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

/** Stands in for the engine beneath the plugin, and starts the session. */
function engine(on: On, { usage = USAGE, agents = [] as Partial<AgentInfo>[] } = {}) {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'canopy' } }))
  on('session.usage', () => ({ value: usage }))
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
  await ui.unmount()
})

test('/canopy show prints the band as text for hosts that draw nothing', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'mobile', isInteractive: true })
  const shown = await $.command.run(canopy('show 60'))
  expect(shown.text).toMatch(/^```\nPlan Limits +5h .*48%/)
  expect(shown.text).toMatch(/Agents +● main/)
  for (const line of (shown.text ?? '').split('\n')) expect(line.length).toBeLessThanOrEqual(60)
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
