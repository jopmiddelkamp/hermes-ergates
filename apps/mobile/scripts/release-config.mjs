/**
 * Pure rules for the store release script (`scripts/release.mjs`, runbook: `RELEASING.md`).
 * No process, file-system or network access here, so Vitest covers every rule.
 * Secret values never appear in a returned message: problems name the key, never its value.
 */

export const RELEASE_DIR = '.release'
export const ENV_FILE = `${RELEASE_DIR}/release.env`
export const ASC_KEY_FILE = `${RELEASE_DIR}/asc-api-key.p8`
export const PLAY_KEY_FILE = `${RELEASE_DIR}/play-service-account.json`

const APPLE_TEAM_TYPES = ['INDIVIDUAL', 'COMPANY_OR_ORGANIZATION', 'IN_HOUSE']
const PLAY_RELEASE_STATUSES = ['draft', 'completed']

/** `KEY=value` lines; `#` starts a comment line or a trailing comment after whitespace; quotes around a value are removed. */
export function parseEnvFile(text) {
  const env = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quoted = /^(["'])(.*)\1$/.exec(value)
    if (quoted) value = quoted[2]
    else value = value.replace(/(^|\s+)#.*$/, '').trim()
    env[key] = value
  }
  return env
}

const RULES = {
  EXPO_TOKEN: { test: v => v.length >= 20, hint: 'an Expo personal access token' },
  APPLE_TEAM_ID: { test: v => /^[A-Z0-9]{10}$/.test(v), hint: '10 capital letters or digits' },
  ASC_KEY_ID: { test: v => /^[A-Z0-9]{10}$/.test(v), hint: '10 capital letters or digits' },
  ASC_ISSUER_ID: { test: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v), hint: 'a UUID' },
  ASC_APP_ID: { test: v => /^\d{6,}$/.test(v), hint: 'the digits of the app\'s Apple ID' },
}

/**
 * Which keys each step needs. `setup` only links the Expo project. `ios-credentials` runs before the
 * App Store Connect app record exists (it registers the bundle ID), so it cannot need ASC_APP_ID yet.
 */
export const REQUIRED = {
  setup: ['EXPO_TOKEN'],
  'ios-credentials': ['EXPO_TOKEN', 'APPLE_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID'],
  ios: ['EXPO_TOKEN', 'APPLE_TEAM_ID', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_APP_ID'],
  android: ['EXPO_TOKEN'],
}

/** eas.json gets the iOS submit block only when every value for it is known. */
export function iosSubmitReady(env) {
  return REQUIRED.ios.every(key => Boolean(env[key]))
}

/**
 * Problems with the env file and the key files for the given steps, as plain sentences.
 * `files` says which key files exist and what their content looks like; it never carries the content.
 */
export function validateRelease(env, files, steps) {
  const problems = []
  const keys = [...new Set(steps.flatMap(step => REQUIRED[step]))]
  for (const key of keys) {
    const value = env[key]
    if (!value) problems.push(`${key} is missing in ${ENV_FILE}.`)
    else if (!RULES[key].test(value)) problems.push(`${key} does not look right: expected ${RULES[key].hint}.`)
  }
  if (env.APPLE_TEAM_TYPE && !APPLE_TEAM_TYPES.includes(env.APPLE_TEAM_TYPE)) {
    problems.push(`APPLE_TEAM_TYPE must be one of ${APPLE_TEAM_TYPES.join(', ')}, or left empty.`)
  }
  if (env.PLAY_RELEASE_STATUS && !PLAY_RELEASE_STATUSES.includes(env.PLAY_RELEASE_STATUS)) {
    problems.push(`PLAY_RELEASE_STATUS must be draft or completed.`)
  }
  if (steps.includes('ios') || steps.includes('ios-credentials')) {
    if (!files.ascKey.exists) problems.push(`${ASC_KEY_FILE} is missing.`)
    else if (!files.ascKey.looksLikePrivateKey) problems.push(`${ASC_KEY_FILE} is not a .p8 private key file.`)
  }
  if (steps.includes('android')) {
    if (!files.playKey.exists) problems.push(`${PLAY_KEY_FILE} is missing.`)
    else if (!files.playKey.looksLikeServiceAccount) problems.push(`${PLAY_KEY_FILE} is not a Google service account JSON key.`)
  }
  return problems
}

/** What `validateRelease` needs to know about the key files, derived from their text (the text itself is not kept). */
export function describeKeyFiles(ascKeyText, playKeyText) {
  let serviceAccount = false
  if (playKeyText !== undefined) {
    try {
      const json = JSON.parse(playKeyText)
      serviceAccount = json.type === 'service_account' && typeof json.client_email === 'string' && typeof json.private_key === 'string'
    } catch {
      serviceAccount = false
    }
  }
  return {
    ascKey: { exists: ascKeyText !== undefined, looksLikePrivateKey: ascKeyText !== undefined && /-----BEGIN PRIVATE KEY-----/.test(ascKeyText) },
    playKey: { exists: playKeyText !== undefined, looksLikeServiceAccount: serviceAccount },
  }
}

/**
 * eas.json with the iOS submit block written from the env file. The IDs are identifiers, not secrets;
 * the secret is the .p8 file, which stays in the git-ignored release folder.
 */
export function withIosSubmit(easJson, env) {
  const next = structuredClone(easJson)
  next.submit ??= {}
  next.submit.production ??= {}
  next.submit.production.ios = {
    ascApiKeyPath: `./${ASC_KEY_FILE}`,
    ascApiKeyIssuerId: env.ASC_ISSUER_ID,
    ascApiKeyId: env.ASC_KEY_ID,
    ascAppId: env.ASC_APP_ID,
    appleTeamId: env.APPLE_TEAM_ID,
  }
  return next
}

/** The submit profile per platform. A Play app in draft status accepts only draft releases. */
export function submitProfile(platform, env) {
  if (platform === 'ios') return 'production'
  return (env.PLAY_RELEASE_STATUS || 'draft') === 'completed' ? 'production' : 'play-draft'
}

/** Environment for eas-cli. Only keys that are set are passed. */
export function easEnvironment(env, ascKeyAbsolutePath) {
  const out = { EXPO_TOKEN: env.EXPO_TOKEN }
  if (env.ASC_KEY_ID && env.ASC_ISSUER_ID) {
    out.EXPO_ASC_API_KEY_PATH = ascKeyAbsolutePath
    out.EXPO_ASC_KEY_ID = env.ASC_KEY_ID
    out.EXPO_ASC_ISSUER_ID = env.ASC_ISSUER_ID
  }
  if (env.APPLE_TEAM_ID) out.EXPO_APPLE_TEAM_ID = env.APPLE_TEAM_ID
  if (env.APPLE_TEAM_TYPE) out.EXPO_APPLE_TEAM_TYPE = env.APPLE_TEAM_TYPE
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value))
}
