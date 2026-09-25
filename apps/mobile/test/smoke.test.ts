import { describe, expect, it } from 'vitest'
import { JsonRpcGatewayClient, isGatewayWebSocketUrl } from '@vendor/hermes/shared/json-rpc-gateway'
import { nousTheme, DEFAULT_SKIN_NAME } from '@vendor/hermes/themes/presets'

describe('vendored hermes sources load in node', () => {
  it('exposes the client and the default skin name', () => {
    expect(typeof JsonRpcGatewayClient).toBe('function')
    expect(isGatewayWebSocketUrl('ws://127.0.0.1:9119/api/ws')).toBe(true)
    expect(DEFAULT_SKIN_NAME).toBe('nous')
    expect(nousTheme.colors.primary).toBe('#0053fd')
  })
})
