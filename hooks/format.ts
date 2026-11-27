export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

/** The session's cost, which Claude Code gives in dollars: `$1,082.62`. */
export function money(n: number): string {
  const [whole = '0', fraction = '00'] = n.toFixed(2).split('.')

  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`
}

/** A span of time, to the minute: `38m`, `2h14m`, `4d06h`. */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const two = (n: number): string => String(n).padStart(2, '0')
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h${two(minutes % 60)}m`

  return `${Math.floor(hours / 24)}d${two(hours % 24)}h`
}

/** Time left until `iso`: `38m`, `2h14m`, `4d06h`. */
export function until(iso: string | undefined, now: number): string {
  const ms = iso ? Date.parse(iso) - now : NaN

  return Number.isFinite(ms) ? duration(ms) : ''
}

/** A Claude gateway's spend limit, which Claude Code calls the monthly spend limit. */
export const SPEND = 'spend_limit'

const WINDOW_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', [SPEND]: 'month' }

export const windowLabel = (kind: string): string => WINDOW_LABEL[kind] ?? kind.replace(/_/g, ' ')

export const pad = (text: string, width: number): string => text.slice(0, Math.max(0, width)).padEnd(width)

export function clip(text: string, width: number): string {
  if (text.length <= width) return text

  return width <= 0 ? '' : `${text.slice(0, width - 1)}…`
}

/** What a tool call is doing, in a few words. */
export function describeTool(tool: string, input: Readonly<Record<string, unknown>>): string {
  const text = (key: string): string => (typeof input[key] === 'string' ? (input[key] as string).replace(/\s+/g, ' ').trim() : '')
  const path = (key: string): string => text(key).split('/').filter(Boolean).slice(-2).join('/')

  switch (tool) {
    case 'Bash':
      return `Bash: ${text('command')}`
    case 'Read':
    case 'Edit':
    case 'Write':
      return `${tool} ${path('file_path')}`
    case 'NotebookEdit':
      return `${tool} ${path('notebook_path')}`
    case 'Grep':
      return `Grep "${text('pattern')}"${text('path') ? ` in ${path('path')}` : ''}`
    case 'Glob':
      return `Glob ${text('pattern')}`
    case 'WebFetch':
      return `WebFetch ${/^https?:\/\/([^/]+)/.exec(text('url'))?.[1] ?? text('url')}`
    case 'WebSearch':
      return `WebSearch "${text('query')}"`
    case 'Agent':
    case 'Task':
      return `Agent: ${text('description')}`
    default:
      return tool.startsWith('mcp__') ? tool.split('__').slice(1).join(' ') : tool
  }
}

/** Whether `version` (`2.1.331`, `2.1.331-dev...`) is `least` or later; one it can't read is not. */
export function atLeast(version: string, least: readonly number[]): boolean {
  const parts = version.split(/[.-]/).map(Number)
  const i = least.findIndex((n, j) => parts[j] !== n)

  return i === -1 || (parts[i] ?? NaN) > least[i]!
}
