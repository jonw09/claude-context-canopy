import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, Timer, TurnUsage } from 'claude-code'

import type { AgentRow, FamilyTokens, LimitWindow, LoopLive, MainContext, Overrides, ShellWatch } from '../types'
import { type SessionLog, type UsageLog, addTo, hourOf, keepSessions, merge, sentBy, splitFor, weigh } from './estimate'
import { atLeast, describeTool } from './format'
import { type Line, type Seg, buildLines } from './layout'
import { familyOf } from './palette'
import { overrideFrom, overridesFrom, settingsFrom } from './settings'
import { EMPTY_WATCH, type ShellRow, endShells, finishedIn, isShellCall, isWatching, readShells } from './shells'
import { isLive } from './tree'

const MAIN = 'main'
/** Blank rows between the transcript and the band. */
const MARGIN = 1
const LOG_KEY = 'usage-log'
const SESSIONS_KEY = 'sessions'
const SETTINGS_KEY = 'settings'
const USAGE_HINT = 'Use /canopy set amber|red <percent>, /canopy set plan|session|agents|split on|off, /canopy set shells count|rows|off, or /canopy reset.'
/** How many of an agent's newest rows the first look at its conversation reads, to find the shell call its reply just made. */
const FIRST_READ = 40

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
/** The plan line of the terminal's welcome logo: how the session is billed. */
const plan = atom({ plugin: 'context-canopy', key: 'plan' } as const, null as string | null)
/** Each agent's background shells, by agent id, `main` included. */
const shells = atom({ plugin: 'context-canopy', key: 'shells' } as const, {} as Record<string, ShellWatch>)

let log: UsageLog = {}
let sessions: SessionLog = {}
let pending: UsageLog = {}
let timers: Timer[] = []
let asks: Record<string, { count: number; columns: number; lines: number }> = {}
let lastError = ''
/** The last row of each agent's conversation the band has read for shells, so each read takes only what is new. */
let cursors: Record<string, string> = {}
/**
 * The plan line the welcome logo was last drawn with. Drawing may not write
 * state, so the logo's hook keeps it here and the one-second poll takes it in.
 */
let welcomePlan: string | null | undefined
/** The plan line the poll last took in, so a poll with nothing new reads no state. */
let takenPlan: string | null | undefined

/** Text every monospaced face draws a cell to the character: printable ASCII. */
const PLAIN = /^[\x20-\x7e]+$/

/**
 * `text` as runs of printable ASCII, and of any other character repeated, such as
 * a bar's blocks. Layout counts a character's cells by its length, so a run's
 * length is its width.
 */
const runs = (text: string): string[] => text.match(/[\x20-\x7e]+|([^])\1*/gu) ?? []

/**
 * Block elements, which fill their cells: the bars' `▆`. Drawn wider by a
 * fallback face, they are cut at the run's last cell, so a bar never reaches
 * its percentage. Other glyphs draw whole, as a space always follows them.
 */
const FILL = /^[\u2580-\u259f]+$/

/** The first Claude Code whose Box takes `mono`: an earlier one refuses a tree that names it. */
const BOX_MONO = [2, 1, 331]
/** Whether this Claude Code takes `mono` on a Box; until it says, the band asks only what every version takes. */
let boxMono = false

async function followVersion($: EngineInterface): Promise<void> {
  const { version, base } = await $.session.version()
  boxMono = atLeast(base ?? version, BOX_MONO)
}

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
  const record = { tokens: await read($, sessionTokens), seenAt: now }
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
  // A new session's shells are its own: none of the last one's is listed or read for.
  cursors = {}
  await update($, shells, () => ({}))
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

/** Takes in the plan line the welcome logo was drawn with, once it has been. */
async function followPlan($: EngineInterface): Promise<void> {
  if (welcomePlan === undefined || welcomePlan === takenPlan) return
  takenPlan = welcomePlan
  await update($, plan, () => takenPlan ?? null)
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
  // An agent's shells go when it does: a subagent's are stopped as it ends.
  await update($, shells, all => Object.fromEntries(Object.entries(all).filter(([id]) => id === MAIN || live.has(id))))
}

/**
 * Reads what is new in one agent's conversation for its background shells: a
 * shell call it made, the answer that says the command went on in the
 * background, and the task notice that says it finished. It reads only while
 * the agent has made a shell call or has a shell running, and keeps nothing of
 * the rows but the shells' ids, names and commands.
 */
