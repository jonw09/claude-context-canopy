import { describe, expect, test } from 'claude-code/testing'

import { type Line, type View, buildLines, contextOf } from '../hooks/layout'
import { settingsFrom } from '../hooks/settings'

const SETTINGS = settingsFrom({})

const NOW = Date.parse('2026-10-21T10:00:00Z')
const text = (line: Line | undefined): string => (line ?? []).map(s => s.text).join('')
/** The line `pattern` matches first, or the one `offset` after it. */
const find = (lines: string[], pattern: RegExp, offset = 0): string => lines[lines.findIndex(line => pattern.test(line)) + offset] ?? ''

const base = (patch: Partial<View> = {}): View => ({
  width: 100,
  now: NOW,
  limits: [
    { kind: 'five_hour', percentUsed: 48, resetsAt: '2026-10-21T12:14:00Z' },
    { kind: 'seven_day', percentUsed: 21, resetsAt: '2026-10-25T16:00:00Z' },
  ],
  planSplit: { five_hour: { opus: 90, haiku: 10 }, seven_day: { opus: 80, haiku: 20 } },
  sessionTokens: { opus: 170_000, haiku: 14_000 },
  usd: 1.12,
  unlimitedMonth: null,
  main: { model: 'claude-opus-5-5', tokens: 82_000, window: 200_000, compactAt: 167_000 },
  roster: [],
  loops: {},
  isCollapsed: false,
  settings: SETTINGS,
  ...patch,
})

