import { describe, expect, it, vi } from 'vitest'

import type { Bot } from '@/features/agents/roster'
import type { Section } from '@/state/organization'

import { botActionItems, createSectionAction, type BotActionHandlers, type BotActionItem, type BotActionItemsInput, type BotActionLevel } from './bot-actions-items'

const bot: Bot = {
  profile: 'kevin',
  name: 'Kevin',
  role: 'Trainer',
  description: '',
  hidden: false,
  hasAvatar: false,
  isDefault: false,
  lastActivityAt: 0,
  preview: '',
  canonicalSessionId: null,
  summary: { name: 'kevin', is_default: false }
}

const sections: Section[] = [
  { id: 'work', name: 'Work', collapsed: false, order: 1 },
  { id: 'prive', name: 'Prive', collapsed: false, order: 0 }
]

function harness(overrides: Partial<BotActionItemsInput> = {}, withSelect = true) {
  const handlers: BotActionHandlers = {
    edit: vi.fn(),
    toggleUnread: vi.fn(),
    togglePin: vi.fn(),
    moveToSection: vi.fn(),
    createSection: vi.fn(),
    toggleHidden: vi.fn(),
    remove: vi.fn(),
    ...(withSelect ? { select: vi.fn() } : {})
  }
  const close = vi.fn()
  const copyId = vi.fn()
  const confirmDelete = vi.fn()
  let level: BotActionLevel = 'main'
  const setLevel = vi.fn((next: BotActionLevel) => {
    level = next
  })
  const build = () =>
    botActionItems({
      bot,
      level,
      unread: false,
      pinned: false,
      sections,
      currentSectionId: null,
      handlers,
      setLevel,
      close,
      copyId,
      confirmDelete,
      ...overrides
    })
  const rows = () => build()
  const items = () => rows().filter((row): row is BotActionItem => row.kind === 'item')
  const press = (key: string) => {
    const found = items().find(i => i.key === key)
    if (!found) {
      throw new Error(`no item "${key}" at level "${level}"`)
    }
    found.onPress()
  }
  return { handlers, close, copyId, confirmDelete, setLevel, rows, items, press, levelNow: () => level }
}

/** Separators never lead, trail, or double up, whatever groups are empty. */
function assertCleanSeparators(rowKinds: string[]) {
  expect(rowKinds[0]).not.toBe('separator')
  expect(rowKinds[rowKinds.length - 1]).not.toBe('separator')
  for (let i = 0; i < rowKinds.length - 1; i++) {
    if (rowKinds[i] === 'separator') {
      expect(rowKinds[i + 1]).not.toBe('separator')
    }
  }
}

describe('the main level (docs/10 "Bot actions"): one menu with separators', () => {
  it('lists every action in the Desktop-style order', () => {
    expect(harness().items().map(i => i.key)).toEqual(['pin', 'move', 'unread', 'edit', 'select', 'copy', 'hide', 'delete'])
  })

  it('drops Select where the screen cannot select agents, without moving a separator', () => {
    const h = harness({}, false)
    expect(h.items().map(i => i.key)).toEqual(['pin', 'move', 'unread', 'edit', 'copy', 'hide', 'delete'])
    assertCleanSeparators(h.rows().map(r => r.kind))
  })

  it('drops Delete for the default concierge, without moving a separator', () => {
    const h = harness({ bot: { ...bot, isDefault: true } })
    expect(h.items().map(i => i.key)).toEqual(['pin', 'move', 'unread', 'edit', 'select', 'copy', 'hide'])
    assertCleanSeparators(h.rows().map(r => r.kind))
  })

  it('places separators between the four groups, and only there', () => {
    const h = harness()
    expect(h.rows().map(r => (r.kind === 'separator' ? '—' : r.key))).toEqual(['pin', 'move', 'unread', '—', 'edit', 'select', '—', 'copy', '—', 'hide', 'delete'])
    assertCleanSeparators(h.rows().map(r => r.kind))
  })

  it('labels Pin/Unpin, Mark as Unread/Read and Hide/Unhide from the current state', () => {
    expect(harness({ pinned: false }).items().find(i => i.key === 'pin')?.label).toBe('Pin')
    expect(harness({ pinned: true }).items().find(i => i.key === 'pin')?.label).toBe('Unpin')
    expect(harness({ unread: false }).items().find(i => i.key === 'unread')?.label).toBe('Mark as Unread')
    expect(harness({ unread: true }).items().find(i => i.key === 'unread')?.label).toBe('Mark as Read')
    expect(harness({ bot: { ...bot, hidden: false } }).items().find(i => i.key === 'hide')?.label).toBe('Hide')
    expect(harness({ bot: { ...bot, hidden: true } }).items().find(i => i.key === 'hide')?.label).toBe('Unhide')
  })

  it('marks Delete destructive and Move to with a trailing chevron', () => {
    expect(harness().items().find(i => i.key === 'delete')?.destructive).toBe(true)
    expect(harness().items().find(i => i.key === 'move')?.chevron).toBe(true)
  })

  it('closes the menu before running every terminal item', () => {
    const h = harness()
    h.press('pin')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.handlers.togglePin).toHaveBeenCalledWith(bot, true)

    h.press('unread')
    expect(h.handlers.toggleUnread).toHaveBeenCalledWith(bot, true)
    h.press('edit')
    expect(h.handlers.edit).toHaveBeenCalledWith(bot)
    h.press('select')
    expect(h.handlers.select).toHaveBeenCalledWith(bot)
    h.press('copy')
    expect(h.copyId).toHaveBeenCalledWith(bot)
    h.press('hide')
    expect(h.handlers.toggleHidden).toHaveBeenCalledWith(bot, true)
    expect(h.close).toHaveBeenCalledTimes(6)
  })

  it('opens the Move level from Move to without dismissing the menu', () => {
    const h = harness()
    h.press('move')
    expect(h.setLevel).toHaveBeenCalledWith('move')
    expect(h.close).not.toHaveBeenCalled()
  })

  it('leaves the menu open for Delete, which presents a dialog; the dialog closes it', () => {
    const h = harness()
    h.press('delete')
    expect(h.confirmDelete).toHaveBeenCalledWith(bot)
    expect(h.close).not.toHaveBeenCalled()
  })
})

