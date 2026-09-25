/**
 * Scenarios for bot-to-bot traffic: the REST transcript window the hook drives
 * (spec 5.5/5.8), live evidence that survives a snapshot which omits it, and the
 * stale-snapshot reschedule.
 *
 * The driver runs the SAME pure modules the hook does (`window.ts`,
 * `exchange.ts`, the reducer); only React's effects are replaced (ADR-029 rule 3).
 */
import { describe, expect, it } from 'vitest'

import { buildExchanges, collectEvidence, exchangeCopy } from '@/features/chat/agent-traffic/exchange'
import type { RosterPeer } from '@/features/chat/agent-traffic/types'
import { FIRST_PAGE_LIMIT, TAIL_LIMIT } from '@/features/chat/agent-traffic/window'
import type { GatewayEventFrame, HistoryMessage, TranscriptQuery, TranscriptRawPage } from '@/gateway/types'

import { flush } from '@test/fake-gateway/fake-websocket'
import historyFixture from '@test/fixtures/history.json'
import liveJson from '@test/fixtures/agent-traffic/receipt-live-json.json'

import { FakeGateway, type FakeScript } from '../fake-gateway/fake-gateway'
import { runSession } from '../fake-gateway/scenarios'

const roster: RosterPeer[] = [
  { profile: 'default', name: 'Hermes', hasAvatar: true },
  { profile: 'kevin', name: 'Kevin', hasAvatar: true }
]

/** A refused send: the tool completes with an error the 5.3 reason table calls `refused`. */
const ZED_ARGS = { target: 'zed', message: 'hi' }
const REFUSED_TURN: GatewayEventFrame[] = [
  { type: 'message.start', seq: 1 },
  { type: 'tool.start', seq: 2, payload: { tool_id: 'call_r', name: 'message_agent', args: ZED_ARGS } },
  { type: 'tool.complete', seq: 3, payload: { tool_id: 'call_r', name: 'message_agent', args: ZED_ARGS, result: { error: 'no such', reason: 'target_busy' } } },
  { type: 'message.complete', seq: 4, payload: { text: 'Could not reach zed.', status: 'complete' } }
]

describe('a refused send with no process (scenario q)', () => {
  it('asks for a tail, reconciles it with the REST page, and reads as unreachable', async () => {
    const gateway = new FakeGateway({ onSubmit: () => REFUSED_TURN })
    const driver = await runSession(gateway, 'thijs')

    await driver.send('Send a short hello to zed')
    await flush(20)

    // Two triggers: the `message_agent` completion and the local turn's completion (spec 5.8).
    expect(driver.getState().tailWanted).toBe(2)

    await driver.fetchInitial()
    await driver.fetchTail()

    // The first tail page overlaps the loaded window, so the run stops after one page.
    expect(gateway.calls.transcript.count).toBe(2)
    expect(gateway.calls.transcript.lastQuery).toMatchObject({ limit: TAIL_LIMIT, offset: 0, order: 'latest' })

    const loaded = driver.transcript()
    expect(loaded.loaded).toBe(true)
    const build = buildExchanges(collectEvidence(driver.getState().items, loaded.rows), { roster, window: loaded })
    const refused = build.exchanges.find(x => x.anchor.toolCallId === 'call_r')
    expect(refused).toBeDefined()
    expect(refused?.phase).toBe('settled')
    expect(exchangeCopy(refused!)).toBe('zed could not be reached')
    // Nothing older is missing: the window reached the start of the recorded chat.
    expect(build.needsOlder).toBe(false)
  })
})

describe('a live receipt across a snapshot that omits it', () => {
  it('survives the refetch and goes only when the transcript reconciles it', async () => {
    const processId = 'proc_b2c3d4e5f6a7'
    // An EMPTY snapshot, not the recorded one: the strongest form of "history does
    // not carry it yet".
    const gateway = new FakeGateway({ history: () => [] })
    const driver = await runSession(gateway, 'thijs')

    gateway.connectionFor('thijs').emit({ type: 'status.update', session_id: driver.liveSessionId, seq: 30, payload: { kind: 'process', text: liveJson.text } })
    const live = driver.getState().items.filter(i => i.kind === 'receipt')
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ live: true })
    // The notification itself is a tail trigger, even for a receipt we already hold.
    expect(driver.getState().tailWanted).toBe(1)

    // Absence from a snapshot is not evidence of absence: the live receipt is all
    // that is left after an empty one.
    await driver.refetchHistory()
    expect(driver.getState().items.map(i => i.kind)).toEqual(['receipt'])

    driver.dispatch({ type: 'transcript/reconciled', toolCallIds: [], processIds: [processId] })
    expect(driver.getState().items.filter(i => i.kind === 'receipt')).toHaveLength(0)
  })
})

