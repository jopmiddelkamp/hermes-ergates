/**
 * The compact bot action menu (docs/10 "Bot actions") shared by Home rows,
 * pinned avatars and the agent details overflow. Owns the level state and the
 * platform dialogs; the item lists themselves are built by the pure
 * `botActionItems` (tested in Node), and the caller owns the anchor and the
 * effects.
 */

import * as Clipboard from 'expo-clipboard'
import React, { useState } from 'react'
import { Alert, Platform } from 'react-native'

import type { Bot } from '@/features/agents'
import type { Section } from '@/state/organization'

import { ActionMenu, type AnchorRect } from './ActionMenu'
import { botActionItems, type BotActionHandlers, type BotActionLevel } from './bot-actions-items'

export type { BotActionHandlers }

export interface BotActionsProps {
  bot: Bot | null
  anchor: AnchorRect | null
  unread: boolean
  pinned: boolean
  sections: Section[]
  currentSectionId: string | null
  connectionLabel: string
  handlers: BotActionHandlers
  onClose(): void
}

export function BotActions({ bot, anchor, unread, pinned, sections, currentSectionId, connectionLabel, handlers, onClose }: BotActionsProps) {
  const [level, setLevel] = useState<BotActionLevel>('main')
  const close = () => {
    setLevel('main')
    onClose()
  }
  if (!bot) {
    return null
  }

  // Dialogs open while the menu is still presented and close it from their own
  // buttons; closing first would dismiss the alert together with the Modal.
  const askNewSection = (target: Bot) => {
    if (Platform.OS === 'ios') {
      Alert.prompt('New section', 'Name the section, for example Prive.', [
        { text: 'Cancel', style: 'cancel', onPress: () => close() },
        {
          text: 'Create',
          onPress: (name?: string) => {
            close()
            if (name?.trim()) {
              handlers.createSection(target, name.trim())
            }
          }
        }
      ])
    } else {
      close()
      handlers.createSection(target, 'New section')
    }
  }

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
    askNewSection,
    confirmDelete
  })

  return <ActionMenu visible={Boolean(bot)} anchor={anchor} items={items} onClose={close} />
}
