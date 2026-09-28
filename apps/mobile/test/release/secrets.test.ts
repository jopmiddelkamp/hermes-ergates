import { describe, expect, it } from 'vitest'

import {
  FILES,
  MAX_SECRET_BYTES,
  SECRETS,
  VARIABLES,
  hasTagPolicy,
  keystoreProblems,
  keytoolArguments,
  parseEnvFile,
  secretProblems,
  secretValue,
} from '../../scripts/release/secrets.mjs'

const ENV = {
  APPLE_TEAM_ID: 'AB12CD34EF',
  IOS_DIST_CERT_PASSWORD: 'p12-secret',
  APP_STORE_CONNECT_KEY_ID: 'ZX98YW76VU',
  APP_STORE_CONNECT_ISSUER_ID: '69a6de7e-1234-47e3-a053-5b8c7c11a4d1',
  ANDROID_UPLOAD_KEY_ALIAS: 'upload',
  ANDROID_UPLOAD_KEYSTORE_PASSWORD: 'keystore-secret',
  ANDROID_UPLOAD_KEY_PASSWORD: 'keystore-secret',
}
const P8 = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n'
const PLAY_JSON = JSON.stringify({ type: 'service_account', client_email: 'ci@ergates.iam.gserviceaccount.com', private_key: 'k' })
const FILES_OK = {
  [FILES.iosCertificate]: { size: 3300 },
  [FILES.iosProfile]: { size: 12000 },
  [FILES.ascKey]: { size: P8.length, text: P8 },
  [FILES.androidKeystore]: { size: 2600 },
  [FILES.playKey]: { size: PLAY_JSON.length, text: PLAY_JSON },
}

describe('parseEnvFile', () => {
  it('reads keys, drops comments and quotes', () => {
    const env = parseEnvFile('# comment\nA=1\nB = "two words"\nC=3   # trailing\n\nbroken line\nD=\n')
    expect(env).toEqual({ A: '1', B: 'two words', C: '3', D: '' })
  })

  it('reads an empty value followed by a comment as empty', () => {
    expect(parseEnvFile('APPLE_TEAM_ID=          # 10 characters\n')).toEqual({ APPLE_TEAM_ID: '' })
  })
})

describe('the secret list', () => {
  it('covers every secret and variable the release workflows read', () => {
    expect(SECRETS.map(secret => secret.name)).toEqual([
      'IOS_DIST_CERT_P12_BASE64',
      'IOS_DIST_CERT_PASSWORD',
      'IOS_APPSTORE_PROFILE_BASE64',
      'APP_STORE_CONNECT_KEY_ID',
      'APP_STORE_CONNECT_ISSUER_ID',
      'APP_STORE_CONNECT_PRIVATE_KEY',
      'ANDROID_UPLOAD_KEYSTORE_BASE64',
      'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
      'ANDROID_UPLOAD_KEY_ALIAS',
      'ANDROID_UPLOAD_KEY_PASSWORD',
      'PLAY_SERVICE_ACCOUNT_JSON',
    ])
    expect(VARIABLES.map(variable => variable.name)).toEqual(['APPLE_TEAM_ID'])
  })
})

describe('secretProblems', () => {
  it('is empty when every value and file is there', () => {
    expect(secretProblems(ENV, FILES_OK)).toEqual([])
  })

  it('names every missing key and file, without a value', () => {
    const problems = secretProblems({ IOS_DIST_CERT_PASSWORD: 'p12-secret' }, {})
    expect(problems).toEqual([
      'APPLE_TEAM_ID is missing in release.env.',
      'APP_STORE_CONNECT_KEY_ID is missing in release.env.',
      'APP_STORE_CONNECT_ISSUER_ID is missing in release.env.',
      'ANDROID_UPLOAD_KEYSTORE_PASSWORD is missing in release.env.',
      'ANDROID_UPLOAD_KEY_ALIAS is missing in release.env.',
      'ANDROID_UPLOAD_KEY_PASSWORD is missing in release.env.',
      'ios-distribution.p12 is missing.',
      'ios-appstore.mobileprovision is missing.',
      'asc-api-key.p8 is missing.',
      'android-upload.jks is missing.',
      'play-service-account.json is missing.',
    ])
    expect(problems.join(' ')).not.toContain('p12-secret')
  })

  it('refuses malformed values without repeating them', () => {
    const problems = secretProblems({ ...ENV, APPLE_TEAM_ID: 'abc', APP_STORE_CONNECT_ISSUER_ID: 'nope', ANDROID_UPLOAD_KEYSTORE_PASSWORD: 'short' }, FILES_OK)
    expect(problems).toEqual([
      'APPLE_TEAM_ID in release.env does not look right: expected 10 capital letters or digits.',
      'APP_STORE_CONNECT_ISSUER_ID in release.env does not look right: expected a UUID.',
      'ANDROID_UPLOAD_KEYSTORE_PASSWORD in release.env does not look right: expected at least 6 characters.',
    ])
    expect(problems.join(' ')).not.toContain('nope')
  })

  it('refuses key files with the wrong content, empty files and files over the GitHub limit', () => {
    const files = {
      ...FILES_OK,
      [FILES.ascKey]: { size: 9, text: 'not a key' },
      [FILES.playKey]: { size: 26, text: '{"type":"authorized_user"}' },
      [FILES.iosCertificate]: { size: 0 },
      [FILES.iosProfile]: { size: (MAX_SECRET_BYTES / 4) * 3 + 1 },
    }
    expect(secretProblems(ENV, files)).toEqual([
      'ios-distribution.p12 is empty.',
      'ios-appstore.mobileprovision is too large for a GitHub secret (48 KB).',
      'asc-api-key.p8 is not an App Store Connect .p8 private key.',
      'play-service-account.json is not a Google service account JSON key.',
    ])
  })
})

