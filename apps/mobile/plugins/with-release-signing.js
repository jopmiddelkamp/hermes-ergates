/**
 * Expo config plugin: signs the Android release build with the upload key
 * (RELEASING.md). It changes the generated android/app/build.gradle only when
 * the four ANDROID_UPLOAD_* variables are set during `expo prebuild`, so local
 * debug builds, `expo run:android` and `expo run:ios` stay as Expo generates
 * them. The keystore path is written into the Gradle file; Gradle reads the
 * passwords and the alias from the environment at build time, so they are
 * never written to disk.
 */
const path = require('node:path')

const { withAppBuildGradle } = require('expo/config-plugins')

const VARIABLES = [
  'ANDROID_UPLOAD_KEYSTORE_PATH',
  'ANDROID_UPLOAD_KEYSTORE_PASSWORD',
  'ANDROID_UPLOAD_KEY_ALIAS',
  'ANDROID_UPLOAD_KEY_PASSWORD',
]
const MARKER = '// Release signing from plugins/with-release-signing.js'
const SIGNING_CONFIGS = '    signingConfigs {\n'
/** The release build type as the Expo SDK 57 template writes it: comment lines, then the debug signing config. */
const RELEASE_BUILD_TYPE = /(\n {8}release \{\n)(?: {12}\/\/[^\n]*\n)* {12}signingConfig signingConfigs\.debug\n/

/**
 * null when none of the variables is set; the keystore path when all are.
 * Throws when only some are set, naming the missing ones and never a value.
 */
function releaseSigningFromEnv(env) {
  const missing = VARIABLES.filter(name => !env[name])
  if (missing.length === VARIABLES.length) return null
  if (missing.length > 0) {
    throw new Error(`Release signing needs ${missing.join(', ')} too: set all four ANDROID_UPLOAD_* variables, or none.`)
  }
  const keystorePath = env.ANDROID_UPLOAD_KEYSTORE_PATH
  if (!path.isAbsolute(keystorePath) || /['\\\n]/.test(keystorePath)) {
    throw new Error('ANDROID_UPLOAD_KEYSTORE_PATH must be an absolute path without quotes, backslashes or line breaks.')
  }
  return { keystorePath }
}

/** The app build.gradle with a `release` signing config that the release build type uses. */
function applyReleaseSigning(gradle, { keystorePath }) {
  if (gradle.includes(MARKER)) return gradle
  if (gradle.split(SIGNING_CONFIGS).length !== 2 || !RELEASE_BUILD_TYPE.test(gradle)) {
    throw new Error(
      'android/app/build.gradle does not have the signingConfigs block and the release build type that plugins/with-release-signing.js expects. Compare it with the Expo template of this SDK and update the plugin.'
    )
  }
  const release = [
    `        ${MARKER}`,
    '        release {',
    `            storeFile file('${keystorePath}')`,
    "            storePassword System.getenv('ANDROID_UPLOAD_KEYSTORE_PASSWORD')",
    "            keyAlias System.getenv('ANDROID_UPLOAD_KEY_ALIAS')",
    "            keyPassword System.getenv('ANDROID_UPLOAD_KEY_PASSWORD')",
    '        }',
    '',
  ].join('\n')
  return gradle
    .replace(SIGNING_CONFIGS, `${SIGNING_CONFIGS}${release}`)
    .replace(RELEASE_BUILD_TYPE, '$1            signingConfig signingConfigs.release\n')
}

function withReleaseSigning(config, props = {}) {
  const signing = releaseSigningFromEnv(props.env ?? process.env)
  if (!signing) return config
  return withAppBuildGradle(config, next => {
    if (next.modResults.language !== 'groovy') {
      throw new Error('plugins/with-release-signing.js expects a Groovy android/app/build.gradle.')
    }
    next.modResults.contents = applyReleaseSigning(next.modResults.contents, signing)
    return next
  })
}

module.exports = withReleaseSigning
module.exports.releaseSigningFromEnv = releaseSigningFromEnv
module.exports.applyReleaseSigning = applyReleaseSigning
