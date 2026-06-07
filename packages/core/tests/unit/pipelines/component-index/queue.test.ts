import { describe, it, expect, vi } from 'vitest';

// Mock sharp before importing queue so cropToBbox just passes the buffer through.
vi.mock('sharp', () => {
  const sharpMock = vi.fn(() => ({
    extract: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  }));
  return { default: sharpMock };
});

import { ClassificationQueue } from '../../../../src/pipelines/component-index/queue.js';
import type { ComponentIndex } from '../../../../src/pipelines/component-index/types.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function mkStore(initial: ComponentIndex) {
  const state = { value: structuredClone(initial) };
  return {
    state,
    load: vi.fn(async () => structuredClone(state.value)),
    save: vi.fn(async (_: string, idx: ComponentIndex) => { state.value = structuredClone(idx); return true; }),
  };
}

describe('ClassificationQueue', () => {
  it('enqueue stores pending work keyed by signature', () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 10, h: 10 } });
    expect(q.size()).toBe(1);
  });

  it('enqueue deduplicates the same signature for the same origin', () => {
    const q = new ClassificationQueue();
    const item = { origin: 'https://x', signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 10, h: 10 } };
    q.enqueue(item);
    q.enqueue(item);
    expect(q.size()).toBe(1);
  });

  it('drainOnce classifies each pending item and persists via store', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<button/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'CustomButton');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({
      classifier,
      screenshotProvider: screenshot,
      store: store as any,
    });

    expect(classifier).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
    const savedIndex: ComponentIndex = store.save.mock.calls[0][1];
    expect(savedIndex.entries['aaaa']?.classification).toBe('CustomButton');
    expect(savedIndex.entries['aaaa']?.classificationSource).toBe('vlm');
    expect(q.size()).toBe(0);
  });

  it('drainOnce persists Unknown when classifier returns Unknown (terminal)', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<div/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'Unknown');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save.mock.calls[0][1].entries['aaaa']?.classification).toBe('Unknown');
  });

  it('drainOnce groups multiple items by origin (one load+save per origin)', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<a/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });
    q.enqueue({ origin: 'https://x', signature: 'bbbb', html: '<b/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'Tag');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });

    expect(classifier).toHaveBeenCalledTimes(2);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('drainOnce is idempotent when there is no pending work', async () => {
    const q = new ClassificationQueue();
    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn(async () => 'X');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });
    expect(classifier).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('drainOnce continues past a classifier error (logs and skips)', async () => {
    const q = new ClassificationQueue();
    q.enqueue({ origin: 'https://x', signature: 'aaaa', html: '<a/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });
    q.enqueue({ origin: 'https://x', signature: 'bbbb', html: '<b/>', bbox: { x: 0, y: 0, w: 50, h: 30 } });

    const store = mkStore({ version: 1, origin: 'https://x', entries: {} });
    const classifier = vi.fn()
      .mockImplementationOnce(async () => { throw new Error('boom'); })
      .mockImplementationOnce(async () => 'GoodOne');
    const screenshot = vi.fn(async () => PNG);

    await q.drainOnce({ classifier, screenshotProvider: screenshot, store: store as any });

    expect(classifier).toHaveBeenCalledTimes(2);
    const saved: ComponentIndex = store.save.mock.calls[0][1];
    expect(saved.entries['bbbb']?.classification).toBe('GoodOne');
    expect(saved.entries['aaaa']).toBeUndefined();
  });
});