describe('a snapshot that went stale in flight (spec 5.8)', () => {
  it('discards it and fetches again instead of rolling the newer turn back', async () => {
    let release = (): void => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const newer: HistoryMessage[] = [
      ...(historyFixture.messages as HistoryMessage[]),
      { role: 'assistant', text: 'Kevin is free on Tuesday.', row_id: 9001, timestamp: 1789203999 }
    ]
    const gateway = new FakeGateway({ history: call => (call === 1 ? gate.then(() => undefined) : newer) })
    const driver = await runSession(gateway, 'thijs')
    const connection = gateway.connectionFor('thijs')

    const pending = driver.refetchHistory()
    await flush(1)

    // A turn we did not start completes while the snapshot is in flight: the
    // snapshot predates it and would remove it.
    connection.emit({ type: 'message.start', session_id: driver.liveSessionId, seq: 40 })
    connection.emit({ type: 'message.complete', session_id: driver.liveSessionId, seq: 41, payload: { text: 'Kevin is free on Tuesday.', status: 'complete' } })
    release()
    await pending

    expect(gateway.calls.history).toBe(2)
    expect(driver.getState().replay.needsHistoryRefetch).toBe(false)
    // The newer snapshot carries only the answer's durable row, no new input row
    // for the live answer to anchor to (spec 12.3, ruling 5): the match is
    // ambiguous, so the live item is retained alongside the durable one instead
    // of being silently rolled back.
    const arrived = driver.getState().items.filter(i => i.kind === 'assistant' && i.text === 'Kevin is free on Tuesday.')
    expect(arrived).toHaveLength(2)
    expect(arrived.some(i => (i as { rowId?: number }).rowId === 9001)).toBe(true)
  })
})

describe('a tail that has not reached the loaded boundary', () => {
  it('continues one page backward and stops on the first overlapping page', async () => {
    const queries: TranscriptQuery[] = []
    const rows = (from: number, count: number): unknown[] =>
      Array.from({ length: count }, (_, i) => ({ id: from + i, role: 'assistant', content: `row ${from + i}`, timestamp: 1789203900 + from + i }))
    const answer = (sessionId: string, q: TranscriptQuery, messages: unknown[]): TranscriptRawPage => ({
      session_id: sessionId,
      messages,
      pagination: { limit: q.limit, offset: q.offset ?? 0, order: q.order, returned: messages.length }
    })
    const script: FakeScript = {
      transcript: q => {
        queries.push(q)
        // The loaded window: rows 1-60. Since then 50 newer rows (101-150) were written.
        if (q.limit === FIRST_PAGE_LIMIT) return answer(q.sessionId, q, rows(1, 60))
        return (q.offset ?? 0) === 0 ? answer(q.sessionId, q, rows(101, 50)) : answer(q.sessionId, q, rows(51, 50))
      }
    }
    const gateway = new FakeGateway(script)
    const driver = await runSession(gateway, 'thijs')

    await driver.fetchInitial()
    await driver.fetchTail()

    expect(queries.map(q => [q.limit, q.offset])).toEqual([
      [FIRST_PAGE_LIMIT, 0],
      [TAIL_LIMIT, 0],
      [TAIL_LIMIT, TAIL_LIMIT]
    ])
    const loaded = driver.transcript()
    // 1-60 and 101-150, joined by 51-100: the ten rows the second page repeats merge away.
    expect(loaded.rows).toHaveLength(150)
    expect(loaded.newestLoadedRowId).toBe(150)
    expect(loaded.oldestLoadedRowId).toBe(1)
  })
})
