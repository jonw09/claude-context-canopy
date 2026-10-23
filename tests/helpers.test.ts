import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { clip, describeTool, money, tokens, until, windowLabel } from '../hooks/format'
import { keepSessions, merge, splitFor, weigh } from '../hooks/estimate'
import { familyOf, healthOf, modelLabel } from '../hooks/palette'
import { overrideFrom, settingsFrom } from '../hooks/settings'
import { monthEnd, spendFrom } from '../hooks/spend'
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

  test('sessions are kept for 40 days', async () => {
    const day = 86_400_000
    const now = new Date(2026, 9, 21, 12).getTime()
    const record = (seenAt: number) => ({ tokens: {}, seenAt })
    const kept = keepSessions({ old: record(now - 41 * day), last: record(new Date(2026, 8, 30).getTime()) }, { a: record(now - day) }, now)
    expect(Object.keys(kept).sort()).toEqual(['a', 'last'])
  })
})

describe('spend', () => {
  const now = new Date(2026, 9, 23, 12).getTime()
  const reply = (extra: Record<string, unknown> | null) => ({ five_hour: null, seven_day: null, extra_usage: extra })

  test('reads what the usage endpoint reports, in minor units, with no limit as null', async () => {
    expect(spendFrom(reply({ is_enabled: true, monthly_limit: null, used_credits: 108_262, utilization: null }), now)).toEqual({
      spent: 1082.62,
      limit: null,
      percentUsed: null,
      currency: 'USD',
      resetsAt: new Date(2026, 10, 1).toISOString(),
    })
    expect(spendFrom(reply({ is_enabled: true, monthly_limit: 200_000, used_credits: 108_262, utilization: 54.1, currency: 'gbp' }), now)).toMatchObject({
      limit: 2000,
      percentUsed: 54.1,
      currency: 'GBP',
    })
  })

  test('works the percentage out when the reply leaves it out', async () => {
    expect(spendFrom(reply({ is_enabled: true, monthly_limit: 10_000, used_credits: 2_500 }), now)?.percentUsed).toBe(25)
  })

  test('shows nothing for an account without extra usage, or a reply it cannot read', async () => {
    expect(spendFrom(reply({ is_enabled: false, monthly_limit: null, used_credits: 0, utilization: null }), now)).toBeUndefined()
    expect(spendFrom(reply(null), now)).toBeUndefined()
    expect(spendFrom({ extra_usage: { used_credits: 'lots' } }, now)).toBeUndefined()
    expect(spendFrom(null, now)).toBeUndefined()
  })

  test('a limit reached still shows, though extra usage has stopped', async () => {
    expect(spendFrom(reply({ is_enabled: false, monthly_limit: 5_000, used_credits: 5_000, utilization: 100 }), now)?.percentUsed).toBe(100)
  })

  test('money', async () => {
    expect(money(1082.62)).toBe('$1,082.62')
    expect(money(1082.62, 'USD', false)).toBe('$1,083')
    expect(money(2000, 'GBP', false)).toBe('£2,000')
    expect(money(12.5, 'EUR')).toBe('€12.50')
    expect(money(1234567.8, 'AUD')).toBe('AUD 1,234,567.80')
  })

  test('the month ends on the 1st of the next, across a year', async () => {
    expect(monthEnd(new Date(2026, 11, 31, 23).getTime())).toBe(new Date(2027, 0, 1).toISOString())
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
      fetchSpend: true,
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
    expect(overrideFrom('spend', 'off')).toEqual({ spend: false })
    expect(overrideFrom('amber', 'lots')).toBeUndefined()
    expect(overrideFrom('colour', 'on')).toBeUndefined()
  })
})
