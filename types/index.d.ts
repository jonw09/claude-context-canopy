export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

export type FamilyTokens = Partial<Record<Family, number>>

/** What `/canopy set` has changed from the defaults. */
export type Overrides = Partial<Record<'amber' | 'red', number> & Record<'plan' | 'session' | 'agents' | 'split' | 'spend', boolean>>

export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** What the account has spent this billing period, as Claude Code's `/usage` reads it, in major units of `currency`. */
export type Spend = {
  spent: number
  /** The monthly spend limit; null when there is none. */
  limit: number | null
  percentUsed: number | null
  currency: string
  resetsAt: string
}

/** What one session has used, kept so a resumed session picks it up again. */
export type SessionRecord = {
  tokens: FamilyTokens
  seenAt: number
}

export type AgentRow = {
  id: string
  parentId?: string
  type: string
  name?: string
  description: string
  status: string
}

/** What the band knows of one agent's loop, or of `main`. */
export type LoopLive = {
  model?: string
  /** Input tokens of its last request, which is what its context holds. */
  tokens?: number
  /** Tokens it has sent and received, counted as the session line counts them; for `main`, since this session started here. */
  sent?: number
  received?: number
  activity?: string
}

export type MainContext = {
  /** The main loop's model as `/model` shows it, before any request has said which model served it. */
  model?: string
  tokens?: number
  window?: number
  /** Where auto-compaction runs; absent when it is off. */
  compactAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-canopy': {
      limits: LimitWindow[]
      main: MainContext
      usd: number | null
      spend: Spend | null
      sessionAt: number | null
      limitsSeen: boolean
      hasReplied: boolean
      sessionTokens: FamilyTokens
      planSplit: Record<string, FamilyTokens>
      roster: AgentRow[]
      loops: Record<string, LoopLive>
      isCollapsed: boolean
      overrides: Overrides
    }
  }
}
