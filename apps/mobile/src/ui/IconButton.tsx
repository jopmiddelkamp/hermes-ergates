/**
 * Icon-only control with a guaranteed 44x44 hit area (docs/10 section 4).
 * `filled` draws a `muted` disc behind the icon for a quieter emphasis state.
 */

import { Pressable, StyleSheet } from 'react-native'

import { useTheme } from '@/theme/provider'

import { Icon, type IconName } from './icons'

const ICON_SIZE = 22

export interface IconButtonProps {
  name: IconName
  onPress: () => void
  accessibilityLabel: string
  size?: number
  filled?: boolean
  /** 48pt circle with a hairline border: the reference's header and composer controls. */
  outlined?: boolean
  disabled?: boolean
}

const OUTLINED_SIZE = 48

export function IconButton({ name, onPress, accessibilityLabel, size = ICON_SIZE, filled, outlined, disabled }: IconButtonProps) {
  const theme = useTheme()

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.hitArea,
        outlined ? { width: OUTLINED_SIZE, height: OUTLINED_SIZE, borderRadius: OUTLINED_SIZE / 2, borderWidth: 1, borderColor: theme.colors.border } : { width: theme.hit, height: theme.hit },
        filled ? { backgroundColor: theme.colors.muted, borderRadius: theme.hit / 2 } : null,
        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }
      ]}
    >
      <Icon name={name} size={size} color={theme.colors.foreground} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hitArea: {
    alignItems: 'center',
    justifyContent: 'center'
  }
})
