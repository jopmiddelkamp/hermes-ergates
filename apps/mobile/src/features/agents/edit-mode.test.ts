import { describe, expect, it, vi } from 'vitest'

import type { Section } from '@/state/organization'

import {
  NO_SELECTION,
  buildEditItems,
  editBarLabels,
  editRowLabel,
  hideEach,
  hideFailureMessage,
  liveSelection,
  moveActions,
  moveStep,
  selectedInListOrder,
  selectionTitle,
  toggleSelected,
  type EditLayout
} from './edit-mode'
import type { Bot } from './roster'

function bot(profile: string, extra: Partial<Bot> = {}): Bot {
  return {
    profile,
    name: profile[0]!.toUpperCase() + profile.slice(1),
    role: '',
    description: '',
    hidden: false,
    hasAvatar: false,
    isDefault: false,
    lastActivityAt: 0,
    preview: '',
    canonicalSessionId: null,
    summary: { name: profile, is_default: false },
    ...extra
  }
}

const prive: Section = { id: 'prive', name: 'Prive', collapsed: true, order: 0 }
const work: Section = { id: 'work', name: 'Work', collapsed: false, order: 1 }

/** Hermes (the concierge) and Noor pinned; Otto without a section; Kevin and Linh in Prive; Work empty. */
function layout(): EditLayout {
  return {
    pinned: [bot('hermes', { isDefault: true }), bot('noor')],
    ungrouped: [bot('otto')],
    sections: [
      { section: prive, rows: [bot('kevin'), bot('linh')] },
      { section: work, rows: [] }
    ]
  }
}

const keys = (l: EditLayout) => buildEditItems(l).map(i => i.key)

describe('buildEditItems', () => {
  it('draws Pinned, No section and every section, top to bottom, as one flat list', () => {
    expect(keys(layout())).toEqual([
      'caption:pinned',
      'pinned:hermes',
      'pinned:noor',
      'caption:none',
      'row:otto',
      'section:prive',
      'row:kevin',
      'row:linh',
      'section:work'
    ])
  })

  it('shows a collapsed section expanded, and keeps its stored collapse state', () => {
    const items = buildEditItems(layout())
    expect(items.filter(i => i.kind === 'row' && i.sectionId === 'prive').map(i => i.key)).toEqual(['row:kevin', 'row:linh'])
    expect(items.find(i => i.kind === 'section' && i.section.id === 'prive')).toMatchObject({ section: { collapsed: true } })
  })

  it('leaves out the Pinned caption without pins, and always draws the No section caption', () => {
    expect(keys({ pinned: [], ungrouped: [], sections: [] })).toEqual(['caption:none'])
  })

  it('locks only the pinned concierge', () => {
    const pinned = buildEditItems(layout()).filter(i => i.kind === 'pinned')
    expect(pinned.map(i => [i.key, i.kind === 'pinned' && i.locked])).toEqual([
      ['pinned:hermes', true],
      ['pinned:noor', false]
    ])
  })
})

describe('the selection', () => {
  it('toggles one agent at a time and names the count', () => {
    const one = toggleSelected(NO_SELECTION, 'kevin')
    const two = toggleSelected(one, 'noor')
    expect([...two]).toEqual(['kevin', 'noor'])
    expect([...toggleSelected(two, 'kevin')]).toEqual(['noor'])
    expect(NO_SELECTION.size).toBe(0)
    expect(selectionTitle(two.size)).toBe('2 selected')
    expect(selectionTitle(0)).toBe('0 selected')
  })

  it('keeps agents that are still shown after a roster refresh and drops the rest', () => {
    const selection = new Set(['kevin', 'otto'])
    const refreshed = buildEditItems({ ...layout(), ungrouped: [] })
    expect([...liveSelection(selection, refreshed)]).toEqual(['kevin'])
    expect(liveSelection(selection, buildEditItems(layout()))).toBe(selection)
  })

  it('lists the selected agents in list order, pins first', () => {
    const items = buildEditItems(layout())
    expect(selectedInListOrder(items, new Set(['linh', 'otto', 'noor']))).toEqual(['noor', 'otto', 'linh'])
  })
})

describe('editBarLabels', () => {
  const state = { isPinned: (p: string) => ['hermes', 'noor'].includes(p), isUnread: (p: string) => p === 'linh' }

  it('says Unpin only when every selected agent is pinned', () => {
    expect(editBarLabels(['hermes', 'noor'], state).pin).toBe('Unpin')
    expect(editBarLabels(['noor', 'otto'], state).pin).toBe('Pin')
  })

  it('says Mark read when at least one selected agent is unread, else Mark unread', () => {
    expect(editBarLabels(['otto', 'linh'], state).read).toBe('Mark read')
    expect(editBarLabels(['otto', 'kevin'], state).read).toBe('Mark unread')
  })
})

