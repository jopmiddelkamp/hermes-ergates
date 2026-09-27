import { describe, expect, it } from 'vitest'

import { nextLayoutEditing } from './layout-editing'

describe('nextLayoutEditing', () => {
  it('switches to Edit layout the instant editing turns on', () => {
    expect(nextLayoutEditing(false, true, false)).toBe(true)
  })

  it('keeps Edit layout while a leave is in progress: editing is off but progress has not reached 0', () => {
    expect(nextLayoutEditing(true, false, false)).toBe(true)
  })

  it('drops back to normal layout once a leave has actually reached 0', () => {
    expect(nextLayoutEditing(true, false, true)).toBe(false)
  })

  it('stays in Edit layout when editing turns on again before a leave reaches 0, even if a stale reached-0 event arrives after that', () => {
    expect(nextLayoutEditing(true, true, true)).toBe(true)
  })

  it('stays out of Edit layout once it is already out, whatever a stray reached-0 event says', () => {
    expect(nextLayoutEditing(false, false, true)).toBe(false)
    expect(nextLayoutEditing(false, false, false)).toBe(false)
  })
})
