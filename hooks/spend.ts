import type { Spend } from '../types'

/** Where Claude Code's own `/usage` reads the account's spend for the billing period. */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** The 1st of next month, local time, when Claude Code says the spend resets. */
export function monthEnd(now: number): string {
  const today = new Date(now)

  return new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString()
}

/**
 * The spend in a reply from the usage endpoint, from its `extra_usage`, in minor
 * units: what has been spent this billing period, and the monthly limit, null
 * when there is none. Undefined when the account has no spend to show: extra
 * usage off and nothing spent, or a reply this plugin can't read.
 */
export function spendFrom(body: unknown, now: number): Spend | undefined {
  const extra = (body as { extra_usage?: Record<string, unknown> } | null)?.extra_usage
  if (!extra || !isNumber(extra.used_credits)) return undefined
  if (extra.is_enabled !== true && extra.used_credits <= 0) return undefined
  const limit = isNumber(extra.monthly_limit) && extra.monthly_limit > 0 ? extra.monthly_limit / 100 : null

  return {
    spent: extra.used_credits / 100,
    limit,
    percentUsed: limit === null ? null : isNumber(extra.utilization) ? extra.utilization : (extra.used_credits / 100 / limit) * 100,
    currency: typeof extra.currency === 'string' && extra.currency ? extra.currency.toUpperCase() : 'USD',
    resetsAt: monthEnd(now),
  }
}
