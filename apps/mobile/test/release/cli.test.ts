/// <reference types="node" />
/**
 * scripts/release/cli.mjs as the release workflow runs it: a node process
 * with the GitHub run in its environment.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const APP = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(APP, 'scripts/release/cli.mjs')
const APP_VERSION: string = JSON.parse(readFileSync(path.join(APP, 'app.json'), 'utf8')).expo.version

let scratch: string

function cli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env } })
}

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'release-cli-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('cli metadata', () => {
  it('prints the outputs and appends them to GITHUB_OUTPUT', () => {
    const output = path.join(scratch, 'github-output')
    writeFileSync(output, 'earlier=1\n')

    const result = cli(['metadata'], {
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: `v${APP_VERSION}-rc.3`,
      GITHUB_RUN_NUMBER: '17',
      BUILD_NUMBER_OFFSET: '100',
      BUILD_NUMBER_OVERRIDE: '',
      GITHUB_OUTPUT: output,
    })

    const lines = `tag=v${APP_VERSION}-rc.3\nversion=${APP_VERSION}\nchannel=rc\nbuild-number=117\n`
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(lines)
    expect(readFileSync(output, 'utf8')).toBe(`earlier=1\n${lines}`)
  })

  it('fails with an error annotation on a branch', () => {
    const result = cli(['metadata'], { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'develop', GITHUB_RUN_NUMBER: '17' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::A release run needs a release tag, but this run is on the branch develop.')
  })
})

describe('cli set-build-number', () => {
  it('writes the build number into a copy of app.json and keeps the rest', () => {
    const file = path.join(scratch, 'app.json')
    copyFileSync(path.join(APP, 'app.json'), file)
    const before = JSON.parse(readFileSync(file, 'utf8'))

    const result = cli(['set-build-number', '42', file])

    const after = JSON.parse(readFileSync(file, 'utf8'))
    expect(result.status).toBe(0)
    expect(after.expo.ios.buildNumber).toBe('42')
    expect(after.expo.android.versionCode).toBe(42)
    delete after.expo.ios.buildNumber
    delete after.expo.android.versionCode
    expect(after).toEqual(before)
  })

  it('refuses a build number that is not a whole number', () => {
    const file = path.join(scratch, 'app.json')
    copyFileSync(path.join(APP, 'app.json'), file)

    const result = cli(['set-build-number', '4x', file])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::The build number must be a whole number from 1 to 2100000000, got NaN.')
    expect(readFileSync(file, 'utf8')).toBe(readFileSync(path.join(APP, 'app.json'), 'utf8'))
  })
})
