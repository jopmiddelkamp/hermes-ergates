/**
 * The bot action menu's item lists (docs/10 "Bot actions") as a pure function
 * of the current level. No React and no React Native imports, so the level
 * machine and the "only terminal items dismiss the menu" rule are testable in
 * Node (ADR-029 rule 4). `BotActions.tsx` owns the React state, the Clipboard
 * write and the platform dialogs.
 */

import type { Bot } from '@/features/agents/roster'
import type { Section } from '@/state/organization'

import type { IconName } from './icons'

export type BotActionLevel = 'main' | 'more' | 'sections'

export interface BotActionItem {
  key: string
  label: string
  icon?: IconName
  destructive?: boolean
  /** The bot's current section: announced by VoiceOver, never drawn as text. */
  selected?: boolean
  onPress: () => void
}

export interface BotActionHandlers {
  edit(bot: Bot): void
  toggleUnread(bot: Bot, unread: boolean): void
  togglePin(bot: Bot, pinned: boolean): void
  moveToSection(bot: Bot, sectionId: string | null): void
  createSection(bot: Bot, name: string): void
  toggleHidden(bot: Bot, hidden: boolean): void
  remove(bot: Bot): void
}

export interface BotActionItemsInput {
  bot: Bot
  level: BotActionLevel
  unread: boolean
  pinned: boolean
  sections: Section[]
  currentSectionId: string | null
  handlers: BotActionHandlers
  /** Moves between levels. Must not dismiss the menu. */
  setLevel(level: BotActionLevel): void
  /** Dismisses the menu and resets it to the main level. */
  close(): void
  /** Copies the bot's id plus connection label (Clipboard lives in the component). */
  copyId(bot: Bot): void
  /** Asks for a section name, then calls `handlers.createSection` (platform dialog). */
  askNewSection(bot: Bot): void
  /** Asks for confirmation, then calls `handlers.remove` (platform dialog). */
  confirmDelete(bot: Bot): void
}

export function botActionItems(input: BotActionItemsInput): BotActionItem[] {
  const { bot, level, handlers, setLevel, close } = input

  // Terminal actions dismiss the menu themselves; level changes must not.
  // (C1: `ActionMenu` used to call `onClose()` before every item's handler, so
  // the submenu levels unmounted the menu instead of opening.) Items that open
  // a native dialog (`confirmDelete`, `askNewSection`) close from the dialog's
  // own buttons instead: an alert presented while the menu's Modal is being
  // dismissed is torn down with it on iOS.
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

  if (level === 'sections') {
    return [
      ...input.sections.map(s => ({
        key: s.id,
        label: s.name,
        icon: 'folder' as const,
        selected: s.id === input.currentSectionId,
        onPress: run(() => handlers.moveToSection(bot, s.id))
      })),
      ...(input.currentSectionId
        ? [{ key: 'none', label: 'Remove from section', icon: 'minus' as const, onPress: run(() => handlers.moveToSection(bot, null)) }]
        : []),
      { key: 'new', label: 'New Section…', icon: 'plus', onPress: () => input.askNewSection(bot) },
      back
    ]
  }

  return [
    { key: 'edit', label: 'Edit Bot', icon: 'edit', onPress: run(() => handlers.edit(bot)) },
    { key: 'unread', label: input.unread ? 'Mark Read' : 'Mark Unread', icon: 'mail', onPress: run(() => handlers.toggleUnread(bot, !input.unread)) },
    { key: 'pin', label: input.pinned ? 'Unpin' : 'Pin', icon: 'bookmark', onPress: run(() => handlers.togglePin(bot, !input.pinned)) },
    { key: 'section', label: input.currentSectionId ? 'Move to Section' : 'New Section', icon: 'folder', onPress: () => setLevel('sections') },
    { key: 'hide', label: bot.hidden ? 'Unhide' : 'Hide', icon: 'eye-off', onPress: run(() => handlers.toggleHidden(bot, !bot.hidden)) },
    { key: 'more', label: 'More', icon: 'more-horizontal', onPress: () => setLevel('more') }
  ]
}
