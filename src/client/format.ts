/** Small display helpers (relative time, template icons). */

type TimeKey = 'time.just' | 'time.minutes' | 'time.hours' | 'time.days'

/** Relative time like "3 分钟前"; falls back to a date after 7 days. */
export function formatRelative(
  ts: number,
  t: (key: TimeKey, params?: Record<string, unknown>) => string,
  now = Date.now(),
): string {
  const diff = now - ts
  if (diff < 60_000) return t('time.just')
  if (diff < 3_600_000) return t('time.minutes', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('time.hours', { n: Math.floor(diff / 3_600_000) })
  if (diff < 7 * 86_400_000) return t('time.days', { n: Math.floor(diff / 86_400_000) })
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Template gallery icon glyph by template id. */
export function templateIcon(id: string | undefined): string {
  switch (id) {
    case 'crm': return '👥'
    case 'project': return '📋'
    case 'finance': return '💰'
    case 'attendance': return '⏰'
    case 'todo': return '✅'
    case 'inventory': return '📦'
    default: return '📄'
  }
}
