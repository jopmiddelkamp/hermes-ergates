/**
 * The bot action menu's item lists (docs/10 "Bot actions") as a pure function
 * of the current level. No React and no React Native imports, so the level
 * machine and the "only terminal items dismiss the menu" rule are testable in
 * Node (ADR-029 rule 4). `BotActions.tsx` owns the React state, the Clipboard
 * write and the Delete dialog.
 */

import type { Bot } from '@/features/agents'

import type { IconName } from './icons'

export type BotActionLevel = 'main' | 'more'

export interface BotActionItem {
  key: string
  label: string
  icon?: IconName
  destructive?: boolean
  onPress: () => void
}

export interface BotActionHandlers {
  edit(bot: Bot): void
  toggleUnread(bot: Bot, unread: boolean): void
  togglePin(bot: Bot, pinned: boolean): void
  /** Opens the Move to Section page for this bot. */
  moveToSection(bot: Bot): void
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
  /** The bot is in a section: the row says "Move to Section" instead of "New Section". */
  inSection: boolean
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

export function botActionItems(input: BotActionItemsInput): BotActionItem[] {
  const { bot, level, handlers, setLevel, close } = input

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
  const back: BotActionItem = { key: 'back', label: 'Back', icon: 'chevron-left', onPress: () => setLevel('main') }

  if (level === 'more') {
    return [
      { key: 'copy', label: 'Copy ID', icon: 'copy', onPress: run(() => input.copyId(bot)) },
      ...(bot.isDefault
        ? []
        : [{ key: 'delete', label: 'Delete', icon: 'trash' as const, destructive: true, onPress: () => input.confirmDelete(bot) }]),
      back
    ]
  }

  const select = handlers.select
  return [
    { key: 'edit', label: 'Edit Bot', icon: 'edit', onPress: run(() => handlers.edit(bot)) },
    { key: 'unread', label: input.unread ? 'Mark Read' : 'Mark Unread', icon: 'mail', onPress: run(() => handlers.toggleUnread(bot, !input.unread)) },
    { key: 'pin', label: input.pinned ? 'Unpin' : 'Pin', icon: 'bookmark', onPress: run(() => handlers.togglePin(bot, !input.pinned)) },
    { key: 'section', label: input.inSection ? 'Move to Section' : 'New Section', icon: 'folder', onPress: run(() => handlers.moveToSection(bot)) },
    { key: 'hide', label: bot.hidden ? 'Unhide' : 'Hide', icon: 'eye-off', onPress: run(() => handlers.toggleHidden(bot, !bot.hidden)) },
    ...(select ? [{ key: 'select', label: 'Select', icon: 'check-circle' as const, onPress: run(() => select(bot)) }] : []),
    { key: 'more', label: 'More', icon: 'more-horizontal', onPress: () => setLevel('more') }
  ]
}
