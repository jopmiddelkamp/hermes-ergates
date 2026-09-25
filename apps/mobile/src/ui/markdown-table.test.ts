import { describe, expect, it } from 'vitest'

import { astTableToRows, tableToStacked, type MarkdownNode } from './markdown-table'

describe('tableToStacked', () => {
  it('turns each body row into label/value pairs keyed by the header', () => {
    const rows = [
      ['Name', 'Role'],
      ['Linh', 'Concierge'],
      ['Kevin', 'Scout']
    ]
    expect(tableToStacked(rows)).toEqual([
      [
        { label: 'Name', value: 'Linh' },
        { label: 'Role', value: 'Concierge' }
      ],
      [
        { label: 'Name', value: 'Kevin' },
        { label: 'Role', value: 'Scout' }
      ]
    ])
  })

  it('fills missing cells with an empty string when a row is shorter than the header', () => {
    const rows = [
      ['Name', 'Role', 'Status'],
      ['Linh']
    ]
    expect(tableToStacked(rows)).toEqual([
      [
        { label: 'Name', value: 'Linh' },
        { label: 'Role', value: '' },
        { label: 'Status', value: '' }
      ]
    ])
  })

  it('ignores extra cells beyond the header width', () => {
    const rows = [['A'], ['1', '2', '3']]
    expect(tableToStacked(rows)).toEqual([[{ label: 'A', value: '1' }]])
  })

  it('returns an empty array when there is only a header row', () => {
    expect(tableToStacked([['A', 'B']])).toEqual([])
  })

  it('returns an empty array for an empty table', () => {
    expect(tableToStacked([])).toEqual([])
  })

  it('returns an empty array when the header row itself is empty', () => {
    expect(tableToStacked([[], ['1', '2']])).toEqual([[]])
  })
})

describe('astTableToRows', () => {
  // Minimal AST node builders matching react-native-markdown-display's shape.
  const leaf = (type: string, content: string): MarkdownNode => ({ type, content, children: [] })
  const node = (type: string, content: string, children: MarkdownNode[]): MarkdownNode => ({ type, content, children })
  const table = (thead: MarkdownNode, tbody: MarkdownNode): MarkdownNode => ({
    type: 'table',
    content: '',
    children: [thead, tbody]
  })
  const tr = (cells: MarkdownNode[]): MarkdownNode => node('tr', '', cells)
  const cell = (type: 'th' | 'td', inline: MarkdownNode): MarkdownNode => node(type, '', [inline])

  it('reads plain header/body text out of a table AST', () => {
    const thead = node('thead', '', [tr([cell('th', node('inline', 'Name', [leaf('text', 'Name')]))])])
    const tbody = node('tbody', '', [tr([cell('td', node('inline', 'Linh', [leaf('text', 'Linh')]))])])
    expect(astTableToRows(table(thead, tbody))).toEqual([['Name'], ['Linh']])
  })

  it('takes the rendered plain text of a formatted cell, not its raw markdown source', () => {
    // The `inline` node's own `.content` is the RAW markdown source markdown-it
    // keeps around ("**Linh**") — the bug was reading that instead of walking
    // into the parsed `strong` -> `text` children ("Linh").
    const formattedCell = node('inline', '**Linh**', [node('strong', '', [leaf('text', 'Linh')])])
    const thead = node('thead', '', [tr([cell('th', node('inline', 'Name', [leaf('text', 'Name')]))])])
    const tbody = node('tbody', '', [tr([cell('td', formattedCell)])])
    expect(astTableToRows(table(thead, tbody))).toEqual([['Name'], ['Linh']])
  })

  it('turns a softbreak between text runs into a single space', () => {
    const wrapped = node('inline', 'a\nb', [leaf('text', 'a'), leaf('softbreak', ''), leaf('text', 'b')])
    const thead = node('thead', '', [tr([cell('th', node('inline', 'H', [leaf('text', 'H')]))])])
    const tbody = node('tbody', '', [tr([cell('td', wrapped)])])
    expect(astTableToRows(table(thead, tbody))).toEqual([['H'], ['a b']])
  })

  it("uses an image's alt text", () => {
    const withImage = node('inline', '![a cat](cat.png)', [
      { type: 'image', content: '', children: [], attributes: { alt: 'a cat', src: 'cat.png' } }
    ])
    const thead = node('thead', '', [tr([cell('th', node('inline', 'H', [leaf('text', 'H')]))])])
    const tbody = node('tbody', '', [tr([cell('td', withImage)])])
    expect(astTableToRows(table(thead, tbody))).toEqual([['H'], ['a cat']])
  })
})
