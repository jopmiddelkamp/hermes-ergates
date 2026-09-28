/// <reference types="node" />
/**
 * upload-secrets.sh must never let a secret value reach a trace log: a run
 * started with `bash -x`, or one that inherits `set -x` from its own
 * environment, still must not print a secret's value to the console.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const APP = path.resolve(import.meta.dirname, '../..')
const SCRIPT = path.join(APP, 'scripts/release/upload-secrets.sh')

describe('upload-secrets.sh', () => {
  it('does not trace a secret value onto stderr under bash -x', () => {
    const secret = 'dummy-secret-do-not-leak-6e2a8d5c'

    const result = spawnSync('bash', ['-x', SCRIPT, '--check'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        ERGATES_RELEASE_DIR: '/nonexistent-ergates-release-dir',
        IOS_DIST_CERT_PASSWORD: secret,
        ANDROID_UPLOAD_KEYSTORE_PASSWORD: secret,
        ANDROID_UPLOAD_KEY_PASSWORD: secret,
      },
    })

    expect(result.stderr).not.toContain(secret)
  })
})
