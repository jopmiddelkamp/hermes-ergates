import type { ExpoConfig } from 'expo/config'
import { describe, expect, it } from 'vitest'

import withReleaseSigning from '../../plugins/with-release-signing.js'

const { applyReleaseSigning, releaseSigningFromEnv } = withReleaseSigning

const SIGNING_ENV = {
  ANDROID_UPLOAD_KEYSTORE_PATH: '/runner/temp/upload.jks',
  ANDROID_UPLOAD_KEYSTORE_PASSWORD: 'store-secret',
  ANDROID_UPLOAD_KEY_ALIAS: 'upload',
  ANDROID_UPLOAD_KEY_PASSWORD: 'key-secret',
}

/** The signing part of android/app/build.gradle as `expo prebuild` writes it for SDK 57. */
const TEMPLATE = [
  '        versionName "0.1.0"',
  '    }',
  '    signingConfigs {',
  '        debug {',
  "            storeFile file('debug.keystore')",
  "            storePassword 'android'",
  "            keyAlias 'androiddebugkey'",
  "            keyPassword 'android'",
  '        }',
  '    }',
  '    buildTypes {',
  '        debug {',
  '            signingConfig signingConfigs.debug',
  '        }',
  '        release {',
  '            // Caution! In production, you need to generate your own keystore file.',
  '            // see https://reactnative.dev/docs/signed-apk-android.',
  '            signingConfig signingConfigs.debug',
  "            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'",
  '            shrinkResources enableShrinkResources.toBoolean()',
  '        }',
  '    }',
  '',
].join('\n')

const SIGNED = [
  '        versionName "0.1.0"',
  '    }',
  '    signingConfigs {',
  '        // Release signing from plugins/with-release-signing.js',
  '        release {',
  "            storeFile file('/runner/temp/upload.jks')",
  "            storePassword System.getenv('ANDROID_UPLOAD_KEYSTORE_PASSWORD')",
  "            keyAlias System.getenv('ANDROID_UPLOAD_KEY_ALIAS')",
  "            keyPassword System.getenv('ANDROID_UPLOAD_KEY_PASSWORD')",
  '        }',
  '        debug {',
  "            storeFile file('debug.keystore')",
  "            storePassword 'android'",
  "            keyAlias 'androiddebugkey'",
  "            keyPassword 'android'",
  '        }',
  '    }',
  '    buildTypes {',
  '        debug {',
  '            signingConfig signingConfigs.debug',
  '        }',
  '        release {',
  '            signingConfig signingConfigs.release',
  "            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'",
  '            shrinkResources enableShrinkResources.toBoolean()',
  '        }',
  '    }',
  '',
].join('\n')

const CONFIG: ExpoConfig = { name: 'Ergates', slug: 'ergates' }

describe('releaseSigningFromEnv', () => {
  it('is off when no variable is set', () => {
    expect(releaseSigningFromEnv({})).toBeNull()
  })

  it('gives the keystore path when all four are set', () => {
    expect(releaseSigningFromEnv(SIGNING_ENV)).toEqual({ keystorePath: '/runner/temp/upload.jks' })
  })

  it('names the missing variables, never a value, when only some are set', () => {
    const { ANDROID_UPLOAD_KEY_ALIAS: _alias, ANDROID_UPLOAD_KEY_PASSWORD: _key, ...partial } = SIGNING_ENV
    expect(() => releaseSigningFromEnv(partial)).toThrow(
      'Release signing needs ANDROID_UPLOAD_KEY_ALIAS, ANDROID_UPLOAD_KEY_PASSWORD too: set all four ANDROID_UPLOAD_* variables, or none.'
    )
  })

  it.each(['relative/upload.jks', "/tmp/it's.jks", '/tmp/a\\b.jks'])('refuses the keystore path %j', keystorePath => {
    expect(() => releaseSigningFromEnv({ ...SIGNING_ENV, ANDROID_UPLOAD_KEYSTORE_PATH: keystorePath })).toThrow(
      'ANDROID_UPLOAD_KEYSTORE_PATH must be an absolute path'
    )
  })
})

describe('applyReleaseSigning', () => {
  it('adds the release signing config and points the release build type at it', () => {
    expect(applyReleaseSigning(TEMPLATE, { keystorePath: '/runner/temp/upload.jks' })).toBe(SIGNED)
  })

  it('leaves a file it already changed alone', () => {
    expect(applyReleaseSigning(SIGNED, { keystorePath: '/runner/temp/upload.jks' })).toBe(SIGNED)
  })

  it('stops when the template no longer has the expected shape', () => {
    const changed = TEMPLATE.replace('            signingConfig signingConfigs.debug\n            def', '            def')
    expect(() => applyReleaseSigning(changed, { keystorePath: '/runner/temp/upload.jks' })).toThrow(
      'android/app/build.gradle does not have the signingConfigs block and the release build type'
    )
  })
})

describe('withReleaseSigning', () => {
  it('adds no mod when the variables are not set', () => {
    expect(withReleaseSigning({ ...CONFIG }, { env: {} }).mods).toBeUndefined()
  })

  it('rewrites the app build.gradle through the mod when the variables are set', async () => {
    const config = withReleaseSigning({ ...CONFIG }, { env: SIGNING_ENV })
    const mod = config.mods?.android?.appBuildGradle
    expect(mod).toBeTypeOf('function')

    const result = await mod!({
      ...config,
      modResults: { path: 'android/app/build.gradle', contents: TEMPLATE, language: 'groovy' },
      modRequest: { projectRoot: '/app', platformProjectRoot: '/app/android', modName: 'appBuildGradle', platform: 'android', introspect: false },
    })

    expect(result.modResults.contents).toBe(SIGNED)
  })
})
