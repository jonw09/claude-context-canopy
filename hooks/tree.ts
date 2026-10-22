import type { AgentRow } from '../types'

export type TreeNode = AgentRow & { children: TreeNode[] }

const FINISHED = new Set(['completed', 'failed', 'killed'])

export const isLive = (row: AgentRow): boolean => !FINISHED.has(row.status)

/**
 * Nests live agents under their parents in list order. An agent whose parent
 * has finished moves up to the nearest live ancestor, or to the top level.
 */
export function buildTree(rows: readonly AgentRow[]): TreeNode[] {
  const byId = new Map(rows.map(row => [row.id, row]))
  const nodes = new Map(rows.filter(isLive).map(row => [row.id, { ...row, children: [] as TreeNode[] }]))
  const roots: TreeNode[] = []
  for (const node of nodes.values()) {
    const seen = new Set([node.id])
    let parentId = node.parentId
    while (parentId !== undefined && !nodes.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId
    }
    const parent = parentId === undefined || parentId === node.id ? undefined : nodes.get(parentId)
    ;(parent?.children ?? roots).push(node)
  }

  return roots
}

/** Depth first, each node with its `├─ └─ │` guides. */
export function flatten(roots: readonly TreeNode[], lead = ''): { node: TreeNode; guides: string }[] {
  return roots.flatMap((node, i) => {
    const isLast = i === roots.length - 1

    return [
      { node, guides: lead + (isLast ? '└─' : '├─') },
      ...flatten(node.children, lead + (isLast ? '  ' : '│ ')),
    ]
  })
}
