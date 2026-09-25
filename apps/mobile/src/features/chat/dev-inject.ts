/**
 * Synthetic event frames for the simulator pass (development only).
 *
 * Three bot-to-bot outcomes the local backend cannot be made to produce on
 * demand — a refused delivery, a durably queued one, and a send still in
 * flight — so the screenshots can show them. The frames go through the normal
 * event path (`SessionController.devInjectEvent` → the reducer), so nothing is
 * faked downstream: the classifier, the pairing and the copy are the real ones.
 *
 * Pure: no React or React Native imports (ADR-029 rule 1). Nothing here is
 * reachable in a release bundle — `devInjectEvent` is a no-op unless `__DEV__`.
 */

import type { GatewayEventFrame } from '@/gateway/types'

/** Fixed sanitized values; no personal data, no real ids (docs/04). */
const TARGET = 'kevin'
const MESSAGE = 'Are you free at 18:00?'

/** No `seq`: these frames must never advance the replay watermark of a real session. */
function start(toolId: string): GatewayEventFrame {
  return { type: 'tool.start', payload: { tool_id: toolId, name: 'message_agent', args: { target: TARGET, message: MESSAGE } } }
}

/** The wire repeats the call's arguments on the completion frame (spec A.14); so does this. */
function complete(toolId: string, result: Record<string, unknown>): GatewayEventFrame {
  return { type: 'tool.complete', payload: { tool_id: toolId, name: 'message_agent', args: { target: TARGET, message: MESSAGE }, result } }
}

const SCENARIOS: Record<string, GatewayEventFrame[]> = {
  refused: [
    start('dev-call-refused'),
    complete('dev-call-refused', {
      error: "Delivery failed: @kevin's Bot Chat is open on another surface right now, so your message was NOT delivered. Try again later.",
      reason: 'target_busy'
    })
  ],
  waiting: [
    start('dev-call-waiting'),
    complete('dev-call-waiting', {
      status: 'queued',
      delivery_id: '3f9c1d2e4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0',
      to: '@kevin',
      detail: 'Durably queued for the live Bot Chat owner. Do NOT wait or resend; finish your turn.',
      process_id: 'proc_dev000000001'
    })
  ],
  // Still in flight: the start with no completion is the "sending" state.
  sending: [start('dev-call-sending')],
  // Three adjacent sends with different outcomes: one merged row whose suffix counts every member
  // (spec 12.4) and whose newest member is still sending yet stays openable.
  mixed: [
    start('dev-call-mixed-waiting'),
    complete('dev-call-mixed-waiting', { status: 'queued', delivery_id: '3f9c1d2e4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff1', to: '@kevin', detail: 'Durably queued.', process_id: 'proc_dev000000002' }),
    start('dev-call-mixed-refused'),
    complete('dev-call-mixed-refused', { error: 'Delivery failed: target busy.', reason: 'target_busy' }),
    start('dev-call-mixed-sending')
  ]
}

/** The frames for a named scenario, oldest first; an unknown name injects nothing. */
export function devInjectFrames(name: string): GatewayEventFrame[] {
  return SCENARIOS[name] ?? []
}
