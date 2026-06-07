import type { ComponentIndexStore } from '../../pipelines/component-index/store.js';
import type { IndexedComponent } from '../../pipelines/component-index/types.js';

export interface ComponentIndexStats {
  totalEntries: number;
  classifiedByRules: number;
  classifiedByVlm: number;
  pendingVlm: number;
  totalObservations: number;
  indexHitRate: number;
}

export interface ComponentIndexResponse {
  origin: string;
  entries: IndexedComponent[];
  stats: ComponentIndexStats;
}

export interface GetComponentIndexArgs {
  origin?: string;
}

export interface GetComponentIndexTool {
  readonly name: 'get_component_index';
  readonly description: string;
  readonly inputSchema: {
    type: 'object';
    properties: { origin: { type: 'string'; description: string } };
    required: never[];
  };
  handler(args: GetComponentIndexArgs): Promise<ComponentIndexResponse>;
}

export interface MakeGetComponentIndexToolOptions {
  store: ComponentIndexStore;
  currentOrigin: () => string;
}

export const makeGetComponentIndexTool = (opts: MakeGetComponentIndexToolOptions): GetComponentIndexTool => ({
  name: 'get_component_index',
  description:
    'Returns the cached component index for the given origin (defaults to the current page origin). Each entry maps a structural signature to a classification (e.g. "Button", "ProductCard") with provenance ("rules" or "vlm"). Use the stats.indexHitRate to track cost reduction: on a familiar app it should approach 1.0.',
  inputSchema: {
    type: 'object',
    properties: { origin: { type: 'string', description: 'Origin URL (defaults to the current page origin)' } },
    required: [],
  },
  async handler(args) {
    const origin = args.origin ?? opts.currentOrigin();
    const index = await opts.store.load(origin);
    const entries = Object.values(index.entries);
    const stats = computeStats(entries);
    return { origin, entries, stats };
  },
});

function computeStats(entries: IndexedComponent[]): ComponentIndexStats {
  let classifiedByRules = 0;
  let classifiedByVlm = 0;
  let totalObservations = 0;
  for (const e of entries) {
    if (e.classificationSource === 'rules') classifiedByRules += 1;
    else if (e.classificationSource === 'vlm') classifiedByVlm += 1;
    totalObservations += e.occurrences;
  }
  const totalEntries = entries.length;
  // pendingVlm represents pending-this-instant — the store does not persist
  // pending stubs (per spec "cold-path persistence semantics"), so it is
  // always 0 in the persisted index. The field is kept for forward compat.
  const pendingVlm = 0;
  // indexHitRate: observations beyond the first per signature divided by total.
  // First-encounter = 1 observation per signature is a "miss" for hit-rate
  // accounting; subsequent observations of the same signature are "hits."
  const indexHitRate = totalObservations === 0
    ? 0
    : Math.max(0, totalObservations - totalEntries) / totalObservations;
  return { totalEntries, classifiedByRules, classifiedByVlm, pendingVlm, totalObservations, indexHitRate };
}
