import type { AgentRow, Family, FamilyTokens, LimitWindow, LoopLive, MainContext, Shell } from '../types'
import { billingFrom } from './billing'
import { clip, duration, money, pad, tokens, until, windowLabel } from './format'
import { FAMILIES, FAMILY_COLOUR, HEALTH_COLOUR, type Health, familyName, familyOf, healthOf, modelLabel } from './palette'
import type { Settings } from './settings'
import { type TreeNode, buildTree, flatten } from './tree'

export type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Line = Seg[]

export type View = {
  width: number
  now: number
  limits: readonly LimitWindow[]
  planSplit: Readonly<Record<string, FamilyTokens>>
  sessionTokens: FamilyTokens
  usd: number | null
  /** Whether Claude has replied and reported no limit: an API key, a cloud provider, or a seat billed by use. */
  noLimitReported: boolean
  /** The plan line of the terminal's welcome logo (`Claude Enterprise`, `API Usage Billing`), once it has been drawn. */
  plan?: string | null
  /** Each agent's background shells, `main` included. */
  shells?: Readonly<Record<string, readonly Shell[]>>
  main: MainContext & LoopLive
  roster: readonly AgentRow[]
  loops: Readonly<Record<string, LoopLive>>
  isCollapsed: boolean
  settings: Settings
  /** The most rows the band may take; the agent tree gives way to keep within it. None for `/canopy show`. */
  maxRows?: number
}

type Row = { guides: string; glyph: string; name: string; live: LoopLive; activity: string; isMain?: boolean; isIdle?: boolean; shell?: Shell }

/** One entry of the agent tree: an agent, or a shell one of them left running, under it. */
type Entry = { guides: string; node: TreeNode; shell?: undefined } | { guides: string; shell: Shell; node?: undefined }

const DEFAULT_WINDOW = 200_000
const NARROW = 72
/** From this width, agent names may take half as many columns again. */
const WIDE = 120
/** The key column's usual width; on a wide terminal, long agent names may take half as much again. */
const KEY = 20
const KEY_NARROW = 16
const BAR = 12
/** The detail column opens with a gutter: `≈` for an estimate, `⚠` for a warning, else blank, so what follows starts in one column. */
const GUTTER = 2
/** The sent and received column on agent rows, its gap included. */
const FLOW = 14
const PLAN = 'Plan Limits'
/** What the plan row reads where Claude Code reports no limit and the welcome logo hasn't named the plan. */
const NOT_REPORTED = 'not reported'
/** A shell's sign in the tree: plain ASCII, so every face draws it in one cell. */
const SHELL = '$'
const LIMITED: Seg = { text: 'limited', color: HEALTH_COLOUR.bad, bold: true }
const DIM = { dim: true }
const HEADING = { dim: true, bold: true }
const GLYPH: Record<string, string> = { pending: '◌', running: '●', waiting: '◐', idle: '○' }

const seg = (text: string, style: Omit<Seg, 'text'> = {}): Seg => ({ text, ...style })
const healthSeg = (text: string, health: Health): Seg => seg(text, { color: HEALTH_COLOUR[health] })
const percent = (n: number): string => `${Math.round(n)}%`
const total = (parts: [Family, number][]): number => parts.reduce((sum, [, n]) => sum + n, 0)
const shares = (t: FamilyTokens): [Family, number][] => FAMILIES.flatMap(f => (t[f] ? [[f, t[f]] as [Family, number]] : []))
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const waiting = (n: number): string | undefined => (n ? `waiting on ${plural(n, 'agent')}` : undefined)
const gutter = (sign = '', style: Omit<Seg, 'text'> = DIM): Seg => seg(pad(sign, GUTTER), style)
const warnGutter = (): Seg => gutter('⚠', { color: HEALTH_COLOUR.bad })
const label = (text: string): Seg => seg(pad(text, PLAN.length + 2), HEADING)
const planHealth = (pct: number, v: View): Health => healthOf(pct, 100, v.settings.warn, v.settings.danger)
const resetKey = (resetsAt: string | undefined, now: number): string => (until(resetsAt, now) ? `↻ ${until(resetsAt, now)}` : '')
/** No limit to show, so the plan line says so in a row of its own. */
const noLimit = (v: View): boolean => v.noLimitReported && !v.limits.length
/** With no limit reported: the plan the welcome logo names and what to say of it, or `not reported` alone. */
const unreported = (v: View): { name: string; note?: string } => billingFrom(v.plan) ?? { name: NOT_REPORTED }
/** Each plan row's name and the key after it. */
const planKeys = (v: View): [string, string][] => [
  ...v.limits.map((w): [string, string] => [windowLabel(w.kind), resetKey(w.resetsAt, v.now)]),
  ...(noLimit(v) ? [[unreported(v).name, ''] as [string, string]] : []),
]
/** Wide enough for the longest plan row name. */
const nameWidth = (v: View): number => Math.max(0, ...planKeys(v).map(([name]) => name.length)) + 2
const agentKeyRoom = (v: View): number => (v.width >= WIDE ? KEY * 1.5 : KEY)
const shellsOf = (v: View, id: string): readonly Shell[] => (v.settings.showShells ? (v.shells?.[id] ?? []) : [])
/** A shell's name in the tree: its own few words, else its command. */
const shellName = (shell: Shell): string => shell.name || shell.command

