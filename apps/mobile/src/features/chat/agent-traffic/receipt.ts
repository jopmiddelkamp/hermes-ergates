/**
 * Receipt grammar, body reading and delivery mapping (spec 5.2, 5.3,
 * docs/superpowers/specs/2026-09-14-agent-traffic-design.md).
 * Pure: no React or React Native imports (ADR-029 rule 1).
 */

import type { Delivery, Reply, Worker } from './types'

export interface ReceiptHeadline {
  processId: string
  description: string
  exitCode: number | 'unknown'
  sigterm: boolean
}

export interface ParsedReceipt {
  headline: ReceiptHeadline
  attribution: string[]
  command: string
  body: string
  trimmed: boolean
  raw: string
}

export type ReceiptRowParse =
  | { kind: 'receipts'; receipts: ParsedReceipt[] }
  | { kind: 'notice'; noticeKind: 'process' | 'batch' | 'unknown' }
  | { kind: 'none' }

export type BodyReading =
  | { kind: 'outcome'; delivery: Delivery; reply: Reply; latestOutcomeUnavailable: boolean; status?: string; reason?: string; error?: string; deliveryId?: string }
  | { kind: 'notice' }

type OutcomeReading = Extract<BodyReading, { kind: 'outcome' }>

export const REFUSED_REASONS: ReadonlySet<string> = new Set(['target_busy', 'runtime_offline', 'agent_blocked'])

export const FAILED_REASONS: ReadonlySet<string> = new Set([
  'queued_expired',
  'provider_auth_or_access',
  'provider_quota_limit',
  'provider_rate_limit',
  'provider_server_error',
  'context_overflow',
  'missing_config',
  'model_unavailable',
])

/** The full status vocabulary (spec 5.3, first table row) — used both for a receipt body's `status`
 * field and, by later tasks, for a paired `message_agent` tool result's `status` field. */
const STATUS_TO_DELIVERY: Readonly<Record<string, Delivery>> = {
  sent: 'admitted',
  queued: 'queued',
  claimed: 'claimed',
  settled: 'settled',
  ambiguous: 'unknown',
  failed: 'failed',
  cancelled: 'cancelled',
}

