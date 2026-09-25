/**
 * The stored-run record a setup run saves (docs/11 section 4.1): it must not
 * look freshly started every time a retry or a resume writes it again.
 */
import { describe, expect, it } from 'vitest'

import { withStartedAt, type ProvisioningRun } from './provisioning'

const run = (over: Partial<Omit<ProvisioningRun, 'startedAt'>> = {}): Omit<ProvisioningRun, 'startedAt'> => ({
  proposalId: 'p-1',
  connectionId: 'c1',
  sourceProfile: 'concierge',
  proposal: { proposal_id: 'p-1' },
  ...over
})

describe('withStartedAt', () => {
  it('stamps the current time for a proposal with no stored run yet', () => {
    expect(withStartedAt(undefined, run(), 100)).toEqual({ ...run(), startedAt: 100 })
  })

  it('keeps the earlier startedAt when this proposal already has a stored run', () => {
    const existing: ProvisioningRun = { ...run(), startedAt: 1 }
    expect(withStartedAt(existing, run(), 200)).toEqual({ ...run(), startedAt: 1 })
  })

  it('keeps the earlier startedAt even for a different proposal payload (a later run report)', () => {
    const existing: ProvisioningRun = { ...run(), startedAt: 1 }
    expect(withStartedAt(existing, run({ sourceProfile: 'pim' }), 200)).toEqual({ ...run({ sourceProfile: 'pim' }), startedAt: 1 })
  })
})
