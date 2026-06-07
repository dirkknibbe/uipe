import { describe, it, expect } from 'vitest';
import { classifyByRules } from '../../../../src/pipelines/component-index/classifier.js';
import type { StructuralNode } from '../../../../src/types/index.js';

function mkNode(p: Partial<StructuralNode> & { id: string; tag: string }): StructuralNode {
  return {
    id: p.id,
    tag: p.tag,
    role: p.role,
    name: undefined,
    text: undefined,
    boundingBox: { x: 0, y: 0, width: 100, height: 50 },
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
    children: [],
    parent: undefined,
  };
}

describe('classifyByRules', () => {
  it('tag=button → Button', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'button' }))).toBe('Button');
  });

  it('role=button → Button (even on a div)', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'div', role: 'button' }))).toBe('Button');
  });

  it('tag=a with href → Link', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'a', attributes: { href: '/x' } }))).toBe('Link');
  });

  it('tag=a without href → null (no rule matches)', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'a' }))).toBeNull();
  });

  it('input[type=text] → TextInput', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'text' } }))).toBe('TextInput');
  });

  it('input[type=password] → PasswordInput', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'password' } }))).toBe('PasswordInput');
  });

  it('input[type=checkbox] → Checkbox', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'checkbox' } }))).toBe('Checkbox');
  });

  it('input[type=radio] → RadioButton', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input', attributes: { type: 'radio' } }))).toBe('RadioButton');
  });

  it('input with no type defaults to text → TextInput', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'input' }))).toBe('TextInput');
  });

  it('tag=textarea → TextArea', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'textarea' }))).toBe('TextArea');
  });

  it('tag=select → Select', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'select' }))).toBe('Select');
  });

  it('tag=form → Form', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'form' }))).toBe('Form');
  });

  it('tag=dialog OR role=dialog → Modal', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'dialog' }))).toBe('Modal');
    expect(classifyByRules(mkNode({ id: 'b', tag: 'div', role: 'dialog' }))).toBe('Modal');
  });

  it('tag=nav OR role=navigation → Nav', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'nav' }))).toBe('Nav');
    expect(classifyByRules(mkNode({ id: 'b', tag: 'div', role: 'navigation' }))).toBe('Nav');
  });

  it('tag=article OR role=article → Card', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'article' }))).toBe('Card');
    expect(classifyByRules(mkNode({ id: 'b', tag: 'div', role: 'article' }))).toBe('Card');
  });

  it('tag=header → Header', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'header' }))).toBe('Header');
  });

  it('tag=footer → Footer', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'footer' }))).toBe('Footer');
  });

  it('tag=main → Main', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'main' }))).toBe('Main');
  });

  it('tag=section → Section', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'section' }))).toBe('Section');
  });

  it('unknown div → null', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'div', attributes: { class: 'foo' } }))).toBeNull();
  });

  it('first-match-wins: tag=button beats no role', () => {
    expect(classifyByRules(mkNode({ id: 'a', tag: 'button', role: 'dialog' }))).toBe('Button');
  });
});
