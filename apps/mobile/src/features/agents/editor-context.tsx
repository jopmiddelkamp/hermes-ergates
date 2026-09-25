/**
 * Shares one `EditBotController` across every `agent/[profile]/*` route
 * (docs/10 "Edit Bot on mobile": "long instructions and capability lists
 * open focused subpages that return to the same unsaved draft"). `useEditBot`
 * keeps its state inside the hook instance, so each screen calling it
 * directly would get its own draft; this provider calls it once, at
 * `app/agent/[profile]/_layout.tsx`, and every screen underneath reads the
 * same controller through context.
 */

import React, { createContext, useContext, type ReactNode } from 'react'

import type { GatewayPort } from '@/gateway/port'

import { useEditBot, type EditBotController } from './use-editor'

const EditBotContext = createContext<EditBotController | null>(null)

export interface EditBotProviderProps {
  port: GatewayPort
  connectionId: string
  profile: string
  children: ReactNode
}

export function EditBotProvider({ port, connectionId, profile, children }: EditBotProviderProps) {
  const controller = useEditBot(port, connectionId, profile)
  return <EditBotContext.Provider value={controller}>{children}</EditBotContext.Provider>
}

export function useEditBotContext(): EditBotController {
  const controller = useContext(EditBotContext)
  if (!controller) {
    throw new Error('EditBotProvider is missing above this component.')
  }
  return controller
}
