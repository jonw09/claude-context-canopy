import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { apportion, clip, describeTool, tokens, until, windowLabel } from '../hooks/format'
import { keepSessions, merge, monthSpend, splitFor, weigh } from '../hooks/estimate'
import { familyOf, healthOf, modelLabel } from '../hooks/palette'
import { overrideFrom, settingsFrom } from '../hooks/settings'
import { buildTree, flatten } from '../hooks/tree'

const agent = (id: string, parentId?: string, status = 'running'): AgentRow => ({
  id,
  parentId,
  type: 'general-purpose',
  name: id,
  description: `task ${id}`,
  status,
})

describe('tree', () => {
  test('nests five levels deep with the right guides', async () => {
    const rows = [agent('a'), agent('b', 'a'), agent('c', 'b'), agent('d', 'c'), agent('e', 'd'), agent('f')]
    const flat = flatten(buildTree(rows))
    expect(flat.map(r => `${r.guides}${r.node.id}`)).toEqual([
      '├─a',
      '│ └─b',
      '│   └─c',
      '│     └─d',
      '│       └─e',
      '└─f',
    ])
  })

  test('drops finished agents and lifts their children to the nearest live ancestor', async () => {
    const rows = [agent('a'), agent('b', 'a', 'completed'), agent('c', 'b'), agent('d', 'gone')]
    const flat = flatten(buildTree(rows))
    expect(flat.map(r => r.node.id)).toEqual(['a', 'c', 'd'])
    expect(flat[1]?.guides).toBe('│ └─')
  })

  test('an empty roster gives an empty tree', async () => {
    expect(flatten(buildTree([]))).toEqual([])
  })

  test('a parent loop in the data cannot hang it', async () => {
    const rows = [agent('a', 'b', 'running'), agent('b', 'a', 'completed')]
    expect(flatten(buildTree(rows)).map(r => r.node.id)).toEqual(['a'])
  })
})

describe('format', () => {
  test('tokens', async () => {
    expect(tokens(950)).toBe('950')
    expect(tokens(184_400)).toBe('184k')
    expect(tokens(2_310_000)).toBe('2.31M')
    expect(tokens(12_500_000)).toBe('12.5M')
  })

  test('time until reset', async () => {
    const now = Date.parse('2026-10-21T10:00:00Z')
    expect(until('2026-10-21T10:38:00Z', now)).toBe('38m')
    expect(until('2026-10-21T12:14:00Z', now)).toBe('2h14m')
    expect(until('2026-10-25T16:00:00Z', now)).toBe('4d06h')
    expect(until(undefined, now)).toBe('')
    expect(until('2026-10-21T09:00:00Z', now)).toBe('0m')
  })

  test('window labels, known and new', async () => {
    expect(windowLabel('five_hour')).toBe('5h')
    expect(windowLabel('seven_day')).toBe('7d')
    expect(windowLabel('spend_limit')).toBe('month')
    expect(windowLabel('seven_day_opus')).toBe('seven day opus')
  })

  test('apportion always adds up', async () => {
    const parts = apportion(14, [['opus', 3], ['sonnet', 3], ['haiku', 3]])
    expect(parts.reduce((n, [, v]) => n + v, 0)).toBe(14)
    expect(apportion(0, [['opus', 1]])).toEqual([['opus', 0]])
  })

  test('clip', async () => {
    expect(clip('abcdef', 4)).toBe('abc…')
    expect(clip('abc', 4)).toBe('abc')
  })

  test('tool descriptions', async () => {
    expect(describeTool('Bash', { command: 'npm   test' })).toBe('Bash: npm test')
    expect(describeTool('Read', { file_path: '/repo/src/billing/invoice.ts' })).toBe('Read billing/invoice.ts')
    expect(describeTool('Grep', { pattern: 'aria-', path: '/repo/app' })).toBe('Grep "aria-" in repo/app')
    expect(describeTool('WebFetch', { url: 'docs/page' })).toBe('WebFetch docs/page')
    expect(describeTool('mcp__github__get_me', {})).toBe('github get_me')
    expect(describeTool('Edit', { file_path: '/repo/hooks/tree.ts' })).toBe('Edit hooks/tree.ts')
    expect(describeTool('Glob', { pattern: '**/*.ts' })).toBe('Glob **/*.ts')
    expect(describeTool('WebSearch', { query: 'context rot' })).toBe('WebSearch "context rot"')
    expect(describeTool('Agent', { description: 'Find callers' })).toBe('Agent: Find callers')
  })
})

