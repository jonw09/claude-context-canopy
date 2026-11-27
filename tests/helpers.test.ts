import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow } from '../types'
import { billingFrom } from '../hooks/billing'
import { atLeast, clip, describeTool, duration, money, tokens, until, windowLabel } from '../hooks/format'
import { keepSessions, merge, splitFor, weigh } from '../hooks/estimate'
import { familyOf, healthOf, modelLabel } from '../hooks/palette'
import { overrideFrom, overridesFrom, settingsFrom } from '../hooks/settings'
import { EMPTY_WATCH, type ShellRow, endShells, finishedIn, isWatching, readShells } from '../hooks/shells'
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
  test('atLeast reads a Claude Code version, and takes one it cannot read as too old', async () => {
    expect(atLeast('2.1.331', [2, 1, 331])).toBe(true)
    expect(atLeast('2.1.332', [2, 1, 331])).toBe(true)
    expect(atLeast('2.2.0', [2, 1, 331])).toBe(true)
    expect(atLeast('2.1.331-dev.20261120.t101500.sha1a2b3c4', [2, 1, 331])).toBe(true)
    expect(atLeast('2.1.330', [2, 1, 331])).toBe(false)
    expect(atLeast('2.1.309', [2, 1, 331])).toBe(false)
    expect(atLeast('2.1', [2, 1, 331])).toBe(false)
    expect(atLeast('unknown', [2, 1, 331])).toBe(false)
  })

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

describe('money', () => {
  test('the session cost, in dollars with the cents', async () => {
    expect(money(0)).toBe('$0.00')
    expect(money(4.5)).toBe('$4.50')
    expect(money(1082.62)).toBe('$1,082.62')
    expect(money(1234567.8)).toBe('$1,234,567.80')
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
      showShells: true,
      estimate: true,
    })
  })

  test('red is kept above amber, and both inside 1 to 100', async () => {
    expect(settingsFrom({ amber: 80, red: 50 })).toMatchObject({ warn: 0.8, danger: 0.81 })
    expect(settingsFrom({ amber: 0, red: 500 })).toMatchObject({ warn: 0.01, danger: 1 })
  })

  test('switches are read as given', async () => {
    expect(settingsFrom({ plan: false, split: false, shells: false })).toMatchObject({ showPlan: false, estimate: false, showShells: false })
  })

  test('/canopy set reads percentages and switches, and nothing else', async () => {
    expect(overrideFrom('amber', '70')).toEqual({ amber: 70 })
    expect(overrideFrom('split', 'off')).toEqual({ split: false })
    expect(overrideFrom('shells', 'off')).toEqual({ shells: false })
    // The spend switch went with the spend request.
    expect(overrideFrom('spend', 'off')).toBeUndefined()
    expect(overrideFrom('amber', 'lots')).toBeUndefined()
    expect(overrideFrom('colour', 'on')).toBeUndefined()
  })

  test('saved settings keep what this version has, and drop the rest', async () => {
    expect(overridesFrom({ amber: 70, red: 95, plan: false, session: true, agents: false, shells: false, split: false })).toEqual({
      amber: 70,
      red: 95,
      plan: false,
      session: true,
      agents: false,
      shells: false,
      split: false,
    })
    // An earlier version saved `spend`; a value of the wrong kind is dropped too.
    expect(overridesFrom({ spend: false, amber: '70', plan: 'off' })).toEqual({})
    expect(overridesFrom(undefined)).toEqual({})
    expect(overridesFrom(null)).toEqual({})
    expect(overridesFrom('settings')).toEqual({})
  })
})

describe('billing', () => {
  test("the welcome logo's plan line, read for the plan row", async () => {
    expect(billingFrom('Claude Enterprise')).toEqual({ name: 'Enterprise', note: 'see /usage' })
    expect(billingFrom('Claude Max')).toEqual({ name: 'Max', note: 'see /usage' })
    // An organisation may name its plan itself.
    expect(billingFrom('Claude Acme Engineering')).toEqual({ name: 'Acme Engineering', note: 'see /usage' })
    expect(billingFrom('API Usage Billing')).toEqual({ name: 'API key', note: 'no plan limit' })
    expect(billingFrom('Google Vertex AI')).toEqual({ name: 'Google Vertex AI', note: 'no plan limit' })
    expect(billingFrom('Claude Platform on AWS')).toEqual({ name: 'Platform on AWS', note: 'no plan limit' })
    expect(billingFrom('Amazon Bedrock (Mantle)')).toEqual({ name: 'Amazon Bedrock (…', note: 'no plan limit' })
    expect(billingFrom('Cloud gateway')).toEqual({ name: 'Cloud gateway', note: 'not reported' })
  })

  test('no line, an empty one, or a plan the logo does not know gives nothing to go by', async () => {
    for (const line of [undefined, null, '', '   ', 'Claude API']) expect(billingFrom(line)).toBeUndefined()
  })
})

