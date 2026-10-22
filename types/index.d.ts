export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

export type FamilyTokens = Partial<Record<Family, number>>

/** What `/canopy set` has changed from the defaults. */
export type Overrides = Partial<Record<'amber' | 'red', number> & Record<'plan' | 'session' | 'agents' | 'split', boolean>>

export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

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
  activity?: string
}

export type MainContext = {
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
      sessionTokens: FamilyTokens
      planSplit: Record<string, FamilyTokens>
      roster: AgentRow[]
      loops: Record<string, LoopLive>
      isCollapsed: boolean
      planName: string | null
      overrides: Overrides
    }
  }
}
