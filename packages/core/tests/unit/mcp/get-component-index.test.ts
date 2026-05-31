import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComponentIndexStore } from '../../../src/pipelines/component-index/store.js';
import { makeGetComponentIndexTool } from '../../../src/mcp/tools/get-component-index.js';
import type { ComponentIndex, IndexedComponent } from '../../../src/pipelines/component-index/types.js';

function mkEntry(sig: string, source: 'rules' | 'vlm', occurrences: number): IndexedComponent {
  return {
    signature: sig, classification: 'X', classificationSource: source,
    firstSeen: '2026-05-14T00:00:00Z', lastSeen: '2026-05-14T00:00:00Z',
    occurrences, domSample: '', source: 'first-traversal',
  };
}

describe('get_component_index tool', () => {
  it('returns empty stats for an unseen origin', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const tool = makeGetComponentIndexTool({ store, currentOrigin: () => 'https://x' });
      const result = await tool.handler({});
      expect(result.entries).toEqual([]);
      expect(result.stats.totalEntries).toBe(0);
      expect(result.stats.indexHitRate).toBe(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('computes stats correctly with a mixed index', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const initial: ComponentIndex = {
        version: 1, origin: 'https://x',
        entries: {
          'aaaa': mkEntry('aaaa', 'rules', 5),
          'bbbb': mkEntry('bbbb', 'vlm', 3),
          'cccc': mkEntry('cccc', 'rules', 1),
        },
      };
      await store.save('https://x', initial);

      const tool = makeGetComponentIndexTool({ store, currentOrigin: () => 'https://x' });
      const result = await tool.handler({});

      expect(result.stats.totalEntries).toBe(3);
      expect(result.stats.classifiedByRules).toBe(2);
      expect(result.stats.classifiedByVlm).toBe(1);
      expect(result.stats.totalObservations).toBe(9);
      // Hit-rate: (9 total observations - 3 first-encounters) / 9 = 0.666...
      expect(result.stats.indexHitRate).toBeCloseTo(6 / 9, 5);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('honors an explicit origin argument over the current-origin default', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      await store.save('https://other', { version: 1, origin: 'https://other', entries: { 'zzzz': mkEntry('zzzz', 'rules', 2) } });
      const tool = makeGetComponentIndexTool({ store, currentOrigin: () => 'https://x' });
      const result = await tool.handler({ origin: 'https://other' });
      expect(result.origin).toBe('https://other');
      expect(result.stats.totalEntries).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
