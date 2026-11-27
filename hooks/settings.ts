import type { Overrides } from '../types'

export type Settings = {
  /** Fractions of the way to auto-compact: amber from `warn`, red from `danger`. */
  warn: number
  danger: number
  showPlan: boolean
  showSession: boolean
  showAgents: boolean
  /** Background shells under the agent that started them. */
  showShells: boolean
  estimate: boolean
}

const SWITCHES = ['plan', 'session', 'agents', 'shells', 'split'] as const
type Switch = (typeof SWITCHES)[number]

const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), high)

export function settingsFrom(o: Overrides): Settings {
  const warn = clamp(o.amber ?? 60, 1, 99)

  return {
    warn: warn / 100,
    danger: clamp(o.red ?? 90, warn + 1, 100) / 100,
    showPlan: o.plan ?? true,
    showSession: o.session ?? true,
    showAgents: o.agents ?? true,
    showShells: o.shells ?? true,
    estimate: o.split ?? true,
  }
}

/** Reads `amber 70` or `split off`; anything else is undefined. */
export function overrideFrom(key = '', value = ''): Overrides | undefined {
  if ((key === 'amber' || key === 'red') && /^\d+$/.test(value)) return { [key]: Number(value) }
  if (SWITCHES.includes(key as Switch) && /^(on|off)$/.test(value)) return { [key]: value === 'on' }

  return undefined
}

/**
 * The saved settings, keeping only those this version has. An earlier version
 * saved `spend`, which no longer means anything, so it is dropped.
 */
export function overridesFrom(saved: unknown): Overrides {
  const all = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const out: Record<string, number | boolean> = {}
  for (const key of ['amber', 'red'] as const) if (typeof all[key] === 'number') out[key] = all[key]
  for (const key of SWITCHES) if (typeof all[key] === 'boolean') out[key] = all[key]

  return out as Overrides
}
