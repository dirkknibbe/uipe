import { createHash } from 'node:crypto';
import type { StructuralNode } from '../../types/index.js';

/**
 * Compute a 16-hex-char structural signature for a DOM node. Inputs joined
 * with '|':
 *   tag | sortedDedupedClasses | childTagSequence | childCount | role
 * Hash: sha256, truncated to first 16 hex chars (64 bits — ample cardinality).
 */
export function computeSignature(node: StructuralNode, nodeMap: ReadonlyMap<string, StructuralNode>): string {
  const tag = node.tag;
  const classes = extractSortedClasses(node);
  const childTags = node.children
    .map((id) => nodeMap.get(id)?.tag ?? '?')
    .join(',');
  const childCount = String(node.children.length);
  const role = node.role ?? '';

  const input = [tag, classes, childTags, childCount, role].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function extractSortedClasses(node: StructuralNode): string {
  const raw = node.attributes['class'];
  if (!raw) return '';
  const parts = raw.split(/\s+/).filter((c) => c.length > 0);
  const deduped = Array.from(new Set(parts));
  deduped.sort();
  return deduped.join(',');
}
