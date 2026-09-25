import { describe, expect, it, vi } from 'vitest'

import type { Bot } from '@/features/agents/roster'
import type { Section } from '@/state/organization'

import { botActionItems, type BotActionHandlers, type BotActionLevel } from './bot-actions-items'

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
  { id: 's1', name: 'Prive', collapsed: false, order: 0 },
  { id: 's2', name: 'Work', collapsed: false, order: 1 }
]

function harness(overrides: Partial<Parameters<typeof botActionItems>[0]> = {}) {
  const handlers: BotActionHandlers = {
    edit: vi.fn(),
    toggleUnread: vi.fn(),
    togglePin: vi.fn(),
    moveToSection: vi.fn(),
    createSection: vi.fn(),
    toggleHidden: vi.fn(),
    remove: vi.fn()
  }
  const close = vi.fn()
  const copyId = vi.fn()
  const askNewSection = vi.fn()
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
      askNewSection,
      confirmDelete,
      ...overrides
    })
  const press = (key: string) => {
    const item = build().find(i => i.key === key)
    if (!item) {
      throw new Error(`no item "${key}" at level "${level}"`)
    }
    item.onPress()
  }
  return { handlers, close, copyId, askNewSection, confirmDelete, setLevel, build, press, levelNow: () => level }
}

describe('bot action menu levels', () => {
  it('opens the section submenu and comes back without dismissing the menu', () => {
    const h = harness()
    expect(h.build().map(i => i.key)).toEqual(['edit', 'unread', 'pin', 'section', 'hide', 'more'])

    h.press('section')
    expect(h.setLevel).toHaveBeenCalledWith('sections')
    expect(h.levelNow()).toBe('sections')
    expect(h.close).not.toHaveBeenCalled()
    expect(h.build().map(i => i.key)).toEqual(['s1', 's2', 'new', 'back'])

    h.press('back')
    expect(h.levelNow()).toBe('main')
    expect(h.close).not.toHaveBeenCalled()
  })

  it('opens the More submenu and comes back without dismissing the menu', () => {
    const h = harness()
    h.press('more')
    expect(h.levelNow()).toBe('more')
    expect(h.close).not.toHaveBeenCalled()
    expect(h.build().map(i => i.key)).toEqual(['copy', 'delete', 'back'])

    h.press('back')
    expect(h.levelNow()).toBe('main')
    expect(h.close).not.toHaveBeenCalled()
  })

  it('closes the menu before running every terminal item', () => {
    const h = harness()
    h.press('edit')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.handlers.edit).toHaveBeenCalledWith(bot)

    h.press('unread')
    expect(h.handlers.toggleUnread).toHaveBeenCalledWith(bot, true)
    h.press('pin')
    expect(h.handlers.togglePin).toHaveBeenCalledWith(bot, true)
    h.press('hide')
    expect(h.handlers.toggleHidden).toHaveBeenCalledWith(bot, true)
    expect(h.close).toHaveBeenCalledTimes(4)

    h.press('more')
    h.press('copy')
    expect(h.copyId).toHaveBeenCalledWith(bot)
    expect(h.close).toHaveBeenCalledTimes(5)
  })

  it('leaves the menu open for items that present a dialog; the dialog closes it', () => {
    // Closing first would dismiss the alert together with the menu's Modal on iOS.
    const h = harness({ level: 'more' })
    h.press('delete')
    expect(h.confirmDelete).toHaveBeenCalledWith(bot)
    expect(h.close).not.toHaveBeenCalled()

    const g = harness({ level: 'sections' })
    g.press('new')
    expect(g.askNewSection).toHaveBeenCalledWith(bot)
    expect(g.close).not.toHaveBeenCalled()
  })

  it('marks the current section as selected instead of decorating the label', () => {
    const h = harness({ level: 'sections', currentSectionId: 's2' })
    const items = h.build()
    expect(items.map(i => i.label)).toEqual(['Prive', 'Work', 'Remove from section', 'New Section…', 'Back'])
    expect(items.find(i => i.key === 's2')?.selected).toBe(true)
    expect(items.find(i => i.key === 's1')?.selected).toBe(false)

    h.press('none')
    expect(h.handlers.moveToSection).toHaveBeenCalledWith(bot, null)
    expect(h.close).toHaveBeenCalledTimes(1)
  })

  it('hides Delete for the default concierge', () => {
    const h = harness({ level: 'more', bot: { ...bot, isDefault: true } })
    expect(h.build().map(i => i.key)).toEqual(['copy', 'back'])
  })
})
