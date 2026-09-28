#!/usr/bin/env node
/**
 * The reading and writing side of a store release (RELEASING.md). The rules
 * live in the pure modules next to this file; the release workflows and the
 * build scripts call these commands. Nothing here prints a secret.
 *
 *   node scripts/release/cli.mjs metadata                          version, channel and build number of this run
 *   node scripts/release/cli.mjs set-build-number <n> [app.json]   write the build number into app.json (never committed)
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatOutputs, resolveRelease, withBuildNumber } from './metadata.mjs'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const APP_JSON = path.join(APP_DIR, 'app.json')

/** `::error::` makes GitHub show the message on the run page; locally it is plain text. */
function fail(message) {
  console.error(`::error::${message}`)
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

const [command, ...args] = process.argv.slice(2)
switch (command) {
  case 'metadata': metadata(); break
  case 'set-build-number': setBuildNumber(...args); break
  default: fail('Usage: node scripts/release/cli.mjs metadata | set-build-number <n> [app.json]')
}