async function followShells($: EngineInterface, id: string, toolUses: readonly { name: string }[]): Promise<void> {
  if (settingsFrom(await read($, overrides)).shells === 'off') return
  const before = (await read($, shells))[id]
  if (!isWatching(before) && !toolUses.some(use => isShellCall(use.name))) return
  const agent = id === MAIN ? {} : { agentId: id }
  const cursor = cursors[id]
  const rows = await $.session.messages(cursor ? { ...agent, after: cursor } : { ...agent, last: FIRST_READ })
  if (!Array.isArray(rows)) {
    // The row read on from was compacted away or rewound: the next read starts again from the newest rows.
    delete cursors[id]

    return
  }
  const last = rows.at(-1)?.uuid
  if (last) cursors[id] = last
  const now = await $.clock.now()
  await update($, shells, all => {
    const next = readShells(all[id] ?? EMPTY_WATCH, rows as readonly ShellRow[], now)

    return isWatching(next) || next.ended.length ? { ...all, [id]: next } : all
  })
}

/** A task notice that starts a turn ends the shell it names straight away, before the turn's first reply. */
async function noticeShells($: EngineInterface, id: string, text: string): Promise<void> {
  const ids = finishedIn(text)
  if (!ids.size) return
  await update($, shells, all => (all[id] ? { ...all, [id]: endShells(all[id], ids) } : all))
}

/** A tool call's input as the record `describeTool` reads; anything else reads as empty. */
const toRecord = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {}

/**
 * An agent's first request names its model before the reply says which model
 * served it, and brings it into the tree without waiting for the next poll.
 */
async function meetAgent($: EngineInterface, id: string, model: string): Promise<void> {
  if ((await read($, loops))[id]?.model) return
  await pollAgents($)
  await setLoop($, id, { model })
}

