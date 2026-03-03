import type { SceneGraph, SceneNode, SceneGraphDiff, NodeModification } from '../../types/index.js';

// Fields compared for modification detection
const COMPARED_FIELDS: (keyof SceneNode)[] = [
  'text', 'value', 'isDisabled', 'isFocused', 'isLoading',
  'visualState', 'interactionType', 'visibilityPercent', 'viewportPosition',
];

export function diffGraphs(prev: SceneGraph, next: SceneGraph): SceneGraphDiff {
  const prevMap = new Map(prev.nodes.map(n => [n.id, n]));
  const nextMap = new Map(next.nodes.map(n => [n.id, n]));

  const added: SceneNode[] = [];
  const removed: SceneNode[] = [];
  const modified: NodeModification[] = [];
  const stable: string[] = [];

  for (const [id, node] of nextMap) {
    if (!prevMap.has(id)) added.push(node);
  }

  for (const [id, prevNode] of prevMap) {
    const nextNode = nextMap.get(id);
    if (!nextNode) {
      removed.push(prevNode);
    } else {
      const changes = detectChanges(prevNode, nextNode);
      if (changes.length > 0) {
        modified.push({ nodeId: id, changes });
      } else {
        stable.push(id);
      }
    }
  }

  return { added, removed, modified, stable };
}

function detectChanges(prev: SceneNode, next: SceneNode): NodeModification['changes'] {
  const changes: NodeModification['changes'] = [];
  for (const field of COMPARED_FIELDS) {
    const from = prev[field];
    const to = next[field];
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}
