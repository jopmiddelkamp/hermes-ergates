#!/usr/bin/env node
/**
 * The reading and writing side of a store release (RELEASING.md). The rules
 * live in the pure modules next to this file; the release workflows and the
 * build scripts call these commands. Nothing here prints a secret.
 *
 *   node scripts/release/cli.mjs metadata                          version, channel and build number of this run
 *   node scripts/release/cli.mjs set-build-number <n> [app.json]   write the build number into app.json (never committed)
 *   node scripts/release/cli.mjs ios-signing <ExportOptions.plist>  check the App Store profile, sign the Xcode project, write the export options
 *   node scripts/release/cli.mjs secrets-check                     what is missing in the release folder (upload-secrets.sh --check)
 *   node scripts/release/cli.mjs secrets-upload                    create the app-stores environment when missing, set its secrets
 *   node scripts/release/cli.mjs make-upload-keystore              create the Android upload keystore in the release folder
 *
 * The release folder is apps/mobile/.release, or ERGATES_RELEASE_DIR when set.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appStoreProfileProblems, exportOptionsPlist } from './ios-signing.mjs'
import { formatOutputs, resolveRelease, withBuildNumber } from './metadata.mjs'
import {
  ENVIRONMENT,
  ENVIRONMENT_BODY,
  ENV_FILE,
  FILES,
  SECRETS,
  TAG_PATTERN,
  TAG_POLICY_BODY,
  VARIABLES,
  hasTagPolicy,
  keystoreProblems,
  keytoolArguments,
  parseEnvFile,
  secretProblems,
  secretValue,
} from './secrets.mjs'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APP_JSON = path.join(APP_DIR, 'app.json')
const RELEASE_DIR = process.env.ERGATES_RELEASE_DIR || path.join(APP_DIR, '.release')

/** `::error::` makes GitHub show each line on the run page; locally it is plain text. */
function fail(lines) {
  for (const line of [].concat(lines)) console.error(`::error::${line}`)
  process.exit(1)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function attempt(rule) {
  try {
    return rule()
  } catch (error) {
    return fail(error.message)
  }
}

/** Reads the GitHub run from the environment; appends the outputs to $GITHUB_OUTPUT when it is set. */
function metadata() {
  const env = process.env
  const release = attempt(() =>
    resolveRelease({
      refType: env.GITHUB_REF_TYPE ?? '',
      refName: env.GITHUB_REF_NAME ?? '',
      runNumber: env.GITHUB_RUN_NUMBER ?? '',
      offset: env.BUILD_NUMBER_OFFSET ?? '',
      override: env.BUILD_NUMBER_OVERRIDE ?? '',
      appVersion: readJson(APP_JSON).expo.version,
    })
  )
  const lines = formatOutputs(release)
  process.stdout.write(lines)
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines)
}

function setBuildNumber(text, file = APP_JSON) {
  const buildNumber = /^\d+$/.test(text ?? '') ? Number(text) : Number.NaN
  const next = attempt(() => withBuildNumber(readJson(file), buildNumber))
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`${path.basename(file)}: build number ${buildNumber}`)
}

/**
 * After `expo prebuild`: checks the profile that build-ios.sh read into the
 * PROFILE_* variables, signs the Release configuration of the app target
 * (only that target: a profile set on the xcodebuild command line would reach
 * the Pods targets too), and writes the export options.
 */
