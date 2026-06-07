import { describe, it, expect } from 'vitest';
import { assignPriority } from '../../../../src/pipelines/affordance/prioritizer.js';
import type { SceneNode } from '../../../../src/types/index.js';

const makeNode = (overrides: Partial<SceneNode> = {}): SceneNode => ({
  id: 'n1', tag: 'button', role: 'button', label: 'Click me',
  boundingBox: { x: 0, y: 0, width: 120, height: 40 },
  viewportPosition: 'visible', visibilityPercent: 100, zLayer: 0,
  interactionType: 'clickable', isDisabled: false, isLoading: false, isFocused: false,
  visualState: 'normal', children: [], spatialRelationships: [],
  visualConfidence: 0, structuralConfidence: 1, fusionMethod: 'structural_only',
  ...overrides,
});

describe('assignPriority', () => {
  it('focused node → high regardless of role', () => {
    expect(assignPriority(makeNode({ isFocused: true, role: 'region' }))).toBe('high');
  });

  it('visible button with >50% visibility → high', () => {
    expect(assignPriority(makeNode({ role: 'button', visibilityPercent: 80 }))).toBe('high');
  });

  it('visible link with >50% visibility → high', () => {
    expect(assignPriority(makeNode({ role: 'link', tag: 'a', visibilityPercent: 70 }))).toBe('high');
  });

  it('visible textbox with >50% visibility → high', () => {
    expect(assignPriority(makeNode({ role: 'textbox', interactionType: 'typeable', visibilityPercent: 90 }))).toBe('high');
  });

  it('visible button with low visibility (≤50%) → medium', () => {
    expect(assignPriority(makeNode({ role: 'button', visibilityPercent: 30 }))).toBe('medium');
  });

  it('visible non-high-priority role → medium', () => {
    expect(assignPriority(makeNode({ role: 'region', tag: 'div', visibilityPercent: 80 }))).toBe('medium');
  });

  it('off-screen node → low', () => {
    expect(assignPriority(makeNode({ viewportPosition: 'above', visibilityPercent: 0 }))).toBe('low');
  });

  it('visible but barely visible (≤20%) → low', () => {
    expect(assignPriority(makeNode({ viewportPosition: 'visible', visibilityPercent: 10 }))).toBe('low');
  });

  it('visible <a> with non-link role (role: "element") and >50% visibility → high', () => {
    expect(assignPriority(makeNode({ role: 'element', tag: 'a', visibilityPercent: 80 }))).toBe('high');
  });
});
