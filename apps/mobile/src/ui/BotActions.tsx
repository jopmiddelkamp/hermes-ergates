/**
 * The compact bot action menu (docs/10 "Bot actions") shared by Home rows,
 * pinned avatars and the agent details overflow. Owns the level state, the
 * Create level's name field state and the Delete dialog; the item lists
 * themselves are built by the pure `botActionItems` (tested in Node), and the
 * caller owns the anchor and the effects.
 */

import * as Clipboard from 'expo-clipboard'
import React, { useState } from 'react'
import { Alert } from 'react-native'

import type { Bot } from '@/features/agents'
import type { Section } from '@/state/organization'

import { ActionMenu, type AnchorRect } from './ActionMenu'
import { botActionItems, createSectionAction, type BotActionHandlers, type BotActionLevel } from './bot-actions-items'

export type { BotActionHandlers }

export interface BotActionsProps {
  bot: Bot | null
  anchor: AnchorRect | null
  unread: boolean
  pinned: boolean
  /** Every section, for the Move level's list. */
  sections: Section[]
  /** Where the bot sits now; null is "No section". */
  currentSectionId: string | null
  connectionLabel: string
  handlers: BotActionHandlers
  onClose(): void
}

export function BotActions({ bot, anchor, unread, pinned, sections, currentSectionId, connectionLabel, handlers, onClose }: BotActionsProps) {
  const [level, setLevel] = useState<BotActionLevel>('main')
  const [createName, setCreateName] = useState('')
  const close = () => {
    setLevel('main')
    setCreateName('')
    onClose()
  }
  if (!bot) {
    return null
  }

  // The dialog opens while the menu is still presented and closes it from its
  // own buttons; closing first would dismiss the alert together with the Modal.
  const confirmDelete = (target: Bot) => {
    Alert.alert(
      `Delete ${target.name}?`,
      'This removes the bot, its chat history, routines and workspace on the gateway. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => close() },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            close()
            handlers.remove(target)
          }
        }
      ],
      { onDismiss: () => close() }
    )
  }

  const items = botActionItems({
    bot,
    level,
    unread,
    pinned,
    sections,
    currentSectionId,
    handlers,
    setLevel,
    close,
    copyId: target => void Clipboard.setStringAsync(`${target.profile} @ ${connectionLabel}`),
    confirmDelete
  })

  const create = level === 'create' ? createSectionAction({ bot, name: createName, close, handlers }) : null

  return (
    <ActionMenu
      visible={Boolean(bot)}
      anchor={anchor}
      items={items}
      onClose={close}
      createSection={create ? { value: createName, onChangeText: setCreateName, disabled: create.disabled, onCreate: create.onCreate } : undefined}
    />
  )
}
