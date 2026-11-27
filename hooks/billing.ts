/**
 * How the session is billed, as the terminal's welcome logo names it: `Claude
 * Enterprise` and the other plans, `API Usage Billing` for an API key, a cloud
 * provider's name, or `Cloud gateway`.
 */
export type Billing = {
  /** The name the plan line gives it, short enough for the key column. */
  name: string
  /** What the plan line says when no limit is reported. */
  note: string
}

/** Where a seat's spend and limit are shown, when Claude Code reports no limit to plugins. */
const SEE_USAGE = 'see /usage'
/** An API key or a cloud provider bills by the token, against no plan. */
const NO_PLAN_LIMIT = 'no plan limit'
/** A gateway may set a spend limit; when it does, it comes as a window. */
const NOT_REPORTED = 'not reported'
/** The longest name the key column takes without widening, its gap included; a longer one is cut. */
const LONGEST = 17

const named = (name: string, note: string): Billing => ({ name: name.length > LONGEST ? `${name.slice(0, LONGEST - 1)}…` : name, note })

/** What the welcome logo's plan line means for the plan row; undefined when there is no line to go by. */
export function billingFrom(plan: string | null | undefined): Billing | undefined {
  const line = plan?.replace(/\s+/g, ' ').trim()
  // `Claude API` is what the logo writes for a login whose plan it doesn't know: no more to go by than no line.
  if (!line || line === 'Claude API') return undefined
  if (line === 'API Usage Billing') return named('API key', NO_PLAN_LIMIT)
  if (line === 'Cloud gateway') return named('Cloud gateway', NOT_REPORTED)
  if (/^Claude Platform on /.test(line)) return named(line.replace(/^Claude /, ''), NO_PLAN_LIMIT)
  // A plan: `Claude Enterprise`, `Claude Team`, `Claude Max`, `Claude Pro`, or the organisation's own name for it.
  if (/^Claude /.test(line)) return named(line.replace(/^Claude /, ''), SEE_USAGE)

  return named(line, NO_PLAN_LIMIT)
}
