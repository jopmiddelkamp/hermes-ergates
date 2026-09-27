/**
 * Sends the organization outbox to Hermes (docs/05 "Organization outbox"):
 * one `profiles.configure` per change, one change at a time, in the order
 * the changes were made. Each write carries the agent's whole `hermes-bots`
 * namespace as last read, with only the changed fields replaced (unknown
 * fields kept), and the revision it was read at, like Hide.
 *
 * - A revision conflict (someone, Hermes Desktop for example, wrote in
 *   between): read the agent again, apply the same change once more, write
 *   again. A second conflict refuses the change.
 * - No connection, a timeout, an expired sign-in, a busy/rate-limited
 *   gateway, or a 502/503/504 (a reverse proxy while Hermes restarts): the
 *   change stays queued and the flush stops; the next roster read starts it
 *   again.
 * - Hermes no longer has the agent (deleted after the last roster read, or a
 *   conflict's re-read no longer finds it): the change is dropped, with no
 *   alert.
 * - Any other error refuses the change. A refused change leaves the outbox,
 *   so the agent shows what Hermes has, and the caller names it in one alert.
 *
 * No React: the caller passes the gateway calls, the roster and the store in.
 */

import { isGatewayError, mapRpcError } from '@/gateway/errors'
import type { ProfilesApi } from '@/gateway/port'
import type { ConfigureParams, ConfigureResult, HermesBotsMeta, ProfileSummary } from '@/gateway/types'
import { markSending, markSent, nextQueued, removeItem, requeue, type OrgChange, type OrgOutboxItem } from '@/state/org-outbox'

import { joinNames } from './edit-mode'
import { botsMeta } from './editor'

export interface OrgSenderDeps {
  profiles: Pick<ProfilesApi, 'list' | 'configure'>
  /** The agent as the roster last read it; undefined when Hermes no longer has it. */
  summaryOf(profile: string): ProfileSummary | undefined
  outbox: {
    list(): OrgOutboxItem[]
    update(fn: (outbox: OrgOutboxItem[]) => OrgOutboxItem[]): void
  }
}

export interface FlushResult {
  /** Writes Hermes applied. */
  sent: number
  /** Changes Hermes refused; they left the outbox. */
  refused: OrgOutboxItem[]
  /** The connection was lost: changes still wait in the outbox. */
  waiting: boolean
}

/** The `hermes-bots` fields one change writes. */
function metaPatch(change: OrgChange): HermesBotsMeta {
  return change.field === 'pinned' ? { pinned: change.pinned } : { sectionId: change.sectionId, sectionName: change.sectionName }
}

/** One write: the agent's `hermes-bots` namespace with only this change's fields replaced, and its revision. */
function configureFor(summary: ProfileSummary, change: OrgChange): ConfigureParams {
  return {
    name: summary.name,
    ui_meta: { 'hermes-bots': { ...botsMeta(summary), ...metaPatch(change) } },
    ui_meta_expected_revisions: { 'hermes-bots': summary.ui_meta_revisions?.['hermes-bots'] ?? 0 }
  }
}

type WriteOutcome = { kind: 'applied'; revision: number } | { kind: 'conflict' } | { kind: 'refused' }

function outcomeOf(result: ConfigureResult): WriteOutcome {
  const applied = result.applied ?? {}
  if (applied.ui_meta === true) {
    const revisions = applied.ui_meta_revisions as Record<string, number> | undefined
    return { kind: 'applied', revision: revisions?.['hermes-bots'] ?? 0 }
  }
  return applied.ui_meta === false && applied.ui_meta_conflicts ? { kind: 'conflict' } : { kind: 'refused' }
}

/** The summary as Hermes has it after this write. */
function afterWrite(summary: ProfileSummary, meta: HermesBotsMeta, revision: number): ProfileSummary {
  return { ...summary, ui_meta: { ...summary.ui_meta, 'hermes-bots': meta }, ui_meta_revisions: { ...summary.ui_meta_revisions, 'hermes-bots': revision } }
}

/** A reverse proxy in front of Hermes answering 502/503/504 while it restarts behaves like a dropped connection. */
const RESTARTING_STATUSES = new Set([502, 503, 504])

/**
 * No connection, a timeout, an expired sign-in, a busy/rate-limited gateway,
 * or a 502/503/504 keeps the change queued and stops the flush; any other
 * error refuses it.
 */
function connectionLost(err: unknown): boolean {
  const mapped = isGatewayError(err) ? err : mapRpcError(err)
  if (mapped.kind === 'network' || mapped.kind === 'timeout' || mapped.kind === 'unauthorized' || mapped.kind === 'rate_limited' || mapped.kind === 'busy') {
    return true
  }
  return mapped.status !== undefined && RESTARTING_STATUSES.has(mapped.status)
}

