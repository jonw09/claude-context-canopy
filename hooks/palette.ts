import type { Family } from '../types'

export type Health = 'ok' | 'warn' | 'bad'

export const FAMILIES: readonly Family[] = ['fable', 'opus', 'sonnet', 'haiku', 'other']

// Mid-tones that read on light and dark terminals, clear of the health colours.
export const FAMILY_COLOUR: Record<Family, string> = {
  fable: '#a78bfa',
  opus: '#e879f9',
  sonnet: '#60a5fa',
  haiku: '#22d3ee',
  other: '#9ca3af',
}

// Theme keys, so health follows the person's theme, colour-blind ones included.
export const HEALTH_COLOUR: Record<Health, string> = { ok: 'success', warn: 'warning', bad: 'error' }

export const familyName = (family: Family): string => family[0]!.toUpperCase() + family.slice(1)

export function familyOf(model = ''): Family {
  const id = model.toLowerCase()

  return FAMILIES.find(family => id.includes(family)) ?? 'other'
}

/** `claude-opus-5-5[1m]` → `Opus 5.5`. */
export function modelLabel(model: string): string {
  const match = /(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)/i.exec(model)
  if (!match) return model.replace(/^claude-/, '')

  return `${familyName(familyOf(match[1]))} ${match[2]}${match[3] ? `.${match[3]}` : ''}`
}

/** `warn` and `danger` are fractions of `limit`. */
export function healthOf(used: number, limit: number, warn: number, danger: number): Health {
  const fill = limit > 0 ? used / limit : 0

  return fill >= danger ? 'bad' : fill >= warn ? 'warn' : 'ok'
}
