/**
 * Labelled text input for forms (docs/10 section 4): the label above in
 * `mutedForeground`, a soft `muted` input without a border, radius 14,
 * minimum height 50 (128 when multiline). An error shows as red text below;
 * the input itself does not change color.
 */

import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native'

import { useTheme } from '@/theme/provider'

const MIN_HEIGHT = 50
const MULTILINE_MIN_HEIGHT = 128
const RADIUS = 14

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

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.colors.mutedForeground }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.mutedForeground}
        selectionColor={theme.colors.primary}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        keyboardType={keyboardType}
        accessibilityLabel={accessibilityLabel ?? label}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          { backgroundColor: theme.colors.muted, color: theme.colors.foreground }
        ]}
      />
      {error ? <Text style={[styles.error, { color: theme.colors.destructive }]}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 7,
    marginBottom: 12
  },
  label: {
    fontSize: 13
  },
  input: {
    minHeight: MIN_HEIGHT,
    borderRadius: RADIUS,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 17,
    lineHeight: 24
  },
  multiline: {
    minHeight: MULTILINE_MIN_HEIGHT,
    textAlignVertical: 'top'
  },
  error: {
    fontSize: 13
  }
})
