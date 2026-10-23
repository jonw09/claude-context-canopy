import type { Overrides } from '../types'

export type Settings = {
  /** Fractions of the way to auto-compact: amber from `warn`, red from `danger`. */
  warn: number
  danger: number
  showPlan: boolean
  showSession: boolean
  showAgents: boolean
  estimate: boolean
  /** Whether to ask Anthropic for the account's spend this month. */
  fetchSpend: boolean
}

const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), high)

export function settingsFrom(o: Overrides): Settings {
  const warn = clamp(o.amber ?? 60, 1, 99)

  return {
    warn: warn / 100,
    danger: clamp(o.red ?? 90, warn + 1, 100) / 100,
    showPlan: o.plan ?? true,
    showSession: o.session ?? true,
    showAgents: o.agents ?? true,
    estimate: o.split ?? true,
    fetchSpend: o.spend ?? true,
  }
}

/** Reads `amber 70` or `split off`; anything else is undefined. */
export function overrideFrom(key = '', value = ''): Overrides | undefined {
  if ((key === 'amber' || key === 'red') && /^\d+$/.test(value)) return { [key]: Number(value) }
  if (['plan', 'session', 'agents', 'split', 'spend'].includes(key) && /^(on|off)$/.test(value)) return { [key]: value === 'on' }

  return undefined
}