describe('shells', () => {
  const NOW = Date.parse('2026-10-21T10:00:00Z')
  const call = (id: string, input: Record<string, unknown>, result?: string): ShellRow => ({
    role: 'assistant',
    text: '',
    toolUses: [{ tool_use_id: id, tool: 'Bash', input, ...(result === undefined ? {} : { text: result }) }],
  })
  const answer = (id: string, text: string, isError = false): ShellRow => ({ role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: id, text, isError }] })
  const notice = (body: string): ShellRow => ({ role: 'user', text: `<system-reminder>\n<task-notification>\n${body}\n</task-notification>\n</system-reminder>`, toolUses: [] })
  const STARTED = 'Command running in background with ID: b7k2. Output is being written to: /tmp/b7k2.output.'

  test('a call whose answer says it runs in the background becomes a shell, with its words, command and task id', async () => {
    const asked = readShells(EMPTY_WATCH, [call('u1', { command: 'npm  run dev', description: 'Start dev server', run_in_background: true })], NOW)
    expect(asked.open).toEqual([])
    expect(isWatching(asked)).toBe(true)
    const running = readShells(asked, [answer('u1', STARTED)], NOW + 1000)
    expect(running.open).toEqual([{ id: 'u1', name: 'Start dev server', command: 'npm run dev', taskId: 'b7k2', startedAt: NOW + 1000 }])
    expect(running.calls).toEqual([])
  })

  test('the answer may already be on the call, and a command moved to the background counts too', async () => {
    const moved = 'Command did not complete within its 120s timeout and was moved to the background (ID: c9). Output is being written to: /tmp/c9.'
    expect(readShells(EMPTY_WATCH, [call('u2', { command: 'make' }, moved)], NOW).open).toEqual([{ id: 'u2', name: '', command: 'make', taskId: 'c9', startedAt: NOW }])
  })

  test('a command that ran to its end, or failed, is forgotten', async () => {
    const watch = readShells(EMPTY_WATCH, [call('u3', { command: 'npm test' }), answer('u3', 'All 12 tests passed')], NOW)
    expect(watch).toEqual(EMPTY_WATCH)
    expect(isWatching(watch)).toBe(false)
    expect(readShells(EMPTY_WATCH, [call('u4', { command: 'npm run dev', run_in_background: true }), answer('u4', STARTED, true)], NOW).open).toEqual([])
  })

  test('a task notice ends the shell it names, by tool use or task id, and a later read never brings it back', async () => {
    const running = readShells(EMPTY_WATCH, [call('u1', { command: 'npm run dev' }), answer('u1', STARTED), call('u5', { command: 'sleep 99' }), answer('u5', 'Command running in background with ID: z1.')], NOW)
    expect(running.open.map(s => s.id)).toEqual(['u1', 'u5'])
    const one = readShells(running, [notice('<task-id>b7k2</task-id>\n<status>completed</status>')], NOW)
    expect(one.open.map(s => s.id)).toEqual(['u5'])
    const both = readShells(one, [notice('<task-id>other</task-id>\n<tool-use-id>u5</tool-use-id>\n<status>killed</status>')], NOW)
    expect(both.open).toEqual([])
    expect(both.ended).toEqual(['u1', 'u5'])
    // Read again from the newest rows, the start is seen once more and stays ended.
    expect(readShells(both, [call('u1', { command: 'npm run dev' }, STARTED)], NOW).open).toEqual([])
  })

  test("tags outside a notice, a person's prompt for one, end nothing", async () => {
    expect(finishedIn('look at <task-id>b7k2</task-id>')).toEqual(new Set())
    expect(finishedIn('<task-notification><task-id> b7k2 </task-id><tool-use-id>u1</tool-use-id></task-notification>')).toEqual(new Set(['b7k2', 'u1']))
    const running = readShells(EMPTY_WATCH, [call('u1', { command: 'npm run dev' }, STARTED)], NOW)
    expect(endShells(running, new Set(['nope']))).toBe(running)
  })

  test('other tools and the rows around them are passed over', async () => {
    const rows: ShellRow[] = [
      { role: 'user', text: 'run the dev server please', toolUses: [] },
      { role: 'assistant', text: 'Sure', toolUses: [{ tool_use_id: 'r1', tool: 'Read', input: { file_path: 'a.ts' }, text: STARTED }] },
    ]
    expect(readShells(EMPTY_WATCH, rows, NOW)).toEqual(EMPTY_WATCH)
  })

  test('how long a shell has run', async () => {
    expect(duration(0)).toBe('0m')
    expect(duration(74 * 60_000)).toBe('1h14m')
    expect(duration(50 * 3_600_000)).toBe('2d02h')
  })
})