/**
 * The tree depth first, each entry with its `├─ └─ │` guides. An agent's shells
 * come straight under it, before the agents it started, so a shell giving way
 * never leaves a guide pointing at nothing.
 */
function entries(v: View, roots: readonly TreeNode[], own: readonly Shell[], lead = ''): Entry[] {
  const items: ({ shell: Shell } | { node: TreeNode })[] = [...own.map(shell => ({ shell })), ...roots.map(node => ({ node }))]

  return items.flatMap((item, i): Entry[] => {
    const isLast = i === items.length - 1
    const guides = lead + (isLast ? '└─' : '├─')
    if ('shell' in item) return [{ guides, shell: item.shell }]

    return [{ guides, node: item.node }, ...entries(v, item.node.children, shellsOf(v, item.node.id), lead + (isLast ? '  ' : '│ '))]
  })
}

/** The longest agent key, guides, status and name, with a column to spare. */
const agentKeyLength = (v: View): number =>
  v.settings.showAgents
    ? Math.max(0, ...entries(v, buildTree(v.roster), shellsOf(v, 'main')).map(e => e.guides.length + 3 + (e.shell ? shellName(e.shell) : (e.node.name ?? e.node.type)).length))
    : 0

/** Wide enough for every row's key, with a column to spare: a plan row and its reset time, or a long agent name on a wide terminal. */
function keyWidth(v: View, narrow: boolean): number {
  const agents = narrow ? KEY_NARROW : Math.min(agentKeyRoom(v), Math.max(KEY, agentKeyLength(v)))

  return Math.max(agents, ...planKeys(v).map(([, key]) => nameWidth(v) + key.length + 1))
}

/**
 * How full something is: a window, a spend limit or a context. Every gauge is
 * coloured by health and nothing else, so a bar always means one thing.
 * Anything above nothing fills a cell.
 */
function gauge(pct: number, health: Health): Line {
  const filled = Math.max(pct > 0 ? 1 : 0, Math.min(BAR, Math.round((pct / 100) * BAR)))

  return [seg('▆'.repeat(filled), { color: HEALTH_COLOUR[health] }), seg('▆'.repeat(BAR - filled), DIM)].filter(s => s.text)
}

/** Every model with a legend anywhere in the band, so each keeps one slot down every row. */
function legendFamilies(v: View): Family[] {
  const rows = [v.sessionTokens, ...(v.settings.estimate ? v.limits.map(w => v.planSplit[w.kind] ?? {}) : [])]

  return FAMILIES.filter(f => rows.some(row => row[f]))
}

/**
 * Legend items in a slot per model of `families`, the percentages right-aligned,
 * for as many as fit in `room` columns. A model this row lacks leaves its slot blank.
 */
function legend(parts: [Family, number][], families: Family[], room: number, sign = ''): Line {
  const of = new Map(parts)
  const line: Line = []
  let used = GUTTER
  let gap = ''
  for (const family of families.slice(0, families.findLastIndex(f => of.has(f)) + 1)) {
    const name = familyName(family)
    const n = of.get(family)
    const slot = name.length + 6
    const text = n === undefined ? ' '.repeat(slot) : `■ ${name} ${String(Math.round((n / total(parts)) * 100)).padStart(2)}%`
    if (used + gap.length + text.length > room) break
    line.push(seg(gap + text, n === undefined ? {} : { color: FAMILY_COLOUR[family] }))
    used += gap.length + text.length
    // A 100% takes a column of the gap after it.
    gap = ' '.repeat(Math.max(1, 2 - (text.length - slot)))
  }

  return line.some(s => s.color) ? [gutter(sign), ...line] : []
}

