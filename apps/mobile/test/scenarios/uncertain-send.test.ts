import { describe, expect, it } from 'vitest'

import { FakeGateway } from '../fake-gateway/fake-gateway'
import { runSession } from '../fake-gateway/scenarios'

describe('uncertain send (scenarios d, e)', () => {
  it('marks the item unconfirmed on a timeout, and never retries prompt.submit', async () => {
    const gateway = new FakeGateway({ onSubmit: () => 'timeout' })
    const driver = await runSession(gateway, 'thijs')

    await driver.send('are you there?')

    const item = driver.getState().items.find(i => i.kind === 'user')
    expect(item).toMatchObject({ kind: 'user', delivery: 'unconfirmed' })
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })

  it('marks the item failed on an rpc rejection', async () => {
    const gateway = new FakeGateway({ onSubmit: () => 'reject' })
    const driver = await runSession(gateway, 'thijs')

    await driver.send('do something risky')

    const item = driver.getState().items.find(i => i.kind === 'user')
    expect(item).toMatchObject({ kind: 'user', delivery: 'failed' })
    expect(driver.getState().lastError).toBeTruthy()
    expect(gateway.connectionFor('thijs').submitCalls).toBe(1)
  })
})