describe('the Move level: sections inside the menu', () => {
  it('starts with a header back row, then No section and every section in order, then Create section', () => {
    const h = harness({ level: 'move' })
    expect(h.items().map(i => i.key)).toEqual(['header', 'none', 'prive', 'work', 'create'])
  })

  it('separates the section rows from Create section, without a leading or trailing separator', () => {
    const h = harness({ level: 'move' })
    assertCleanSeparators(h.rows().map(r => r.kind))
    expect(h.rows().filter(r => r.kind === 'separator')).toHaveLength(1)
  })

  it('checks the bot\'s current place, "No section" included, and folders everywhere else', () => {
    const none = harness({ level: 'move', currentSectionId: null }).items()
    expect(none.find(i => i.key === 'none')?.icon).toBe('check')
    expect(none.find(i => i.key === 'none')?.selected).toBe(true)
    expect(none.find(i => i.key === 'prive')?.icon).toBe('folder')
    expect(none.find(i => i.key === 'work')?.icon).toBe('folder')

    const prive = harness({ level: 'move', currentSectionId: 'prive' }).items()
    expect(prive.find(i => i.key === 'prive')?.icon).toBe('check')
    expect(prive.find(i => i.key === 'prive')?.selected).toBe(true)
    expect(prive.find(i => i.key === 'none')?.icon).toBe('folder')
  })

  it('goes back to the main level from the header without closing', () => {
    const h = harness({ level: 'move' })
    h.press('header')
    expect(h.setLevel).toHaveBeenCalledWith('main')
    expect(h.close).not.toHaveBeenCalled()
  })

  it('moves the bot and closes when tapping a different place', () => {
    const h = harness({ level: 'move', currentSectionId: null })
    h.press('work')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.handlers.moveToSection).toHaveBeenCalledWith(bot, 'work')
  })

  it('moves to No section (null id) the same way', () => {
    const h = harness({ level: 'move', currentSectionId: 'work' })
    h.press('none')
    expect(h.handlers.moveToSection).toHaveBeenCalledWith(bot, null)
  })

  it('just closes when tapping the bot\'s current place, without moving it', () => {
    const h = harness({ level: 'move', currentSectionId: 'prive' })
    h.press('prive')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.handlers.moveToSection).not.toHaveBeenCalled()
  })

  it('opens the Create level from Create section without closing', () => {
    const h = harness({ level: 'move' })
    h.press('create')
    expect(h.setLevel).toHaveBeenCalledWith('create')
    expect(h.close).not.toHaveBeenCalled()
  })
})

describe('the Create level: only a header row, the field and button live in BotActions/ActionMenu', () => {
  it('shows only the header back row', () => {
    const h = harness({ level: 'create' })
    expect(h.items().map(i => i.key)).toEqual(['header'])
  })

  it('goes back to the Move level from the header without closing', () => {
    const h = harness({ level: 'create' })
    h.press('header')
    expect(h.setLevel).toHaveBeenCalledWith('move')
    expect(h.close).not.toHaveBeenCalled()
  })
})

describe('createSectionAction: the Create button\'s disabled state and effect', () => {
  it('is disabled for a blank or whitespace-only name', () => {
    const close = vi.fn()
    const handlers = { createSection: vi.fn() }
    expect(createSectionAction({ bot, name: '', close, handlers }).disabled).toBe(true)
    expect(createSectionAction({ bot, name: '   ', close, handlers }).disabled).toBe(true)
    expect(createSectionAction({ bot, name: 'Ideas', close, handlers }).disabled).toBe(false)
  })

  it('does nothing while disabled', () => {
    const close = vi.fn()
    const handlers = { createSection: vi.fn() }
    createSectionAction({ bot, name: '  ', close, handlers }).onCreate()
    expect(close).not.toHaveBeenCalled()
    expect(handlers.createSection).not.toHaveBeenCalled()
  })

  it('closes the menu and creates the section once enabled', () => {
    const close = vi.fn()
    const handlers = { createSection: vi.fn() }
    createSectionAction({ bot, name: 'Ideas', close, handlers }).onCreate()
    expect(close).toHaveBeenCalledTimes(1)
    expect(handlers.createSection).toHaveBeenCalledWith(bot, 'Ideas')
  })
})
