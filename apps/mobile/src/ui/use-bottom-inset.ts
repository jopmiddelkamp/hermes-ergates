/**
 * The bottom safe-area padding rule (docs/10 section 4) as a hook: `base` is
 * the padding a screen already wants at the bottom (0 for a fixed bar that
 * had none), and the device's bottom inset is added on top while the
 * keyboard is closed. The keyboard-open tracking mirrors `ActionMenu.tsx`'s
 * `useKeyboardHeight`. See `safe-area.ts` for why the inset is dropped while
 * the keyboard is open.
 */

import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { bottomPadding } from './safe-area'

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, () => setOpen(true))
    const hideSub = Keyboard.addListener(hideEvent, () => setOpen(false))
    return () => {
      showSub.remove()
      hideSub.remove()
    }
  }, [])
  return open
}

/**
 * `base` plus the nearest `SafeAreaProvider`'s bottom inset (0 while the
 * keyboard is open). Sheet nests its own provider so a real modal sheet
 * (which already sits above the home indicator) reads 0 there; call this
 * from inside that nested tree, not from `Sheet` itself.
 */
export function useBottomInset(base = 0): number {
  const insets = useSafeAreaInsets()
  const keyboardOpen = useKeyboardOpen()
  return bottomPadding(base, insets.bottom, keyboardOpen)
}
