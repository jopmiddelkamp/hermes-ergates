/**
 * Settings switch row (docs/10 section 4: settings row min height 52). Sits
 * transparent so the caller can wrap a group of these in `Card` for the
 * grouped-row look.
 */

import { Platform, StyleSheet, Switch, Text, View } from 'react-native'

import { useTheme } from '@/theme/provider'

/** Design floor for the row; never allowed below the shared min hit area. */
const MIN_HEIGHT = 52

export interface SwitchRowProps {
  label: string
  description?: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}

export function SwitchRow({ label, description, value, onValueChange, disabled, accessibilityLabel }: SwitchRowProps) {
  const theme = useTheme()

  return (
    <View style={[styles.row, { minHeight: Math.max(theme.hit, MIN_HEIGHT) }]}>
      <View style={styles.text}>
        <Text style={[styles.label, { color: theme.colors.foreground }]}>{label}</Text>
        {description ? (
          <Text style={[styles.description, { color: theme.colors.mutedForeground }]}>{description}</Text>
        ) : null}
      </View>
      <Switch
        // iOS 26 draws the native switch about 12pt above the frame React Native
        // lays out for it (measured on the simulator), so it sat above its label.
        style={styles.switch}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel ?? label}
        trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
        thumbColor={theme.colors.background}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16
  },
  text: {
    flex: 1,
    gap: 2
  },
  label: {
    fontSize: 17
  },
  description: {
    fontSize: 13
  },
  switch: {
    height: 31,
    ...Platform.select({ ios: { transform: [{ translateY: 12 }] }, default: {} })
  }
})
