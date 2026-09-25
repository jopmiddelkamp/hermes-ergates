/**
 * An agent the operator accepted whose setup has not finished (docs/11
 * section 4.1, roadmap decision D4). Device-owned, like an outbox item: the
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
