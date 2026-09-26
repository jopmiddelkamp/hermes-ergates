/**
 * Grouped surface (docs/10 section 4: settings group radius 20, dividers
 * inset to text). Used for settings groups and inline chat cards.
 */

import { Children, Fragment, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

import { softFill } from '@/theme/fill'
import { useTheme } from '@/theme/provider'

import { useSurface } from './surface-context'

/** Left inset for dividers, aligned with a settings row's label text. */
const DIVIDER_INSET = 16

export interface CardProps {
  children: ReactNode
  /** Draw an inset divider between each child. Default true. */
  divider?: boolean
  /** Left inset of each divider. Default 16, the text edge of a row without an icon. */
  dividerInset?: number
}

export function Card({ children, divider = true, dividerInset = DIVIDER_INSET }: CardProps) {
  const theme = useTheme()
  const surface = useSurface()
  const items = Children.toArray(children)

  return (
    <View style={[styles.card, { backgroundColor: softFill(theme.colors, surface), borderRadius: theme.radius.group }]}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && divider ? (
            <View style={[styles.divider, { marginLeft: dividerInset, backgroundColor: theme.colors.border }]} />
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
    height: StyleSheet.hairlineWidth
  }
})
