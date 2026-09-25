import React, { createContext, useContext, useMemo } from 'react'
import { useColorScheme } from 'react-native'

import { resolvePalette, type BackendThemes } from './resolve'
import type { Appearance, MobileTheme } from './tokens'

const ThemeContext = createContext<MobileTheme | null>(null)

export interface ThemeProviderProps {
  appearance: Appearance
  themeName: string
  backendThemes?: BackendThemes
  children: React.ReactNode
}

export function ThemeProvider({ appearance, themeName, backendThemes, children }: ThemeProviderProps) {
  const scheme = useColorScheme()
  const theme = useMemo(
    () => resolvePalette({ themeName, appearance, systemDark: scheme === 'dark', backend: backendThemes }),
    [themeName, appearance, scheme, backendThemes]
  )
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): MobileTheme {
  const theme = useContext(ThemeContext)
  if (!theme) {
    throw new Error('ThemeProvider is missing above this component.')
  }
  return theme
}
