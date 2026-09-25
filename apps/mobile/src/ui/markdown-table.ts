/**
 * Pure helper for MarkdownText's narrow-width table rule (docs/10 section 3).
 * No React Native imports — safe to unit test under Node.
 */

export interface StackedCell {
  label: string
  value: string
}

/**
 * Converts a markdown table's raw cell text into stacked "label: value"
 * groups, one group per body row. The first row is the header; each
 * following row is paired with the header cell at the same index. A row
 * shorter than the header gets '' for the missing trailing cells; cells
 * beyond the header width are dropped (there is no label for them).
 */
export function tableToStacked(rows: string[][]): StackedCell[][] {
  const [header = [], ...body] = rows
  return body.map(row => header.map((label, i) => ({ label, value: row[i] ?? '' })))
}

/**
 * Minimal shape of a `react-native-markdown-display` AST node — just the
 * fields the table walk needs. A real `ASTNode` (from the library) is a
 * structural superset of this, so it can be passed in directly.
 */
export interface MarkdownNode {
  type: string
  content: string
  children: MarkdownNode[]
  attributes?: Record<string, unknown>
}

/**
 * Plain text of a node, for a table cell. Container nodes (an inline run,
 * `strong`/`em`/`s`/`link`, `th`/`td` themselves) hold their un-rendered
 * source in `.content` (e.g. `**bold**`), so those must be read by walking
 * `.children`, not by taking `.content` at face value. Only true leaves get
 * their text from `.content`: `text` and `code_inline`. `softbreak` becomes
 * a space, and `image` contributes its alt text.
 */
function textOfNode(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
    case 'code_inline':
      return node.content
    case 'softbreak':
      return ' '
    case 'image':
      return typeof node.attributes?.alt === 'string' ? node.attributes.alt : ''
    default:
      return node.children.map(textOfNode).join('')
  }
}

/**
 * Extracts a markdown `table` AST node into raw cell text rows (header
 * first), per react-native-markdown-display's shape: table -> thead/tbody ->
 * tr -> th/td.
 */
export function astTableToRows(table: MarkdownNode): string[][] {
  const rows: string[][] = []
  for (const section of table.children) {
    if (section.type !== 'thead' && section.type !== 'tbody') {
      continue
    }
    for (const row of section.children) {
      if (row.type === 'tr') {
        rows.push(row.children.map(textOfNode))
      }
    }
  }
  return rows
}
