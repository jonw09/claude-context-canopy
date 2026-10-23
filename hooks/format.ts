export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}

export const usd = (n: number): string => `$${n.toFixed(2)}`

/** Time left until `iso`: `38m`, `2h14m`, `4d06h`. */
export function until(iso: string | undefined, now: number): string {
  const ms = iso ? Date.parse(iso) - now : NaN
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const two = (n: number): string => String(n).padStart(2, '0')
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h${two(minutes % 60)}m`

  return `${Math.floor(hours / 24)}d${two(hours % 24)}h`
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

/** Splits `cells` among weighted parts by largest remainder, so they always add up. */
export function apportion<K>(cells: number, parts: readonly (readonly [K, number])[]): [K, number][] {
  const total = parts.reduce((sum, [, n]) => sum + n, 0)
  const exact = parts.map(([k, n]) => [k, total > 0 ? (n / total) * cells : 0] as const)
  const out = exact.map(([k, n]): [K, number] => [k, Math.floor(n)])
  const order = exact.map(([, n], i) => [n % 1, i] as const).sort((a, b) => b[0] - a[0])
  let left = cells - out.reduce((sum, [, n]) => sum + n, 0)
  for (const [, i] of order) if (left-- > 0) out[i]![1] += 1

  return out
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
