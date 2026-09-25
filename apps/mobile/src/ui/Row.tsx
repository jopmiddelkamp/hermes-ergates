/**
 * Flat conversation row (docs/10 section 4): avatar, name, optional role
 * badge, time, one-line preview, unread dot. No card or separator — rows sit
 * directly on the page background, and the page (`Screen`/`Sheet`) owns the
 * horizontal gutter, so this component adds none.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '@/theme/provider'

import { Avatar } from './Avatar'

const AVATAR_SIZE = 48
/** Design floor for the row; never allowed below the shared min hit area. */
const ROW_MIN_HEIGHT = 52
const BADGE_MAX_WIDTH = 113
const UNREAD_DOT_SIZE = 8

export interface RowProps {
  name: string
  avatarColor?: string
  avatarImageUri?: string | null
  role?: string
  time?: string
  preview?: string
  unread?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

export function Row({ name, avatarColor, avatarImageUri, role, time, preview, unread, onPress, onLongPress }: RowProps) {
  const theme = useTheme()

  const label = [name, role, unread ? 'unread' : '', time, preview].filter(Boolean).join(', ')

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: Math.max(theme.hit, ROW_MIN_HEIGHT),
          backgroundColor: pressed ? theme.colors.muted : 'transparent'
        }
      ]}
    >
      <Avatar name={name} color={avatarColor} imageUri={avatarImageUri} size={AVATAR_SIZE} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text numberOfLines={1} style={[styles.name, { color: theme.colors.foreground }]}>
            {name}
          </Text>
          {role ? (
            <Text
              numberOfLines={1}
              style={[
                styles.badge,
                { color: theme.colors.mutedForeground, backgroundColor: theme.colors.muted }
              ]}
            >
              {role}
            </Text>
          ) : null}
          {time ? (
            <Text numberOfLines={1} style={[styles.time, { color: theme.colors.mutedForeground }]}>
              {time}
            </Text>
          ) : null}
        </View>
        <View style={styles.line}>
          {preview ? (
            <Text numberOfLines={1} style={[styles.preview, { color: theme.colors.mutedForeground }]}>
              {preview}
            </Text>
          ) : (
            <View style={styles.preview} />
          )}
          {unread ? (
            <View
              // Decorative: an `accessible` container hides its descendants on
              // iOS, so the state is carried by the row's own label instead.
              accessible={false}
              style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]}
            />
          ) : null}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8
  },
  body: {
    flex: 1,
    gap: 2
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  name: {
    flex: 1,
    fontSize: 17,
    fontWeight: '500'
  },
  badge: {
    fontSize: 12,
    borderRadius: 6,
    maxWidth: BADGE_MAX_WIDTH,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden'
  },
  time: {
    fontSize: 12
  },
  preview: {
    flex: 1,
    fontSize: 15
  },
  unreadDot: {
    width: UNREAD_DOT_SIZE,
    height: UNREAD_DOT_SIZE,
    borderRadius: UNREAD_DOT_SIZE / 2
  }
})
