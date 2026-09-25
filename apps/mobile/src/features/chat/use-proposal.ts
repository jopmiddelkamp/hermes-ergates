/**
 * useProposals and useProposal: the React binding of the agent proposal cards
 * (docs/11 section 4.1). The rules live in `@/features/agents`
 * (`collectProposals`, `proposalView`, `provisionAgent`), pure and tested in
 * Node; this file holds the Query, the device-store setup run and the one
 * automatic resume per card mount (ADR-029 rule 2).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { collectProposals, proposalView, provisionAgent, provisionDeps, provisionOnce, rosterKey, type ProposalView, type ProvisionOutcome } from '@/features/agents'
import type { AgentProposal, ProvisionStep } from '@/gateway/types'
import { useDeviceStore } from '@/state/device-store'

import { openCanonicalChat } from './canonical-chat'
import { useChatSession } from './chat-session-context'

export const proposalKey = (connectionId: string, proposalId: string) => ['proposal', connectionId, proposalId] as const

export interface ProposalCardState {
  view: ProposalView
  accept(): Promise<void>
  /** Rejects when the server refuses; the card shows why. */
  reject(): Promise<void>
  retry(): Promise<void>
  resendBriefing(): Promise<void>
  reload(): void
}

/** The proposals this chat shows: its tool results, and this device's unfinished setups started here. */
export function useProposals(): AgentProposal[] {
  const { connectionId, profile, session, transcript } = useChatSession()
  const runs = useDeviceStore(s => s.provisioning)
  const items = session.state.items
  const rows = transcript.window.rows
  return useMemo(() => {
    const stored = runs.filter(run => run.connectionId === connectionId && run.sourceProfile === profile).map(run => run.proposal)
    return collectProposals(items, rows, stored)
  }, [runs, connectionId, profile, items, rows])
}

export function useProposal(proposal: AgentProposal): ProposalCardState {
  const { connectionId, profile, port } = useChatSession()
  const client = useQueryClient()
  const id = proposal.proposal_id
  const receipt = useQuery({ queryKey: proposalKey(connectionId, id), queryFn: () => port.ergates.getProposal(id), retry: false, staleTime: 5_000 })
  const saveRun = useDeviceStore(s => s.saveProvisioningRun)
  const removeRun = useDeviceStore(s => s.removeProvisioningRun)
  const [step, setStep] = useState<ProvisionStep | null>(null)
  const [outcome, setOutcome] = useState<ProvisionOutcome | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(
    async (resendBriefing: boolean) => {
      setBusy(true)
      setOutcome(null)
      // Saved before the accept call: only the tool result carries the payload and the briefing.
      saveRun({ proposalId: id, connectionId, sourceProfile: profile, proposal: proposal as unknown as Record<string, unknown>, startedAt: Date.now() })
      const result = await provisionOnce(id, () => provisionAgent(provisionDeps(port, openCanonicalChat), proposal, { resendBriefing, onStep: setStep }))
      setStep(null)
      setBusy(false)
      setOutcome(result)
      if (result.kind === 'complete' || (result.kind === 'failed' && result.terminal)) {
        removeRun(id)
      }
      if (result.kind === 'complete') {
        void client.invalidateQueries({ queryKey: rosterKey(connectionId) })
      }
      void client.invalidateQueries({ queryKey: proposalKey(connectionId, id) })
    },
    [client, connectionId, id, port, profile, proposal, removeRun, saveRun]
  )

  // Reopening resumes: an accepted proposal whose setup did not finish runs
  // again, once per mount. A run never repeats an uncertain step (provision.ts).
  const resumed = useRef(false)
  const state = receipt.data?.state
  useEffect(() => {
    if (state === 'accepted' && !resumed.current) {
      resumed.current = true
      void run(false)
    }
  }, [state, run])

  const reject = useCallback(async () => {
    setBusy(true)
    try {
      await port.ergates.rejectProposal(id)
      removeRun(id)
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: proposalKey(connectionId, id) })
    }
  }, [client, connectionId, id, port, removeRun])

  const refetch = receipt.refetch
  return {
    view: proposalView({ proposal, receipt: receipt.data, receiptError: receipt.error, step, outcome, busy }),
    accept: () => run(false),
    reject,
    retry: () => run(false),
    resendBriefing: () => run(true),
    reload: () => void refetch()
  }
}
