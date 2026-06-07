import { describe, it, expect } from 'vitest';
import { computeSignature } from '../../../../src/pipelines/component-index/fingerprint.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(partial: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: partial.id,
    tag: partial.tag,
    role: partial.role,
    name: undefined,
    text: undefined,
    boundingBox: partial.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: {
      display: 'block', visibility: 'visible', opacity: 1,
      position: 'static', zIndex: 0, overflow: 'visible',
      pointerEvents: 'auto', cursor: 'auto',
    },
    attributes: partial.attributes ?? {},
    states: {
      isVisible: true, isInteractable: false, isDisabled: false,
      isFocused: false, isEditable: false,
    },
    children: partial.children ?? [],
    parent: undefined,
  };
}

describe('computeSignature', () => {
  it('produces a 16-hex-character string', () => {
    const node = mkNode({ id: 'a', tag: 'button' });
    const sig = computeSignature(node, new Map());
    expect(sig).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns the same signature for the same input', () => {
    const node = mkNode({ id: 'a', tag: 'button', attributes: { class: 'primary large' } });
    const map = new Map();
    expect(computeSignature(node, map)).toBe(computeSignature(node, map));
  });

  it('is insensitive to class order', () => {
    const a = mkNode({ id: 'a', tag: 'div', attributes: { class: 'primary large' } });
    const b = mkNode({ id: 'b', tag: 'div', attributes: { class: 'large primary' } });
    expect(computeSignature(a, new Map())).toBe(computeSignature(b, new Map()));
  });

  it('deduplicates classes', () => {
    const a = mkNode({ id: 'a', tag: 'div', attributes: { class: 'foo foo bar' } });
    const b = mkNode({ id: 'b', tag: 'div', attributes: { class: 'foo bar' } });
    expect(computeSignature(a, new Map())).toBe(computeSignature(b, new Map()));
  });

  it('changes when tag changes', () => {
    const a = mkNode({ id: 'a', tag: 'button' });
    const b = mkNode({ id: 'b', tag: 'a' });
    expect(computeSignature(a, new Map())).not.toBe(computeSignature(b, new Map()));
  });

  it('changes when role changes', () => {
    const a = mkNode({ id: 'a', tag: 'div' });
    const b = mkNode({ id: 'b', tag: 'div', role: 'button' });
    expect(computeSignature(a, new Map())).not.toBe(computeSignature(b, new Map()));
  });

  it('incorporates childTagSequence (Card vs Modal)', () => {
    const card = mkNode({ id: 'a', tag: 'div', children: ['h1', 'p'] });
    const modal = mkNode({ id: 'b', tag: 'div', children: ['header', 'section', 'footer'] });
    const map = new Map<string, StructuralNode>([
      ['h1',      mkNode({ id: 'h1',      tag: 'h1' })],
      ['p',       mkNode({ id: 'p',       tag: 'p' })],
      ['header',  mkNode({ id: 'header',  tag: 'header' })],
      ['section', mkNode({ id: 'section', tag: 'section' })],
      ['footer',  mkNode({ id: 'footer',  tag: 'footer' })],
    ]);
    expect(computeSignature(card, map)).not.toBe(computeSignature(modal, map));
  });

  it('child tag order is part of the signature (a different sequence → different hash)', () => {
    const a = mkNode({ id: 'a', tag: 'div', children: ['x', 'y'] });
    const b = mkNode({ id: 'b', tag: 'div', children: ['y', 'x'] });
    const map = new Map<string, StructuralNode>([
      ['x', mkNode({ id: 'x', tag: 'span' })],
      ['y', mkNode({ id: 'y', tag: 'p' })],
    ]);
    expect(computeSignature(a, map)).not.toBe(computeSignature(b, map));
  });

  it('produces distinct signatures across a small fixture (cardinality smoke)', () => {
    const sigs = new Set<string>();
    const cases: Array<Partial<StructuralNode> & { id: string; tag: string }> = [
      { id: '1', tag: 'button' },
      { id: '2', tag: 'a',     attributes: { href: '/x' } },
      { id: '3', tag: 'input', attributes: { type: 'text' } },
      { id: '4', tag: 'div',   attributes: { class: 'card' } },
      { id: '5', tag: 'div',   attributes: { class: 'card primary' } },
      { id: '6', tag: 'div',   role: 'button' },
    ];
    for (const c of cases) {
      sigs.add(computeSignature(mkNode(c), new Map()));
    }
    expect(sigs.size).toBe(cases.length);
  });

  it('treats missing class attribute as empty class list', () => {
    const a = mkNode({ id: 'a', tag: 'div' });
    const b = mkNode({ id: 'b', tag: 'div', attributes: { class: '' } });
    expect(computeSignature(a, new Map())).toBe(computeSignature(b, new Map()));
  });
});
