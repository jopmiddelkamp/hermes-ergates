/** The ≡ glyph inside a drag handle. Hidden from screen readers, which use Move up and Move down. */

import { View } from 'react-native'

import { useTheme } from '@/theme/provider'

import { Icon } from '../icons'

export function Grip() {
  const theme = useTheme()
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Icon name="menu" size={22} color={theme.colors.mutedForeground} />
    </View>
  )
}
