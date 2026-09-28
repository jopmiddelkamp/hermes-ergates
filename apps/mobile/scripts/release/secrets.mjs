/**
 * Pure rules for the release secrets (RELEASING.md): which secret of the
 * GitHub environment comes from which file or release.env key, whether the
 * local files look right, and how the upload keystore is made. No process,
 * file or network access here; scripts/release/cli.mjs reads the files and
 * runs `gh` and `keytool`. A message names a key or a file, never a value.
 */
import { Buffer } from 'node:buffer'

export const ENVIRONMENT = 'app-stores'
/** The environment's deployment rule: only runs on tags matching this pattern get its secrets. */
export const TAG_PATTERN = 'v*'

/** File names inside the release folder (default apps/mobile/.release, git-ignored). */
export const ENV_FILE = 'release.env'
export const FILES = {
  iosCertificate: 'ios-distribution.p12',
  iosProfile: 'ios-appstore.mobileprovision',
  ascKey: 'asc-api-key.p8',
  androidKeystore: 'android-upload.jks',
  playKey: 'play-service-account.json',
}

/** Each environment secret comes from a release.env key or a file; binary files go up as base64. */
export const SECRETS = [
  { name: 'IOS_DIST_CERT_P12_BASE64', file: FILES.iosCertificate, base64: true },
  { name: 'IOS_DIST_CERT_PASSWORD', key: 'IOS_DIST_CERT_PASSWORD' },
  { name: 'IOS_APPSTORE_PROFILE_BASE64', file: FILES.iosProfile, base64: true },
  { name: 'APP_STORE_CONNECT_KEY_ID', key: 'APP_STORE_CONNECT_KEY_ID' },
  { name: 'APP_STORE_CONNECT_ISSUER_ID', key: 'APP_STORE_CONNECT_ISSUER_ID' },
  { name: 'APP_STORE_CONNECT_PRIVATE_KEY', file: FILES.ascKey },
  { name: 'ANDROID_UPLOAD_KEYSTORE_BASE64', file: FILES.androidKeystore, base64: true },
  { name: 'ANDROID_UPLOAD_KEYSTORE_PASSWORD', key: 'ANDROID_UPLOAD_KEYSTORE_PASSWORD' },
  { name: 'ANDROID_UPLOAD_KEY_ALIAS', key: 'ANDROID_UPLOAD_KEY_ALIAS' },
  { name: 'ANDROID_UPLOAD_KEY_PASSWORD', key: 'ANDROID_UPLOAD_KEY_PASSWORD' },
  { name: 'PLAY_SERVICE_ACCOUNT_JSON', file: FILES.playKey },
]
/** Environment variables: identifiers, not secrets. */
export const VARIABLES = [{ name: 'APPLE_TEAM_ID', key: 'APPLE_TEAM_ID' }]

/** GitHub refuses a secret larger than 48 KB (docs.github.com, "Limits for secrets"). */
export const MAX_SECRET_BYTES = 48 * 1024

const KEY_RULES = {
  APPLE_TEAM_ID: [/^[A-Z0-9]{10}$/, '10 capital letters or digits'],
  APP_STORE_CONNECT_KEY_ID: [/^[A-Z0-9]{10}$/, '10 capital letters or digits'],
  APP_STORE_CONNECT_ISSUER_ID: [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'a UUID'],
  IOS_DIST_CERT_PASSWORD: [/^.+$/, 'the password of the .p12 export'],
  ANDROID_UPLOAD_KEYSTORE_PASSWORD: [/^.{6,}$/, 'at least 6 characters'],
  ANDROID_UPLOAD_KEY_ALIAS: [/^[A-Za-z0-9._-]+$/, 'letters, digits, dots, dashes or underscores'],
  ANDROID_UPLOAD_KEY_PASSWORD: [/^.{6,}$/, 'at least 6 characters'],
}

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

function base64Length(bytes) {
  return 4 * Math.ceil(bytes / 3)
}

/**
 * Everything that stops an upload, as sentences; empty when all is ready.
 * `files` maps each file name of FILES to `{ size }` when the file exists,
 * with `text` for the two text files (the .p8 key and the JSON key).
 */
