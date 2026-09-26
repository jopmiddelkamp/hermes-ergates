/**
 * The color a control is actually drawn on, for `softFill` (`src/theme/fill.ts`).
 * Most of the app sits on an ordinary page, so the default is
 * `theme.colors.background`; a component that paints its own surface —
 * today, `Sheet`'s rounded `popover` sheet — provides that surface's color so
 * a `Field`, `Card` or secondary `Button` inside it reads against the sheet,
 * not the page underneath it.
 */

import { createContext, useContext, type ReactNode } from 'react'

import { useTheme } from '@/theme/provider'

const SurfaceContext = createContext<string | null>(null)

export interface SurfaceProviderProps {
  color: string
  children: ReactNode
}

export function SurfaceProvider({ color, children }: SurfaceProviderProps) {
  return <SurfaceContext.Provider value={color}>{children}</SurfaceContext.Provider>
}

export function useSurface(): string {
  const theme = useTheme()
  const surface = useContext(SurfaceContext)
  return surface ?? theme.colors.background
}
