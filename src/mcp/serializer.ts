import type { AffordanceMap, VisualUnderstanding } from '../types/index.js';

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

/**
 * Render a VisualUnderstanding to human-readable text for the analyze_visual MCP tool.
 *
 * Local vision models (llava, qwen3-vl) frequently return partial, malformed, or
 * incorrectly-shaped data that doesn't actually satisfy the declared
 * VisualUnderstanding type — e.g. `visualHierarchy: null`, arrays containing
 * `null` entries, or objects missing required string fields. The handler used to
 * crash the MCP server (`MCP error -32000: Connection closed`) on the first call
 * whenever any of those occurred. Every field access below is null-safe so a
 * partial or empty response degrades gracefully instead of taking the whole
 * server down.
 */
export function formatVisualAnalysis(analysis: VisualUnderstanding): string {
  // Cast to unknown-ish so we can defensively poke at fields the declared type
  // says are required but the runtime data may not actually provide.
  const a = analysis as Partial<VisualUnderstanding> & Record<string, unknown>;

  const rawVh = a.visualHierarchy as Partial<{ primaryFocus: string; readingFlow: unknown }> | null | undefined;
  const vh = rawVh && typeof rawVh === 'object' ? rawVh : { primaryFocus: 'unknown', readingFlow: [] };
  const primaryFocus = typeof vh.primaryFocus === 'string' && vh.primaryFocus ? vh.primaryFocus : 'unknown';
  const readingFlow = Array.isArray(vh.readingFlow)
    ? vh.readingFlow.filter((s): s is string => typeof s === 'string')
    : [];

  const safeArr = <T>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x): x is T => x != null && typeof x === 'object') : []);

  const contrastIssues = safeArr<{ element?: unknown; issue?: unknown; estimatedRatio?: unknown }>(a.contrastIssues);
  const spacingIssues = safeArr<{ area?: unknown; issue?: unknown }>(a.spacingIssues);
  const affordanceIssues = safeArr<{ element?: unknown; issue?: unknown }>(a.affordanceIssues);
  const stateIndicators = safeArr<{ type?: unknown; element?: unknown; description?: unknown }>(a.stateIndicators);

  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

  const lines = [
    `Visual Hierarchy: primary focus = "${primaryFocus}", flow = ${readingFlow.join(' → ')}`,
    '',
    `Contrast Issues (${contrastIssues.length}):`,
    ...contrastIssues.map(c => {
      const ratio = typeof c.estimatedRatio === 'string' && c.estimatedRatio ? ` (ratio: ${c.estimatedRatio})` : '';
      return `  - ${str(c.element, '?')}: ${str(c.issue, '?')}${ratio}`;
    }),
    '',
    `Spacing Issues (${spacingIssues.length}):`,
    ...spacingIssues.map(s => `  - ${str(s.area, '?')}: ${str(s.issue, '?')}`),
    '',
    `Affordance Issues (${affordanceIssues.length}):`,
    ...affordanceIssues.map(af => `  - ${str(af.element, '?')}: ${str(af.issue, '?')}`),
    '',
    `State Indicators (${stateIndicators.length}):`,
    ...stateIndicators.map(s => `  - [${str(s.type, '?')}] ${str(s.element, '?')}: ${str(s.description, '?')}`),
    '',
    `Overall: ${str(a.overallAssessment, 'No assessment available')}`,
  ];
  return lines.join('\n');
}
