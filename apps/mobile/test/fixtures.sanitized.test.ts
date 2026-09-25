/// <reference types="node" />
/**
 * Fixtures must never carry personal data (binding constraint, docs/04 section 9).
 *
 * Recordings are taken from a real `hermes serve` on a real machine, so this
 * runs over every file under `test/fixtures/` and fails on the markers that
 * an unsanitized recording leaves behind: absolute home paths, the operator's
 * account name, a `system_prompt` (which embeds the user's memory blocks and
 * skill inventory verbatim), e-mail addresses, and macOS app-support paths.
 *
 * A fixture that genuinely needs one of these shapes must use a synthetic
 * value (`/opt/data/workspace`, `install-fixture`, the Linh/Kevin/Thijs
 * roster from the design docs).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const FIXTURES_DIR = path.resolve(import.meta.dirname, 'fixtures')

/** Forbidden markers. Each is a plain description plus the pattern that finds it. */
const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: 'a macOS/Linux home path', pattern: /\/Users\/|\/home\// },
  { label: 'a macOS app-support path', pattern: /Library\/Application Support/ },
  { label: "the operator's account name", pattern: /jopmiddelkamp/i },
  { label: 'a system_prompt (carries memory blocks and the skill inventory)', pattern: /system_prompt/ },
  { label: 'an e-mail address', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/ },
  { label: 'a Hermes home path', pattern: /hermes_home|\.hermes\// },
  { label: 'a macOS temp path', pattern: /\/var\/folders\// }
]

function fixtureFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...fixtureFiles(full))
    } else {
      out.push(full)
    }
  }
  return out.sort()
}

describe('test fixtures carry no personal data', () => {
  const files = fixtureFiles(FIXTURES_DIR)

  it('finds the fixtures', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('covers the agent-traffic recordings', () => {
    const traffic = files.filter(f => path.relative(FIXTURES_DIR, f).startsWith('agent-traffic/'))
    expect(traffic.length).toBeGreaterThanOrEqual(10)
  })

  for (const file of files) {
    const name = path.relative(FIXTURES_DIR, file)
    it(`${name} is sanitized`, () => {
      const text = readFileSync(file, 'utf8')
      for (const { label, pattern } of FORBIDDEN) {
        const match = pattern.exec(text)
        expect(match, `${name} contains ${label}: ${match?.[0] ?? ''}`).toBeNull()
      }
    })
  }
})
