/// <reference types="node" />
/**
 * make-upload-keystore.sh must never let a secret value reach a trace log: a
 * run started with `bash -x`, or one that inherits `set -x` from its own
 * environment, still must not print a secret's value to the console.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const APP = path.resolve(import.meta.dirname, '../..')
const SCRIPT = path.join(APP, 'scripts/release/make-upload-keystore.sh')

describe('make-upload-keystore.sh', () => {
  it('does not trace a secret value onto stderr under bash -x', () => {
    const secret = 'dummy-secret-do-not-leak-3b9f7a1e'

    const result = spawnSync('bash', ['-x', SCRIPT], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        ERGATES_RELEASE_DIR: '/nonexistent-ergates-release-dir',
        ANDROID_UPLOAD_KEYSTORE_PASSWORD: secret,
        ANDROID_UPLOAD_KEY_PASSWORD: secret,
      },
    })

    expect(result.stderr).not.toContain(secret)
  })
})
