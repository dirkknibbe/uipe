import { describe, it, expect, vi } from 'vitest';
import { Matcher } from '../../../../src/pipelines/component-index/matcher.js';
import { ClassificationQueue } from '../../../../src/pipelines/component-index/queue.js';
import type { ComponentIndex, IndexedComponent } from '../../../../src/pipelines/component-index/types.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id,
    tag: p.tag,
    role: p.role,
    name: undefined,
    text: undefined,
    boundingBox: p.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: { display: 'block', visibility: 'visible', opacity: 1, position: 'static', zIndex: 0, overflow: 'visible', pointerEvents: 'auto', cursor: 'auto' },
    attributes: p.attributes ?? {},
    states: { isVisible: true, isInteractable: false, isDisabled: false, isFocused: false, isEditable: false },
    children: p.children ?? [],
    parent: undefined,
  };
}

function mkEntry(sig: string, classification: string, source: 'rules' | 'vlm' = 'rules'): IndexedComponent {
  return {
    signature: sig, classification, classificationSource: source,
    firstSeen: '2026-05-14T00:00:00Z', lastSeen: '2026-05-14T00:00:00Z',
    occurrences: 1, domSample: '', source: 'first-traversal',
  };
}

function mkStore(initial: ComponentIndex) {
  const state = { value: structuredClone(initial) };
  return {
    state,
    load: vi.fn(async () => structuredClone(state.value)),
    save: vi.fn(async (_: string, idx: ComponentIndex) => { state.value = structuredClone(idx); return true; }),
    pathFor: vi.fn(() => '/tmp/x.json'),
  };
}

describe('Matcher.lookup', () => {
  const origin = 'https://app.example.com';

  it('returns cached classification on hit', async () => {
    const store = mkStore({ version: 1, origin, entries: { '01234567': mkEntry('01234567', 'Button') } });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    const result = m.lookup({
      node: mkNode({ id: 'a', tag: 'button' }),
      signature: '01234567',
      origin,
    });
    expect(result).toEqual({ name: 'Button', source: 'rules', signature: '01234567' });
    expect(queue.size()).toBe(0);
  });

  it('rules-classifiable miss queues a persist and returns rules result', async () => {
    const store = mkStore({ version: 1, origin, entries: {} });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    const result = m.lookup({
      node: mkNode({ id: 'a', tag: 'button' }),
      signature: '01234567',
      origin,
    });
    expect(result).toEqual({ name: 'Button', source: 'rules', signature: '01234567' });
    await m.endRun(origin);
    expect(store.save).toHaveBeenCalledTimes(1);
    const saved: ComponentIndex = store.save.mock.calls[0][1];
    expect(saved.entries['01234567'].classification).toBe('Button');
    expect(saved.entries['01234567'].classificationSource).toBe('rules');
    expect(queue.size()).toBe(0);
  });

  it('non-rules miss returns pending and enqueues to VLM', async () => {
    const store = mkStore({ version: 1, origin, entries: {} });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    const result = m.lookup({
      node: mkNode({ id: 'a', tag: 'div', attributes: { class: 'mystery' }, children: ['x'] }),
      signature: 'aaaa1111',
      origin,
    });
    expect(result).toEqual({ name: null, status: 'pending', signature: 'aaaa1111' });
    expect(queue.size()).toBe(1);
    await m.endRun(origin);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('increments occurrences + lastSeen on cache hits during endRun', async () => {
    const store = mkStore({ version: 1, origin, entries: { '01234567': { ...mkEntry('01234567', 'Button'), occurrences: 1, lastSeen: '2020-01-01T00:00:00Z' } } });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    m.lookup({ node: mkNode({ id: 'a', tag: 'button' }), signature: '01234567', origin });
    m.lookup({ node: mkNode({ id: 'b', tag: 'button' }), signature: '01234567', origin });
    await m.endRun(origin);
    const saved: ComponentIndex = store.save.mock.calls[0][1];
    expect(saved.entries['01234567'].occurrences).toBe(3);
    expect(saved.entries['01234567'].lastSeen).not.toBe('2020-01-01T00:00:00Z');
  });

  it('hit/miss counters track index hit rate for the current run', async () => {
    const store = mkStore({ version: 1, origin, entries: { '01234567': mkEntry('01234567', 'Button') } });
    const queue = new ClassificationQueue();
    const m = new Matcher({ store: store as any, queue });
    await m.beginRun(origin);
    m.lookup({ node: mkNode({ id: 'a', tag: 'button' }), signature: '01234567', origin });        // hit
    m.lookup({ node: mkNode({ id: 'b', tag: 'button' }), signature: 'newnewxx', origin });         // miss (rules)
    m.lookup({ node: mkNode({ id: 'c', tag: 'div', attributes: { class: 'x' }, children: ['z'] }), signature: 'unknownx', origin }); // miss (vlm)
    expect(m.runStats()).toEqual({ hits: 1, misses: 2 });
  });
});
