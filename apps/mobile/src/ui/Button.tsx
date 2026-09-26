/**
 * Control button (docs/10 section 4: minimum height 50, radius 16, 600-weight
 * label). Primary sits on `primary`; secondary is the soft `muted` button with
 * `foreground` text. Variants map to the paired tokens in docs/10 section 3.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native'

import { useTheme } from '@/theme/provider'
import type { MobileTheme } from '@/theme/tokens'

const RADIUS = 16
const MIN_HEIGHT = 50

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost'

export interface ButtonProps {
  label: string
  onPress: () => void
  variant?: ButtonVariant
  loading?: boolean
  disabled?: boolean
  accessibilityLabel?: string
  /** No horizontal padding: a text action that must align with the content edge (sheet headers). */
  compact?: boolean
}

function colorsFor(theme: MobileTheme, variant: ButtonVariant) {
  switch (variant) {
    case 'primary':
      return { background: theme.colors.primary, foreground: theme.colors.primaryForeground }
    case 'secondary':
      return { background: theme.colors.muted, foreground: theme.colors.foreground }
    case 'destructive':
      return { background: theme.colors.destructive, foreground: theme.colors.destructiveForeground }
    case 'ghost':
      return { background: 'transparent', foreground: theme.colors.foreground }
  }
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, accessibilityLabel, compact }: ButtonProps) {
  const theme = useTheme()
  const { background, foreground } = colorsFor(theme, variant)
  const isDisabled = disabled || loading

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        { minHeight: MIN_HEIGHT, minWidth: theme.hit, backgroundColor: background, opacity: isDisabled ? 0.45 : pressed ? 0.7 : 1 },
        compact ? styles.compact : null
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[styles.label, { color: foreground }]}>{label}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    borderRadius: RADIUS,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  compact: {
    paddingHorizontal: 0,
    minWidth: 0
  },
  label: {
    fontSize: 17,
    fontWeight: '600'
  }
})