function iosSigning(exportOptionsPath) {
  const env = process.env
  const app = { teamId: env.APPLE_TEAM_ID ?? '', bundleId: readJson(APP_JSON).expo.ios.bundleIdentifier }
  const profile = {
    name: env.PROFILE_NAME ?? '',
    uuid: env.PROFILE_UUID ?? '',
    teamId: env.PROFILE_TEAM_ID ?? '',
    appId: env.PROFILE_APP_ID ?? '',
    getTaskAllow: env.PROFILE_GET_TASK_ALLOW ?? '',
    hasDevices: Boolean(env.PROFILE_DEVICES),
  }
  const problems = appStoreProfileProblems(profile, app)
  if (problems.length > 0) fail(problems)
  if (!exportOptionsPath) fail('Usage: node scripts/release/cli.mjs ios-signing <ExportOptions.plist>')
  // Loaded here, not at the top: the metadata job runs this file without node_modules.
  const { IOSConfig } = createRequire(import.meta.url)('expo/config-plugins')
  const targetName = IOSConfig.XcodeUtils.getProjectName(APP_DIR)
  IOSConfig.ProvisioningProfile.setProvisioningProfileForPbxproj(APP_DIR, {
    targetName,
    profileName: profile.name,
    appleTeamId: app.teamId,
    buildConfiguration: 'Release',
    codeSignIdentity: 'Apple Distribution',
  })
  writeFileSync(exportOptionsPath, exportOptionsPlist({ ...app, profileName: profile.name }))
  console.log(`ios-signing: ${targetName} Release signs with "${profile.name}"; export options in ${exportOptionsPath}`)
}

function inRelease(name) {
  return path.join(RELEASE_DIR, name)
}

function loadReleaseEnv() {
  const file = inRelease(ENV_FILE)
  if (!existsSync(file)) {
    fail(`${file} is missing. Copy scripts/release/release.env.example there and fill it in (RELEASING.md).`)
  }
  return parseEnvFile(readFileSync(file, 'utf8'))
}

/** Size of each file that exists; the text of the two text files, for the shape checks only. */
function describeFiles() {
  const files = {}
  for (const name of Object.values(FILES)) {
    if (!existsSync(inRelease(name))) continue
    files[name] = { size: statSync(inRelease(name)).size }
    if (name === FILES.ascKey || name === FILES.playKey) files[name].text = readFileSync(inRelease(name), 'utf8')
  }
  return files
}

/**
 * Git must never see the release folder, but only when it is actually inside
 * this repository's work tree: a folder outside it (an absolute
 * ERGATES_RELEASE_DIR elsewhere, for example) can never be committed from
 * here, so there is nothing to check. "Inside" is decided by comparing real
 * paths (resolved symlinks) against `git rev-parse --show-toplevel`. When
 * that call fails, the repository root is unknown, so this fails closed the
 * same way as an unreadable check-ignore result. Inside the work tree,
 * `git check-ignore` exits 1 for a path it would track (a real problem), 0
 * for a path it ignores; any other exit (for example 128) means the
 * question could not be answered, so this also fails closed there.
 */
function gitProblems() {
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: APP_DIR, encoding: 'utf8' })
  if (root.error || root.status !== 0) return [`cannot verify ${RELEASE_DIR} is ignored by git.`]
  const repoRoot = realpathSync(root.stdout.trim())
  const releasePath = realpathSync(RELEASE_DIR)
  const inside = releasePath === repoRoot || releasePath.startsWith(repoRoot + path.sep)
  if (!inside) return []
  // Probe the resolved path, relative to the resolved repo root, and run git
  // from that root: a RELEASE_DIR whose own path sits outside the work tree
  // but whose target resolves inside it (the macOS /tmp -> /private/tmp
  // case) makes git exit 128 ("outside repository") on the unresolved path,
  // even when the real underlying file is genuinely ignored.
  const probe = spawnSync('git', ['check-ignore', '-q', path.relative(repoRoot, path.join(releasePath, ENV_FILE))], { cwd: repoRoot })
  if (probe.status === 0) return []
  if (probe.status === 1) return [`${RELEASE_DIR} is not ignored by git. Stop: the secrets could be committed.`]
  return [`cannot verify ${RELEASE_DIR} is ignored by git.`]
}

/** The release folder must be 700 and every file in it 600; group/other-readable refuses, it does not just warn. */
function permissionProblems() {
  const open = [RELEASE_DIR, ...Object.values(FILES).map(inRelease), inRelease(ENV_FILE)]
    .filter(file => existsSync(file) && (statSync(file).mode & 0o077) !== 0)
  return open.map(file => `${file} is readable by other users: chmod ${file === RELEASE_DIR ? '700' : '600'} it.`)
}

