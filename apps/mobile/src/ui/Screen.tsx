/**
 * Safe-area page wrapper (docs/10 section 4: page padding 20, 16 on narrow
 * devices). Applies the theme background to the whole safe area, and
 * horizontal page padding to its content.
 */

import type { ReactNode } from 'react'
import { StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'

import { useTheme } from '@/theme/provider'

const NARROW_WIDTH = 360
const NARROW_PADDING = 16

export interface ScreenProps {
  children: ReactNode
  /** Safe-area edges to inset. Default: all edges. */
  edges?: readonly Edge[]
  style?: ViewStyle
}

export function Screen({ children, edges, style }: ScreenProps) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const horizontalPadding = width < NARROW_WIDTH ? NARROW_PADDING : theme.pagePadding

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.safeArea, { backgroundColor: theme.colors.background }]}
    >
      <View style={[styles.content, { paddingHorizontal: horizontalPadding }, style]}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1
  },
  content: {
    flex: 1
  }
})
