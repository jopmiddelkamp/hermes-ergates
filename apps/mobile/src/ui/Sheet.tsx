/**
 * Full-screen container for router modals (docs/10 section 4: sheet radius
 * 28 at top). The route itself is presented with `presentation: 'modal'`;
 * this component supplies the rounded `popover` surface, the header
 * ([close or custom left] [title] [optional right action]) and keyboard
 * avoidance inside it.
 */

import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

import { useTheme } from '@/theme/provider'

import { IconButton } from './IconButton'

const HEADER_MIN_HEIGHT = 48

export interface SheetProps {
  title: string
  onClose: () => void
  /** Replaces the close button (Edit Bot uses Cancel). */
  headerLeft?: ReactNode
  /** Trailing action (Edit Bot uses Save). */
  headerRight?: ReactNode
  children: ReactNode
}

export function Sheet({ title, onClose, headerLeft, headerRight, children }: SheetProps) {
  const theme = useTheme()

  return (
    // Its own provider: the inset is measured from this view, so a real iOS
    // sheet (which already sits below the status bar) gets none, while a sheet
    // that fills the screen gets the status-bar inset. The root provider would
    // report the window's inset in both cases and leave an empty band on top.
    <SafeAreaProvider style={styles.container}>
      <SafeAreaView
        edges={['top']}
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.popover,
            borderTopLeftRadius: theme.radius.sheet,
            borderTopRightRadius: theme.radius.sheet
          }
        ]}
      >
        <View style={[styles.header, { paddingHorizontal: theme.pagePadding }]}>
          <View style={styles.headerSide}>{headerLeft ?? <IconButton name="x" accessibilityLabel="Close" onPress={onClose} />}</View>
          <Text numberOfLines={1} style={[styles.title, { color: theme.colors.foreground }]}>
            {title}
          </Text>
          <View style={[styles.headerSide, styles.headerRight]}>{headerRight ?? null}</View>
        </View>
        {/* Sheets carry forms (New Agent, Edit Bot, Routine); iOS ScrollViews do
            not move for the keyboard on their own, so the lower fields and the
            primary button would sit under it. */}
        <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: theme.pagePadding, paddingTop: theme.spacing[2], paddingBottom: theme.spacing[4] }}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden'
  },
  header: {
    minHeight: HEADER_MIN_HEIGHT,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  headerSide: {
    minWidth: 48,
    alignItems: 'flex-start'
  },
  headerRight: {
    alignItems: 'flex-end'
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600'
  },
  scroll: {
    flex: 1
  }
})
