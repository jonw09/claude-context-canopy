import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer, TurnUsage } from 'claude-code'

import type { AgentRow, FamilyTokens, LimitWindow, LoopLive, MainContext, Overrides } from '../types'
import { type SessionLog, type UsageLog, addTo, hourOf, keepSessions, merge, monthSpend, sentBy, splitFor, weigh } from './estimate'
import { describeTool } from './format'
import { type Line, buildLines } from './layout'
import { familyOf } from './palette'
import { overrideFrom, settingsFrom } from './settings'
import { isLive } from './tree'

const MAIN = 'main'
/** Blank rows between the transcript and the band. */
const MARGIN = 1
const LOG_KEY = 'usage-log'
const SESSIONS_KEY = 'sessions'
const SETTINGS_KEY = 'settings'
const USAGE_HINT = 'Use /canopy set amber|red <percent>, /canopy set plan|session|agents|split on|off, or /canopy reset.'

const limits = atom({ plugin: 'context-canopy', key: 'limits' } as const, [] as LimitWindow[])
const main = atom({ plugin: 'context-canopy', key: 'main' } as const, {} as MainContext)
const usd = atom({ plugin: 'context-canopy', key: 'usd' } as const, null as number | null)
/** The start time of the session the session figures belong to (`$.session.usage().startedAt`). */
const sessionAt = atom({ plugin: 'context-canopy', key: 'sessionAt' } as const, null as number | null)
/** Whether any limit has been reported, so a window that lapses unread is not taken for no limit. */
const limitsSeen = atom({ plugin: 'context-canopy', key: 'limitsSeen' } as const, false)
/** Whether a request has been answered since the band loaded, after which limits have been reported if there are any. */
const hasReplied = atom({ plugin: 'context-canopy', key: 'hasReplied' } as const, false)
const sessionTokens = atom({ plugin: 'context-canopy', key: 'sessionTokens' } as const, {} as FamilyTokens)
const planSplit = atom({ plugin: 'context-canopy', key: 'planSplit' } as const, {} as Record<string, FamilyTokens>)
const roster = atom({ plugin: 'context-canopy', key: 'roster' } as const, [] as AgentRow[])
const loops = atom({ plugin: 'context-canopy', key: 'loops' } as const, {} as Record<string, LoopLive>)
const isCollapsed = atom({ plugin: 'context-canopy', key: 'isCollapsed' } as const, false)
const overrides = atom({ plugin: 'context-canopy', key: 'overrides' } as const, {} as Overrides)

let log: UsageLog = {}
let sessions: SessionLog = {}
let pending: UsageLog = {}
let timers: Timer[] = []
let asks: Record<string, { count: number; columns: number; lines: number }> = {}
let lastError = ''

/** The band only observes: a failure is kept for `/canopy status` and never reaches Claude's work. */
const quietly = (work: Promise<unknown>): Promise<unknown> =>
  work.catch(err => {
    lastError = String(err)
  })

function setLoop($: EngineInterface, id: string, patch: LoopLive): Promise<unknown> {
  return update($, loops, all => ({ ...all, [id]: { ...all[id], ...patch } }))
}

async function refreshPlanSplit($: EngineInterface): Promise<void> {
  if (!settingsFrom(await read($, overrides)).estimate) return
  const now = await $.clock.now()
  const all = merge(log, pending, now)
  const windows = await read($, limits)
  await update($, planSplit, () => Object.fromEntries(windows.map(w => [w.kind, splitFor(all, w.kind, w.resetsAt, now)])))
}

/** Saves the current session's figures beside those other sessions on this machine saved. */
async function saveSession($: EngineInterface): Promise<void> {
  const at = await read($, sessionAt)
  if (at === null) return
  const now = await $.clock.now()
  const record = { usd: (await read($, usd)) ?? 0, tokens: await read($, sessionTokens), seenAt: now }
  sessions = keepSessions(((await $.store.get(SESSIONS_KEY)) ?? {}) as SessionLog, { [at]: record }, now)
  await $.store.set(SESSIONS_KEY, sessions)
}

async function flush($: EngineInterface): Promise<void> {
  await saveSession($)
  if (!Object.keys(pending).length) return
  log = merge(((await $.store.get(LOG_KEY)) ?? {}) as UsageLog, pending, await $.clock.now())
  pending = {}
  await $.store.set(LOG_KEY, log)
}

/**
 * Moves the session figures to the session that started at `startedAt`. A
 * resumed session picks up what it saved; `/clear` starts a new session, and
 * the figures over, as Claude Code does with the session's cost.
 */
