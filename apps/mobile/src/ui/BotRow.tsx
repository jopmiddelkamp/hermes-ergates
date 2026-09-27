/**
 * Roster row with its avatar query, for Search results: the same look as a
 * Home row (photo, shape or initials), so a bot's avatar matches everywhere.
 */

import { useAvatar, type Bot } from '@/features/agents'
import { formatRowTime } from '@/lib/time'

import { Row } from './Row'

export interface BotRowProps {
  bot: Bot
  gateway: Parameters<typeof useAvatar>[0]
  connectionId: string
  /** Show the last-activity time (Home); Search leaves it out. */
  showTime?: boolean
  /** Second line: the latest message (Home) or the bot's description (Search). */
  preview?: 'activity' | 'description'
  onPress: () => void
}

export function BotRow({ bot, gateway, connectionId, showTime = true, preview = 'activity', onPress }: BotRowProps) {
  const avatar = useAvatar(gateway, connectionId, bot.profile, bot.hasAvatar)
  return (
    <Row
      name={bot.name}
      role={bot.role || undefined}
      avatarColor={bot.color}
      avatarImageUri={avatar.data ?? null}
      time={showTime ? formatRowTime(bot.lastActivityAt) : undefined}
      preview={preview === 'description' ? bot.description || bot.preview : bot.preview || bot.description}
      onPress={onPress}
    />
  )
}
