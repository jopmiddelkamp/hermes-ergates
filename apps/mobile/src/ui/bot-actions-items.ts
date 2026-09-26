/**
 * The bot action menu's item lists (docs/10 "Bot actions") as a pure function
 * of the current level. No React and no React Native imports, so the level
 * machine and the "only terminal items dismiss the menu" rule are testable in
 * Node (ADR-029 rule 4). `BotActions.tsx` owns the React state, the Clipboard
 * write and the Delete dialog; `ActionMenu.tsx` draws the rows.
 *
 * One menu with separators, mirroring the Hermes Desktop context menu: the
 * main level groups Pin/Move to/Mark as Unread, then Edit Bot/Select, then
 * Copy ID, then Hide/Delete. "Move to" opens a Move level in place, listing
 * every section with a check mark on the bot's current place; "Create
 * section" there opens a Create level for a new section's name.
 */

import { canCreateSection } from '@/features/agents'
import type { Bot } from '@/features/agents'
import type { Section } from '@/state/organization'

import type { IconName } from './icons'

export type BotActionLevel = 'main' | 'move' | 'create'

export interface BotActionItem {
  kind: 'item'
  key: string
  label: string
  icon?: IconName
  /** Draws a chevron-right at the row's end: "Move to" opens the Move level. */
  chevron?: boolean
  destructive?: boolean
  /** Announced as selected by the screen reader; drives the check-mark icon in the Move level. */
  selected?: boolean
  onPress: () => void
}

export interface BotActionSeparator {
  kind: 'separator'
  key: string
}

/** One row of the menu: a pressable item, or a hairline group divider. */
export type BotActionRow = BotActionItem | BotActionSeparator

export interface BotActionHandlers {
  edit(bot: Bot): void
  toggleUnread(bot: Bot, unread: boolean): void
  togglePin(bot: Bot, pinned: boolean): void
  /** Moves the bot to a section, or to "No section" when `sectionId` is null. */
  moveToSection(bot: Bot, sectionId: string | null): void
  /** Creates a section with this trimmed name, then moves the bot into it. */
  createSection(bot: Bot, name: string): void
  toggleHidden(bot: Bot, hidden: boolean): void
  remove(bot: Bot): void
  /** Opens Home's Edit mode with this bot selected. The Select row shows only where this is set. */
  select?(bot: Bot): void
}

export interface BotActionItemsInput {
  bot: Bot
  level: BotActionLevel
  unread: boolean
  pinned: boolean
  /** Every section, any order; the Move level sorts them and lists "No section" first. */
  sections: Section[]
  /** Where the bot sits now; null is "No section". Decides the Move level's check mark. */
  currentSectionId: string | null
  handlers: BotActionHandlers
  /** Moves between levels. Must not dismiss the menu. */
  setLevel(level: BotActionLevel): void
  /** Dismisses the menu and resets it to the main level. */
  close(): void
  /** Copies the bot's id plus connection label (Clipboard lives in the component). */
  copyId(bot: Bot): void
  /** Asks for confirmation, then calls `handlers.remove` (platform dialog). */
  confirmDelete(bot: Bot): void
}

function item(key: string, label: string, icon: IconName, onPress: () => void, opts: Partial<Pick<BotActionItem, 'destructive' | 'chevron' | 'selected'>> = {}): BotActionItem {
  return { kind: 'item', key, label, icon, onPress, ...opts }
}

function separator(key: string): BotActionSeparator {
  return { kind: 'separator', key }
}

/**
 * Joins groups of items with one separator between each pair of non-empty
 * groups, so a separator never leads, trails, or appears twice in a row even
 * when a group (e.g. Select) is absent.
 */
function withSeparators(groups: BotActionItem[][]): BotActionRow[] {
  const nonEmpty = groups.filter(group => group.length > 0)
  return nonEmpty.flatMap((group, index) => (index === 0 ? group : [separator(`sep-${index}`), ...group]))
}

