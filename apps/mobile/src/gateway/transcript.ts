/**
 * REST transcript row normalization (docs/06-hermes-api-contract.md, "Session transcript").
 * Pure: no React or React Native imports (ADR-029 rule 1). It lives next to the
 * port so both adapters can use it without importing a feature.
 */

import type { TranscriptPage, TranscriptRawPage, TranscriptRow, TranscriptToolCall } from '@/gateway/types'

const ROLES = new Set(['user', 'assistant', 'tool', 'system'])

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(part => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '')).filter(Boolean).join('\n')
  }
  return ''
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

function toolCallsOf(raw: unknown): TranscriptToolCall[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: TranscriptToolCall[] = []
  for (const tc of raw) {
    if (!tc || typeof tc !== 'object') continue
    const fn = (tc as { function?: { name?: unknown; arguments?: unknown } }).function ?? {}
    const id = (tc as { id?: unknown }).id
    if (typeof id !== 'string' || typeof fn.name !== 'string') continue
    const parsed = typeof fn.arguments === 'string' ? parseJson(fn.arguments) : fn.arguments
    out.push({ id, name: fn.name, args: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} })
  }
  return out
}

export function normalizeTranscriptRow(raw: unknown): TranscriptRow | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'number' || !Number.isFinite(m.id)) return null
  if (m.display_kind === 'hidden') return null
  const role = typeof m.role === 'string' && ROLES.has(m.role) ? (m.role as TranscriptRow['role']) : 'system'
  const content = textOf(m.content)
  const text = typeof m.display_content === 'string' ? m.display_content : content
  const row: TranscriptRow = { id: m.id, role, text, content }
  const toolCalls = toolCallsOf(m.tool_calls)
  if (toolCalls) row.toolCalls = toolCalls
  if (typeof m.tool_call_id === 'string' && m.tool_call_id) row.toolCallId = m.tool_call_id
  if (typeof m.tool_name === 'string' && m.tool_name) row.toolName = m.tool_name
  if (role === 'tool') { const parsed = parseJson(content); row.result = parsed === undefined ? content : parsed }
  if (typeof m.timestamp === 'number' && m.timestamp > 0) row.at = m.timestamp
  if (typeof m.display_kind === 'string') row.displayKind = m.display_kind
  if (m.display_metadata !== undefined && m.display_metadata !== null) row.displayMetadata = m.display_metadata
  return row
}

export function normalizeTranscriptPage(raw: TranscriptRawPage): TranscriptPage {
  const rows = (Array.isArray(raw?.messages) ? raw.messages : []).map(normalizeTranscriptRow).filter((r): r is TranscriptRow => r !== null).sort((a, b) => a.id - b.id)
  const p = raw?.pagination ?? { limit: rows.length, offset: 0, returned: rows.length }
  return { sessionId: String(raw?.session_id ?? ''), rows, page: { limit: Number(p.limit) || rows.length, offset: Number(p.offset) || 0, returned: Number(p.returned) || rows.length } }
}