describe('band layout', () => {
  test('a solo session draws session, plan, then the main row', async () => {
    const lines = buildLines(base()).map(text)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^Session +184k tok +\$1\.12 /)
    expect(lines[1]).toMatch(/^Plan Limits +5h +↻ 2h14m +▆+ +48% +≈ ■ Opus 90% +■ Haiku 10%/)
    expect(lines[2]).toMatch(/^ +7d +↻ 4d06h +▆+ +21%/)
    expect(lines[3]).toMatch(/^Agents +● main +Opus 5\.5 .*41% +↑0 +↓0 +ready$/)
  })

  test('before the first reply the plan line waits; with no plan it goes', async () => {
    const fresh = buildLines(base({ limits: [], sessionTokens: {} })).map(text)
    expect(fresh[1]).toMatch(/^Plan Limits +appears after the first reply/)
    expect(buildLines(base({ limits: [] })).map(text).join('\n')).not.toMatch(/Plan Limits/)
  })

  test('a full window says limited', async () => {
    const lines = buildLines(base({ limits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-21T10:38:00Z' }] }))
    const full = lines.find(line => text(line).startsWith('Plan Limits'))
    expect(text(full)).toMatch(/↻ 38m .* 100% +limited$/)
    expect(full?.find(s => s.text.includes('limited'))?.color).toBe('error')
  })

  test('nested agents, with health tied to the compaction point', async () => {
    const v = base({
      roster: [
        { id: 'p', type: 'Plan', name: 'planner', description: 'plan', status: 'running' },
        { id: 'r', parentId: 'p', type: 'reviewer', description: 'review', status: 'running' },
        { id: 'x', parentId: 'r', type: 'Explore', description: 'look around', status: 'running' },
        { id: 'd', parentId: 'p', type: 'Explore', description: 'done one', status: 'completed' },
      ],
      loops: {
        p: { model: 'claude-opus-5-5', tokens: 50_000 },
        // 155k of a 200k window, against a compaction point of 167k: past 90%.
        r: { model: 'claude-sonnet-5-5', tokens: 155_000, sent: 412_300, received: 8_900, activity: 'Read src/x.ts' },
      },
    })
    const lines = buildLines(v).map(text).slice(3)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/main .*waiting on 1 agent$/)
    expect(lines[1]).toMatch(/└─● planner/)
    expect(lines[2]).toMatch(/  └─● reviewer +Sonnet 5\.5 .*78% +⚠ ↑412k  ↓9k +compacts soon · R/)
    expect(lines[3]).toMatch(/    └─● Explore +… +·+ +— +look around/)
    expect(lines.join('\n')).not.toMatch(/done one/)
  })

  test('agent windows follow the model and the main compaction ratio', async () => {
    const main = { model: 'claude-opus-5-5', window: 200_000, compactAt: 160_000 }
    // 600k of a 1M window is 60%, and 75% of the way to an 800k compaction point.
    expect(contextOf({ model: 'claude-opus-5-5[1m]', tokens: 600_000 }, main, SETTINGS)).toEqual({ pct: 60, health: 'warn' })
    // 150k of the assumed 200k window, past 90% of 160k.
    expect(contextOf({ model: 'claude-haiku-5-5', tokens: 150_000 }, main, SETTINGS)).toEqual({ pct: 75, health: 'bad' })
    expect(contextOf({ model: 'claude-haiku-5-5' }, main, SETTINGS)).toBeUndefined()
  })

  test('every line fits the width, narrow or wide', async () => {
    for (const width of [40, 60, 72, 100, 160]) {
      const v = base({
        width,
        roster: [{ id: 'a', type: 'general-purpose', name: 'a-rather-long-agent-name', description: 'x'.repeat(200), status: 'running' }],
      })
      for (const line of buildLines(v)) expect(text(line).length).toBeLessThanOrEqual(width)
    }
  })

  test('narrow drops the bars and keeps the numbers', async () => {
    const lines = buildLines(base({ width: 60 })).map(text)
    expect(lines.join('\n')).not.toMatch(/▆|↑/)
    expect(find(lines, /^Plan Limits/)).toMatch(/5h +↻ 2h14m +48%/)
    expect(find(lines, /main/)).toMatch(/main +Opus +41%/)
  })

  test('bars, percentages and details line up down every row', async () => {
    const lines = buildLines(
      base({
        roster: [{ id: 'r', type: 'reviewer', description: 'review', status: 'running' }],
        loops: { r: { model: 'claude-sonnet-5-5', tokens: 120_000, sent: 1_250_000, received: 31_000, activity: 'Read src/x.ts' } },
      }),
    ).map(text)
    const columns = (pattern: RegExp): number[] => lines.map(line => line.search(pattern)).filter(i => i >= 0)
    expect(new Set(columns(/▆/)).size).toBe(1)
    expect(new Set(columns(/(?<=▆ +)\d+%/)).size).toBe(1)
    expect(new Set(columns(/■/)).size).toBe(1)
    // A gutter holds `≈`; legends and each agent's sent and received counts start two columns on, together,
    // and the agents' activity after those, together too.
    const gutter = columns(/≈/)[0]!
    for (const line of lines) expect(line.slice(gutter, gutter + 3)).toMatch(/^(≈ |  )[■↑ ]/)
    expect(find(lines, /reviewer/)).toMatch(/↑1\.25M ↓31k +Read src\/x\.ts$/)
    expect(new Set(columns(/waiting|Read /)).size).toBe(1)
  })

  test('each model keeps its own slot down every legend, whatever its percentage', async () => {
    const lines = buildLines(
      base({
        planSplit: { five_hour: { opus: 95, sonnet: 5 }, seven_day: { opus: 60, sonnet: 30, haiku: 10 } },
        sessionTokens: { sonnet: 50_000, haiku: 50_000 },
        width: 140,
      }),
    ).map(text)
    for (const name of ['Opus', 'Sonnet', 'Haiku']) {
      expect(new Set(lines.map(line => line.indexOf(`■ ${name}`)).filter(i => i >= 0)).size).toBe(1)
    }
    expect(find(lines, /^Plan Limits/)).toMatch(/■ Opus 95% +■ Sonnet  5%/)
    // The session used no Opus, so its slot is left blank.
    expect(find(lines, /^Session/)).toMatch(/ {3}■ Sonnet 50% +■ Haiku 50%/)
  })

  test('a legend shows every model that fits, the last without a gap after it', async () => {
    const v = base({ width: 104, planSplit: { five_hour: { opus: 58, sonnet: 27, haiku: 15 }, seven_day: {} }, sessionTokens: { opus: 1 } })
    expect(find(buildLines(v).map(text), /^Plan Limits/)).toMatch(/■ Sonnet 27%  ■ Haiku 15%$/)
    expect(find(buildLines({ ...v, width: 103 }).map(text), /^Plan Limits/)).toMatch(/■ Sonnet 27%$/)
  })

  test('collapsed is one line, in the band order, and still flags agents that need compacting', async () => {
    const v = base({
      isCollapsed: true,
      roster: [{ id: 'r', type: 'reviewer', description: 'review', status: 'running' }],
      loops: { r: { model: 'claude-opus-5-5', tokens: 160_000 } },
    })
    const lines = buildLines(v).map(text)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^Session 184k tok \$1\.12 +Plan Limits 5h 48% · 7d 21% +Agents 2 ● +1 ⚠ +main 41%$/)
  })

  test('sections can be switched off', async () => {
    const lines = buildLines(base({ settings: { ...SETTINGS, showPlan: false, showSession: false } })).map(text)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^Agents/)
  })
})

