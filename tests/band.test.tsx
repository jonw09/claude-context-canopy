import type { AgentInfo, CommandRunInput, On, SessionUsage } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'context-canopy',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const USAGE = {
  startedAt: 0,
  context: {
    tokens: 82_000,
    window: 200_000,
    percent: 41,
    breakdown: { autoCompactThreshold: 167_000, isAutoCompactEnabled: true },
  },
  rateLimits: [{ kind: 'five_hour', percentUsed: 48, resetsAt: '2099-01-01T00:00:00Z' }],
  cost: { usd: 1.12 },
} as unknown as SessionUsage

const canopy = (args: string): CommandRunInput => ({
  command: 'canopy',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
})

/** Stands in for the engine beneath the plugin, and starts the session. `usage` may be read afresh on each call. */
function engine(on: On, { usage = USAGE as SessionUsage | (() => SessionUsage), agents = [] as Partial<AgentInfo>[] } = {}) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'canopy' } }))
  on('session.usage', () => ({ value: typeof usage === 'function' ? usage() : usage }))
  on('agent.list', () => ({ value: agents as AgentInfo[] }))
  const clock = mock.clock(on, { now: Date.parse('2026-10-21T10:00:00Z') })
  mock.store(on)

  return clock
}

test('the band shows plan, session and the agent tree on terminal and desktop', async ($, on) => {
  const clock = engine(on, {
    agents: [
      { id: 'r', type: 'reviewer', description: 'Review the billing change', status: 'running' },
      { id: 'x', parentId: 'r', type: 'Explore', description: 'Find callers', status: 'running' },
    ],
  })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // The band polls the agent list each second.
  await clock.advance(1000)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: /48%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Bash: npm test/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /└─/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Find callers/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a tree taller than the band gives way, after a blank row, so the plan line still shows', async ($, on) => {
  const clock = engine(on, {
    agents: Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, type: 'Explore', description: `task ${i}`, status: 'running' })),
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)

  // Eight rows: the margin, session and plan leave five for the tree, main and three agents, then the row for the other nine.
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, maxRows: 8 } })
  expect(await ui.find({ type: 'Text', text: /\+9 more agents/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /48%/ })).toBeDefined()
  expect((await ui.find({ type: 'Box' }))?.props.marginTop).toBe(1)
  await ui.unmount()
})

test('/canopy collapses the band to one line and back', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const collapsed = await $.command.run(canopy(''))
  expect(collapsed).toMatchObject({ text: 'Context Canopy collapsed to one line.' })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Agents / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↻/ })).toBeUndefined()
  await ui.unmount()

  const expanded = await $.command.run(canopy('expand'))
  expect(expanded).toMatchObject({ text: 'Context Canopy expanded.' })
})

test('a survey above the prompt keeps the band out of its way', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('each model request feeds the session split and the agent row', async ($, on) => {
  const clock = engine(on, {
    usage: { ...USAGE, rateLimits: [] },
    agents: [{ id: 'r', type: 'reviewer', description: 'Review', status: 'running' }],
  })
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: 'claude-sonnet-5-5',
        input_tokens: 2_000,
        output_tokens: 1_000,
        cache_read_input_tokens: 150_000,
        cache_creation_input_tokens: 3_000,
      },
    }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1000)
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 3, agentId: 'r' })) {
    // drain the stream
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  // 2k + 1k + 3k + 150k / 10 = 21k
  expect(await ui.find({ type: 'Text', text: /21k tok/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Sonnet 5\.5/ })).toBeDefined()
  // 155k of a 200k window is 78%, and past 90% of the 167k compaction point.
  expect(await ui.find({ type: 'Text', text: /78%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compacts soon/ })).toBeDefined()
  // Sent: 2k + 3k + 150k / 10; received: 1k.
  expect(await ui.find({ type: 'Text', text: /↑20k +↓1k/ })).toBeDefined()
  await ui.unmount()
})

test('/canopy show prints the band as text for hosts that draw nothing', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  const shown = await $.command.run(canopy('show 60'))
  expect(shown.text).toMatch(/^```\nSession .*\nPlan Limits +5h .*48%\nAgents +● main.*\n```$/)
  for (const line of (shown.text ?? '').split('\n')) expect(line.length).toBeLessThanOrEqual(60)
})