describe('palette', () => {
  test('families and labels', async () => {
    expect(familyOf('claude-opus-5-5[1m]')).toBe('opus')
    expect(familyOf('claude-haiku-5-5')).toBe('haiku')
    expect(familyOf('gpt-x')).toBe('other')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelLabel('claude-opus-4-20250514')).toBe('Opus 4')
  })

  test('health is measured against the compaction point', async () => {
    expect(healthOf(100_000, 180_000, 0.6, 0.9)).toBe('ok')
    expect(healthOf(110_000, 180_000, 0.6, 0.9)).toBe('warn')
    expect(healthOf(165_000, 180_000, 0.6, 0.9)).toBe('bad')
    expect(healthOf(5, 0, 0.6, 0.9)).toBe('ok')
  })
})

describe('estimate', () => {
  test('cache reads count at a tenth', async () => {
    expect(
      weigh({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000 }),
    ).toBe(260)
  })

  test('a window counts only the hours inside it', async () => {
    const hour = 3_600_000
    const now = 100 * hour
    const log = merge({}, { [String(90 * hour)]: { opus: 10 }, [String(97 * hour)]: { opus: 5, haiku: 5 } }, now)
    const reset = new Date(now + 2 * hour).toISOString()
    expect(splitFor(log, 'five_hour', reset, now)).toEqual({ opus: 5, haiku: 5 })
    expect(splitFor(log, 'seven_day', reset, now)).toEqual({ opus: 15, haiku: 5 })
  })

  test('old hours are pruned', async () => {
    const day = 86_400_000
    const log = merge({ [String(0)]: { opus: 1 } }, {}, 20 * day)
    expect(Object.keys(log)).toEqual([])
  })

  test('sessions are kept for 40 days, and the month sums those seen in it', async () => {
    const day = 86_400_000
    const now = new Date(2026, 9, 21, 12).getTime()
    const record = (usd: number, seenAt: number) => ({ usd, tokens: {}, seenAt })
    const kept = keepSessions({ old: record(9, now - 41 * day), last: record(30, new Date(2026, 8, 30).getTime()) }, { a: record(10, now - day) }, now)
    expect(Object.keys(kept).sort()).toEqual(['a', 'last'])
    expect(monthSpend({ ...kept, b: record(2.5, now), current: record(99, now) }, 'current', now)).toBe(12.5)
  })
})

describe('settings', () => {
  test('defaults fill in what is not set', async () => {
    expect(settingsFrom({})).toEqual({
      warn: 0.6,
      danger: 0.9,
      showPlan: true,
      showSession: true,
      showAgents: true,
      estimate: true,
    })
  })

  test('red is kept above amber, and both inside 1 to 100', async () => {
    expect(settingsFrom({ amber: 80, red: 50 })).toMatchObject({ warn: 0.8, danger: 0.81 })
    expect(settingsFrom({ amber: 0, red: 500 })).toMatchObject({ warn: 0.01, danger: 1 })
  })

  test('switches are read as given', async () => {
    expect(settingsFrom({ plan: false, split: false })).toMatchObject({ showPlan: false, estimate: false })
  })

  test('/canopy set reads percentages and switches, and nothing else', async () => {
    expect(overrideFrom('amber', '70')).toEqual({ amber: 70 })
    expect(overrideFrom('split', 'off')).toEqual({ split: false })
    expect(overrideFrom('amber', 'lots')).toBeUndefined()
    expect(overrideFrom('colour', 'on')).toBeUndefined()
  })
})