export function secretProblems(env, files) {
  const problems = []
  for (const [key, [rule, hint]] of Object.entries(KEY_RULES)) {
    if (!env[key]) problems.push(`${key} is missing in ${ENV_FILE}.`)
    else if (!rule.test(env[key])) problems.push(`${key} in ${ENV_FILE} does not look right: expected ${hint}.`)
  }
  for (const secret of SECRETS.filter(entry => entry.file)) {
    const file = files[secret.file]
    if (!file) {
      problems.push(`${secret.file} is missing.`)
    } else if (file.size === 0) {
      problems.push(`${secret.file} is empty.`)
    } else if ((secret.base64 ? base64Length(file.size) : file.size) > MAX_SECRET_BYTES) {
      problems.push(`${secret.file} is too large for a GitHub secret (48 KB).`)
    }
  }
  const ascKey = files[FILES.ascKey]
  if (ascKey?.text !== undefined && !ascKey.text.includes('-----BEGIN PRIVATE KEY-----')) {
    problems.push(`${FILES.ascKey} is not an App Store Connect .p8 private key.`)
  }
  const playKey = files[FILES.playKey]
  if (playKey?.text !== undefined && !isServiceAccount(playKey.text)) {
    problems.push(`${FILES.playKey} is not a Google service account JSON key.`)
  }
  return problems
}

function isServiceAccount(text) {
  try {
    const json = JSON.parse(text)
    return json.type === 'service_account' && typeof json.client_email === 'string' && typeof json.private_key === 'string'
  } catch {
    return false
  }
}

/** What `gh secret set` or `gh variable set` reads from stdin. `readFile(name)` gives the file's bytes. */
export function secretValue(entry, env, readFile) {
  if (entry.key) return env[entry.key]
  const bytes = readFile(entry.file)
  return entry.base64 ? Buffer.from(bytes).toString('base64') : Buffer.from(bytes).toString('utf8')
}

/**
 * Why the upload keystore cannot be made yet. A PKCS12 keystore has one
 * password, so the key password must be the keystore password.
 */
export function keystoreProblems(env, keystoreExists) {
  const problems = []
  for (const key of ['ANDROID_UPLOAD_KEYSTORE_PASSWORD', 'ANDROID_UPLOAD_KEY_ALIAS', 'ANDROID_UPLOAD_KEY_PASSWORD']) {
    const [rule, hint] = KEY_RULES[key]
    if (!env[key]) problems.push(`${key} is missing in ${ENV_FILE}.`)
    else if (!rule.test(env[key])) problems.push(`${key} in ${ENV_FILE} does not look right: expected ${hint}.`)
  }
  if (env.ANDROID_UPLOAD_KEY_PASSWORD && env.ANDROID_UPLOAD_KEY_PASSWORD !== env.ANDROID_UPLOAD_KEYSTORE_PASSWORD) {
    problems.push('ANDROID_UPLOAD_KEY_PASSWORD must be the same as ANDROID_UPLOAD_KEYSTORE_PASSWORD: a PKCS12 keystore has one password.')
  }
  if (keystoreExists) {
    problems.push(`${FILES.androidKeystore} already exists. Google Play knows the upload key by its certificate, so keep the file; move it away first to make a new one.`)
  }
  return problems
}

/** keytool arguments for the upload keystore. The passwords reach keytool through its environment (`:env`), not argv. */
export function keytoolArguments(env, keystorePath) {
  return [
    '-genkeypair',
    '-keystore', keystorePath,
    '-storetype', 'PKCS12',
    // The alias is on argv (keytool has no :env form for it); the passwords are not.
    // It is an identifier, not a password (usually "upload"), classified as a secret only for consistent handling.
    '-alias', env.ANDROID_UPLOAD_KEY_ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000',
    '-dname', 'CN=Ergates upload key',
    '-storepass:env', 'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
    '-keypass:env', 'ANDROID_UPLOAD_KEY_PASSWORD',
    '-noprompt',
  ]
}

/** Body of PUT /repos/{owner}/{repo}/environments/app-stores: deployments limited by custom rules. */
export const ENVIRONMENT_BODY = { deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }

/** Body of POST .../environments/app-stores/deployment-branch-policies. */
export const TAG_POLICY_BODY = { name: TAG_PATTERN, type: 'tag' }

/** Whether a deployment-branch-policies listing already holds the tag rule. */
export function hasTagPolicy(listing) {
  return (listing.branch_policies ?? []).some(policy => policy.type === 'tag' && policy.name === TAG_PATTERN)
}