describe('Move up and Move down', () => {
  const items = buildEditItems(layout())

  it('moves a row one step inside its group', () => {
    expect(moveStep(items, 'row:linh', 'up')).toEqual({ kind: 'row', profile: 'linh', sectionId: 'prive', before: 'kevin' })
    expect(moveStep(items, 'row:kevin', 'down')).toEqual({ kind: 'row', profile: 'kevin', sectionId: 'prive', before: null })
  })

  it('never moves a row out of its group', () => {
    expect(moveStep(items, 'row:kevin', 'up')).toBeNull()
    expect(moveStep(items, 'row:linh', 'down')).toBeNull()
    expect(moveStep(items, 'row:otto', 'up')).toBeNull()
    expect(moveStep(items, 'row:otto', 'down')).toBeNull()
  })

  it('lands in front of the row after the next one when moving down past it', () => {
    const three = buildEditItems({ ...layout(), ungrouped: [bot('otto'), bot('ada'), bot('bo')] })
    expect(moveStep(three, 'row:otto', 'down')).toEqual({ kind: 'row', profile: 'otto', sectionId: null, before: 'bo' })
  })

  it('moves sections among sections', () => {
    expect(moveStep(items, 'section:work', 'up')).toEqual({ kind: 'section', sectionId: 'work', before: 'prive' })
    expect(moveStep(items, 'section:prive', 'down')).toEqual({ kind: 'section', sectionId: 'prive', before: null })
    expect(moveStep(items, 'section:prive', 'up')).toBeNull()
  })

  it('never moves a caption or an unknown key', () => {
    expect(moveStep(items, 'caption:none', 'down')).toBeNull()
    expect(moveStep(items, 'row:nobody', 'up')).toBeNull()
  })

  it('keeps the pinned concierge first: it never moves and no pin passes above it', () => {
    expect(moveStep(items, 'pinned:hermes', 'down')).toBeNull()
    expect(moveStep(items, 'pinned:noor', 'up')).toBeNull()
    expect(moveActions(items, 'pinned:hermes')).toEqual([])
    expect(moveActions(items, 'pinned:noor')).toEqual([])
  })

  it('moves pins among themselves when the concierge is not pinned', () => {
    const pins = buildEditItems({ ...layout(), pinned: [bot('noor'), bot('mia'), bot('ada')] })
    expect(moveStep(pins, 'pinned:mia', 'up')).toEqual({ kind: 'pin', profile: 'mia', before: 'noor' })
    expect(moveStep(pins, 'pinned:noor', 'down')).toEqual({ kind: 'pin', profile: 'noor', before: 'ada' })
  })

  it('offers only the moves that can happen as screen-reader actions', () => {
    expect(moveActions(items, 'row:kevin')).toEqual([{ name: 'moveDown', label: 'Move down' }])
    expect(moveActions(items, 'row:linh')).toEqual([{ name: 'moveUp', label: 'Move up' }])
    expect(moveActions(items, 'section:work')).toEqual([{ name: 'moveUp', label: 'Move up' }])
    const three = buildEditItems({ ...layout(), ungrouped: [bot('otto'), bot('ada'), bot('bo')] })
    expect(moveActions(three, 'row:ada').map(a => a.label)).toEqual(['Move up', 'Move down'])
  })
})

describe('editRowLabel', () => {
  it('ends with the selection state', () => {
    expect(editRowLabel(bot('kevin', { role: 'Trainer' }), true, false)).toBe('Kevin, Trainer, selected')
    expect(editRowLabel(bot('kevin'), false, true)).toBe('Kevin, unread, not selected')
  })
})

describe('hiding several agents', () => {
  it('hides each agent with its own call and returns the ones that failed', async () => {
    const hide = vi.fn(async (b: Bot) => {
      if (b.profile !== 'kevin') {
        throw new Error('conflict')
      }
    })
    const failed = await hideEach([bot('kevin'), bot('linh'), bot('otto')], hide)
    expect(hide).toHaveBeenCalledTimes(3)
    expect(failed.map(b => b.profile)).toEqual(['linh', 'otto'])
  })

  it('keeps hiding the rest when one call throws synchronously instead of rejecting', async () => {
    const hide = vi.fn((b: Bot) => {
      if (b.profile === 'linh') {
        throw new Error('conflict')
      }
      return Promise.resolve()
    })
    const failed = await hideEach([bot('kevin'), bot('linh'), bot('otto')], hide)
    expect(hide).toHaveBeenCalledTimes(3)
    expect(failed.map(b => b.profile)).toEqual(['linh'])
  })

  it('names every agent that was not hidden in one message', () => {
    expect(hideFailureMessage([bot('linh')])).toBe('Linh was not hidden. Try again.')
    expect(hideFailureMessage([bot('linh'), bot('otto')])).toBe('Linh and Otto were not hidden. Try again.')
    expect(hideFailureMessage([bot('ada'), bot('linh'), bot('otto')])).toBe('Ada, Linh and Otto were not hidden. Try again.')
  })
})
