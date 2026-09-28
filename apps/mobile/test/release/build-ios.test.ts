/// <reference types="node" />
/**
 * build-ios.sh must never let a secret value reach a trace log: a run started
 * with `bash -x`, or one that inherits `set -x` from its own environment,
 * still must not print a secret's value to the console.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const APP = path.resolve(import.meta.dirname, '../..')
const SCRIPT = path.join(APP, 'scripts/release/build-ios.sh')

let home: string

beforeEach(() => {
  // A real HOME (even an empty one): the script reads $HOME under `set -u`
  // before it reaches the check this test is about, and an unset HOME would
  // stop it there instead, for an unrelated reason.
  home = mkdtempSync(path.join(tmpdir(), 'build-ios-home-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('build-ios.sh', () => {
  it('does not trace a secret value onto stderr under bash -x', () => {
    const secret = 'dummy-secret-do-not-leak-4f7c1e9b'

    const result = spawnSync('bash', ['-x', SCRIPT], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', HOME: home, IOS_DIST_CERT_PASSWORD: secret },
    })

    expect(result.stderr).not.toContain(secret)
  })
})
