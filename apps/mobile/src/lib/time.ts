/** Compact conversation timestamps for rows (docs/10: time at useful breaks). */
export function formatRowTime(epochMs: number, now: Date = new Date(), locale = 'en-US'): string {
  if (!epochMs) {
    return ''
  }
  const d = new Date(epochMs)
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 7) {
    return d.toLocaleDateString(locale, { weekday: 'short' })
  }
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export function formatDateSeparator(epochSeconds: number, now: Date = new Date(), locale = 'en-US'): string {
  const d = new Date(epochSeconds * 1000)
  if (d.toDateString() === now.toDateString()) {
    return 'Today'
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  }
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
}

export function formatClock(epochSeconds: number, locale = 'en-US'): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}