/** Pads or cuts `cells` to exactly `width` columns, so every row shares one grid. */
function column(cells: Line, width: number): Line {
  const used = cells.reduce((n, s) => n + s.text.length, 0)

  return used > width ? clipLine(cells, width) : [...cells, seg(' '.repeat(width - used))]
}

/** `spans`: a row with no model takes that column for its key too, so a long note isn't cut. */
type Cells = { key: Line; model?: Seg; spans?: true; bar?: Line; value?: Seg; detail: Line | ((room: number) => Line) }

/** One row of the grid: label, key, model, bar and value columns, then as much detail as fits. */
function row(heading: string, c: Cells, v: View, narrow: boolean): Line {
  const modelWidth = narrow ? 8 : 12
  const line = [
    label(heading),
    // A key that fills its column still leaves a space before the model.
    ...(c.spans
      ? column(c.key, keyWidth(v, narrow) + modelWidth)
      : [...column(c.key, keyWidth(v, narrow) - 1), seg(' '), ...column(c.model ? [c.model] : [], modelWidth)]),
    ...(narrow ? [] : column(c.bar ?? [], BAR + 2)),
    ...column(c.value ? [c.value] : [], 6),
  ]
  const room = v.width - line.reduce((n, s) => n + s.text.length, 0)

  return [...line, ...(typeof c.detail === 'function' ? c.detail(room) : c.detail)]
}

/**
 * How full a loop's context is, of its window, and its health against where it
 * compacts. A subagent's window is assumed from its model, and its compaction
 * point scaled as the main session's is.
 */
export function contextOf(live: LoopLive, main: MainContext & LoopLive, settings: Settings): { pct: number; health: Health } | undefined {
  if (live.tokens === undefined) return undefined
  const window = /\[1m\]/i.test(live.model ?? '') ? 1_000_000 : live.model === main.model && main.window ? main.window : DEFAULT_WINDOW
  const ratio = main.compactAt && main.window ? main.compactAt / main.window : 1

  return { pct: (live.tokens / window) * 100, health: healthOf(live.tokens, window * ratio, settings.warn, settings.danger) }
}

const isHot = (live: LoopLive, v: View): boolean => contextOf(live, v.main, v.settings)?.health === 'bad'

function windowCells(w: LimitWindow, v: View, width: number): Cells {
  const health = planHealth(w.percentUsed, v)
  const parts = v.settings.estimate ? shares(v.planSplit[w.kind] ?? {}) : []

  return {
    key: [seg(pad(windowLabel(w.kind), width)), seg(resetKey(w.resetsAt, v.now), DIM)],
    bar: gauge(w.percentUsed, health),
    value: healthSeg(percent(w.percentUsed), health),
    detail:
      w.percentUsed >= 100 ? [gutter(), LIMITED] : room => legend(parts, legendFamilies(v), room, '≈'),
  }
}

/**
 * A row with no limit to measure it by. The plan the welcome logo names, and
 * what to say of it where the bar would be (or as its detail when narrow):
 * where an Enterprise seat's spend is shown, or that an API key has no plan
 * limit. With no plan named, `not reported` alone.
 */
function unreportedCells(v: View, width: number, narrow: boolean): Cells {
  const { name, note } = unreported(v)
  const key = [seg(pad(name, width), note ? {} : DIM)]
  if (!note) return { key, detail: [] }

  return { key, bar: [seg(note, DIM)], detail: narrow ? [gutter(), seg(note, DIM)] : [] }
}

/** The plan's windows, or a row of its own when no limit is reported. */
function planLines(v: View, narrow: boolean): Line[] {
  const width = nameWidth(v)
  const rows = [
    ...v.limits.map(w => windowCells(w, v, width)),
    ...(noLimit(v) ? [unreportedCells(v, width, narrow)] : []),
  ]
  if (!rows.length) return shares(v.sessionTokens).length ? [] : [[label(PLAN), seg('appears after the first reply', DIM)]]

  return rows.map((cells, i) => row(i ? '' : PLAN, cells, v, narrow))
}

