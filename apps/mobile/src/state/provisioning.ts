/**
 * An agent the operator accepted whose setup has not finished (docs/11
 * section 4.1, ADR-032). Device-owned, like an outbox item: the
 * user's pending action, kept so that a killed app resumes it. `proposal` is
 * the tool result exactly as it arrived: the accept call must send it back
 * unchanged (the server compares hashes), and the briefing step needs its
 * text, which the server never stores.
 */
export interface ProvisioningRun {
  proposalId: string
  connectionId: string
  /** The profile whose chat showed the proposal. */
  sourceProfile: string
  proposal: Record<string, unknown>
  startedAt: number
}

/**
 * The record to save when a setup starts or resumes. Reuses `existing`'s
 * `startedAt` when this proposal already has a stored run, so a retry or a
 * resumed run does not look freshly started: an age-based cleanup needs the
 * time the operator first accepted, not the time of the latest attempt.
 */
export function withStartedAt(existing: ProvisioningRun | undefined, run: Omit<ProvisioningRun, 'startedAt'>, now: number): ProvisioningRun {
  return { ...run, startedAt: existing?.startedAt ?? now }
}
