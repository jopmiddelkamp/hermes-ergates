/**
 * Grouped surface (docs/10 section 4: settings group radius 20, dividers
 * inset to text). Used for settings groups and inline chat cards.
 */

import { Children, Fragment, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '@/theme/provider'

/** Left inset for dividers, aligned with a settings row's label text. */
const DIVIDER_INSET = 16

export interface CardProps {
  children: ReactNode
  /** Draw an inset divider between each child. Default true. */
  divider?: boolean
}

export function Card({ children, divider = true }: CardProps) {
  const theme = useTheme()
  const items = Children.toArray(children)

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.muted, borderRadius: theme.radius.group }]}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && divider ? (
            <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          ) : null}
          {child}
        </Fragment>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden'
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: DIVIDER_INSET
  }
})
