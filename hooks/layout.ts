import type { AgentRow, Family, FamilyTokens, LimitWindow, LoopLive, MainContext } from '../types'
import { apportion, clip, pad, tokens, until, usd, windowLabel } from './format'
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
  main: MainContext & LoopLive
  roster: readonly AgentRow[]
  loops: Readonly<Record<string, LoopLive>>
  isCollapsed: boolean
  settings: Settings
}

type Row = { guides: string; glyph: string; name: string; live: LoopLive; activity: string; isMain?: boolean; isIdle?: boolean }

const DEFAULT_WINDOW = 200_000
const NARROW = 72
const BAR = 12
const DIM = { dim: true }
const HEADING = { dim: true, bold: true }
const GLYPH: Record<string, string> = { pending: '◌', running: '●', waiting: '◐', idle: '○' }

const seg = (text: string, style: Omit<Seg, 'text'> = {}): Seg => ({ text, ...style })
const healthSeg = (text: string, health: Health): Seg => seg(text, { color: HEALTH_COLOUR[health] })
const percent = (n: number): string => `${Math.round(n)}%`
const total = (parts: [Family, number][]): number => parts.reduce((sum, [, n]) => sum + n, 0)
const shares = (t: FamilyTokens): [Family, number][] => FAMILIES.flatMap(f => (t[f] ? [[f, t[f]] as [Family, number]] : []))
const byFamily = (parts: [Family, number][]): [string, number][] => parts.map(([f, n]) => [FAMILY_COLOUR[f], n])
const waiting = (n: number): string | undefined => (n ? `waiting on ${n} agent${n === 1 ? '' : 's'}` : undefined)
const PLAN = 'Plan Limits'
const label = (text: string): Seg => seg(pad(text, PLAN.length + 2), HEADING)
/** Wide enough for every row's key, a long window name and its reset time included. */
const keyWidth = (v: View, narrow: boolean): number => Math.max(narrow ? 16 : 20, ...v.limits.map(w => windowLabel(w.kind).length + 10))
const planHealth = (w: LimitWindow, v: View): Health => healthOf(w.percentUsed, 100, v.settings.warn, v.settings.danger)

/** A bar `pct` full, its filled cells shared among colours by weight. */
function bar(pct: number, cells: number, parts: [string, number][]): Line {
  const filled = Math.max(0, Math.min(cells, Math.round((pct / 100) * cells)))
  const line = apportion(filled, parts).flatMap(([color, n]) => (n ? [seg('▆'.repeat(n), { color })] : []))

  return filled < cells ? [...line, seg('▆'.repeat(cells - filled), DIM)] : line
}

