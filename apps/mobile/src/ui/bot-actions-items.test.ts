import { describe, expect, it, vi } from 'vitest'

import type { Bot } from '@/features/agents/roster'

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

function harness(overrides: Partial<Parameters<typeof botActionItems>[0]> = {}, withSelect = true) {
  const handlers: BotActionHandlers = {
    edit: vi.fn(),
    toggleUnread: vi.fn(),
    togglePin: vi.fn(),
    moveToSection: vi.fn(),
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
      inSection: false,
      handlers,
      setLevel,
      close,
      copyId,
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
  return { handlers, close, copyId, confirmDelete, setLevel, build, press, levelNow: () => level }
}

describe('bot action menu levels', () => {
  it('shows Select only where the screen can select agents', () => {
    expect(harness().build().map(i => i.key)).toEqual(['edit', 'unread', 'pin', 'section', 'hide', 'select', 'more'])
    expect(harness({}, false).build().map(i => i.key)).toEqual(['edit', 'unread', 'pin', 'section', 'hide', 'more'])
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

  it('opens the Move to Section page from the section row instead of a submenu', () => {
    const h = harness()
    expect(h.build().find(i => i.key === 'section')?.label).toBe('New Section')
    h.press('section')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.handlers.moveToSection).toHaveBeenCalledWith(bot)
    expect(h.setLevel).not.toHaveBeenCalled()
    expect(h.levelNow()).toBe('main')

    expect(harness({ inSection: true }).build().find(i => i.key === 'section')?.label).toBe('Move to Section')
  })

  it('Select closes the menu and opens Edit mode with this agent selected', () => {
    const h = harness()
    const select = h.build().find(i => i.key === 'select')
    expect(select?.label).toBe('Select')
    h.press('select')
    expect(h.close).toHaveBeenCalledTimes(1)
    expect(h.handlers.select).toHaveBeenCalledWith(bot)
  })

  it('leaves the menu open for Delete, which presents a dialog; the dialog closes it', () => {
    // Closing first would dismiss the alert together with the menu's Modal on iOS.
    const h = harness({ level: 'more' })
    h.press('delete')
    expect(h.confirmDelete).toHaveBeenCalledWith(bot)
    expect(h.close).not.toHaveBeenCalled()
  })

  it('hides Delete for the default concierge', () => {
    const h = harness({ level: 'more', bot: { ...bot, isDefault: true } })
    expect(h.build().map(i => i.key)).toEqual(['copy', 'back'])
  })
})
