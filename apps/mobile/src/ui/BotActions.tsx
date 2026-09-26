/**
 * The compact bot action menu (docs/10 "Bot actions") shared by Home rows,
 * pinned avatars and the agent details overflow. Owns the level state and the
 * Delete dialog; the item lists themselves are built by the pure
 * `botActionItems` (tested in Node), and the caller owns the anchor and the
 * effects.
 */

import * as Clipboard from 'expo-clipboard'
import React, { useState } from 'react'
import { Alert } from 'react-native'

import type { Bot } from '@/features/agents'

import { ActionMenu, type AnchorRect } from './ActionMenu'
import { botActionItems, type BotActionHandlers, type BotActionLevel } from './bot-actions-items'

export type { BotActionHandlers }

export interface BotActionsProps {
  bot: Bot | null
  anchor: AnchorRect | null
  unread: boolean
  pinned: boolean
  inSection: boolean
  connectionLabel: string
  handlers: BotActionHandlers
  onClose(): void
}

export function BotActions({ bot, anchor, unread, pinned, inSection, connectionLabel, handlers, onClose }: BotActionsProps) {
  const [level, setLevel] = useState<BotActionLevel>('main')
  const close = () => {
    setLevel('main')
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
    inSection,
    handlers,
    setLevel,
    close,
    copyId: target => void Clipboard.setStringAsync(`${target.profile} @ ${connectionLabel}`),
    confirmDelete
  })

  return <ActionMenu visible={Boolean(bot)} anchor={anchor} items={items} onClose={close} />
}
