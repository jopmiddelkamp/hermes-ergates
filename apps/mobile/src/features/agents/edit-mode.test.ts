import { describe, expect, it, vi } from 'vitest'

import type { Section } from '@/state/organization'

import {
  NO_SELECTION,
  buildEditItems,
  collapseSelection,
  editBarLabels,
  editRowLabel,
  hideEach,
  hideFailureMessage,
  listItems,
  liveSelection,
  moveActions,
  moveDirection,
  moveStep,
  pinnedItems,
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

const prive: Section = { id: 'prive', name: 'Prive', collapsed: false, order: 0 }
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
  it('draws the pins, the rows without a section and every section, top to bottom, as one flat list without captions', () => {
    expect(keys(layout())).toEqual(['pinned:hermes', 'pinned:noor', 'row:otto', 'section:prive', 'row:kevin', 'row:linh', 'section:work'])
  })

  it('leaves the rows of a collapsed section out, and keeps its top row for a drop under its header', () => {
    const closed = { ...layout(), sections: [{ section: { ...prive, collapsed: true }, rows: [bot('kevin'), bot('linh')] }, { section: work, rows: [] }] }
    const items = buildEditItems(closed)
    expect(items.map(i => i.key)).toEqual(['pinned:hermes', 'pinned:noor', 'row:otto', 'section:prive', 'section:work'])
    expect(items.flatMap(i => (i.kind === 'section' ? [i.topRow] : []))).toEqual(['kevin', null])
  })

  it('draws nothing for an empty Home', () => {
    expect(keys({ pinned: [], ungrouped: [], sections: [] })).toEqual([])
  })

  it('splits the list into the pinned avatars and the rows list below them', () => {
    const items = buildEditItems(layout())
    expect(pinnedItems(items).map(i => i.key)).toEqual(['pinned:hermes', 'pinned:noor'])
    expect(listItems(items).map(i => i.key)).toEqual(['row:otto', 'section:prive', 'row:kevin', 'row:linh', 'section:work'])
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

  it('drops the selection of the rows a section hides when it collapses', () => {
    const selection = new Set(['kevin', 'noor'])
    const collapsed = buildEditItems({ ...layout(), sections: [{ section: { ...prive, collapsed: true }, rows: [bot('kevin'), bot('linh')] }, { section: work, rows: [] }] })
    expect([...liveSelection(selection, collapsed)]).toEqual(['noor'])
  })

  it('lists the selected agents in list order, pins first', () => {
    const items = buildEditItems(layout())
    expect(selectedInListOrder(items, new Set(['linh', 'otto', 'noor']))).toEqual(['noor', 'otto', 'linh'])
  })

  it('drops the rows of a collapsing section for good, so expanding it again does not restore them', () => {
    const selection = new Set(['kevin', 'noor'])
    expect([...collapseSelection(selection, layout(), 'prive')]).toEqual(['noor'])
  })

  it('changes nothing when the section is already collapsed, since collapsing it further does not apply', () => {
    const selection = new Set(['kevin', 'noor'])
    const closed = { ...layout(), sections: [{ section: { ...prive, collapsed: true }, rows: [bot('kevin'), bot('linh')] }, { section: work, rows: [] }] }
    expect(collapseSelection(selection, closed, 'prive')).toBe(selection)
  })

  it('changes nothing for a section with none of its rows selected, or a section that does not exist', () => {
    const selection = new Set(['noor'])
    expect(collapseSelection(selection, layout(), 'prive')).toBe(selection)
    expect(collapseSelection(selection, layout(), 'gone')).toBe(selection)
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

  it('never moves an unknown key', () => {
    expect(moveStep(items, 'row:nobody', 'up')).toBeNull()
  })

  it('moves the default profile like any other pin', () => {
    expect(moveStep(items, 'pinned:hermes', 'down')).toEqual({ kind: 'pin', profile: 'hermes', before: null })
    expect(moveStep(items, 'pinned:noor', 'up')).toEqual({ kind: 'pin', profile: 'noor', before: 'hermes' })
  })

  it('offers Move left on the second pin even when the first pin is the default profile', () => {
    expect(moveActions(items, 'pinned:noor')).toEqual([{ name: 'moveLeft', label: 'Move left' }])
  })

  it('moves pins among themselves whichever one is the default profile', () => {
    const pins = buildEditItems({ ...layout(), pinned: [bot('noor'), bot('mia'), bot('ada')] })
    expect(moveStep(pins, 'pinned:mia', 'up')).toEqual({ kind: 'pin', profile: 'mia', before: 'noor' })
    expect(moveStep(pins, 'pinned:noor', 'down')).toEqual({ kind: 'pin', profile: 'noor', before: 'ada' })
  })

  it('offers Move left and Move right on a pin, with the same rules as Move up and Move down', () => {
    const pins = buildEditItems({ ...layout(), pinned: [bot('noor'), bot('mia'), bot('ada')] })
    expect(moveActions(pins, 'pinned:mia')).toEqual([
      { name: 'moveLeft', label: 'Move left' },
      { name: 'moveRight', label: 'Move right' }
    ])
    expect(moveActions(pins, 'pinned:noor')).toEqual([{ name: 'moveRight', label: 'Move right' }])
  })

  it('reads the direction of a screen-reader action by its name', () => {
    expect(['moveUp', 'moveLeft', 'moveDown', 'moveRight', 'editSection'].map(moveDirection)).toEqual(['up', 'up', 'down', 'down', null])
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
