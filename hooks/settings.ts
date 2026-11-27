import type { Overrides, ShellsMode } from '../types'

export type Settings = {
  /** Fractions of the way to auto-compact: amber from `warn`, red from `danger`. */
  warn: number
  danger: number
  showPlan: boolean
  showSession: boolean
  showAgents: boolean
  /** Background shells: a count on the agent's row, a row each under it, or none. */
  shells: ShellsMode
  estimate: boolean
}

const SWITCHES = ['plan', 'session', 'agents', 'split'] as const
type Switch = (typeof SWITCHES)[number]
const SHELLS_MODES: readonly ShellsMode[] = ['count', 'rows', 'off']

const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), high)

export function settingsFrom(o: Overrides): Settings {
  const warn = clamp(o.amber ?? 60, 1, 99)

  return {
    warn: warn / 100,
    danger: clamp(o.red ?? 90, warn + 1, 100) / 100,
    showPlan: o.plan ?? true,
    showSession: o.session ?? true,
    showAgents: o.agents ?? true,
    shells: o.shells ?? 'count',
    estimate: o.split ?? true,
  }
}

/** Reads `amber 70`, `split off` or `shells rows` (`on` is `count`); anything else is undefined. */
export function overrideFrom(key = '', value = ''): Overrides | undefined {
  if ((key === 'amber' || key === 'red') && /^\d+$/.test(value)) return { [key]: Number(value) }
  if (SWITCHES.includes(key as Switch) && /^(on|off)$/.test(value)) return { [key]: value === 'on' }
  if (key === 'shells') {
    const mode = value === 'on' ? 'count' : value
    if (SHELLS_MODES.includes(mode as ShellsMode)) return { shells: mode as ShellsMode }
  }

  return undefined
}

/**
 * The saved settings, keeping only those this version has. An earlier version
 * saved `spend`, which no longer means anything, so it is dropped.
 */
export function overridesFrom(saved: unknown): Overrides {
  const all = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {}
  const out: Record<string, number | boolean | string> = {}
  for (const key of ['amber', 'red'] as const) if (typeof all[key] === 'number') out[key] = all[key]
  for (const key of SWITCHES) if (typeof all[key] === 'boolean') out[key] = all[key]
  if (SHELLS_MODES.includes(all.shells as ShellsMode)) out.shells = all.shells as ShellsMode

  return out as Overrides
}