async function recordStep($: EngineInterface, id: string, model: string, usage: TurnUsage | null): Promise<void> {
  if (!usage) {
    await setLoop($, id, { model })

    return
  }
  // The limits this response reported are read first, so a plan with limits never reads as having none.
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
async function snapshot(
  $: EngineInterface,
  width: number,
  { collapsed, maxRows, isFull }: { collapsed?: boolean; maxRows?: number; isFull?: boolean } = {},
): Promise<Line[]> {
  const settings = settingsFrom(await read($, overrides))
  const allLoops = await read($, loops)
  const mainContext = await read($, main)
  const windows = await read($, limits)

  return buildLines({
    width,
    now: await $.clock.now(),
    limits: windows,
    planSplit: await read($, planSplit),
    sessionTokens: await read($, sessionTokens),
    usd: await read($, usd),
    noLimitReported: !windows.length && !(await read($, limitsSeen)) && (await read($, hasReplied)),
    plan: await read($, plan),
    shells: Object.fromEntries(Object.entries(await read($, shells)).map(([id, watch]) => [id, watch.open])),
    main: { ...mainContext, ...allLoops[MAIN], model: allLoops[MAIN]?.model ?? mainContext.model },
    roster: await read($, roster),
    loops: allLoops,
    isCollapsed: collapsed ?? (await read($, isCollapsed)),
    // Printed in full, with no height to keep to, shells counted on their agents' rows are listed too.
    settings: isFull && settings.shells === 'count' ? { ...settings, shells: 'rows' } : settings,
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
  const changed = Object.entries(now).map(([key, value]) => `${key} ${typeof value === 'number' ? `${value}%` : typeof value === 'string' ? value : value ? 'on' : 'off'}`)

  return `Context Canopy settings: ${changed.join(', ') || 'all defaults'}.`
}

export const register: Register = on => {
  pending = {}
  boxMono = false
  welcomePlan = undefined
  takenPlan = undefined

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    log = ((await $.store.get(LOG_KEY)) ?? {}) as UsageLog
    sessions = ((await $.store.get(SESSIONS_KEY)) ?? {}) as SessionLog
    const saved = overridesFrom(await $.store.get(SETTINGS_KEY))
    await update($, overrides, () => saved)
    await $.command.register({
      name: 'canopy',
      description: 'Collapse, expand or adjust the Context Canopy band',
      argumentHint: '[collapse|expand|show [width]|status|set <setting> <value>|reset]',
    })
    await quietly(followVersion($))
    await quietly(followModel($))
    await quietly(measure($, true).then(() => refreshPlanSplit($)))
    for (const timer of timers) timer.cancel()
    timers = [
      $.clock.every(1000, () => void quietly(Promise.all([pollAgents($), followModel($), followUsage($), followPlan($)]))),
      $.clock.every(60_000, () => {
        void quietly(flush($))
        // Times the band counts in minutes (a window's reset, how long a shell has run) move with no change of state.
        $.ui.invalidate('ui.render')
      }),
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
    await quietly(noticeShells($, e.agentId ?? MAIN, e.text))

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) await quietly(meetAgent($, e.agentId, e.model))
    const result = yield* next(e)
    const id = e.agentId ?? MAIN
    await quietly(recordStep($, id, e.model, result.usage))
    // What the reply asks to run next is what the agent is doing. It is read from the reply, so the band hooks no tool call.
    const last = result.toolUses.at(-1)
    if (last) await quietly(setLoop($, id, { activity: describeTool(last.name, toRecord(last.input)) }))
    await quietly(followShells($, id, result.toolUses))

    return result
  })

  on('turn.complete', async ($, e, next) => {
    await quietly(setLoop($, e.agentId ?? MAIN, { activity: undefined }))

    return next(e)
  })

  on('command.run', { command: 'canopy' }, async ($, e) => {
    const [arg = '', size, value] = e.args.trim().toLowerCase().split(/\s+/)
    if (arg === 'status') return { text: await statusReport($) }
    if (arg === 'reset') return { text: await setOverrides($, () => ({})) }
    if (arg === 'set') {
      const change = overrideFrom(size, value)
      if (!change) return { text: USAGE_HINT }
      return { text: await setOverrides($, now => ({ ...now, ...change })) }
    }
    if (arg === 'show') {
      const width = Math.min(Number(size) >= 30 ? Number(size) : e.presentation.columns || 60, 160)
      const lines = await snapshot($, width, { collapsed: false, isFull: true })

      return { text: ['```', ...lines.map(line => line.map(s => s.text).join('').trimEnd()), '```'].join('\n') }
    }
    const collapsed = await update($, isCollapsed, now => (arg === 'collapse' ? true : arg === 'expand' ? false : !now))

    return { text: collapsed ? 'Context Canopy collapsed to one line.' : 'Context Canopy expanded.' }
  })

  // The welcome logo names how the session is billed. The band reads that line and draws the logo as it is.
  on('ui.render', { component: 'Welcome' }, async ($, e, next) => {
    if (e.props.isLive) welcomePlan = e.props.plan.trim() || null

    return next(e)
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

      // The terminal is a grid of cells already. Elsewhere text is drawn in the surface's monospaced face, so
      // spaces pad as wide as letters. From 2.1.331 the band also asks for the face's cell, and glyphs past ASCII
      // take a Box of their cells, so a glyph the face lacks can't widen its row; an earlier version refuses that.
      const onGrid = e.surface === 'terminal'
      const inCells = !onGrid && boxMono
      const style = (s: Seg) => ({ color: s.color, dimColor: s.dim, bold: s.bold, mono: onGrid ? undefined : true })

      return (
        <Box flexDirection="column" marginTop={MARGIN} mono={inCells ? true : undefined}>
          {lines.map((line, i) =>
            inCells ? (
              <Box key={`line-${i}`} overflow="hidden">
                {line.flatMap(s =>
                  runs(s.text).map(run =>
                    PLAIN.test(run) ? (
                      <Text {...style(s)}>{run}</Text>
                    ) : (
                      <Box width={run.length} flexShrink={0} overflow={FILL.test(run) ? 'hidden' : undefined}>
                        <Text {...style(s)}>{run}</Text>
                      </Box>
                    ),
                  ),
                )}
              </Box>
            ) : (
              <Box key={`line-${i}`}>
                <Text wrap="truncate" mono={onGrid ? undefined : true}>
                  {line.map(s => (
                    <Text {...style(s)}>{s.text}</Text>
                  ))}
                </Text>
              </Box>
            ),
          )}
        </Box>
      )
    } catch (err) {
      lastError = `draw on ${e.surface}: ${String(err)}`

      return next(e)
    }
  })
}
