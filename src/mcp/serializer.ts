import type { AffordanceMap } from '../types/index.js';

const PRIORITY_RANK: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 };

export function affordanceToText(
  map: AffordanceMap,
  minPriority: 'high' | 'medium' | 'low' = 'medium',
): string {
  const minRank = PRIORITY_RANK[minPriority];

  const entries = [...map.values()]
    .filter(a => PRIORITY_RANK[a.priority] <= minRank)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  if (entries.length === 0) {
    return `No affordances at ${minPriority}+ priority.`;
  }

  return entries.map(a => {
    const pred = a.predictions[0]; // MCP view: leading prediction only
    if (!pred) return null;
    let line = `[${a.priority.toUpperCase()}] ${a.nodeId}: ${pred.predictedOutcome} (${pred.action}, confidence=${pred.confidence.toFixed(2)})`;
    if (pred.sideEffects?.length) {
      line += `\n  → side effects: ${pred.sideEffects.join(', ')}`;
    }
    return line;
  }).filter((line): line is string => line !== null).join('\n');
}