test('on a spend limit, the plan line reads month, and the session line keeps its cost', async ($, on) => {
  let usage = { ...USAGE, rateLimits: [{ kind: 'spend_limit', percentUsed: 61, resetsAt: '2099-01-01T00:00:00Z' }] } as SessionUsage
  engine(on, { usage: () => usage })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  usage = { ...usage, rateLimits: [{ kind: 'spend_limit', percentUsed: 64.2, resetsAt: '2099-01-01T00:00:00Z' }], cost: { usd: 18.4 } }
  await $.session.measure({ context: usage.context, rateLimits: usage.rateLimits, cost: usage.cost, changed: ['rateLimits', 'cost'] })

  const shown = (await $.command.run(canopy('show 100'))).text ?? ''
  expect(shown).toMatch(/Plan Limits +month .*64%/)
  expect(shown).toMatch(/Session +0 tok +\$18\.40/)
})

test('the main row shows the active model before the first message, and follows a switch', async ($, on) => {
  let model = 'claude-opus-5-5'
  const clock = engine(on)
  on('session.model', () => ({ value: model }))
  // Requests are served by Haiku, as a fallback would.
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'claude-haiku-5-5', input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(canopy('show 100'))).text).toMatch(/● main +Opus 5\.5 /)

  model = 'claude-sonnet-5-5'
  await clock.advance(1000)
  expect((await $.command.run(canopy('show 100'))).text).toMatch(/● main +Sonnet 5\.5 /)

  // A request served by a fallback model shows that model, and the poll leaves it be.
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model, messageCount: 1 })) {
    // drain the stream
  }
  await clock.advance(1000)
  expect((await $.command.run(canopy('show 100'))).text).toMatch(/● main +Haiku 5\.5 /)
})

test('/clear starts the session figures over, and a resumed session picks its own back up', async ($, on) => {
  const first = Date.parse('2026-10-21T08:00:00Z')
  let usage = { ...USAGE, startedAt: first, rateLimits: [], cost: { usd: 5 } } as SessionUsage
  const clock = engine(on, { usage: () => usage })
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'claude-sonnet-5-5', input_tokens: 20_000, output_tokens: 1_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }
  })
  const show = async (): Promise<string> => (await $.command.run(canopy('show 100'))).text ?? ''
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 })) {
    // drain the stream
  }
  expect(await show()).toMatch(/Session +21k tok +\$5\.00 /)
  expect(await show()).toMatch(/month +≈ \$5\.00 +unlimited/)
  expect(await show()).toMatch(/● main .*↑20k +↓1k/)

  // `/clear`: Claude Code starts a new session and its cost over, and raises no measure event for it.
  usage = { ...usage, startedAt: Date.parse('2026-10-21T10:00:00Z'), cost: { usd: 0 } }
  await clock.advance(1000)
  // The month keeps what the first session cost.
  expect(await show()).toMatch(/month +≈ \$5\.00 +unlimited/)
  expect(await show()).toMatch(/Session +0 tok +\$0\.00/)
  expect(await show()).not.toMatch(/↑20k/)

  // Resuming the first session brings its cost back, and its tokens with it.
  usage = { ...usage, startedAt: first, cost: { usd: 5 } }
  await clock.advance(1000)
  expect(await show()).toMatch(/Session +21k tok +\$5\.00 /)
})

test('/canopy set changes a setting for later sessions, and reset puts the defaults back', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(canopy('set plan off'))).text).toBe('Context Canopy settings: plan off.')
  expect((await $.command.run(canopy('show 80'))).text).not.toMatch(/Plan Limits/)
  expect((await $.command.run(canopy('set amber lots'))).text).toMatch(/^Use \/canopy set/)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(canopy('show 80'))).text).not.toMatch(/Plan Limits/)
  expect((await $.command.run(canopy('reset'))).text).toBe('Context Canopy settings: all defaults.')
  expect((await $.command.run(canopy('show 80'))).text).toMatch(/Plan Limits/)
})
