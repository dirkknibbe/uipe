import { describe, it, expect } from 'vitest';
import { predictActions } from '../../../../src/pipelines/affordance/predictor.js';
import type { SceneNode, StateTransition, SceneGraphDiff } from '../../../../src/types/index.js';

const makeNode = (overrides: Partial<SceneNode> = {}): SceneNode => ({
  id: 'n1', tag: 'div', role: 'button', label: 'Submit',
  boundingBox: { x: 0, y: 0, width: 100, height: 40 },
  viewportPosition: 'visible', visibilityPercent: 100, zLayer: 0,
  interactionType: 'clickable', isDisabled: false, isLoading: false, isFocused: false,
  visualState: 'normal', children: [], spatialRelationships: [],
  visualConfidence: 0, structuralConfidence: 1, fusionMethod: 'structural_only',
  ...overrides,
});

const emptyDiff: SceneGraphDiff = { added: [], removed: [], modified: [], stable: [] };

const makeTransition = (type: StateTransition['type']): StateTransition => ({
  type,
  timestamp: Date.now(),
  diff: emptyDiff,
});

describe('predictActions', () => {
  it('disabled node → empty predictions', () => {
    expect(predictActions(makeNode({ isDisabled: true }), [])).toHaveLength(0);
  });

  it('static node → empty predictions', () => {
    expect(predictActions(makeNode({ interactionType: 'static' }), [])).toHaveLength(0);
  });

  it('typeable node → Updates field value with high confidence', () => {
    const predictions = predictActions(makeNode({ interactionType: 'typeable', role: 'textbox' }), []);
    expect(predictions).toHaveLength(1);
    expect(predictions[0].action).toBe('typeable');
    expect(predictions[0].predictedOutcome).toMatch(/field/i);
    expect(predictions[0].confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('scrollable node → Scrolls content', () => {
    const predictions = predictActions(makeNode({ interactionType: 'scrollable', role: 'region' }), []);
    expect(predictions).toHaveLength(1);
    expect(predictions[0].action).toBe('scrollable');
    expect(predictions[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('link tag → Navigates to linked page', () => {
    const predictions = predictActions(makeNode({ tag: 'a', role: 'link' }), []);
    expect(predictions[0].predictedOutcome).toMatch(/navigat/i);
    expect(predictions[0].confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('checkbox role → Toggles selection state', () => {
    const predictions = predictActions(makeNode({ role: 'checkbox' }), []);
    expect(predictions[0].predictedOutcome).toMatch(/toggl/i);
    expect(predictions[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('button with no history → generic action prediction', () => {
    const predictions = predictActions(makeNode({ role: 'button' }), []);
    expect(predictions).toHaveLength(1);
    expect(predictions[0].action).toBe('clickable');
    expect(predictions[0].confidence).toBeLessThan(0.75);
  });

  it('button with form_feedback in history → higher confidence form prediction', () => {
    const history = [makeTransition('form_feedback')];
    const predictions = predictActions(makeNode({ role: 'button' }), history);
    expect(predictions[0].confidence).toBeGreaterThan(0.65);
    expect(predictions[0].predictedOutcome).toMatch(/form|submit/i);
  });

  it('button with modal_open in history → modal prediction with sideEffects', () => {
    const history = [makeTransition('modal_open')];
    const predictions = predictActions(makeNode({ role: 'button' }), history);
    expect(predictions[0].sideEffects).toContain('modal_open');
  });
});
