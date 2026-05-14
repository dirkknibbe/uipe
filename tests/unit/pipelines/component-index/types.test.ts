import { describe, it, expect } from 'vitest';
import type {
  IndexedComponent,
  ComponentIndex,
  ComponentField,
  ClassificationSource,
} from '../../../../src/pipelines/component-index/types.js';
import type { SceneNode } from '../../../../src/types/index.js';

describe('IndexedComponent', () => {
  it('accepts a rules-classified entry', () => {
    const entry: IndexedComponent = {
      signature: '0123456789abcdef',
      classification: 'Button',
      classificationSource: 'rules',
      firstSeen: '2026-05-14T00:00:00Z',
      lastSeen: '2026-05-14T00:00:00Z',
      occurrences: 1,
      domSample: '<button class="primary">Click</button>',
      source: 'first-traversal',
    };
    expect(entry.classificationSource).toBe('rules');
  });

  it('accepts a vlm-classified entry', () => {
    const entry: IndexedComponent = {
      signature: 'abcdef0123456789',
      classification: 'ProductCard',
      classificationSource: 'vlm',
      firstSeen: '2026-05-14T00:00:00Z',
      lastSeen: '2026-05-14T00:00:00Z',
      occurrences: 7,
      domSample: '<div class="card product">…</div>',
      source: 'first-traversal',
    };
    expect(entry.classification).toBe('ProductCard');
  });
});

describe('ComponentIndex', () => {
  it('keys entries by signature', () => {
    const index: ComponentIndex = {
      version: 1,
      origin: 'https://app.example.com',
      entries: {
        '0123456789abcdef': {
          signature: '0123456789abcdef',
          classification: 'Button',
          classificationSource: 'rules',
          firstSeen: '2026-05-14T00:00:00Z',
          lastSeen: '2026-05-14T00:00:00Z',
          occurrences: 1,
          domSample: '',
          source: 'first-traversal',
        },
      },
    };
    expect(index.entries['0123456789abcdef'].classification).toBe('Button');
  });
});

describe('ComponentField', () => {
  it('accepts a resolved variant', () => {
    const f: ComponentField = { name: 'Button', source: 'rules', signature: '0123456789abcdef' };
    expect(f.name).toBe('Button');
  });

  it('accepts a pending variant', () => {
    const f: ComponentField = { name: null, status: 'pending', signature: '0123456789abcdef' };
    expect(f.status).toBe('pending');
  });

  it('source covers rules | vlm | storybook', () => {
    const a: ClassificationSource = 'rules';
    const b: ClassificationSource = 'vlm';
    const c: ClassificationSource = 'storybook';
    expect([a, b, c]).toEqual(['rules', 'vlm', 'storybook']);
  });
});

describe('SceneNode.component', () => {
  it('accepts a SceneNode with a component field', () => {
    const n: Pick<SceneNode, 'id' | 'component'> = {
      id: 'dom-1',
      component: { name: 'Button', source: 'rules', signature: '0123456789abcdef' },
    };
    expect(n.component?.name).toBe('Button');
  });

  it('accepts a SceneNode without a component field', () => {
    const n: Pick<SceneNode, 'id' | 'component'> = { id: 'dom-2' };
    expect(n.component).toBeUndefined();
  });
});
