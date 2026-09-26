/**
 * A pushed page (docs/10 section 4): a back chevron on the left, the title
 * centered, an optional action on the right, and a scrolling body that moves
 * clear of the keyboard. Settings, its sub-pages and Move to Section use it.
 */

import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'

import { useTheme } from '@/theme/provider'

import { IconButton } from './IconButton'
import { Screen } from './Screen'
import { useBottomInset } from './use-bottom-inset'

export interface PageProps {
  title: string
  onBack: () => void
  right?: ReactNode
  children: ReactNode
}

const BODY_BOTTOM_PADDING = 24

export function Page({ title, onBack, right, children }: PageProps) {
  const theme = useTheme()
  const bottomInset = useBottomInset(BODY_BOTTOM_PADDING)
  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <View style={styles.side}>
          <IconButton name="chevron-left" accessibilityLabel="Back" onPress={onBack} />
        </View>
        <Text numberOfLines={1} accessibilityRole="header" style={[styles.title, { color: theme.colors.foreground }]}>
          {title}
        </Text>
        <View style={[styles.side, styles.right]}>{right ?? null}</View>
      </View>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.body, { paddingBottom: bottomInset }]}>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center'
  },
  side: {
    minWidth: 44,
    alignItems: 'flex-start'
  },
  right: {
    alignItems: 'flex-end'
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600'
  },
  fill: {
    flex: 1
  },
  body: {
    paddingTop: 12,
    gap: 24
  }
})
