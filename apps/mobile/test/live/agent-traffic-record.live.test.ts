/**
 * Opt-in recorder for the agent-traffic fixtures. It drives the real backend: Hermes (`default`)
 * is asked to message Kevin (`kevin`) over `message_agent`, once with Kevin's Bot Chat closed
 * (CLI delivery) and once with it held
 * live on a second socket (live delivery), then to message a teammate that does not exist
 * (refusal) and to send two messages in one turn (batch candidate).
 *
 * Raw output goes to ERGATES_OUT (never into test/fixtures directly): the controller sanitizes
 * it by hand before it becomes a fixture. Runs only with ERGATES_LIVE=1 ERGATES_RECORD=1.
 *
 *   ERGATES_LIVE=1 ERGATES_RECORD=1 ERGATES_TOKEN=... ERGATES_OUT=/path npx vitest run test/live/agent-traffic-record.live.test.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { openCanonicalChat } from '@/features/chat/canonical-chat'
import type { GatewayConnection } from '@/gateway/port'
import { RealGateway } from '@/gateway/real/real-gateway'
import { MemorySecretStore } from '@/gateway/real/secrets'
import type { GatewayEventFrame } from '@/gateway/types'

const record = process.env.ERGATES_LIVE === '1' && process.env.ERGATES_RECORD === '1'
const baseUrl = process.env.ERGATES_BASE_URL ?? 'http://127.0.0.1:9119'
const outDir = process.env.ERGATES_OUT ?? ''
const SENDER = process.env.ERGATES_SENDER ?? 'default'
const RECEIVER = process.env.ERGATES_RECEIVER ?? 'kevin'
const WAIT_MS = 480_000

interface Seen { at: number; event: GatewayEventFrame }

function tap(connection: GatewayConnection, into: Seen[]): () => void {
  return connection.onEvent(event => {
    into.push({ at: Date.now(), event })
  })
}

async function waitFor(label: string, pred: () => boolean, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pred()) {
      return
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const count = (seen: Seen[], type: string, sid: string) => seen.filter(s => s.event.type === type && s.event.session_id === sid).length
const processUpdates = (seen: Seen[], sid: string) => seen.filter(s => s.event.type === 'status.update' && s.event.session_id === sid && (s.event.payload as { kind?: string } | undefined)?.kind === 'process').length

function save(name: string, value: unknown): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2))
}

describe.runIf(record)('record agent traffic against a live backend', () => {
  it('records CLI, live, refusal and batch deliveries', async () => {
    expect(outDir).toBeTruthy()
    const gateway = new RealGateway({ connectionId: 'record', baseUrl, secrets: new MemorySecretStore() })
    await gateway.login({ mode: 'token', token: process.env.ERGATES_TOKEN ?? '' })
    const roster = await gateway.profiles.list()
    const senderSummary = roster.profiles.find(p => p.name === SENDER)
    const receiverSummary = roster.profiles.find(p => p.name === RECEIVER)
    expect(senderSummary).toBeTruthy()
    expect(receiverSummary).toBeTruthy()

    const senderConn = await gateway.connect(SENDER)
    const senderSeen: Seen[] = []
    const offSender = tap(senderConn, senderSeen)
    const sender = await openCanonicalChat(gateway, SENDER, senderSummary)
    const sid = sender.liveSessionId
    console.log('sender chat open:', { messages: sender.messages.length, running: sender.running })
    await waitFor('sender idle', () => !sender.running, 60_000)

    const stamp = (name: string) => save(`${name}.json`, { at: Date.now(), events: senderSeen.map(s => s.event) })

    // A) CLI delivery: the receiver's Bot Chat is not live anywhere.
    let completes = count(senderSeen, 'message.complete', sid)
    let processes = processUpdates(senderSeen, sid)
    await gateway.sessions.submit(sid, 'Ask Kevin when he is free for a training session and tell me what he says.')
    await waitFor('A: send turn complete', () => count(senderSeen, 'message.complete', sid) > completes)
    completes = count(senderSeen, 'message.complete', sid)
    await waitFor('A: process notification', () => processUpdates(senderSeen, sid) > processes)
    processes = processUpdates(senderSeen, sid)
    await waitFor('A: notification turn complete', () => count(senderSeen, 'message.complete', sid) > completes)
    completes = count(senderSeen, 'message.complete', sid)
    stamp('events-after-A')

    // B) Live delivery: hold the receiver's Bot Chat live on a second socket.
    const receiverConn = await gateway.connect(RECEIVER)
    const receiverSeen: Seen[] = []
    const offReceiver = tap(receiverConn, receiverSeen)
    const receiver = await openCanonicalChat(gateway, RECEIVER, receiverSummary)
    await gateway.sessions.activate(receiver.liveSessionId)
    console.log('receiver chat open (live):', { messages: receiver.messages.length })
    await gateway.sessions.submit(sid, 'Ask Kevin one more time, in a different wording, when he is free for a training session and tell me what he says.')
    await waitFor('B: send turn complete', () => count(senderSeen, 'message.complete', sid) > completes)
    completes = count(senderSeen, 'message.complete', sid)
    await waitFor('B: process notification', () => processUpdates(senderSeen, sid) > processes)
    processes = processUpdates(senderSeen, sid)
    await waitFor('B: notification turn complete', () => count(senderSeen, 'message.complete', sid) > completes)
    completes = count(senderSeen, 'message.complete', sid)
    stamp('events-after-B')
    save('events-receiver-after-B.json', { events: receiverSeen.map(s => s.event) })

    // C) Refusal: a teammate that does not exist. No process spawns, so no receipt follows.
    await gateway.sessions.submit(sid, 'Send a short hello to a teammate called zed using message_agent, then tell me exactly what the tool returned.')
    await waitFor('C: send turn complete', () => count(senderSeen, 'message.complete', sid) > completes)
    completes = count(senderSeen, 'message.complete', sid)
    stamp('events-after-C')

    // D) Batch candidate: two sends in one turn.
    await gateway.sessions.submit(sid, 'Send Kevin two separate messages with two separate message_agent calls in this same turn: one asking his favorite color, one asking his favorite food. Then wait; when both answers come back, report them.')
    await waitFor('D: send turn complete', () => count(senderSeen, 'message.complete', sid) > completes)
    completes = count(senderSeen, 'message.complete', sid)
    await waitFor('D: process notification', () => processUpdates(senderSeen, sid) > processes)
    // Give a second receipt a chance to arrive in the same batch, then wait for the notification turn(s).
    await new Promise(r => setTimeout(r, 15_000))
    await waitFor('D: notification turn complete', () => count(senderSeen, 'message.complete', sid) > completes)
    await new Promise(r => setTimeout(r, 30_000))
    stamp('events-after-D')

    const senderHistory = await gateway.sessions.history(sid)
    const receiverHistory = await gateway.sessions.history(receiver.liveSessionId)
    save('history-sender.raw.json', senderHistory)
    save('history-receiver.raw.json', receiverHistory)
    const transcript = await gateway.http.get(`/api/sessions/${encodeURIComponent(sender.storedSessionId)}/messages?profile=${encodeURIComponent(SENDER)}&limit=500&offset=0&order=latest`)
    save('transcript-sender.raw.json', transcript)
    const receiverTranscript = await gateway.http.get(`/api/sessions/${encodeURIComponent(receiver.storedSessionId)}/messages?profile=${encodeURIComponent(RECEIVER)}&limit=500&offset=0&order=latest`)
    save('transcript-receiver.raw.json', receiverTranscript)
    save('events-sender.raw.json', { events: senderSeen.map(s => ({ at: s.at, ...s.event })) })
    save('events-receiver.raw.json', { events: receiverSeen.map(s => ({ at: s.at, ...s.event })) })

    offSender()
    offReceiver()
    gateway.disconnectAll()
  }, 45 * 60_000)
})