/** Hermes no longer has this profile: the pin answers `profiles.configure` for a missing one with rpc 4064 (`_resolve_profile`). */
function missingProfile(err: unknown): boolean {
  const mapped = isGatewayError(err) ? err : mapRpcError(err)
  return mapped.kind === 'rpc' && mapped.code === 4064
}

/**
 * Sends every queued change, in order, until the outbox has none left or the
 * connection is lost. `summaries` holds what this flush itself wrote, so the
 * next change of the same agent starts from it.
 */
export async function flushOrgOutbox(deps: OrgSenderDeps): Promise<FlushResult> {
  const summaries = new Map<string, ProfileSummary>()
  const refused: OrgOutboxItem[] = []
  let sent = 0

  const write = async (summary: ProfileSummary, change: OrgChange): Promise<WriteOutcome> => {
    const params = configureFor(summary, change)
    const outcome = outcomeOf(await deps.profiles.configure(params))
    if (outcome.kind === 'applied') {
      summaries.set(change.profile, afterWrite(summary, params.ui_meta?.['hermes-bots'] ?? {}, outcome.revision))
    }
    return outcome
  }

  /** One change, with the one retry after a conflict; `gone` when Hermes no longer has the agent. */
  const send = async (change: OrgChange): Promise<WriteOutcome | 'gone'> => {
    const summary = summaries.get(change.profile) ?? deps.summaryOf(change.profile)
    if (!summary) {
      return 'gone'
    }
    const first = await write(summary, change)
    if (first.kind !== 'conflict') {
      return first
    }
    const reread = (await deps.profiles.list()).profiles.find(p => p.name === change.profile)
    if (!reread) {
      return 'gone'
    }
    const second = await write(reread, change)
    return second.kind === 'conflict' ? { kind: 'refused' } : second
  }

  for (let item = nextQueued(deps.outbox.list()); item; item = nextQueued(deps.outbox.list())) {
    const { id } = item
    deps.outbox.update(outbox => markSending(outbox, id))
    let outcome: WriteOutcome | 'gone'
    try {
      outcome = await send(item)
    } catch (err) {
      if (connectionLost(err)) {
        deps.outbox.update(outbox => requeue(outbox, id))
        return { sent, refused, waiting: true }
      }
      outcome = missingProfile(err) ? 'gone' : { kind: 'refused' }
    }
    if (outcome === 'gone') {
      deps.outbox.update(outbox => removeItem(outbox, id))
    } else if (outcome.kind === 'applied') {
      const { revision } = outcome
      sent++
      deps.outbox.update(outbox => markSent(outbox, id, revision))
    } else {
      refused.push(item)
      deps.outbox.update(outbox => removeItem(outbox, id))
    }
  }
  return { sent, refused, waiting: false }
}

/**
 * Whether Home may flush now: something is queued, the roster has been read
 * since the app started (`rosterReadAt` is 0 before), and that read is newer
 * than the last stall (`stalledAt`, 0 when the flush has never stalled).
 *
 * Before the first read the roster knows no agent, and every queued change
 * would look like one for an agent Hermes no longer has, and be dropped.
 *
 * After a flush stalls (the connection was lost mid-flush, `FlushResult.waiting`),
 * the requeued item makes `queued` true again at once; without the
 * `rosterReadAt > stalledAt` check that would flush again immediately, and
 * with the connection still down, loop without ever giving the app a turn.
 * Holding the flush until a newer roster read comes in matches docs/05: a
 * stalled change is sent again only after the next successful roster read.
 */
export function readyToFlush(queued: boolean, rosterReadAt: number, stalledAt: number): boolean {
  return queued && rosterReadAt > 0 && rosterReadAt > stalledAt
}

/**
 * Runs `task` one at a time: a call while it runs asks for one more run
 * after it (several calls ask once), and returns the running one.
 */
export function oneAtATime(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  let again = false
  const start = (): Promise<void> => {
    running = task().finally(() => {
      running = null
      if (again) {
        again = false
        void start()
      }
    })
    return running
  }
  return () => {
    if (running) {
      again = true
      return running
    }
    return start()
  }
}

function verbOf(change: OrgChange): string {
  if (change.field === 'section') {
    return 'move'
  }
  return change.pinned ? 'pin' : 'unpin'
}

/** The one alert after a flush: every refused agent once, e.g. "Could not move 2 agents: Linh and Kevin." */
export function refusedMessage(refused: OrgChange[], nameOf: (profile: string) => string): string {
  const names = [...new Set(refused.map(change => change.profile))].map(nameOf)
  const verbs = new Set(refused.map(verbOf))
  const verb = verbs.size === 1 ? [...verbs][0] : 'change'
  const one = names.length === 1
  return `Could not ${verb} ${names.length} ${one ? 'agent' : 'agents'}: ${joinNames(names)}. ${one ? 'It shows' : 'They show'} what Hermes has.`
}
