import type { ModelUsage } from 'claude-code'

import type { Family, FamilyTokens } from '../types'

/** Hour start in ms, as a key, to tokens by family seen in that hour. */
export type UsageLog = Record<string, FamilyTokens>

const HOUR = 3_600_000
const DAY = 24 * HOUR
const KEEP = 8 * DAY
const SPAN: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * DAY, spend_limit: 30 * DAY }

/** Cache reads count at a tenth, as they are priced. */
export const weigh = (u: ModelUsage): number =>
  u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens * 0.1

export const hourOf = (ms: number): string => String(Math.floor(ms / HOUR) * HOUR)

export const addTo = (into: FamilyTokens, family: Family, n: number): FamilyTokens => ({
  ...into,
  [family]: (into[family] ?? 0) + n,
})

function sum(rows: FamilyTokens[]): FamilyTokens {
  let out: FamilyTokens = {}
  for (const row of rows) for (const [family, n] of Object.entries(row)) out = addTo(out, family as Family, n)

  return out
}

/** Adds `pending` into `log` and drops hours older than eight days. */
export function merge(log: UsageLog, pending: UsageLog, now: number): UsageLog {
  const out: UsageLog = {}
  for (const [hour, row] of [...Object.entries(log), ...Object.entries(pending)]) {
    if (Number(hour) >= now - KEEP) out[hour] = sum([out[hour] ?? {}, row])
  }

  return out
}

/** Tokens by family logged in the window that resets at `resetsAt`; an hour counts if any of it falls inside. */
export function splitFor(log: UsageLog, kind: string, resetsAt: string | undefined, now: number): FamilyTokens {
  const end = resetsAt ? Date.parse(resetsAt) : now
  const start = (Number.isFinite(end) ? end : now) - (SPAN[kind] ?? 7 * DAY)

  return sum(Object.entries(log).filter(([hour]) => Number(hour) + HOUR > start).map(([, row]) => row))
}
