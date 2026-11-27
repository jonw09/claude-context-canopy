import type { Shell, ShellCall, ShellWatch } from '../types'

/** The tools that run a shell command, either of which can leave it running in the background. */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])

/**
 * What a shell call's result says when its command keeps running: started in
 * the background, or moved there (ctrl+b, or a timeout), with the task's id.
 */
const IN_BACKGROUND = /running in background with ID: ([\w-]+)|moved to the background \(ID: ([\w-]+)\)/

const NOTICE = '<task-notification>'

/** The rows the band reads: a part of what `$.session.messages()` gives. */
export type ShellRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { tool_use_id: string; tool: string; input: Readonly<Record<string, unknown>>; text?: string; isError?: true }[]
  toolResults?: readonly { tool_use_id: string; text: string; isError: boolean }[]
}

export const EMPTY_WATCH: ShellWatch = { calls: [], open: [], ended: [] }

const text = (input: Readonly<Record<string, unknown>>, key: string): string =>
  typeof input[key] === 'string' ? (input[key] as string).replace(/\s+/g, ' ').trim() : ''

/** Whether a tool call runs a shell command, so its result may say the command went on in the background. */
export const isShellCall = (tool: string): boolean => SHELL_TOOLS.has(tool)

/** The tool-use and task ids every task notice in `body` names: what a finished background shell is known by. */
export function finishedIn(body: string): Set<string> {
  const ids = new Set<string>()
  if (!body.includes(NOTICE)) return ids
  for (const [, id] of body.matchAll(/<(?:tool-use-id|task-id)>\s*([^<\s]+)\s*<\//g)) ids.add(id!)

  return ids
}

/** Ends every open shell a notice names, and keeps its id so a later read never brings it back. */
export function endShells(watch: ShellWatch, ids: ReadonlySet<string>): ShellWatch {
  if (!ids.size) return watch
  const done = watch.open.filter(s => ids.has(s.id) || (s.taskId !== undefined && ids.has(s.taskId)))
  if (!done.length) return watch

  return { ...watch, open: watch.open.filter(s => !done.includes(s)), ended: [...watch.ended, ...done.map(s => s.id)].slice(-200) }
}

/** A shell call's answer: the command is a background shell from now, or it ran to its end and is forgotten. */
function answer(watch: ShellWatch, call: ShellCall, result: string, isError: boolean, now: number): ShellWatch {
  const calls = watch.calls.filter(c => c.id !== call.id)
  const match = isError ? null : IN_BACKGROUND.exec(result)
  const isKnown = watch.open.some(s => s.id === call.id) || watch.ended.includes(call.id)
  if (!match || isKnown) return { ...watch, calls }
  const shell: Shell = { ...call, taskId: match[1] ?? match[2], startedAt: now }

  return { ...watch, calls, open: [...watch.open, shell] }
}

/**
 * Takes in the rows of one agent's conversation, oldest first: a shell call it
 * makes, the answer that says the command went on in the background, and the
 * task notice that says it has finished.
 */
export function readShells(watch: ShellWatch, rows: readonly ShellRow[], now: number): ShellWatch {
  let next = watch
  for (const row of rows) {
    if (row.role === 'assistant') {
      for (const use of row.toolUses) {
        if (!isShellCall(use.tool)) continue
        const call: ShellCall = { id: use.tool_use_id, name: text(use.input, 'description'), command: text(use.input, 'command') }
        if (use.text !== undefined) next = answer(next, call, use.text, use.isError === true, now)
        else if (!next.calls.some(c => c.id === call.id)) next = { ...next, calls: [...next.calls, call] }
      }
    } else {
      for (const result of row.toolResults ?? []) {
        const call = next.calls.find(c => c.id === result.tool_use_id)
        if (call) next = answer(next, call, result.text, result.isError, now)
      }
      next = endShells(next, finishedIn(row.text))
    }
  }

  return next
}

/** Whether an agent's conversation is worth reading for its shells: one is running, or a call may yet leave one running. */
export const isWatching = (watch: ShellWatch | undefined): boolean => !!watch && (watch.calls.length > 0 || watch.open.length > 0)
