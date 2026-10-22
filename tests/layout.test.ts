import { describe, expect, test } from 'claude-code/testing'

import { type Line, type View, buildLines, contextOf } from '../hooks/layout'
import { settingsFrom } from '../hooks/settings'

const SETTINGS = settingsFrom({})

const NOW = Date.parse('2026-10-21T10:00:00Z')
const text = (line: Line | undefined): string => (line ?? []).map(s => s.text).join('')

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
  main: { model: 'claude-opus-5-5', tokens: 82_000, window: 200_000, compactAt: 167_000 },
  roster: [],
  loops: {},
  isCollapsed: false,
  settings: SETTINGS,
  ...patch,
})

describe('band layout', () => {
  test('a solo session draws plan, session and the main row', async () => {
    const lines = buildLines(base()).map(text)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^Plan Limits +5h +↻ 2h14m +▆+ +48% +≈ ■ Opus 90% +■ Haiku 10%/)
    expect(lines[1]).toMatch(/^ +7d +↻ 4d06h +▆+ +21%/)
    expect(lines[2]).toMatch(/^Session +184k tok +\$1\.12 /)
    expect(lines[3]).toMatch(/^Agents +● main +Opus 5\.5 .*41% +ready$/)
  })

  test('before the first reply the plan line waits; with no plan it goes', async () => {
    const fresh = buildLines(base({ limits: [], sessionTokens: {} })).map(text)
    expect(fresh[0]).toMatch(/Plan Limits +appears after the first reply/)
    const apiKey = buildLines(base({ limits: [] })).map(text)
    expect(apiKey[0]).toMatch(/^Session/)
  })

  test('a full window says limited', async () => {
    const lines = buildLines(base({ limits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: '2026-10-21T10:38:00Z' }] }))
    expect(text(lines[0])).toMatch(/↻ 38m .* 100% +limited$/)
    expect(lines[0]?.find(s => s.text.includes('limited'))?.color).toBe('error')
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
        r: { model: 'claude-sonnet-5-5', tokens: 155_000, activity: 'Read src/x.ts' },
      },
    })
    const lines = buildLines(v).map(text)
    expect(lines.slice(3)).toHaveLength(4)
    expect(lines[3]).toMatch(/main .*waiting on 1 agent$/)
    expect(lines[4]).toMatch(/└─● planner/)
    expect(lines[5]).toMatch(/  └─● reviewer +Sonnet 5\.5 .*78% +⚠ compacts soon · Read src\/x\.ts/)
    expect(lines[6]).toMatch(/    └─● Explore +… +·+ +— +look around/)
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
    expect(lines.join('\n')).not.toMatch(/▆/)
    expect(lines[0]).toMatch(/5h +↻ 2h14m +48%/)
    expect(lines[3]).toMatch(/main +Opus +41%/)
  })

  test('bars, percentages and details line up down every row', async () => {
    const lines = buildLines(
      base({
        roster: [{ id: 'r', type: 'reviewer', description: 'review', status: 'running' }],
        loops: { r: { model: 'claude-sonnet-5-5', tokens: 120_000, activity: 'Read src/x.ts' } },
      }),
    ).map(text)
    const columns = (pattern: RegExp): number[] => lines.map(line => line.search(pattern)).filter(i => i >= 0)
    expect(new Set(columns(/▆/)).size).toBe(1)
    expect(new Set(columns(/(?<=▆ +)\d+%/)).size).toBe(1)
    expect(new Set(columns(/■/)).size).toBe(1)
    expect(new Set(columns(/≈|waiting|Read /)).size).toBe(1)
  })

  test('collapsed is one line and still flags agents that need compacting', async () => {
    const v = base({
      isCollapsed: true,
      roster: [{ id: 'r', type: 'reviewer', description: 'review', status: 'running' }],
      loops: { r: { model: 'claude-opus-5-5', tokens: 160_000 } },
    })
    const lines = buildLines(v).map(text)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/Plan Limits 5h 48% · 7d 21% +Session 184k tok \$1\.12 +Agents 2 ● +1 ⚠ +main 41%/)
  })

  test('sections can be switched off', async () => {
    const lines = buildLines(base({ settings: { ...SETTINGS, showPlan: false, showSession: false } })).map(text)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^Agents/)
  })
})

test('an agent with no description or name still draws', async () => {
  const v = base({
    roster: [{ id: 'q', type: 'general-purpose', description: undefined as unknown as string, status: 'running' }],
  })
  const lines = buildLines(v).map(text)
  expect(lines[lines.length - 1]).toMatch(/└─● general-purpose/)
})

test('with no limits reported, the plan line stays quiet once Claude has replied', async () => {
  expect(text(buildLines(base({ limits: [] }))[0])).toMatch(/^Session/)
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
  expect(lines[1]).toMatch(/seven day opus  ↻ 1d00h/)
  expect(lines[0]!.indexOf('↻')).toBe(lines[1]!.indexOf('↻'))
})
