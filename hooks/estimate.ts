import type { ModelUsage } from 'claude-code'

import type { Family, FamilyTokens, SessionRecord } from '../types'

/** Hour start in ms, as a key, to tokens by family seen in that hour. */
export type UsageLog = Record<string, FamilyTokens>

/** A session's start time in ms, as a key, to what it has used. */
export type SessionLog = Record<string, SessionRecord>

const HOUR = 3_600_000
const DAY = 24 * HOUR
const KEEP = 8 * DAY
const KEEP_SESSIONS = 40 * DAY
const SPAN: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * DAY, spend_limit: 30 * DAY }

/** Tokens a request sent, cache reads at a tenth, as they are priced. */
export const sentBy = (u: ModelUsage): number => u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens * 0.1

/** Tokens a request sent and received, as the session line counts them. */
export const weigh = (u: ModelUsage): number => sentBy(u) + u.output_tokens

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

/** Adds or replaces `sessions` in `log`, and drops sessions last seen over 40 days ago. */
export function keepSessions(log: SessionLog, sessions: SessionLog, now: number): SessionLog {
  return Object.fromEntries(Object.entries({ ...log, ...sessions }).filter(([, s]) => s.seenAt >= now - KEEP_SESSIONS))
}

/** What the sessions last seen this calendar month cost, all but `current`. */
export function monthSpend(log: SessionLog, current: string, now: number): number {
  const today = new Date(now)
  const start = new Date(today.getFullYear(), today.getMonth(), 1).getTime()

  return Object.entries(log).reduce((spent, [key, s]) => (key !== current && s.seenAt >= start ? spent + s.usd : spent), 0)
}

/** Tokens by family logged in the window that resets at `resetsAt`; an hour counts if any of it falls inside. */
export function splitFor(log: UsageLog, kind: string, resetsAt: string | undefined, now: number): FamilyTokens {
  const end = resetsAt ? Date.parse(resetsAt) : now
  const start = (Number.isFinite(end) ? end : now) - (SPAN[kind] ?? 7 * DAY)

  return sum(Object.entries(log).filter(([hour]) => Number(hour) + HOUR > start).map(([, row]) => row))
}