function sessionLine(v: View, narrow: boolean): Line {
  const parts = shares(v.sessionTokens)
  const cells: Cells = {
    key: [seg(`${tokens(total(parts))} tok`)],
    model: v.usd === null ? undefined : seg(money(v.usd)),
    detail: room => legend(parts, legendFamilies(v), room),
  }

  return row('Session', cells, v, narrow)
}

/**
 * What an agent has sent and received, `↑48k  ↓6.1k`, with the arrows in line
 * down the tree. It opens the detail column, level with the legends above.
 * Main counts from nothing; another agent shows none until its first request.
 */
function flow(live: LoopLive, isMain = false): Seg {
  const sent = live.sent ?? (isMain ? 0 : undefined)
  const text = sent === undefined ? '' : `↑${tokens(sent).padEnd(5)} ↓${tokens(live.received ?? 0)}`

  return seg(pad(text, FLOW), DIM)
}

function agentLine(r: Row, v: View, narrow: boolean, heading: string): Line {
  const colour = { color: FAMILY_COLOUR[familyOf(r.live.model)] }
  const model = r.live.model ? modelLabel(r.live.model) : '…'
  const context = contextOf(r.live, v.main, v.settings)
  const warning = isHot(r.live, v) ? [healthSeg(r.isMain ? '/compact soon · ' : 'compacts soon · ', 'bad')] : []
  const cells: Cells = {
    key: [seg(r.guides, DIM), seg(`${r.glyph} `, r.isIdle ? DIM : colour), seg(r.name, { bold: true })],
    model: seg(narrow ? model.split(' ')[0]! : model, colour),
    bar: context ? gauge(context.pct, context.health) : [seg('·'.repeat(BAR), DIM)],
    value: context ? healthSeg(percent(context.pct), context.health) : seg('—', DIM),
    detail: [
      warning.length ? warnGutter() : gutter(),
      ...(narrow ? [] : [flow(r.live, r.isMain)]),
      ...warning,
      seg(r.activity, r.isIdle ? DIM : {}),
    ],
  }

  return row(heading, cells, v, narrow)
}

/**
 * A shell an agent left running, under it: its name, how long it has run, and
 * its command in line with the agents' activity. It has no bar, as there is
 * nothing for it to fill.
 */
function shellLine(r: Row, shell: Shell, v: View, narrow: boolean): Line {
  const name = shellName(shell)
  const cells: Cells = {
    key: [seg(r.guides, DIM), seg(`${SHELL} `, DIM), seg(name)],
    model: seg('shell', DIM),
    value: seg(duration(v.now - shell.startedAt), DIM),
    detail: [gutter(), ...(narrow ? [] : [seg(pad('', FLOW))]), seg(name === shell.command ? '' : shell.command, DIM)],
  }

  return row('', cells, v, narrow)
}

/** `+3 more agents, 2 shells`, or `+2 more shells` when only shells are hidden. */
function hiddenText(agents: number, shells: number): string {
  if (!agents) return `+${plural(shells, 'more shell')}`

  return `+${plural(agents, 'more agent')}${shells ? `, ${plural(shells, 'shell')}` : ''}`
}

/** The row that ends a cropped tree: how many agents and shells it hides, and how many of the agents are near compacting. */
function moreLine(hidden: readonly Row[], v: View, narrow: boolean): Line {
  const agents = hidden.filter(r => !r.shell)
  const hot = agents.filter(r => isHot(r.live, v)).length
  const detail = hot ? [warnGutter(), healthSeg(`${hot} ${hot === 1 ? 'compacts' : 'compact'} soon`, 'bad')] : []

  return row('', { key: [seg(hiddenText(agents.length, hidden.length - agents.length), DIM)], spans: true, detail }, v, narrow)
}

/**
 * The rows shown in `room`: all of them when they fit. Past that, shells give
 * way first, the lowest first, so each agent keeps its row while there's room
 * for it; then the tree is cut, keeping main. A row says what is hidden.
 */
function fit(rows: readonly Row[], room: number): Row[] {
  if (rows.length <= room) return [...rows]
  const keep = Math.max(1, room - 1)
  let shown = [...rows]
  for (let i = shown.length - 1; i >= 0 && shown.length > keep; i--) if (shown[i]!.shell) shown.splice(i, 1)

  return shown.slice(0, keep)
}

