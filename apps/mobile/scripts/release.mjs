#!/usr/bin/env node
/**
 * Store releases for Ergates: EAS Build in the cloud, then EAS Submit to TestFlight and the Google Play
 * internal testing track. Runbook: RELEASING.md. Pure rules: scripts/release-config.mjs.
 *
 *   node scripts/release.mjs check [ios|android|all]   validate secrets and the Expo login, change nothing
 *   node scripts/release.mjs setup                     link the Expo project, lock down .release/, sync eas.json
 *   node scripts/release.mjs ios-credentials           ONE interactive run: create the Apple distribution certificate
 *   node scripts/release.mjs ship [ios|android|all]    tests + typecheck, then build and submit
 *
 * Secret values are never printed.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ASC_KEY_FILE,
  ENV_FILE,
  PLAY_KEY_FILE,
  RELEASE_DIR,
  describeKeyFiles,
  easEnvironment,
  iosSubmitReady,
  parseEnvFile,
  submitProfile,
  validateRelease,
  withIosSubmit,
} from './release-config.mjs'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = relative => path.join(APP_DIR, relative)

function readOptional(relative) {
  return existsSync(at(relative)) ? readFileSync(at(relative), 'utf8') : undefined
}

function fail(lines) {
  for (const line of [].concat(lines)) console.error(`✗ ${line}`)
  process.exit(1)
}

function run(command, args, { env = {}, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: APP_DIR,
    env: { ...process.env, ...env },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  })
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function platformsFrom(arg) {
  if (arg === undefined || arg === 'all') return ['ios', 'android']
  if (arg === 'ios' || arg === 'android') return [arg]
  return fail(`Unknown platform "${arg}". Use ios, android or all.`)
}

function loadEnv() {
  const text = readOptional(ENV_FILE)
  if (text === undefined) fail(`${ENV_FILE} is missing. Copy release.env.example to ${ENV_FILE} and fill it in (RELEASING.md).`)
  return parseEnvFile(text)
}

function assertIgnoredByGit() {
  const probe = run('git', ['check-ignore', '-q', `${RELEASE_DIR}/release.env`], { capture: true })
  if (!probe.ok) fail(`${RELEASE_DIR}/ is not ignored by git. Stop: secrets could be committed.`)
}

function warnOpenPermissions() {
  for (const relative of [ENV_FILE, ASC_KEY_FILE, PLAY_KEY_FILE]) {
    if (existsSync(at(relative)) && (statSync(at(relative)).mode & 0o077) !== 0) {
      console.warn(`! ${relative} is readable by other users. Run: npm run release:setup`)
    }
  }
}

function validate(env, steps) {
  const files = describeKeyFiles(readOptional(ASC_KEY_FILE), readOptional(PLAY_KEY_FILE))
  const problems = validateRelease(env, files, steps)
  if (problems.length > 0) fail(problems)
}

function expoLogin(env) {
  const who = run('npx', ['eas', 'whoami'], { env: easEnvironment(env, at(ASC_KEY_FILE)), capture: true })
  if (!who.ok) fail('Expo rejected EXPO_TOKEN. Create a new personal access token (RELEASING.md, step 1).')
  return who.stdout.trim().split('\n')[0]
}

function projectId() {
  const app = JSON.parse(readFileSync(at('app.json'), 'utf8'))
  return app.expo?.extra?.eas?.projectId
}

function syncEasJson(env) {
  if (!iosSubmitReady(env)) return
  const file = at('eas.json')
  const before = readFileSync(file, 'utf8')
  const after = `${JSON.stringify(withIosSubmit(JSON.parse(before), env), null, 2)}\n`
  if (after !== before) {
    writeFileSync(file, after)
    console.log('✓ eas.json: iOS submit settings written from release.env')
  }
}

function check(platformArg, steps = platformsFrom(platformArg)) {
  assertIgnoredByGit()
  warnOpenPermissions()
  const env = loadEnv()
  validate(env, steps)
  console.log(`✓ secrets complete for: ${steps.join(', ')}`)
  console.log(`✓ Expo login: ${expoLogin(env)}`)
  if (!projectId()) fail('The Expo project is not linked yet. Run: npm run release:setup')
  console.log('✓ Expo project linked')
  return env
}

function setup() {
  assertIgnoredByGit()
  const env = loadEnv()
  validate(env, ['setup'])
  chmodSync(at(RELEASE_DIR), 0o700)
  for (const relative of [ENV_FILE, ASC_KEY_FILE, PLAY_KEY_FILE]) {
    if (existsSync(at(relative))) chmodSync(at(relative), 0o600)
  }
  console.log(`✓ ${RELEASE_DIR}/ readable only by you`)
  console.log(`✓ Expo login: ${expoLogin(env)}`)
  if (!run('npx', ['eas', 'init', '--non-interactive', '--force'], { env: easEnvironment(env, at(ASC_KEY_FILE)) }).ok) {
    fail('eas init failed; see the output above.')
  }
  syncEasJson(env)
  console.log('✓ setup done. Next, once: npm run release:ios-credentials (in your own terminal)')
}

function iosCredentials() {
  const env = check('ios', ['ios-credentials'])
  console.log('This run asks a few questions. Answer yes to register the bundle ID and to create the distribution certificate and the provisioning profile.')
  const ok = run('npx', ['eas', 'credentials:configure-build', '--platform', 'ios', '--profile', 'production'], {
    env: easEnvironment(env, at(ASC_KEY_FILE)),
  }).ok
  if (!ok) fail('Credential setup did not finish.')
  console.log('✓ iOS credentials stored in EAS. Next: create the app record in App Store Connect and set ASC_APP_ID (RELEASING.md).')
}

function ship(platformArg) {
  const platforms = platformsFrom(platformArg)
  const env = check(platformArg)
  syncEasJson(env)
  if (!run('npm', ['test']).ok) fail('Tests failed. Nothing was built.')
  if (!run('npm', ['run', 'typecheck']).ok) fail('Typecheck failed. Nothing was built.')
  const { version } = JSON.parse(readFileSync(at('app.json'), 'utf8')).expo
  for (const platform of platforms) {
    const profile = submitProfile(platform, env)
    console.log(`→ ${platform}: build ${version} and submit with profile "${profile}"`)
    const ok = run('npx', [
      'eas', 'build',
      '--platform', platform,
      '--profile', 'production',
      '--non-interactive',
      '--auto-submit-with-profile', profile,
      '--message', `Ergates ${version}`,
    ], { env: easEnvironment(env, at(ASC_KEY_FILE)) }).ok
    if (!ok) fail(`${platform} build or submit failed; see the output above.`)
  }
  console.log('✓ done. TestFlight and Play process the upload for a few minutes before testers see it.')
}

const [command, arg] = process.argv.slice(2)
switch (command) {
  case 'check': check(arg); break
  case 'setup': setup(); break
  case 'ios-credentials': iosCredentials(); break
  case 'ship': ship(arg); break
  default: fail('Usage: node scripts/release.mjs check|setup|ios-credentials|ship [ios|android|all]')
}
