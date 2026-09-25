import { describe, expect, it } from 'vitest'

import {
  describeKeyFiles,
  easEnvironment,
  iosSubmitReady,
  parseEnvFile,
  submitProfile,
  validateRelease,
  withIosSubmit,
} from '../../scripts/release-config.mjs'

const APPLE = {
  EXPO_TOKEN: 'expo_token_abcdefghijklmnopqrstuvwxyz',
  APPLE_TEAM_ID: 'AB12CD34EF',
  ASC_KEY_ID: 'ZX98YW76VU',
  ASC_ISSUER_ID: '69a6de7e-1234-47e3-e053-5b8c7c11a4d1',
  ASC_APP_ID: '6741234567',
}
const GOOD_FILES = describeKeyFiles(
  '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  JSON.stringify({ type: 'service_account', client_email: 'x@y.iam.gserviceaccount.com', private_key: 'k' }),
)
const NO_FILES = describeKeyFiles(undefined, undefined)

describe('parseEnvFile', () => {
  it('reads keys, drops comments and quotes', () => {
    const env = parseEnvFile('# comment\nA=1\nB = "two words"\nC=3   # trailing\n\nbroken line\nD=\n')
    expect(env).toEqual({ A: '1', B: 'two words', C: '3', D: '' })
  })

  it('reads an empty value followed by a comment as empty', () => {
    expect(parseEnvFile('APPLE_TEAM_ID=          # 10 characters\n')).toEqual({ APPLE_TEAM_ID: '' })
  })
})

describe('validateRelease', () => {
  it('accepts a complete setup for both platforms', () => {
    expect(validateRelease(APPLE, GOOD_FILES, ['ios', 'android'])).toEqual([])
  })

  it('setup needs only the Expo token', () => {
    expect(validateRelease({ EXPO_TOKEN: APPLE.EXPO_TOKEN }, NO_FILES, ['setup'])).toEqual([])
  })

  it('the iOS credential step runs before the app record exists, so it does not need ASC_APP_ID', () => {
    const { ASC_APP_ID: _unused, ...beforeAppRecord } = APPLE
    expect(validateRelease(beforeAppRecord, GOOD_FILES, ['ios-credentials'])).toEqual([])
    expect(validateRelease(beforeAppRecord, GOOD_FILES, ['ios'])).toEqual(['ASC_APP_ID is missing in .release/release.env.'])
  })

  it('names missing keys and files without printing any value', () => {
    const problems = validateRelease({ EXPO_TOKEN: APPLE.EXPO_TOKEN }, NO_FILES, ['ios', 'android'])
    expect(problems).toEqual([
      'APPLE_TEAM_ID is missing in .release/release.env.',
      'ASC_KEY_ID is missing in .release/release.env.',
      'ASC_ISSUER_ID is missing in .release/release.env.',
      'ASC_APP_ID is missing in .release/release.env.',
      '.release/asc-api-key.p8 is missing.',
      '.release/play-service-account.json is missing.',
    ])
    expect(problems.join(' ')).not.toContain(APPLE.EXPO_TOKEN)
  })

  it('rejects malformed values', () => {
    const problems = validateRelease({ ...APPLE, APPLE_TEAM_ID: 'abc', ASC_ISSUER_ID: 'nope', APPLE_TEAM_TYPE: 'SOLO', PLAY_RELEASE_STATUS: 'live' }, GOOD_FILES, ['ios'])
    expect(problems).toHaveLength(4)
    expect(problems.join(' ')).not.toContain('nope')
  })

  it('rejects key files with the wrong content', () => {
    const files = describeKeyFiles('not a key', '{"type":"authorized_user"}')
    expect(validateRelease(APPLE, files, ['ios', 'android'])).toEqual([
      '.release/asc-api-key.p8 is not a .p8 private key file.',
      '.release/play-service-account.json is not a Google service account JSON key.',
    ])
  })
})

describe('iosSubmitReady', () => {
  it('is true only when every iOS submit value is set', () => {
    expect(iosSubmitReady(APPLE)).toBe(true)
    expect(iosSubmitReady({ ...APPLE, ASC_APP_ID: '' })).toBe(false)
  })
})

describe('withIosSubmit', () => {
  it('writes the iOS submit block and keeps the Android one', () => {
    const eas = { submit: { production: { android: { track: 'internal' } } } }
    const next = withIosSubmit(eas, APPLE)
    expect(next.submit.production).toEqual({
      android: { track: 'internal' },
      ios: { ascApiKeyPath: './.release/asc-api-key.p8', ascApiKeyIssuerId: APPLE.ASC_ISSUER_ID, ascApiKeyId: APPLE.ASC_KEY_ID, ascAppId: APPLE.ASC_APP_ID, appleTeamId: APPLE.APPLE_TEAM_ID },
    })
    expect(eas.submit.production).toEqual({ android: { track: 'internal' } })
  })
})

describe('submitProfile', () => {
  it('uses draft Play releases until the owner switches to completed', () => {
    expect(submitProfile('ios', {})).toBe('production')
    expect(submitProfile('android', {})).toBe('play-draft')
    expect(submitProfile('android', { PLAY_RELEASE_STATUS: 'completed' })).toBe('production')
  })
})

describe('easEnvironment', () => {
  it('passes Apple key variables only when they are set', () => {
    expect(easEnvironment({ EXPO_TOKEN: 't' }, '/abs/key.p8')).toEqual({ EXPO_TOKEN: 't' })
    expect(easEnvironment({ ...APPLE, APPLE_TEAM_TYPE: 'INDIVIDUAL' }, '/abs/key.p8')).toEqual({
      EXPO_TOKEN: APPLE.EXPO_TOKEN,
      EXPO_ASC_API_KEY_PATH: '/abs/key.p8',
      EXPO_ASC_KEY_ID: APPLE.ASC_KEY_ID,
      EXPO_ASC_ISSUER_ID: APPLE.ASC_ISSUER_ID,
      EXPO_APPLE_TEAM_ID: APPLE.APPLE_TEAM_ID,
      EXPO_APPLE_TEAM_TYPE: 'INDIVIDUAL',
    })
  })
})