export const HEADLINE_RE = /^\[IMPORTANT: Background process (proc_[0-9a-f]{12}) (.+?) \(exit code (-?\d+|\?|None)(, SIGTERM)?\)\.\n/
export const BATCH_HEADER_RE = /^\[IMPORTANT: (\d+) background processes completed\./
export const BATCH_SPLIT = ']\n\n[IMPORTANT: Background process '
export const TRIM_MARKER_RE = /^\.\.\.\(output trimmed — subagent-owned process;[^\n]*\)\n/

const SINGLE_RECEIPT_PREFIX = '[IMPORTANT: Background process '
const IMPORTANT_PREFIX = '[IMPORTANT:'
const COMMAND_LINE_PREFIX = 'Command: '
const OUTPUT_MARKER_LINE = 'Output:'

const SESSION_ID_LINE_RE = /^session_id:\s/
const RESUMED_SESSION_LINE_RE = /^↻? ?Resumed session /
const REASON_TAG_RE = /\[reason: ([^\]]+)\]/

// ---------------------------------------------------------------------------
// Grammar / parsing (spec 5.2)
// ---------------------------------------------------------------------------

function parseExitCode(raw: string): number | 'unknown' {
  return raw === '?' || raw === 'None' ? 'unknown' : Number(raw)
}

/** Parses one `[IMPORTANT: Background process …]` row into headline, attribution, command and body. */
export function parseSingleReceipt(text: string): ParsedReceipt | null {
  const headlineMatch = HEADLINE_RE.exec(text)
  if (!headlineMatch) return null
  const [full, processId, description, exitCodeRaw, sigtermFlag] = headlineMatch
  const headline: ReceiptHeadline = { processId: processId!, description: description!, exitCode: parseExitCode(exitCodeRaw!), sigterm: Boolean(sigtermFlag) }

  const lines = text.slice(full.length).split('\n')
  let i = 0
  const attribution: string[] = []
  while (i < lines.length && !lines[i]!.startsWith(COMMAND_LINE_PREFIX)) {
    attribution.push(lines[i]!)
    i++
  }
  if (i >= lines.length) return null

  const afterCommandPrefix = [lines[i]!.slice(COMMAND_LINE_PREFIX.length), ...lines.slice(i + 1)]
  const outputIndex = afterCommandPrefix.findIndex(line => line === OUTPUT_MARKER_LINE)
  if (outputIndex === -1) return null
  const command = afterCommandPrefix.slice(0, outputIndex).join('\n')

  const remainder = afterCommandPrefix.slice(outputIndex + 1).join('\n')
  if (!remainder.endsWith(']')) return null
  const rawBody = remainder.slice(0, -1)

  const trimMarkerMatch = TRIM_MARKER_RE.exec(rawBody)
  const trimmed = trimMarkerMatch !== null
  const body = trimmed ? rawBody.slice(trimMarkerMatch![0].length) : rawBody

  return { headline, attribution, command, body, trimmed, raw: text }
}

/** Splits an accepted batch row into its receipt pieces, or returns null if malformed or miscounted. */
function parseBatchReceipts(text: string, count: number): ParsedReceipt[] | null {
  const pieces = text.split(BATCH_SPLIT).slice(1)
  if (pieces.length !== count) return null
  const receipts: ParsedReceipt[] = []
  for (const [idx, piece] of pieces.entries()) {
    const isLast = idx === pieces.length - 1
    const receipt = parseSingleReceipt(SINGLE_RECEIPT_PREFIX + piece + (isLast ? '' : ']'))
    if (!receipt) return null
    receipts.push(receipt)
  }
  return receipts
}

/** Classifies a chat row as receipts, a notice, or plain (non-receipt) text. */
export function parseReceiptRow(text: string): ReceiptRowParse {
  if (text.startsWith(SINGLE_RECEIPT_PREFIX)) {
    const receipt = parseSingleReceipt(text)
    return receipt ? { kind: 'receipts', receipts: [receipt] } : { kind: 'notice', noticeKind: 'process' }
  }

  const batchHeaderMatch = BATCH_HEADER_RE.exec(text)
  if (batchHeaderMatch) {
    const receipts = parseBatchReceipts(text, Number(batchHeaderMatch[1]))
    return receipts ? { kind: 'receipts', receipts } : { kind: 'notice', noticeKind: 'batch' }
  }

  if (text.startsWith(IMPORTANT_PREFIX)) return { kind: 'notice', noticeKind: 'unknown' }
  return { kind: 'none' }
}

/** Maps a receipt headline's description to a worker state (spec 5.2). */
export function workerFromHeadline(h: ReceiptHeadline): Worker {
  if (h.description === 'completed normally' || h.description === 'exited') return { kind: 'exited', code: h.exitCode }
  if (h.description === 'marked lost because the process backend disappeared') return { kind: 'lost' }
  if (h.description === 'failed to start') return { kind: 'failed_start' }
  const terminatedMatch = /^terminated by (.+)$/.exec(h.description)
  if (terminatedMatch) return { kind: 'terminated', by: terminatedMatch[1] }
  return { kind: 'not_observed' }
}

// ---------------------------------------------------------------------------
// Delivery mapping (spec 5.3)
// ---------------------------------------------------------------------------

export function deliveryFromStatus(status: string): Delivery {
  return STATUS_TO_DELIVERY[status] ?? 'unknown'
}

export function deliveryFromReason(reason: string | undefined): Delivery {
  if (reason === undefined) return 'unknown'
  if (REFUSED_REASONS.has(reason)) return 'refused'
  if (FAILED_REASONS.has(reason)) return 'failed'
  if (reason === 'cancelled') return 'cancelled'
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Body reading (spec 5.2). A relay reply or CLI text that yields a reply body reads as settled:
// the worker prints the target's reply only after the message was delivered.
// ---------------------------------------------------------------------------

function outcomeReading(delivery: Delivery, reply: Reply, extra?: { status?: string; reason?: string; error?: string; deliveryId?: string }): OutcomeReading {
  const reading: OutcomeReading = { kind: 'outcome', delivery, reply, latestOutcomeUnavailable: false }
  if (extra?.status !== undefined) reading.status = extra.status
  if (extra?.reason !== undefined) reading.reason = extra.reason
  if (extra?.error !== undefined) reading.error = extra.error
  if (extra?.deliveryId !== undefined) reading.deliveryId = extra.deliveryId
  return reading
}

/** Branch 1: the body is a JSON object. Returns undefined when the body does not parse as one. */
function readJsonBody(body: string): BodyReading | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined

  const obj = parsed as Record<string, unknown>
  const status = typeof obj.status === 'string' ? obj.status : undefined
  const reason = typeof obj.reason === 'string' ? obj.reason : undefined
  const error = typeof obj.error === 'string' ? obj.error : undefined
  const deliveryId = typeof obj.delivery_id === 'string' ? obj.delivery_id : undefined
  const replyText = typeof obj.reply === 'string' ? obj.reply : undefined

  if (status !== undefined) {
    const delivery = status === 'failed' && reason !== undefined ? deliveryFromReason(reason) : deliveryFromStatus(status)
    const reply: Reply = replyText ? { kind: 'text', body: replyText, completeness: 'complete' } : status === 'settled' ? { kind: 'empty' } : { kind: 'none' }
    return outcomeReading(delivery, reply, { status, reason, error, deliveryId })
  }

  if (error !== undefined) return outcomeReading(deliveryFromReason(reason), { kind: 'none' }, { reason, error })

  return { kind: 'notice' }
}

/** Branch 2: `Delivery to … failed [reason: …]: …`. */
function readDeliveryFailedBody(body: string): BodyReading | undefined {
  if (!body.startsWith('Delivery to ') || !body.includes(' failed')) return undefined
  const reasonMatch = REASON_TAG_RE.exec(body)
  const reason = reasonMatch ? reasonMatch[1]! : 'unknown'
  return outcomeReading(deliveryFromReason(reason), { kind: 'none' }, { reason })
}

/** Branch 3: `No reply from … within …s. …`. */
function readNoReplyBody(body: string): BodyReading | undefined {
  if (!body.startsWith('No reply from ')) return undefined
  const reading = outcomeReading('unknown', { kind: 'none' })
  reading.latestOutcomeUnavailable = true
  return reading
}

/** A `text` reply becomes an excerpt when the receipt body was trimmed by the backend. */
function replyFromRelayText(text: string, trimmed: boolean): Reply {
  if (text === '(empty reply)') return { kind: 'empty' }
  return trimmed ? { kind: 'excerpt', body: text } : { kind: 'text', body: text, completeness: 'unknown' }
}

/** Branch 4: `Reply from … on …:\n<text>` or `(empty reply)`. */
function readReplyFromBody(body: string, trimmed: boolean): BodyReading | undefined {
  if (!body.startsWith('Reply from ')) return undefined
  const newlineIndex = body.indexOf('\n')
  const rest = newlineIndex === -1 ? '' : body.slice(newlineIndex + 1)
  if (rest.trim().length === 0) return outcomeReading('settled', { kind: 'empty' })
  return outcomeReading('settled', replyFromRelayText(rest, trimmed))
}

/** Branch 6: plain CLI stdout. Drops the resumed-session/session_id lines, then trims. */
function readCliTextBody(body: string, exitCode: number | 'unknown', trimmed: boolean): BodyReading {
  const cleaned = body
    .split('\n')
    .filter(line => !SESSION_ID_LINE_RE.test(line) && !RESUMED_SESSION_LINE_RE.test(line))
    .join('\n')
    .trim()

  if (cleaned.length > 0) {
    const reply: Reply = trimmed ? { kind: 'excerpt', body: cleaned } : { kind: 'text', body: cleaned, completeness: 'unknown' }
    return outcomeReading('settled', reply)
  }
  return exitCode === 0 ? outcomeReading('settled', { kind: 'empty' }) : outcomeReading('unknown', { kind: 'none' })
}

/**
 * Reads a parsed receipt's body per the grammar's ordered branches (spec 5.2). A JSON `failed`
 * status that carries a `reason` takes its delivery from the reason table; CLI text with nothing
 * left reads as settled on exit code 0 and as unknown otherwise.
 */
export function readBody(receipt: ParsedReceipt, opts: { pairedResultHasDeliveryId: boolean }): BodyReading {
  const { body, trimmed } = receipt

  const jsonReading = readJsonBody(body)
  if (jsonReading) return jsonReading

  const deliveryFailedReading = readDeliveryFailedBody(body)
  if (deliveryFailedReading) return deliveryFailedReading

  const noReplyReading = readNoReplyBody(body)
  if (noReplyReading) return noReplyReading

  const replyFromReading = readReplyFromBody(body, trimmed)
  if (replyFromReading) return replyFromReading

  if (body.startsWith('{') || opts.pairedResultHasDeliveryId) return outcomeReading('unknown', { kind: 'damaged' })

  return readCliTextBody(body, receipt.headline.exitCode, trimmed)
}
