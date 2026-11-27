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
  noLimitReported: false,
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
    expect(lines[1]).toMatch(/^Plan Limits +5h +↻ 2h14m +▆+ +48% +≈ *$/)
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
    for (const line of lines) expect(line.slice(gutter, gutter + 3)).toMatch(/^(≈ *$|  [■↑ ])/)
    expect(find(lines, /reviewer/)).toMatch(/↑1\.25M ↓31k +Read src\/x\.ts$/)
    expect(new Set(columns(/waiting|Read /)).size).toBe(1)
  })

  test("a plan bar is split by the models that used it, in the session legend's colours, each cell to one model", async () => {
    const lines = buildLines(base({ planSplit: { five_hour: { opus: 90, haiku: 10 }, seven_day: { opus: 50, sonnet: 30, haiku: 20 } } }))
    const bar = (i: number) => lines[i]!.filter(s => s.text.startsWith('▆')).map(s => [s.text.length, s.dim ? 'dim' : s.color])
    // 48% of 12 cells is 6: Opus 5.4 and Haiku 0.6, rounded by the larger remainder.
    expect(bar(1)).toEqual([[5, '#e879f9'], [1, '#22d3ee'], [6, 'dim']])
    // 21% is 3 cells: Opus 1.5, Sonnet 0.9 and Haiku 0.6, so one each as the remainders fall.
    expect(bar(2)).toEqual([[1, '#e879f9'], [1, '#60a5fa'], [1, '#22d3ee'], [9, 'dim']])
    // The session line's legend is the key to those colours.
    expect(text(lines[0])).toMatch(/■ Opus 92% +■ Haiku  8%/)
  })

  test('with no split to go by, a plan bar is one neutral fill and has no ≈', async () => {
    for (const v of [base({ planSplit: {} }), base({ settings: settingsFrom({ split: false }) })]) {
      const plan = buildLines(v)[1]!
      expect(plan.filter(s => s.text.startsWith('▆') && !s.dim).map(s => s.color)).toEqual(['#9ca3af'])
      expect(text(plan)).not.toMatch(/≈/)
    }
  })

  test('a legend shows every model that fits, the last without a gap after it', async () => {
    const v = base({ width: 0, sessionTokens: { opus: 58, sonnet: 27, haiku: 15 } })
    const session = (width: number) => find(buildLines({ ...v, width }).map(text), /^Session/)
    const all = [...Array(161).keys()].find(width => /Haiku 15%$/.test(session(width)))!
    expect(session(all)).toMatch(/■ Opus 58%  ■ Sonnet 27%  ■ Haiku 15%$/)
    expect(session(all).length).toBe(all)
    expect(session(all - 1)).toMatch(/■ Sonnet 27%$/)
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

describe('accounts with no 5-hour or 7-day window', () => {
  const account = (patch: Partial<View> = {}): View =>
    base({ limits: [], planSplit: {}, sessionTokens: { opus: 210_000, sonnet: 80_000 }, usd: 18.4, ...patch })

  test("a gateway's spend limit, a percentage only, reads month", async () => {
    const lines = buildLines(
      account({ limits: [{ kind: 'spend_limit', percentUsed: 64, resetsAt: '2026-10-30T10:00:00Z' }], planSplit: { spend_limit: { opus: 70, sonnet: 30 } } }),
    ).map(text)
    expect(lines[1]).toMatch(/^Plan Limits +month +↻ 9d00h +▆+ +64% +≈ *$/)
  })

  test('with no limit reported and no plan named, the plan line says not reported alone', async () => {
    const lines = buildLines(account({ noLimitReported: true })).map(text)
    expect(find(lines, /^Plan Limits/)).toMatch(/^Plan Limits  not reported *$/)
    expect(buildLines(base({ noLimitReported: true })).map(text).join('\n')).not.toMatch(/not reported/)
  })

  test('the plan the welcome logo names says where its spend is shown, or that it has no plan limit', async () => {
    const plan = (line: string): string => find(buildLines(account({ noLimitReported: true, plan: line })).map(text), /^Plan Limits/)
    expect(plan('Claude Enterprise')).toMatch(/^Plan Limits  Enterprise +see \/usage *$/)
    expect(plan('Claude Team')).toMatch(/^Plan Limits  Team +see \/usage *$/)
    expect(plan('API Usage Billing')).toMatch(/^Plan Limits  API key +no plan limit *$/)
    expect(plan('Amazon Bedrock')).toMatch(/^Plan Limits  Amazon Bedrock +no plan limit *$/)
    expect(plan('Cloud gateway')).toMatch(/^Plan Limits  Cloud gateway +not reported *$/)
    // A login whose plan the logo doesn't know says no more than no line at all.
    expect(plan('Claude API')).toMatch(/^Plan Limits  not reported *$/)
    // The note sits where a bar would be.
    const lines = buildLines(account({ noLimitReported: true, plan: 'Claude Enterprise' })).map(text)
    expect(find(lines, /^Plan Limits/).indexOf('see /usage')).toBe(find(lines, /^Agents/).search(/▆/))
  })

  test('a long provider name is cut so the grid keeps its columns', async () => {
    const named = buildLines(account({ noLimitReported: true, plan: 'Claude Platform on Google Cloud' })).map(text)
    const plain = buildLines(account({ noLimitReported: true })).map(text)
    expect(find(named, /^Plan Limits/)).toMatch(/^Plan Limits  Platform on Goog… +no plan limit *$/)
    expect(find(named, /^Agents/)).toBe(find(plain, /^Agents/))
  })

  test('with windows reported, the plan named changes nothing', async () => {
    expect(buildLines(base({ plan: 'Claude Max' })).map(text)).toEqual(buildLines(base()).map(text))
  })

  test('before a reply, with nothing reported, there is no plan line', async () => {
    expect(buildLines(account()).map(text).join('\n')).not.toMatch(/Plan Limits|not reported/)
    expect(buildLines(account({ plan: 'Claude Enterprise' })).map(text).join('\n')).not.toMatch(/Plan Limits|Enterprise/)
  })

  test('collapsed, the plan line follows the session', async () => {
    expect(text(buildLines(account({ noLimitReported: true, isCollapsed: true }))[0])).toMatch(/^Session 290k tok \$18\.40 +Plan Limits not reported +Agents/)
    expect(text(buildLines(account({ noLimitReported: true, plan: 'Claude Enterprise', isCollapsed: true }))[0])).toMatch(
      /^Session 290k tok \$18\.40 +Plan Limits Enterprise see \/usage +Agents/,
    )
  })

  test('narrow, the note moves to the detail column and every line fits', async () => {
    expect(find(buildLines(account({ noLimitReported: true, plan: 'Claude Enterprise', width: 60 })).map(text), /^Plan Limits/)).toMatch(/^Plan Limits  Enterprise +see \/usage$/)
    for (const plan of [undefined, 'Claude Enterprise', 'Claude Platform on Google Cloud'])
      for (const width of [40, 60, 72, 100, 160])
        for (const line of buildLines(account({ noLimitReported: true, plan, width }))) expect(text(line).length).toBeLessThanOrEqual(width)
  })
})

describe('shells', () => {
  const ROWS = settingsFrom({ shells: 'rows' })
  const shell = (id: string, name: string, command: string, minutes: number) => ({ id, name, command, startedAt: NOW - minutes * 60_000 })
  const team = (patch: Partial<View> = {}): View =>
    base({
      roster: [
        { id: 'e', type: 'Explore', description: 'look around', status: 'running' },
        { id: 't', type: 'general-purpose', name: 'test-writer', description: 'write tests', status: 'running' },
      ],
      loops: { e: { model: 'claude-haiku-5-5', tokens: 30_000, sent: 30_000, received: 2_000, activity: 'Grep "x"' } },
      shells: {
        main: [shell('1', 'Start dev server', 'npm run dev', 74)],
        t: [shell('2', 'Watch tests', 'npm test -- --watch', 12), shell('3', '', 'tail -f a.log', 3)],
      },
      settings: ROWS,
      ...patch,
    })

  test("each shell sits under the agent that started it, before that agent's own agents, with how long it has run", async () => {
    const lines = buildLines(team()).map(text)
    const tree = lines.slice(lines.findIndex(line => line.startsWith('Agents')))
    expect(tree).toHaveLength(6)
    expect(tree[1]).toMatch(/^ {13}├─\$ Start dev server · npm run dev · 1h14m$/)
    expect(tree[2]).toMatch(/^ +├─● Explore /)
    expect(tree[3]).toMatch(/^ +└─● test-writer /)
    expect(tree[4]).toMatch(/^ {15}├─\$ Watch tests · npm test -- --watch · 12m$/)
    // With no words of its own, a shell goes by its command, said once.
    expect(tree[5]).toMatch(/^ {15}└─\$ tail -f a\.log · 3m$/)
  })

  test('a shell takes the whole row for what it is doing, keeping to none of the columns, and is cut at the edge', async () => {
    const long = shell('4', 'Serve the storybook on port 6006 for the review', 'npx storybook dev --port 6006 --no-open', 5)
    const lines = buildLines(team({ shells: { main: [long] }, width: 100 })).map(text)
    const row = lines.find(line => line.includes('storybook'))!
    expect(row).toMatch(/^ {13}├─\$ Serve the storybook on port 6006 for the review · npx storybook dev --port 6006 --…$/)
    expect(row).toHaveLength(100)
    // The agents' columns stay where they were: a shell never widens the key column.
    expect(find(lines, /Explore/)).toBe(find(buildLines(team({ shells: {}, width: 100 })).map(text), /Explore/))
  })

  test('a shell is dim but its name, and its sign is plain ASCII', async () => {
    const row = buildLines(team()).find(line => text(line).includes('npm run dev'))!
    expect(row.filter(s => s.text.trim() && !s.dim).map(s => s.text.trim())).toEqual(['Start dev server'])
    expect(row.some(s => s.text === '$ ')).toBe(true)
    expect(row.some(s => s.color)).toBe(false)
  })

  test('when the tree runs out of room, shells give way first and the last row counts them', async () => {
    // Seven rows: session and plan take three, so the tree has four.
    const tree = (maxRows: number) => buildLines(team({ maxRows })).map(text).slice(3)
    expect(tree(7)).toEqual([expect.stringMatching(/^Agents +● main/), expect.stringMatching(/Explore/), expect.stringMatching(/test-writer/), expect.stringMatching(/^ +\+3 more shells/)])
    expect(tree(8)).toEqual([
      expect.stringMatching(/^Agents +● main/),
      expect.stringMatching(/Start dev/),
      expect.stringMatching(/Explore/),
      expect.stringMatching(/test-writer/),
      expect.stringMatching(/^ +\+2 more shells/),
    ])
    expect(tree(5)).toEqual([expect.stringMatching(/^Agents +● main/), expect.stringMatching(/^ +\+2 more agents, 3 shells +$/)])
    // All of it fits: nothing is counted.
    expect(tree(20).join('\n')).not.toMatch(/more/)
  })

  test('collapsed, the shells are counted beside the agents', async () => {
    expect(text(buildLines(team({ isCollapsed: true }))[0])).toMatch(/Agents 3 ●  3 \$  main 41%/)
  })

  test('by default each agent counts its shells on its own row, in a column of their own, and the tree keeps its height', async () => {
    const lines = buildLines(team({ settings: SETTINGS, width: 120 })).map(text)
    const tree = lines.slice(lines.findIndex(line => line.startsWith('Agents')))
    expect(tree).toHaveLength(3)
    expect(tree[0]).toMatch(/↑0 +↓0 +\$1  waiting on 2 agents$/)
    expect(tree[1]).toMatch(/↑30k +↓2k +Grep "x"$/)
    expect(tree[2]).toMatch(/ +\$2  write tests$/)
    expect(new Set(tree.map(line => line.search(/waiting on|Grep "|write tests/))).size).toBe(1)
    // With no shell running, the column goes and the activity moves back.
    expect(buildLines(team({ settings: SETTINGS, shells: {} })).map(text).join('\n')).not.toMatch(/\$\d(?!\.)/)
    expect(text(buildLines(team({ settings: SETTINGS, isCollapsed: true }))[0])).toMatch(/Agents 3 ●  3 \$  main/)
    for (const width of [40, 60, 72, 100, 160]) for (const line of buildLines(team({ settings: SETTINGS, width }))) expect(text(line).length).toBeLessThanOrEqual(width)
  })

  test('/canopy set shells off hides them, and the tree is as before', async () => {
    const off = buildLines(team({ settings: settingsFrom({ shells: 'off' }) })).map(text)
    expect(off.join('\n')).not.toMatch(/\$ /)
    expect(off).toEqual(buildLines(team({ shells: {} })).map(text))
    expect(text(buildLines(team({ isCollapsed: true, settings: settingsFrom({ shells: 'off' }) }))[0])).toMatch(/Agents 3 ●  main/)
  })

  test('narrow, a shell keeps its name, command and time, and every line fits', async () => {
    const tree = buildLines(team({ width: 60 })).map(text)
    expect(tree.find(line => line.includes('Watch'))).toMatch(/^ +├─\$ Watch tests · npm test -- --watch · 12m$/)
    for (const width of [40, 60, 72, 100, 120, 160]) for (const line of buildLines(team({ width }))) expect(text(line).length).toBeLessThanOrEqual(width)
  })
})

describe('bars and numbers', () => {
  const v = base({
    roster: [
      { id: 'r', type: 'reviewer', description: 'review', status: 'running' },
      { id: 'x', type: 'Explore', description: 'look', status: 'running' },
    ],
    loops: { r: { model: 'claude-sonnet-5-5', tokens: 120_000 }, x: { model: 'claude-haiku-5-5', tokens: 160_000 } },
  })

  test("an agent's context bar is its health: green, then amber, then red", async () => {
    const lines = buildLines(v)
    const fill = (pattern: RegExp) => lines.find(line => pattern.test(text(line)))!.filter(s => s.text.startsWith('▆') && !s.dim).map(s => s.color)
    expect(fill(/● main/)).toEqual(['success'])
    expect(fill(/reviewer/)).toEqual(['warning'])
    expect(fill(/Explore/)).toEqual(['error'])
  })

  test("the session's bar is whole, split by the models that used it: the key to the plan bars' colours", async () => {
    const session = buildLines(base({ sessionTokens: { opus: 55_000, sonnet: 31_000, haiku: 14_000 }, width: 120 }))[0]!
    // 12 cells: Opus 6.6, Sonnet 3.7 and Haiku 1.7, the two left over to the larger remainders.
    expect(session.filter(s => s.text.startsWith('▆')).map(s => [s.text.length, s.dim ? 'dim' : s.color])).toEqual([
      [6, '#e879f9'],
      [4, '#60a5fa'],
      [2, '#22d3ee'],
    ])
    // Its legend stays, in line with the plan bars, and it has no percentage: a session has no limit.
    expect(text(session)).toMatch(/^Session +100k tok +\$1\.12 +▆{12} +■ Opus 55%  ■ Sonnet 31%  ■ Haiku 14%$/)
    // Before any tokens, no bar.
    expect(text(buildLines(base({ sessionTokens: {} }))[0])).not.toMatch(/▆/)
  })

  test('a number is plain while all is well, and amber or red as it nears its limit', async () => {
    const lines = buildLines(base({ ...v, limits: [{ kind: 'five_hour', percentUsed: 93 }, { kind: 'seven_day', percentUsed: 71 }, { kind: 'extra', percentUsed: 12 }] }))
    const colour = (pattern: RegExp, value: RegExp) => lines.find(line => pattern.test(text(line)))!.find(s => value.test(s.text))?.color
    expect(colour(/5h/, /^93%/)).toBe('error')
    expect(colour(/7d/, /^71%/)).toBe('warning')
    expect(colour(/extra/, /^12%/)).toBeUndefined()
    // Main at 41% of its window is well short of compacting; the reviewer at 60% is past 60% of the way; Explore at 80% is past 90%.
    expect(colour(/● main/, /^41%/)).toBeUndefined()
    expect(colour(/reviewer/, /^60%/)).toBe('warning')
    expect(colour(/Explore/, /^80%/)).toBe('error')
  })
})
