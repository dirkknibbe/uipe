import type { SceneGraph, SceneNode } from '../../types/index.js';

export function toJSON(graph: SceneGraph): string {
  return JSON.stringify(graph, null, 2);
}

export function toCompact(graph: SceneGraph): string {
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const lines: string[] = [];

  function renderNode(node: SceneNode, depth: number): void {
    const indent = '  '.repeat(depth);
    const parts: string[] = [`${node.label}[${node.role}`];
    if (node.interactionType !== 'static') parts[0] += `,${node.interactionType}`;
    if (node.isDisabled) parts[0] += ',disabled';
    parts[0] += ']';
    if (node.text) parts.push(`:"${node.text.slice(0, 40)}"`);
    lines.push(`${indent}${parts.join('')}`);
    for (const childId of node.children) {
      const child = nodeMap.get(childId);
      if (child) renderNode(child, depth + 1);
    }
  }

  for (const rootId of graph.rootNodeIds) {
    const root = nodeMap.get(rootId);
    if (root) renderNode(root, 0);
  }

  return lines.join('\n');
}