describe('secretValue', () => {
  const read = (name: string) => Buffer.from(name === FILES.ascKey ? P8 : [0, 1, 2, 250])

  it('takes a release.env value, a text file as text and a binary file as base64', () => {
    const byName = (name: string) => SECRETS.find(secret => secret.name === name)!
    expect(secretValue(byName('IOS_DIST_CERT_PASSWORD'), ENV, read)).toBe('p12-secret')
    expect(secretValue(byName('APP_STORE_CONNECT_PRIVATE_KEY'), ENV, read)).toBe(P8)
    expect(secretValue(byName('ANDROID_UPLOAD_KEYSTORE_BASE64'), ENV, read)).toBe('AAEC+g==')
    expect(secretValue(VARIABLES[0], ENV, read)).toBe('AB12CD34EF')
  })
})

describe('keystoreProblems', () => {
  it('is empty with an alias and one password for both', () => {
    expect(keystoreProblems(ENV, false)).toEqual([])
  })

  it('asks for the same password twice, because PKCS12 has one', () => {
    expect(keystoreProblems({ ...ENV, ANDROID_UPLOAD_KEY_PASSWORD: 'other-secret' }, false)).toEqual([
      'ANDROID_UPLOAD_KEY_PASSWORD must be the same as ANDROID_UPLOAD_KEYSTORE_PASSWORD: a PKCS12 keystore has one password.',
    ])
  })

  it('never replaces an existing keystore', () => {
    expect(keystoreProblems(ENV, true)).toEqual([
      'android-upload.jks already exists. Google Play knows the upload key by its certificate, so keep the file; move it away first to make a new one.',
    ])
  })

  it('names missing values', () => {
    expect(keystoreProblems({}, false)).toEqual([
      'ANDROID_UPLOAD_KEYSTORE_PASSWORD is missing in release.env.',
      'ANDROID_UPLOAD_KEY_ALIAS is missing in release.env.',
      'ANDROID_UPLOAD_KEY_PASSWORD is missing in release.env.',
    ])
  })
})

describe('keytoolArguments', () => {
  it('passes the passwords by variable name, never by value', () => {
    const args = keytoolArguments(ENV, '/home/me/.release/android-upload.jks')
    expect(args).toEqual([
      '-genkeypair',
      '-keystore', '/home/me/.release/android-upload.jks',
      '-storetype', 'PKCS12',
      '-alias', 'upload',
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-dname', 'CN=Ergates upload key',
      '-storepass:env', 'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
      '-keypass:env', 'ANDROID_UPLOAD_KEY_PASSWORD',
      '-noprompt',
    ])
    expect(args.join(' ')).not.toContain('keystore-secret')
  })
})

describe('hasTagPolicy', () => {
  it('finds the v* tag rule among the deployment policies', () => {
    expect(hasTagPolicy({ total_count: 0, branch_policies: [] })).toBe(false)
    expect(hasTagPolicy({ total_count: 1, branch_policies: [{ id: 1, name: 'v*', type: 'branch' }] })).toBe(false)
    expect(hasTagPolicy({ total_count: 1, branch_policies: [{ id: 2, name: 'v*', type: 'tag' }] })).toBe(true)
  })
})
