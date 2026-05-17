import { describe, it, expect } from 'vitest';
import { qualifies } from '../../../../src/pipelines/component-index/heuristic.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id,
    tag: p.tag,
    role: p.role,
    name: undefined,
    text: undefined,
    boundingBox: p.boundingBox ?? { x: 0, y: 0, width: 100, height: 50 },
    computedStyle: {
      display: 'block', visibility: 'visible', opacity: 1,
      position: 'static', zIndex: 0, overflow: 'visible',
      pointerEvents: 'auto', cursor: 'auto',
    },
    attributes: p.attributes ?? {},
    states: {
      isVisible: true, isInteractable: false, isDisabled: false,
      isFocused: false, isEditable: false,
    },
    children: p.children ?? [],
    parent: undefined,
  };
}

describe('qualifies', () => {
  it('semantic <button> qualifies even when tiny (10×10)', () => {
    expect(qualifies(mkNode({
      id: 'b', tag: 'button', boundingBox: { x: 0, y: 0, width: 10, height: 10 },
    }))).toBe(true);
  });

  it('<input>, <textarea>, <select>, <form>, <dialog>, <nav>, <article>, <header>, <footer>, <main>, <section> all qualify', () => {
    for (const tag of ['input', 'textarea', 'select', 'form', 'dialog', 'nav', 'article', 'header', 'footer', 'main', 'section']) {
      expect(qualifies(mkNode({ id: tag, tag }))).toBe(true);
    }
  });

  it('<a> with href qualifies; <a> without href does not (unless multi-child styled)', () => {
    expect(qualifies(mkNode({ id: 'a1', tag: 'a', attributes: { href: '/x' } }))).toBe(true);
    expect(qualifies(mkNode({ id: 'a2', tag: 'a' }))).toBe(false);
  });

  it('multi-child styled div with bbox ≥ 40×40 qualifies', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div',
      attributes: { class: 'card' },
      children: ['c1'],
      boundingBox: { x: 0, y: 0, width: 200, height: 120 },
    }))).toBe(true);
  });

  it('multi-child styled div below 40×40 does NOT qualify', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div',
      attributes: { class: 'card' },
      children: ['c1'],
      boundingBox: { x: 0, y: 0, width: 30, height: 30 },
    }))).toBe(false);
  });

  it('div with class but no children does NOT qualify (multi-child branch wants ≥1 child)', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div',
      attributes: { class: 'wrapper' },
      children: [],
      boundingBox: { x: 0, y: 0, width: 200, height: 120 },
    }))).toBe(false);
  });

  it('layout-only div (no class, no semantic tag, no role) does NOT qualify', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div', children: ['c1'],
      boundingBox: { x: 0, y: 0, width: 200, height: 120 },
    }))).toBe(false);
  });

  it('role-only qualifies (e.g. <div role="button">)', () => {
    expect(qualifies(mkNode({
      id: 'd', tag: 'div', role: 'button',
    }))).toBe(true);
  });

  it('role="navigation", "dialog", "article", "form" qualify', () => {
    for (const role of ['navigation', 'dialog', 'article', 'form']) {
      expect(qualifies(mkNode({ id: role, tag: 'div', role }))).toBe(true);
    }
  });

  it('text-only node (no tag-class-role match) does NOT qualify', () => {
    expect(qualifies(mkNode({
      id: 's', tag: 'span', text: 'hello',
    }))).toBe(false);
  });
});