/** The tree in `room` rows at most: past that, as many as fit, then a row saying what it hides. */
function agentLines(v: View, narrow: boolean, room = Infinity): Line[] {
  const roots = buildTree(v.roster)
  const rows: Row[] = [
    { guides: '', glyph: '●', name: 'main', live: v.main, activity: v.main.activity || waiting(roots.length) || 'ready', isMain: true },
    ...entries(v, roots, shellsOf(v, 'main')).map(({ node, shell, guides }): Row => {
      if (shell) return { guides, glyph: SHELL, name: shellName(shell), live: {}, activity: '', shell }
      const live = v.loops[node.id] ?? {}
      const isIdle = node.status === 'idle'
      const activity = live.activity || waiting(node.children.length) || (isIdle ? 'idle' : (node.description ?? ''))

      return { guides, glyph: GLYPH[node.status] ?? '●', name: node.name ?? node.type, live, activity, isIdle }
    }),
  ]

  const shown = fit(rows, room)
  const lines = shown.map((r, i) => (r.shell ? shellLine(r, r.shell, v, narrow) : agentLine(r, v, narrow, i ? '' : 'Agents')))
  const hidden = rows.filter(r => !shown.includes(r))

  return hidden.length ? [...lines, moreLine(hidden, v, narrow)] : lines
}

function unreportedItem(v: View): Line {
  const { name, note } = unreported(v)

  return note ? [seg(`${name} `), seg(note, DIM)] : [seg(name, DIM)]
}

function collapsedPlan(v: View): Line {
  const items = [
    ...v.limits.map(w => [seg(`${windowLabel(w.kind)} `), healthSeg(percent(w.percentUsed), planHealth(w.percentUsed, v))]),
    ...(noLimit(v) ? [unreportedItem(v)] : []),
  ]
  if (!v.settings.showPlan || !items.length) return []

  return [seg(`${PLAN} `, HEADING), ...items.flatMap((item, i) => (i ? [seg(' · '), ...item] : item))]
}

function collapsedSession(v: View): Line {
  if (!v.settings.showSession) return []

  return [seg('Session ', HEADING), seg(`${tokens(total(shares(v.sessionTokens)))} tok${v.usd === null ? '' : ` ${money(v.usd)}`}`)]
}

function collapsedAgents(v: View): Line {
  if (!v.settings.showAgents) return []
  const agents = flatten(buildTree(v.roster))
  const hot = agents.filter(({ node }) => isHot(v.loops[node.id] ?? {}, v)).length
  const main = contextOf(v.main, v.main, v.settings)
  const shells = entries(v, buildTree(v.roster), shellsOf(v, 'main')).filter(e => e.shell).length

  return [
    seg('Agents ', HEADING),
    seg(`${agents.length + 1} ●`),
    ...(shells ? [seg(`  ${shells} ${SHELL}`, DIM)] : []),
    ...(hot ? [healthSeg(`  ${hot} ⚠`, 'bad')] : []),
    ...(main ? [seg('  main ', DIM), healthSeg(percent(main.pct), main.health)] : []),
  ]
}

/** Each section's figures on one line, in the band's order. */
function collapsedLine(v: View): Line {
  const parts = [collapsedSession(v), collapsedPlan(v), collapsedAgents(v)]

  return parts.filter(part => part.length).flatMap((part, i) => (i ? [seg('   '), ...part] : part))
}

function clipLine(line: Line, columns: number): Line {
  const out: Line = []
  let left = columns
  for (const s of line) {
    const text = clip(s.text, left)
    if (text) out.push({ ...s, text })
    left -= s.text.length
    if (left <= 0) break
  }

  return out
}

/** The band: Session, Plan, then Agents, the tree giving way to keep the band within `maxRows`. */
export function buildLines(v: View): Line[] {
  const narrow = v.width < NARROW
  const { showPlan, showSession, showAgents } = v.settings
  if (v.isCollapsed) return [clipLine(collapsedLine(v), v.width)].filter(line => line.length > 0)

  const plan = showPlan ? planLines(v, narrow) : []
  const session = showSession ? [sessionLine(v, narrow)] : []
  const agents = showAgents ? agentLines(v, narrow, (v.maxRows ?? Infinity) - plan.length - session.length) : []
  const lines = [...session, ...plan, ...agents]

  return lines.map(line => clipLine(line, v.width)).filter(line => line.length > 0)
}
