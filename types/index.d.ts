export type Family = 'fable' | 'opus' | 'sonnet' | 'haiku' | 'other'

export type FamilyTokens = Partial<Record<Family, number>>

/** What `/canopy set` has changed from the defaults. */
export type Overrides = Partial<Record<'amber' | 'red', number> & Record<'plan' | 'session' | 'agents' | 'shells' | 'split', boolean>>

export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

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

/** A shell call whose answer hasn't been read yet, which may say its command went on in the background. */
export type ShellCall = {
  /** The call's tool use id, which the task notice names when the command finishes. */
  id: string
  /** The call's own few words for the command; empty when it gave none. */
  name: string
  command: string
}

/** A command an agent left running in the background. */
export type Shell = ShellCall & {
  /** The background task's id, which a task notice may name instead. */
  taskId?: string
  /** When the band first read that it was running in the background. */
  startedAt: number
}

/** What the band knows of one agent's background shells. */
export type ShellWatch = {
  calls: ShellCall[]
  open: Shell[]
  /** The tool use ids of shells that have finished, so a later read never brings one back. */
  ended: string[]
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
      sessionAt: number | null
      limitsSeen: boolean
      hasReplied: boolean
      sessionTokens: FamilyTokens
      planSplit: Record<string, FamilyTokens>
      roster: AgentRow[]
      loops: Record<string, LoopLive>
      isCollapsed: boolean
      overrides: Overrides
      plan: string | null
      shells: Record<string, ShellWatch>
    }
  }
}
