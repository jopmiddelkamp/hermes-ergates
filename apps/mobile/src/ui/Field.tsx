/**
 * Labelled text input for forms (docs/10 "Edit Bot on mobile" and settings
 * forms): `input` background, `border` outline, radius 12, min height 48.
 */

import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native'

import { useTheme } from '@/theme/provider'

/** Design floor for the input; never allowed below the shared min hit area. */
const MIN_HEIGHT = 48
const RADIUS = 12

export interface FieldProps {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  error?: string
  secureTextEntry?: boolean
  multiline?: boolean
  keyboardType?: KeyboardTypeOptions
  accessibilityLabel?: string
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry,
  multiline,
  keyboardType,
  accessibilityLabel
}: FieldProps) {
  const theme = useTheme()
  const borderColor = error ? theme.colors.destructive : theme.colors.border

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.colors.foreground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.mutedForeground}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        keyboardType={keyboardType}
        accessibilityLabel={accessibilityLabel ?? label}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          {
            minHeight: Math.max(theme.hit, MIN_HEIGHT),
            backgroundColor: theme.colors.input,
            borderColor,
            color: theme.colors.foreground
          }
        ]}
      />
      {error ? <Text style={[styles.error, { color: theme.colors.destructive }]}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
    marginBottom: 12
  },
  label: {
    fontSize: 13,
    fontWeight: '500'
  },
  input: {
    borderRadius: RADIUS,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17
  },
  multiline: {
    textAlignVertical: 'top'
  },
  error: {
    fontSize: 13
  }
})
