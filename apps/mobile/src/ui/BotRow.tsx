/**
 * Roster row with its avatar query: one component for Home, Search and any
 * other list, so a bot looks the same everywhere (photo, shape or initials).
 * Long-press reports the row's window rectangle for the anchored action menu.
 */

import { useRef } from 'react'
import { View } from 'react-native'

import { useAvatar, type Bot } from '@/features/agents'
import { formatRowTime } from '@/lib/time'

import type { AnchorRect } from './ActionMenu'
import { Row } from './Row'

export interface BotRowProps {
  bot: Bot
  gateway: Parameters<typeof useAvatar>[0]
  connectionId: string
  unread?: boolean
  /** Show the last-activity time (Home); Search leaves it out. */
  showTime?: boolean
  /** Second line: the latest message (Home) or the bot's description (Search). */
  preview?: 'activity' | 'description'
  onPress: () => void
  onLongPress?: (anchor: AnchorRect) => void
}

export function BotRow({ bot, gateway, connectionId, unread = false, showTime = true, preview = 'activity', onPress, onLongPress }: BotRowProps) {
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  const ref = useRef<View>(null)
  const measure = () => ref.current?.measureInWindow((x, y, width, height) => onLongPress?.({ x, y, width, height }))
  return (
    <View ref={ref} collapsable={false}>
      <Row
        name={bot.name}
        role={bot.role || undefined}
        avatarColor={bot.color}
        avatarImageUri={avatar.data ?? null}
        time={showTime ? formatRowTime(bot.lastActivityAt) : undefined}
        preview={preview === 'description' ? bot.description || bot.preview : bot.preview || bot.description}
        unread={unread}
        onPress={onPress}
        onLongPress={onLongPress ? measure : undefined}
      />
    </View>
  )
}