async function followSession($: EngineInterface, startedAt: number): Promise<void> {
  if ((await read($, sessionAt)) === startedAt) return
  await saveSession($)
  const saved = sessions[startedAt]
  await update($, sessionTokens, () => saved?.tokens ?? {})
  await setLoop($, MAIN, { sent: undefined, received: undefined })
  await update($, sessionAt, () => startedAt)
}

/** Takes in a reading of the session's usage; one without a breakdown keeps the compaction point it had. */
async function apply($: EngineInterface, usage: SessionUsage): Promise<void> {
  const breakdown = usage.context.breakdown
  await followSession($, usage.startedAt)
  await update($, limits, () => usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })))
  if (usage.rateLimits.length) await update($, limitsSeen, () => true)
  await update($, usd, () => usage.cost?.usd ?? null)
  await update($, main, before => ({
    ...before,
    tokens: usage.context.tokens,
    window: usage.context.window,
    compactAt: breakdown ? (breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined) : before.compactAt,
  }))
}

/** `withThreshold` also asks where auto-compaction runs, a local estimate that only moves with the window. */
async function measure($: EngineInterface, withThreshold: boolean): Promise<void> {
  await apply($, await $.session.usage(withThreshold ? { breakdown: 'summary' } : undefined))
}

/** Takes in a fresh reading when the session changed or its cost moved, which `/clear` does without a measure event. */
async function followUsage($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const isSame = usage.startedAt === (await read($, sessionAt)) && (usage.cost?.usd ?? null) === (await read($, usd))
  if (!isSame) await apply($, usage)
}

/**
 * Keeps the main row on the session's model from the start, before any request.
 * On a switch, the last request's model gives way to the new one; otherwise it
 * stands, so a fallback shows.
 */
async function followModel($: EngineInterface): Promise<void> {
  const model = await $.session.model()
  if (!model || model === (await read($, main)).model) return
  await update($, main, before => ({ ...before, model }))
  await setLoop($, MAIN, { model: undefined })
}

async function pollAgents($: EngineInterface): Promise<void> {
  const rows = (await $.agent.list()).map(({ id, parentId, type, name, description, status }) => ({ id, parentId, type, name, description, status }))
  if (JSON.stringify(rows) === JSON.stringify(await read($, roster))) return
  const live = new Set(rows.filter(isLive).map(row => row.id))
  await update($, roster, () => rows)
  await update($, loops, all => Object.fromEntries(Object.entries(all).filter(([id]) => id === MAIN || live.has(id))))
}

async function recordStep($: EngineInterface, id: string, model: string, usage: TurnUsage | null): Promise<void> {
  if (!usage) {
    await setLoop($, id, { model })

    return
  }
  // The limits this response reported are read first, so a plan with limits never shows unlimited.
  await followUsage($)
  await update($, hasReplied, () => true)
  const family = familyOf(usage.model)
  const weight = weigh(usage)
  const hour = hourOf(await $.clock.now())
  const prior = (await read($, loops))[id] ?? {}
  await setLoop($, id, {
    model: usage.model,
    tokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    sent: (prior.sent ?? 0) + sentBy(usage),
    received: (prior.received ?? 0) + usage.output_tokens,
  })
  await update($, sessionTokens, all => addTo(all, family, weight))
  pending = { ...pending, [hour]: addTo(pending[hour] ?? {}, family, weight) }
  await refreshPlanSplit($)
}

/** The band as lines for `width` columns; `collapsed` overrides the person's choice, and `maxRows` caps the tree. */
async function snapshot($: EngineInterface, width: number, { collapsed, maxRows }: { collapsed?: boolean; maxRows?: number } = {}): Promise<Line[]> {
  const allLoops = await read($, loops)
  const mainContext = await read($, main)
  const now = await $.clock.now()
  const cost = await read($, usd)
  const tokensSoFar = await read($, sessionTokens)
  const windows = await read($, limits)
  const isUnlimited = !windows.length && !(await read($, limitsSeen)) && (await read($, hasReplied))

  return buildLines({
    width,
    now,
    limits: windows,
    planSplit: await read($, planSplit),
    sessionTokens: tokensSoFar,
    usd: cost,
    unlimitedMonth: isUnlimited ? monthSpend(sessions, String(await read($, sessionAt)), now) + (cost ?? 0) : null,
    main: { ...mainContext, ...allLoops[MAIN], model: allLoops[MAIN]?.model ?? mainContext.model },
    roster: await read($, roster),
    loops: allLoops,
    isCollapsed: collapsed ?? (await read($, isCollapsed)),
    settings: settingsFrom(await read($, overrides)),
    maxRows,
  })
}