function secretsCheck() {
  const env = loadReleaseEnv()
  const problems = [...permissionProblems(), ...gitProblems(), ...secretProblems(env, describeFiles())]
  if (problems.length > 0) fail(problems)
  console.log(`✓ ${RELEASE_DIR}: every secret of the ${ENVIRONMENT} environment is ready`)
  return env
}

/** Runs gh; a secret goes in as `input` on stdin, never as an argument. */
function gh(args, input) {
  const result = spawnSync('gh', args, { cwd: APP_DIR, input, encoding: 'utf8' })
  return { ok: !result.error && result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function ghOrFail(args, input) {
  const result = gh(args, input)
  if (!result.ok) {
    process.stderr.write(result.stderr)
    fail(`gh ${args.slice(0, 3).join(' ')} failed. Check gh auth status and that this folder's git remote is the GitHub repository.`)
  }
  return result.stdout
}

function secretsUpload() {
  const env = secretsCheck()
  const environment = `repos/{owner}/{repo}/environments/${ENVIRONMENT}`
  // Always PUT: a misconfigured environment (wrong deployment_branch_policy,
  // for example set up by hand) gets repaired, not just created once.
  const existed = gh(['api', environment]).ok
  ghOrFail(['api', '--method', 'PUT', environment, '--input', '-'], JSON.stringify(ENVIRONMENT_BODY))
  console.log(`✓ environment ${ENVIRONMENT} ${existed ? 'updated' : 'created'}`)
  const policies = JSON.parse(ghOrFail(['api', `${environment}/deployment-branch-policies`]))
  if (!hasTagPolicy(policies)) {
    ghOrFail(['api', '--method', 'POST', `${environment}/deployment-branch-policies`, '--input', '-'], JSON.stringify(TAG_POLICY_BODY))
  }
  console.log(`✓ environment ${ENVIRONMENT}: only tags matching ${TAG_PATTERN} deploy`)
  const readFile = name => readFileSync(inRelease(name))
  for (const secret of SECRETS) {
    ghOrFail(['secret', 'set', secret.name, '--env', ENVIRONMENT], secretValue(secret, env, readFile))
    console.log(`✓ secret ${secret.name}`)
  }
  for (const variable of VARIABLES) {
    ghOrFail(['variable', 'set', variable.name, '--env', ENVIRONMENT], secretValue(variable, env, readFile))
    console.log(`✓ variable ${variable.name}`)
  }
}

function makeUploadKeystore() {
  const env = loadReleaseEnv()
  const keystore = inRelease(FILES.androidKeystore)
  const problems = keystoreProblems(env, existsSync(keystore))
  if (problems.length > 0) fail(problems)
  const passwords = {
    ANDROID_UPLOAD_KEYSTORE_PASSWORD: env.ANDROID_UPLOAD_KEYSTORE_PASSWORD,
    ANDROID_UPLOAD_KEY_PASSWORD: env.ANDROID_UPLOAD_KEY_PASSWORD,
  }
  const result = spawnSync('keytool', keytoolArguments(env, keystore), { env: { ...process.env, ...passwords }, stdio: 'inherit' })
  if (result.error || result.status !== 0) fail('keytool failed; see the output above. keytool comes with a JDK, for example Java 17.')
  chmodSync(keystore, 0o600)
  // No secret value in this message: ANDROID_UPLOAD_KEY_ALIAS is one of SECRETS.
  console.log(`✓ ${keystore} created`)
}

const [command, ...args] = process.argv.slice(2)
switch (command) {
  case 'metadata': metadata(); break
  case 'set-build-number': setBuildNumber(...args); break
  case 'ios-signing': iosSigning(...args); break
  case 'secrets-check': secretsCheck(); break
  case 'secrets-upload': secretsUpload(); break
  case 'make-upload-keystore': makeUploadKeystore(); break
  default: fail('Usage: node scripts/release/cli.mjs metadata | set-build-number | ios-signing | secrets-check | secrets-upload | make-upload-keystore')
}
