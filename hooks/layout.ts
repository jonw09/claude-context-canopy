import type { AgentRow, Family, FamilyTokens, LimitWindow, LoopLive, MainContext, Spend } from '../types'
import { SPEND, clip, money, pad, tokens, until, windowLabel } from './format'
import { FAMILIES, FAMILY_COLOUR, HEALTH_COLOUR, type Health, familyName, familyOf, healthOf, modelLabel } from './palette'
import type { Settings } from './settings'
import { buildTree, flatten } from './tree'

export type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Line = Seg[]

export type View = {
  width: number
  now: number
  limits: readonly LimitWindow[]
  planSplit: Readonly<Record<string, FamilyTokens>>
  sessionTokens: FamilyTokens
  usd: number | null
  /** What the account has spent this billing period, from Claude Code's usage endpoint; null when that isn't known. */
  spend: Spend | null
  /** Whether Claude has replied and reported no limit: an account with no limit, an API key or a cloud provider. */
  isUnlimited: boolean
  main: MainContext & LoopLive
  roster: readonly AgentRow[]
  loops: Readonly<Record<string, LoopLive>>
  isCollapsed: boolean
  settings: Settings
  /** The most rows the band may take; the agent tree gives way to keep within it. None for `/canopy show`. */
  maxRows?: number
}

type Row = { guides: string; glyph: string; name: string; live: LoopLive; activity: string; isMain?: boolean; isIdle?: boolean }

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
const MONTH = windowLabel(SPEND)
const UNLIMITED = 'unlimited'
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
/** The spend row's name: `extra` beside the 5h and 7d windows, as extra usage tops them up, else `month`. */
const spendName = (v: View): string => (v.limits.length ? 'extra' : MONTH)
/** No limit and no spend to show, so the plan line says so in a row of its own. */
const noLimit = (v: View): boolean => v.isUnlimited && !v.limits.length && !v.spend
/** Each plan row's name and the key after it. */
const planKeys = (v: View): [string, string][] => [
  ...v.limits.map((w): [string, string] => [windowLabel(w.kind), resetKey(w.resetsAt, v.now)]),
  ...(v.spend ? [[spendName(v), resetKey(v.spend.resetsAt, v.now)] as [string, string]] : []),
  ...(noLimit(v) ? [[MONTH, ''] as [string, string]] : []),
]
/** Wide enough for the longest plan row name. */
const nameWidth = (v: View): number => Math.max(0, ...planKeys(v).map(([name]) => name.length)) + 2
const agentKeyRoom = (v: View): number => (v.width >= WIDE ? KEY * 1.5 : KEY)
/** The longest agent key, guides, status and name, with a column to spare. */
const agentKeyLength = (v: View): number =>
  v.settings.showAgents ? Math.max(0, ...flatten(buildTree(v.roster)).map(({ node, guides }) => guides.length + 3 + (node.name ?? node.type).length)) : 0

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

type Cells = { key: Line; model?: Seg; bar?: Line; value?: Seg; detail: Line | ((room: number) => Line) }

/** One row of the grid: label, key, model, bar and value columns, then as much detail as fits. */
function row(heading: string, c: Cells, v: View, narrow: boolean): Line {
  const line = [
    label(heading),
    // A key that fills its column still leaves a space before the model.
    ...column(c.key, keyWidth(v, narrow) - 1),
    seg(' '),
    ...column(c.model ? [c.model] : [], narrow ? 8 : 12),
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

/** A row with no limit to measure it by: `unlimited` where the bar would be, or as its detail when narrow. */
function unlimitedCells(key: Line, narrow: boolean, amount?: Seg): Cells {
  return { key, model: amount, bar: [seg(UNLIMITED, DIM)], detail: narrow ? [gutter(), seg(UNLIMITED, DIM)] : [] }
}

/**
 * The account's spend this billing period, laid out as the session's cost is:
 * the amount in the model column, then how much of the limit it is and the
 * limit, or `unlimited` where the bar would be.
 */
function spendCells(s: Spend, v: View, width: number, narrow: boolean): Cells {
  const key = [seg(pad(spendName(v), width)), seg(resetKey(s.resetsAt, v.now), DIM)]
  const amount = seg(money(s.spent, s.currency, !narrow || s.spent < 1000))
  if (s.limit === null || s.percentUsed === null) return unlimitedCells(key, narrow, amount)
  const health = planHealth(s.percentUsed, v)
  const limit = money(s.limit, s.currency, !Number.isInteger(s.limit))

  return {
    key,
    model: amount,
    bar: gauge(s.percentUsed, health),
    value: healthSeg(percent(s.percentUsed), health),
    detail: [gutter(), s.percentUsed >= 100 ? LIMITED : seg(`of ${limit}`, DIM)],
  }
}

/** The plan's windows, then the month's spend, or `month` alone when no limit is reported. */
function planLines(v: View, narrow: boolean): Line[] {
  const width = nameWidth(v)
  const rows = [
    ...v.limits.map(w => windowCells(w, v, width)),
    ...(v.spend ? [spendCells(v.spend, v, width, narrow)] : []),
    ...(noLimit(v) ? [unlimitedCells([seg(pad(MONTH, width))], narrow)] : []),
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

/** The row that ends a cropped tree: how many agents it hides, and how many of those are near compacting. */
function moreLine(hidden: readonly Row[], v: View, narrow: boolean): Line {
  const hot = hidden.filter(r => isHot(r.live, v)).length
  const detail = hot ? [warnGutter(), healthSeg(`${hot} ${hot === 1 ? 'compacts' : 'compact'} soon`, 'bad')] : []

  return row('', { key: [seg(`+${plural(hidden.length, 'more agent')}`, DIM)], detail }, v, narrow)
}

/** The tree in `room` rows at most: past that, as many as fit, then a row saying what it hides. */
function agentLines(v: View, narrow: boolean, room = Infinity): Line[] {
  const roots = buildTree(v.roster)
  const rows: Row[] = [
    { guides: '', glyph: '●', name: 'main', live: v.main, activity: v.main.activity || waiting(roots.length) || 'ready', isMain: true },
    ...flatten(roots).map(({ node, guides }) => {
      const live = v.loops[node.id] ?? {}
      const isIdle = node.status === 'idle'
      const activity = live.activity || waiting(node.children.length) || (isIdle ? 'idle' : (node.description ?? ''))

      return { guides, glyph: GLYPH[node.status] ?? '●', name: node.name ?? node.type, live, activity, isIdle }
    }),
  ]

  const shown = rows.length > room ? rows.slice(0, Math.max(1, room - 1)) : rows
  const lines = shown.map((r, i) => agentLine(r, v, narrow, i ? '' : 'Agents'))

  return shown.length < rows.length ? [...lines, moreLine(rows.slice(shown.length), v, narrow)] : lines
}

function collapsedSpend(s: Spend, v: View): Line {
  const amount = seg(`${spendName(v)} ${money(s.spent, s.currency)} `)
  if (s.percentUsed === null) return [amount, seg(UNLIMITED, DIM)]

  return [amount, healthSeg(percent(s.percentUsed), planHealth(s.percentUsed, v))]
}

function collapsedPlan(v: View): Line {
  const items = [
    ...v.limits.map(w => [seg(`${windowLabel(w.kind)} `), healthSeg(percent(w.percentUsed), planHealth(w.percentUsed, v))]),
    ...(v.spend ? [collapsedSpend(v.spend, v)] : []),
    ...(noLimit(v) ? [[seg(`${MONTH} `), seg(UNLIMITED, DIM)]] : []),
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

  return [
    seg('Agents ', HEADING),
    seg(`${agents.length + 1} ●`),
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