async function statusReport($: EngineInterface): Promise<string> {
  const surfaces = await $.session.surfaces()
  const drawn = Object.entries(asks).map(([surface, a]) => `${surface}: asked ${a.count}×, ${a.columns} cols, ${a.lines} lines`)

  return [
    `Surfaces attached: ${surfaces.join(', ') || 'none'}`,
    `Band asked for by: ${drawn.join('; ') || 'no surface yet'}`,
    `Last error: ${lastError || 'none'}`,
  ].join('\n')
}

async function setOverrides($: EngineInterface, change: (now: Overrides) => Overrides): Promise<string> {
  const now = await update($, overrides, change)
  await $.store.set(SETTINGS_KEY, now)
  const changed = Object.entries(now).map(([key, value]) => `${key} ${typeof value === 'number' ? `${value}%` : value ? 'on' : 'off'}`)

  return `Context Canopy settings: ${changed.join(', ') || 'all defaults'}.`
}

export const register: Register = on => {
  pending = {}

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    log = ((await $.store.get(LOG_KEY)) ?? {}) as UsageLog
    sessions = ((await $.store.get(SESSIONS_KEY)) ?? {}) as SessionLog
    const saved = ((await $.store.get(SETTINGS_KEY)) ?? {}) as Overrides
    await update($, overrides, () => saved)
    await $.command.register({
      name: 'canopy',
      description: 'Collapse, expand or adjust the Context Canopy band',
      argumentHint: '[collapse|expand|show [width]|status|set <setting> <value>|reset]',
    })
    await quietly(followModel($))
    await quietly(measure($, true).then(() => refreshPlanSplit($)))
    for (const timer of timers) timer.cancel()
    timers = [
      $.clock.every(1000, () => void quietly(Promise.all([pollAgents($), followModel($), followUsage($)]))),
      $.clock.every(60_000, () => void quietly(flush($))),
    ]

    return started
  })

  on('session.end', async ($, e, next) => {
    await quietly(flush($))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const before = await read($, main)
    await quietly(measure($, before.window !== e.context.window || before.compactAt === undefined))
    if (e.changed.includes('rateLimits')) await quietly(refreshPlanSplit($))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await quietly(setLoop($, e.agentId ?? MAIN, { activity: 'thinking…' }))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    await quietly(recordStep($, e.agentId ?? MAIN, e.model, result.usage))

    return result
  })

  on('tool.call', async ($, e, next) => {
    await quietly(setLoop($, e.agentId ?? MAIN, { activity: describeTool(String(e.tool), e as unknown as Record<string, unknown>) }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await quietly(setLoop($, e.agentId ?? MAIN, { activity: undefined }))

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) {
      if (spawned.model) await quietly(setLoop($, spawned.agentId, { model: spawned.model }))
      await quietly(pollAgents($))
    }

    return spawned
  })

  on('command.run', { command: 'canopy' }, async ($, e) => {
    const [arg = '', size, value] = e.args.trim().toLowerCase().split(/\s+/)
    if (arg === 'status') return { text: await statusReport($) }
    if (arg === 'reset') return { text: await setOverrides($, () => ({})) }
    if (arg === 'set') {
      const change = overrideFrom(size, value)

      return { text: change ? await setOverrides($, now => ({ ...now, ...change })) : USAGE_HINT }
    }
    if (arg === 'show') {
      const width = Math.min(Number(size) >= 30 ? Number(size) : e.presentation.columns || 60, 160)
      const lines = await snapshot($, width, { collapsed: false })

      return { text: ['```', ...lines.map(line => line.map(s => s.text).join('').trimEnd()), '```'].join('\n') }
    }
    const collapsed = await update($, isCollapsed, now => (arg === 'collapse' ? true : arg === 'expand' ? false : !now))

    return { text: collapsed ? 'Context Canopy collapsed to one line.' : 'Context Canopy expanded.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ask = (asks[e.surface] ??= { count: 0, columns: 0, lines: 0 })
    ask.count += 1
    ask.columns = e.props.bodyColumns
    try {
      const { Box, Text } = $.ui.resolve(e)
      // The margin counts against the band's rows, so the tree gives way in time and the engine never scrolls the band.
      const lines = await snapshot($, e.props.bodyColumns, { maxRows: e.props.maxRows - MARGIN })
      ask.lines = lines.length
      if (!lines.length) return next(e)

      return (
        <Box flexDirection="column" marginTop={MARGIN}>
          {lines.map((line, i) => (
            <Box key={`line-${i}`}>
              <Text wrap="truncate">
                {line.map(s => (
                  <Text color={s.color} dimColor={s.dim} bold={s.bold}>
                    {s.text}
                  </Text>
                ))}
              </Text>
            </Box>
          ))}
        </Box>
      )
    } catch (err) {
      lastError = `draw on ${e.surface}: ${String(err)}`

      return next(e)
    }
  })
}
