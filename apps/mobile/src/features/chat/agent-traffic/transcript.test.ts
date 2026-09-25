import { describe, expect, it } from 'vitest'

import { normalizeTranscriptPage, normalizeTranscriptRow } from './transcript'

import senderPage from '@test/fixtures/agent-traffic/transcript-sender.json'

describe('normalizeTranscriptRow', () => {
  it('decodes an assistant row with tool_calls into toolCalls with parsed args', () => {
    const row = normalizeTranscriptRow({ id: 10, role: 'assistant', content: '', timestamp: 1789300000.5, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'message_agent', arguments: '{"target":"kevin","message":"Hi"}' } }] })
    expect(row).toMatchObject({ id: 10, role: 'assistant', text: '', at: 1789300000.5, toolCalls: [{ id: 'call_1', name: 'message_agent', args: { target: 'kevin', message: 'Hi' } }] })
  })
  it('decodes a tool row result as JSON when it parses, else keeps the raw string', () => {
    expect(normalizeTranscriptRow({ id: 11, role: 'tool', tool_call_id: 'call_1', tool_name: 'message_agent', content: '{"status":"sent","process_id":"proc_0123456789ab"}', timestamp: 1 })).toMatchObject({ toolCallId: 'call_1', toolName: 'message_agent', result: { status: 'sent', process_id: 'proc_0123456789ab' } })
    expect(normalizeTranscriptRow({ id: 12, role: 'tool', tool_call_id: 'call_2', content: 'not json', timestamp: 1 })).toMatchObject({ result: 'not json', text: 'not json' })
  })
  it('never throws on malformed tool_calls or arguments; the row still exists', () => {
    const row = normalizeTranscriptRow({ id: 13, role: 'assistant', content: 'x', tool_calls: 'garbage' })
    expect(row).toMatchObject({ id: 13, text: 'x' })
    expect(row?.toolCalls).toBeUndefined()
    const bad = normalizeTranscriptRow({ id: 14, role: 'assistant', content: 'y', tool_calls: [{ id: 'c', function: { name: 'message_agent', arguments: '{oops' } }] })
    expect(bad?.toolCalls).toEqual([{ id: 'c', name: 'message_agent', args: {} }])
  })
  it('uses display_content over content, drops hidden rows, joins content parts', () => {
    expect(normalizeTranscriptRow({ id: 1, role: 'user', content: 'raw', display_content: 'shown' })?.text).toBe('shown')
    expect(normalizeTranscriptRow({ id: 2, role: 'user', content: 'x', display_kind: 'hidden' })).toBeNull()
    expect(normalizeTranscriptRow({ id: 3, role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image_url' }, { type: 'text', text: 'b' }] })?.text).toBe('a\nb')
    expect(normalizeTranscriptRow({ role: 'user', content: 'no id' })).toBeNull()
    expect(normalizeTranscriptRow('nope')).toBeNull()
  })
})

describe('normalizeTranscriptPage', () => {
  it('normalizes the recorded sender page and keeps the pagination', () => {
    const page = normalizeTranscriptPage(senderPage as never)
    expect(page.sessionId).toBe(senderPage.session_id)
    expect(page.rows.length).toBeGreaterThan(0)
    expect(page.rows.every((r, i, all) => i === 0 || all[i - 1]!.id < r.id)).toBe(true)
    expect(page.page).toEqual({ limit: senderPage.pagination.limit, offset: senderPage.pagination.offset, returned: senderPage.pagination.returned })
    expect(page.rows.some(r => r.role === 'tool' && r.toolName === 'message_agent' && r.toolCallId)).toBe(true)
  })
})
