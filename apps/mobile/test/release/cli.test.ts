/// <reference types="node" />
/**
 * scripts/release/cli.mjs as the release workflow runs it: a node process
 * with the GitHub run in its environment.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

describe('cli ios-signing', () => {
  it('refuses a development profile before it writes anything', () => {
    const exportOptions = path.join(scratch, 'ExportOptions.plist')

    const result = cli(['ios-signing', exportOptions], {
      APPLE_TEAM_ID: 'AB12CD34EF',
      PROFILE_NAME: 'Ergates Development',
      PROFILE_UUID: '0f5e3c9a-1111-4222-8333-944455556666',
      PROFILE_TEAM_ID: 'AB12CD34EF',
      PROFILE_APP_ID: 'AB12CD34EF.dev.ergates.mobile',
      PROFILE_GET_TASK_ALLOW: 'true',
      PROFILE_DEVICES: '',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toBe('::error::The provisioning profile is a development or ad hoc profile. Create an App Store profile (RELEASING.md).\n')
    expect(existsSync(exportOptions)).toBe(false)
  })
})

describe('cli secrets', () => {
  const RELEASE_ENV = [
    'APPLE_TEAM_ID=AB12CD34EF',
    'IOS_DIST_CERT_PASSWORD=p12-secret',
    'APP_STORE_CONNECT_KEY_ID=ZX98YW76VU',
    'APP_STORE_CONNECT_ISSUER_ID=69a6de7e-1234-47e3-a053-5b8c7c11a4d1',
    'ANDROID_UPLOAD_KEY_ALIAS=upload',
    'ANDROID_UPLOAD_KEYSTORE_PASSWORD=keystore-secret',
    'ANDROID_UPLOAD_KEY_PASSWORD=keystore-secret',
    '',
  ].join('\n')
  const P8 = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n'
  const PLAY_JSON = JSON.stringify({ type: 'service_account', client_email: 'ci@ergates.iam.gserviceaccount.com', private_key: 'k' })
  const GH_STUB = [
    '#!/usr/bin/env bash',
    `{ printf 'gh'; printf ' %s' "$@"; printf '\\n'; printf 'stdin=%s\\n' "$(cat)"; } >> "$GH_LOG"`,
    'case "$*" in',
    '  "api repos/{owner}/{repo}/environments/app-stores") exit 1 ;;',
    `  "api repos/{owner}/{repo}/environments/app-stores/deployment-branch-policies") echo '{"total_count":0,"branch_policies":[]}' ;;`,
    'esac',
    '',
  ].join('\n')

  function releaseFolder(env = RELEASE_ENV): string {
    const dir = path.join(scratch, 'release')
    mkdirSync(dir, { mode: 0o700 })
    const files: Record<string, string | Buffer> = {
      'release.env': env,
      'ios-distribution.p12': Buffer.from([48, 130, 1, 2]),
      'ios-appstore.mobileprovision': Buffer.from([48, 128, 6, 9]),
      'asc-api-key.p8': P8,
      'android-upload.jks': Buffer.from([48, 130, 10, 4]),
      'play-service-account.json': PLAY_JSON,
    }
    for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content, { mode: 0o600 })
    return dir
  }

  function withFakeGh(): { PATH: string; GH_LOG: string } {
    const bin = path.join(scratch, 'bin')
    mkdirSync(bin)
    writeFileSync(path.join(bin, 'gh'), GH_STUB, { mode: 0o755 })
    return { PATH: `${bin}:${process.env.PATH ?? ''}`, GH_LOG: path.join(scratch, 'gh.log') }
  }

  it('check names what is missing and uploads nothing', () => {
    const dir = path.join(scratch, 'release')
    mkdirSync(dir, { mode: 0o700 })
    writeFileSync(path.join(dir, 'release.env'), 'APPLE_TEAM_ID=AB12CD34EF\n', { mode: 0o600 })

    const result = cli(['secrets-check'], { ERGATES_RELEASE_DIR: dir })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::IOS_DIST_CERT_PASSWORD is missing in release.env.')
    expect(result.stderr).toContain('::error::ios-distribution.p12 is missing.')
  })

  it('upload creates the environment with its tag rule and sends every value on stdin', () => {
    const gh = withFakeGh()

    const result = cli(['secrets-upload'], { ERGATES_RELEASE_DIR: releaseFolder(), ...gh })

    expect(result.status).toBe(0)
    expect(result.stdout).not.toMatch(/p12-secret|keystore-secret|BEGIN PRIVATE KEY/)
    expect(result.stdout).toContain('✓ environment app-stores created\n')
    expect(result.stdout).toContain('✓ secret APP_STORE_CONNECT_PRIVATE_KEY\n')
    expect(result.stdout).toContain('✓ variable APPLE_TEAM_ID\n')
    const log = readFileSync(gh.GH_LOG, 'utf8')
    const calls = log.split('\n').filter(line => line.startsWith('gh '))
    expect(calls.slice(0, 4)).toEqual([
      'gh api repos/{owner}/{repo}/environments/app-stores',
      'gh api --method PUT repos/{owner}/{repo}/environments/app-stores --input -',
      'gh api repos/{owner}/{repo}/environments/app-stores/deployment-branch-policies',
      'gh api --method POST repos/{owner}/{repo}/environments/app-stores/deployment-branch-policies --input -',
    ])
    expect(calls).toHaveLength(4 + 11 + 1)
    expect(calls.join('\n')).not.toMatch(/p12-secret|keystore-secret/)
    expect(log).toContain('gh secret set IOS_DIST_CERT_PASSWORD --env app-stores\nstdin=p12-secret\n')
    expect(log).toContain('gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --env app-stores\nstdin=MIIKBA==\n')
    expect(log).toContain('stdin={"name":"v*","type":"tag"}\n')
  })

  it('make-upload-keystore refuses two different passwords before it runs keytool', () => {
    const env = RELEASE_ENV.replace('ANDROID_UPLOAD_KEY_PASSWORD=keystore-secret', 'ANDROID_UPLOAD_KEY_PASSWORD=other-secret')
    const dir = releaseFolder(env)
    rmSync(path.join(dir, 'android-upload.jks'))

    const result = cli(['make-upload-keystore'], { ERGATES_RELEASE_DIR: dir })

    expect(result.status).toBe(1)
    expect(result.stderr).toBe(
      '::error::ANDROID_UPLOAD_KEY_PASSWORD must be the same as ANDROID_UPLOAD_KEYSTORE_PASSWORD: a PKCS12 keystore has one password.\n'
    )
    expect(existsSync(path.join(dir, 'android-upload.jks'))).toBe(false)
  })
})
