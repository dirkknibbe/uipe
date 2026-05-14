import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Indexer } from '../../../../src/pipelines/component-index/indexer.js';
import { Matcher } from '../../../../src/pipelines/component-index/matcher.js';
import { ClassificationQueue } from '../../../../src/pipelines/component-index/queue.js';
import { ComponentIndexStore } from '../../../../src/pipelines/component-index/store.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id, tag: p.tag, role: p.role,
    name: undefined, text: undefined,
    boundingBox: p.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
    attributes: p.attributes ?? {},
    states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
    children: p.children ?? [],
    parent: undefined,
  };
}

describe('Indexer.run', () => {
  it('produces a component map keyed by node id', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      const nodes: StructuralNode[] = [
        mkNode({ id: 'b1', tag: 'button' }),
        mkNode({ id: 'a1', tag: 'a', attributes: { href: '/x' } }),
        mkNode({ id: 'span1', tag: 'span', text: 'hi' }), // does not qualify
      ];

      const map = await indexer.run(nodes, { origin: 'https://x' });

      expect(map.size).toBe(2);
      expect(map.get('b1')).toEqual({ name: 'Button', source: 'rules', signature: expect.stringMatching(/^[0-9a-f]{16}$/) });
      expect(map.get('a1')).toEqual({ name: 'Link', source: 'rules', signature: expect.stringMatching(/^[0-9a-f]{16}$/) });
      expect(map.get('span1')).toBeUndefined();
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('attaches pending field for non-rules misses and enqueues VLM work', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      const nodes: StructuralNode[] = [
        mkNode({ id: 'card', tag: 'div', attributes: { class: 'mystery' }, children: ['inner'], boundingBox: { x: 0, y: 0, width: 200, height: 200 } }),
        mkNode({ id: 'inner', tag: 'p', text: 'content' }),
      ];

      const map = await indexer.run(nodes, { origin: 'https://x' });

      const entry = map.get('card');
      expect(entry).toBeDefined();
      expect(entry!.name).toBeNull();
      expect((entry as any).status).toBe('pending');
      expect(queue.size()).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('exposes runStats() (hits, misses) after a run', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      // Seed the index by running once
      await indexer.run([mkNode({ id: 'b1', tag: 'button' })], { origin: 'https://x' });

      // Re-run — should hit the cache for the same signature
      const stats = await indexer.runAndGetStats([
        mkNode({ id: 'b2', tag: 'button' }),
        mkNode({ id: 'a1', tag: 'a', attributes: { href: '/x' } }),
      ], { origin: 'https://x' });

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('persists rules-tier classifications after a run', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'uipe-ci-'));
    try {
      const store = new ComponentIndexStore({ baseDir: tmp });
      const queue = new ClassificationQueue();
      const matcher = new Matcher({ store, queue });
      const indexer = new Indexer({ matcher });

      await indexer.run([mkNode({ id: 'b1', tag: 'button' })], { origin: 'https://x' });

      const reloaded = await store.load('https://x');
      const entries = Object.values(reloaded.entries);
      expect(entries).toHaveLength(1);
      expect(entries[0].classification).toBe('Button');
      expect(entries[0].classificationSource).toBe('rules');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
