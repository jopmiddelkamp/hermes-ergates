#!/usr/bin/env node
/**
 * The reading and writing side of a store release (RELEASING.md). The rules
 * live in the pure modules next to this file; the release workflows and the
 * build scripts call these commands. Nothing here prints a secret.
 *
 *   node scripts/release/cli.mjs metadata                          version, channel and build number of this run
 *   node scripts/release/cli.mjs set-build-number <n> [app.json]   write the build number into app.json (never committed)
 *   node scripts/release/cli.mjs ios-signing <ExportOptions.plist>  check the App Store profile, sign the Xcode project, write the export options
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appStoreProfileProblems, exportOptionsPlist } from './ios-signing.mjs'
import { formatOutputs, resolveRelease, withBuildNumber } from './metadata.mjs'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APP_JSON = path.join(APP_DIR, 'app.json')

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

const [command, ...args] = process.argv.slice(2)
switch (command) {
  case 'metadata': metadata(); break
  case 'set-build-number': setBuildNumber(...args); break
  case 'ios-signing': iosSigning(...args); break
  default: fail('Usage: node scripts/release/cli.mjs metadata | set-build-number <n> [app.json] | ios-signing <ExportOptions.plist>')
}