/** Legend items for as many parts as fit in `room` columns. */
function legend(parts: [Family, number][], room: number, lead: string): Line {
  const items = parts.map(([family, n]) => seg(`■ ${familyName(family)} ${percent((n / total(parts)) * 100)}  `, { color: FAMILY_COLOUR[family] }))
  let used = lead.length
  const fits = items.filter(item => (used += item.text.length) <= room)

  return fits.length ? [seg(lead, DIM), ...fits] : []
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
    ...column(c.key, keyWidth(v, narrow)),
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

function planLines(v: View, narrow: boolean): Line[] {
  if (!v.limits.length) return shares(v.sessionTokens).length ? [] : [[label(PLAN), seg('appears after the first reply', DIM)]]

  const kindWidth = Math.max(...v.limits.map(w => windowLabel(w.kind).length)) + 2

  return v.limits.map((w, i) => {
    const health = planHealth(w, v)
    const parts = v.settings.estimate ? shares(v.planSplit[w.kind] ?? {}) : []
    const reset = until(w.resetsAt, v.now)
    const cells: Cells = {
      key: [seg(pad(windowLabel(w.kind), kindWidth)), ...(reset ? [seg(`↻ ${reset}`, DIM)] : [])],
      bar: bar(w.percentUsed, BAR, parts.length ? byFamily(parts) : [[HEALTH_COLOUR[health], 1]]),
      value: healthSeg(percent(w.percentUsed), health),
      detail: w.percentUsed >= 100 ? [seg('limited', { color: HEALTH_COLOUR.bad, bold: true })] : room => legend(parts, room, '≈ '),
    }

    return row(i ? '' : PLAN, cells, v, narrow)
  })
}

function sessionLine(v: View, narrow: boolean): Line {
  const parts = shares(v.sessionTokens)
  const cells: Cells = {
    key: [seg(`${tokens(total(parts))} tok`)],
    model: v.usd === null ? undefined : seg(usd(v.usd)),
    bar: parts.length ? bar(100, BAR, byFamily(parts)) : [],
    detail: room => legend(parts, room, '  '),
  }

  return row('Session', cells, v, narrow)
}

function agentLine(r: Row, v: View, narrow: boolean, heading: string): Line {
  const colour = { color: FAMILY_COLOUR[familyOf(r.live.model)] }
  const model = r.live.model ? modelLabel(r.live.model) : '…'
  const context = contextOf(r.live, v.main, v.settings)
  const warning = context?.health === 'bad' ? [healthSeg(r.isMain ? '⚠ /compact soon · ' : '⚠ compacts soon · ', 'bad')] : []
  const cells: Cells = {
    key: [seg(r.guides, DIM), seg(`${r.glyph} `, r.isIdle ? DIM : colour), seg(r.name, { bold: true })],
    model: seg(narrow ? model.split(' ')[0]! : model, colour),
    bar: context ? bar(context.pct, BAR, [[HEALTH_COLOUR[context.health], 1]]) : [seg('·'.repeat(BAR), DIM)],
    value: context ? healthSeg(percent(context.pct), context.health) : seg('—', DIM),
    detail: [...warning, seg(r.activity, r.isIdle ? DIM : {})],
  }

  return row(heading, cells, v, narrow)
}

function agentLines(v: View, narrow: boolean): Line[] {
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

  return rows.map((r, i) => agentLine(r, v, narrow, i ? '' : 'Agents'))
}

function collapsedLine(v: View): Line {
  const line: Line = []
  if (v.settings.showPlan && v.limits.length) {
    line.push(seg(`${PLAN} `, HEADING))
    v.limits.forEach((w, i) => line.push(seg(`${i ? ' · ' : ''}${windowLabel(w.kind)} `), healthSeg(percent(w.percentUsed), planHealth(w, v))))
    line.push(seg('   '))
  }
  if (v.settings.showSession) {
    line.push(seg('Session ', HEADING), seg(`${tokens(total(shares(v.sessionTokens)))} tok${v.usd === null ? '' : ` ${usd(v.usd)}`}   `))
  }
  if (v.settings.showAgents) {
    const agents = flatten(buildTree(v.roster))
    const hot = agents.filter(({ node }) => contextOf(v.loops[node.id] ?? {}, v.main, v.settings)?.health === 'bad').length
    const main = contextOf(v.main, v.main, v.settings)
    line.push(seg('Agents ', HEADING), seg(`${agents.length + 1} ●`))
    if (hot) line.push(healthSeg(`  ${hot} ⚠`, 'bad'))
    if (main) line.push(seg('  main ', DIM), healthSeg(percent(main.pct), main.health))
  }

  return line
}

export function clipLine(line: Line, columns: number): Line {
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

export function buildLines(v: View): Line[] {
  const narrow = v.width < NARROW
  const { showPlan, showSession, showAgents } = v.settings
  const lines = v.isCollapsed
    ? [collapsedLine(v)]
    : [
        ...(showPlan ? planLines(v, narrow) : []),
        ...(showSession ? [sessionLine(v, narrow)] : []),
        ...(showAgents ? agentLines(v, narrow) : []),
      ]

  return lines.map(line => clipLine(line, v.width)).filter(line => line.length > 0)
}