/** The header row: back chevron plus the current level's name, going back without closing. */
function headerRow(label: string, back: () => void): BotActionItem {
  return item('header', label, 'chevron-left', back)
}

function mainLevelItems(input: BotActionItemsInput): BotActionRow[] {
  const { bot, handlers, setLevel, close } = input
  // Terminal actions dismiss the menu themselves; level changes must not.
  // (`ActionMenu` used to call `onClose()` before every item's handler, so
  // the submenu levels unmounted the menu instead of opening.) Delete opens a
  // native dialog and closes from the dialog's own buttons instead: an alert
  // presented while the menu's Modal is being dismissed is torn down with it
  // on iOS.
  const run = (fn: () => void) => () => {
    close()
    fn()
  }
  const select = handlers.select

  const groups: BotActionItem[][] = [
    [
      item('pin', input.pinned ? 'Unpin' : 'Pin', 'bookmark', run(() => handlers.togglePin(bot, !input.pinned))),
      item('move', 'Move to', 'folder', () => setLevel('move'), { chevron: true }),
      item('unread', input.unread ? 'Mark as Read' : 'Mark as Unread', 'mail', run(() => handlers.toggleUnread(bot, !input.unread)))
    ],
    [item('edit', 'Edit Bot', 'edit', run(() => handlers.edit(bot))), ...(select ? [item('select', 'Select', 'check-circle', run(() => select(bot)))] : [])],
    [item('copy', 'Copy ID', 'copy', run(() => input.copyId(bot)))],
    [
      item('hide', bot.hidden ? 'Unhide' : 'Hide', 'eye-off', run(() => handlers.toggleHidden(bot, !bot.hidden))),
      ...(bot.isDefault ? [] : [item('delete', 'Delete', 'trash', () => input.confirmDelete(bot), { destructive: true })])
    ]
  ]
  return withSeparators(groups)
}

function moveLevelItems(input: BotActionItemsInput): BotActionRow[] {
  const { bot, sections, currentSectionId, handlers, setLevel, close } = input
  const choices: { id: string | null; name: string }[] = [
    { id: null, name: 'No section' },
    ...[...sections].sort((a, b) => a.order - b.order).map(s => ({ id: s.id, name: s.name }))
  ]

  const rows: BotActionRow[] = [headerRow('Move to', () => setLevel('main'))]
  for (const choice of choices) {
    const current = choice.id === currentSectionId
    rows.push(
      item(choice.id ?? 'none', choice.name, current ? 'check' : 'folder', () => {
        close()
        if (!current) {
          handlers.moveToSection(bot, choice.id)
        }
      }, { selected: current })
    )
  }
  rows.push(separator('sep-move'))
  rows.push(item('create', 'Create section', 'plus', () => setLevel('create')))
  return rows
}

function createLevelItems(input: BotActionItemsInput): BotActionRow[] {
  return [headerRow('Create section', () => input.setLevel('move'))]
}

export function botActionItems(input: BotActionItemsInput): BotActionRow[] {
  if (input.level === 'move') {
    return moveLevelItems(input)
  }
  if (input.level === 'create') {
    return createLevelItems(input)
  }
  return mainLevelItems(input)
}

export interface CreateSectionInput {
  bot: Bot
  /** Live text of the Create level's name field (state lives in `BotActions`). */
  name: string
  close(): void
  handlers: Pick<BotActionHandlers, 'createSection'>
}

export interface CreateSectionResult {
  /** Mirrors `canCreateSection(name)`: disables the Create button for a blank name. */
  disabled: boolean
  onCreate: () => void
}

/** The Create level's button: disabled for a blank name, otherwise closes the menu and creates the section. */
export function createSectionAction(input: CreateSectionInput): CreateSectionResult {
  const disabled = !canCreateSection(input.name)
  return {
    disabled,
    onCreate: () => {
      if (disabled) {
        return
      }
      input.close()
      input.handlers.createSection(input.bot, input.name)
    }
  }
}