describe('a tree taller than the band', () => {
  const team = (n: number, hot: string[] = []) =>
    base({
      roster: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, type: 'Explore', name: `explorer-${i}`, description: `task ${i}`, status: 'running' })),
      loops: Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, { model: 'claude-haiku-5-5', tokens: hot.includes(`a${i}`) ? 160_000 : 20_000 }])),
    })

  test('is cut to fit, with a row saying how many agents it hides', async () => {
    // Session 1 + plan 2 leaves 7 of 10 rows: main and 5 agents, then the row for the other 3.
    const lines = buildLines({ ...team(8), maxRows: 10 }).map(text)
    expect(lines).toHaveLength(10)
    expect(lines[1]).toMatch(/^Plan Limits +5h/)
    expect(lines[8]).toMatch(/[├└]─● explorer-4/)
    expect(lines[9]).toMatch(/^ +\+3 more agents *$/)
  })

  test('says how many of the hidden agents are near compacting', async () => {
    const lines = buildLines({ ...team(8, ['a6', 'a7', 'a1']), maxRows: 10 }).map(text)
    expect(find(lines, /more agents/)).toMatch(/\+3 more agents +⚠ 2 compact soon$/)
  })

  test('is left whole when it fits, and by /canopy show', async () => {
    expect(buildLines({ ...team(6), maxRows: 10 }).map(text).join('\n')).not.toMatch(/more agent/)
    expect(buildLines(team(30)).map(text).join('\n')).not.toMatch(/more agent/)
  })

  test('keeps main and the row, however little room there is', async () => {
    const lines = buildLines({ ...team(4), maxRows: 3 }).map(text)
    expect(lines[3]).toMatch(/● main/)
    expect(lines[4]).toMatch(/\+4 more agents/)
  })
})

test('on a wide terminal, long agent names take up to half as many columns again', async () => {
  const roster = [
    { id: 'p', type: 'Plan', name: 'migration-planner', description: 'plan', status: 'running' },
    { id: 'r', parentId: 'p', type: 'general-purpose', name: 'billing-invoice-review', description: 'review', status: 'running' },
  ]
  const at = (width: number, names = roster) => buildLines(base({ width, roster: names })).map(text)
  const bar = (lines: string[]) => find(lines, /^Plan Limits/).search(/▆/)
  const wide = at(140)
  expect(find(wide, /billing/)).toMatch(/  └─● billing-invoice-review +… /)
  // The column grows only as far as the names need, and every row's bar moves with it.
  expect(new Set(wide.map(line => line.search(/▆|·{12}/)).filter(i => i >= 0)).size).toBe(1)
  expect(bar(wide)).toBeGreaterThan(bar(at(100)))
  // Short names leave it as it was; below 120 columns long ones are cut as before.
  expect(bar(at(140, [{ ...roster[0]!, name: 'planner' }]))).toBe(bar(at(100)))
  expect(find(at(100), /billing/)).toMatch(/billing-invo… +… /)
  // Past half as much again, a name is cut there.
  expect(find(at(160, [{ ...roster[0]!, name: 'x'.repeat(40) }]), /xxx/)).toMatch(/└─● x{24}… +… /)
})

test('an agent with no description or name still draws', async () => {
  const v = base({
    roster: [{ id: 'q', type: 'general-purpose', description: undefined as unknown as string, status: 'running' }],
  })
  expect(buildLines(v).map(text).join('\n')).toMatch(/└─● general-purpose/)
})

test('with no limits reported, the plan line stays quiet once Claude has replied', async () => {
  expect(buildLines(base({ limits: [] })).map(text).join('\n')).not.toMatch(/Plan Limits/)
})

