/// <reference types="node" />
/**
 * build-android.sh must never let a secret value reach a trace log: a run
 * started with `bash -x`, or one that inherits `set -x` from its own
 * environment, still must not print a secret's value to the console.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const APP = path.resolve(import.meta.dirname, '../..')
const SCRIPT = path.join(APP, 'scripts/release/build-android.sh')

describe('build-android.sh', () => {
  it('does not trace a secret value onto stderr under bash -x', () => {
    const secret = 'dummy-secret-do-not-leak-9a1c3f6d'

    const result = spawnSync('bash', ['-x', SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        ANDROID_UPLOAD_KEYSTORE_BASE64: secret,
        ANDROID_UPLOAD_KEYSTORE_PASSWORD: secret,
        ANDROID_UPLOAD_KEY_PASSWORD: secret,
      },
    })

    expect(result.stderr).not.toContain(secret)
  })
})