test('a long window name is kept whole, and the reset times still line up', async () => {
  const lines = buildLines(
    base({
      limits: [
        { kind: 'five_hour', percentUsed: 10, resetsAt: '2026-10-21T12:00:00Z' },
        { kind: 'seven_day_opus', percentUsed: 20, resetsAt: '2026-10-22T10:00:00Z' },
      ],
    }),
  ).map(text)
  const first = find(lines, /^Plan Limits/)
  const second = find(lines, /^Plan Limits/, 1)
  expect(second).toMatch(/seven day opus  ↻ 1d00h/)
  expect(first.indexOf('↻')).toBe(second.indexOf('↻'))
})

describe('accounts that spend money', () => {
  const spend = (patch: Partial<View> = {}): View =>
    base({
      limits: [{ kind: 'spend_limit', percentUsed: 64, resetsAt: '2026-10-30T10:00:00Z' }],
      planSplit: { spend_limit: { opus: 70, sonnet: 30 } },
      sessionTokens: { opus: 210_000, sonnet: 80_000 },
      usd: 18.4,
      ...patch,
    })
  const unlimited = (patch: Partial<View> = {}): View => spend({ limits: [], unlimitedMonth: 412.8, ...patch })

  test('a spend limit reads month, and the session line keeps its cost', async () => {
    const lines = buildLines(spend()).map(text)
    expect(lines[0]).toMatch(/^Session +290k tok +\$18\.40 +▆+ +■ Opus 72%/)
    expect(lines[1]).toMatch(/^Plan Limits +month +↻ 9d00h +▆+ +64% +≈ ■ Opus 70% +■ Sonnet 30%/)
    expect(lines).toHaveLength(3)
  })

  test('a month barely begun still shows on its bar', async () => {
    const lines = buildLines(spend({ limits: [{ kind: 'spend_limit', percentUsed: 2, resetsAt: '2026-10-30T10:00:00Z' }], planSplit: {} }))
    const month = lines.find(line => text(line).startsWith('Plan Limits'))
    expect(month?.filter(s => s.text.startsWith('▆') && !s.dim).map(s => s.text).join('')).toBe('▆')
  })

  test('past the limit, the month row says limited', async () => {
    const lines = buildLines(spend({ limits: [{ kind: 'spend_limit', percentUsed: 104, resetsAt: '2026-10-30T10:00:00Z' }] })).map(text)
    expect(find(lines, /^Plan Limits/)).toMatch(/104% +limited$/)
  })

  test('with no limit reported, the month reads unlimited where the bar would be', async () => {
    const lines = buildLines(unlimited()).map(text)
    expect(lines[0]).toMatch(/^Session +290k tok +\$18\.40 +▆+ +■ Opus 72%/)
    expect(lines[1]).toMatch(/^Plan Limits +month +≈ \$412\.80 +unlimited *$/)
    expect(lines[1]!.indexOf('unlimited')).toBe(lines[2]!.search(/▆/))
  })

  test('with no limit reported, narrow and collapsed keep the figures', async () => {
    expect(find(buildLines(unlimited({ width: 60 })).map(text), /^Plan Limits/)).toMatch(/month +≈ \$412\.80 +unlimited/)
    expect(text(buildLines(unlimited({ isCollapsed: true }))[0])).toMatch(/^Session 290k tok \$18\.40 +Plan Limits month ≈ \$412\.80 unlimited +Agents 1 ●/)
  })

  test('before a reply, or once a limit has been seen, no limit is not taken for unlimited', async () => {
    expect(buildLines(spend({ limits: [] })).map(text).join('\n')).not.toMatch(/Plan Limits|unlimited/)
  })

  test('collapsed, it reads the month after the session', async () => {
    expect(text(buildLines(spend({ isCollapsed: true }))[0])).toMatch(/^Session 290k tok \$18\.40 +Plan Limits month 64% +Agents/)
  })

  test('narrow, it keeps every number', async () => {
    expect(find(buildLines(spend({ width: 60 })).map(text), /^Plan Limits/)).toMatch(/month +↻ 9d00h +64%/)
    for (const width of [40, 60, 72, 100, 160]) {
      for (const v of [spend({ width }), unlimited({ width })]) for (const line of buildLines(v)) expect(text(line).length).toBeLessThanOrEqual(width)
    }
  })
})
