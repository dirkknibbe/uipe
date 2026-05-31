// src/pipelines/fusion/node-builder.ts
import type {
  SceneNode, VisualElement, StructuralNode,
  InteractionType, ViewportPosition, Viewport, BoundingBox,
} from '../../types/index.js';
import type { MatchPair } from './matcher.js';
import type { ComponentField } from '../component-index/types.js';

const VISUAL_LABEL_TO_ROLE: Record<string, string> = {
  button: 'button', input: 'textbox', link: 'link', select: 'combobox',
  checkbox: 'checkbox', radio: 'radio', heading: 'heading',
  nav: 'navigation', image: 'img', icon: 'img', text: 'text',
};

export function buildSceneNode(
  pair: MatchPair,
  viewport: Viewport,
  componentMap?: ReadonlyMap<string, ComponentField>,
): SceneNode {
  const { visualElement: v, structuralNode: s, fusionMethod } = pair;
  const bb = s?.boundingBox ?? v!.boundingBox;
  const id = s?.id ?? v!.id;
  const component = componentMap?.get(id);

  return {
    id,
    tag: s?.tag ?? 'unknown',
    role: s?.role ?? (v?.label ? VISUAL_LABEL_TO_ROLE[v.label] : undefined) ?? v?.label ?? 'element',
    label: v?.label ?? s?.role ?? s?.tag ?? 'element',
    description: undefined,
    boundingBox: bb,
    viewportPosition: deriveViewportPosition(bb, viewport),
    visibilityPercent: computeVisibilityPercent(bb, viewport),
    zLayer: s?.computedStyle.zIndex ?? 0,
    text: v?.text ?? s?.text,
    value: s?.attributes['value'],
    placeholder: s?.attributes['placeholder'],
    imageAlt: s?.attributes['alt'],
    interactionType: deriveInteractionType(s, v),
    isDisabled: s?.states.isDisabled ?? false,
    isLoading: false,
    isFocused: s?.states.isFocused ?? false,
    visualState: 'normal',
    parent: s?.parent,
    children: s?.children ?? [],
    spatialRelationships: [],
    visualConfidence: v?.confidence ?? 0,
    structuralConfidence: s !== null ? 1 : 0,
    fusionMethod,
    ...(component ? { component } : {}),
  };
}

function deriveInteractionType(s: StructuralNode | null, v: VisualElement | null): InteractionType {
  if (s?.states.isDisabled) return 'static';
  if (s?.states.isEditable) return 'typeable';
  if (s?.states.isInteractable) return 'clickable';
  const label = v?.label;
  if (label === 'input' || label === 'textarea') return 'typeable';
  if (label === 'button' || label === 'link' || label === 'dropdown') return 'clickable';
  return 'static';
}

function deriveViewportPosition(bb: BoundingBox, vp: Viewport): ViewportPosition {
  if (bb.y + bb.height < 0) return 'above';
  if (bb.y > vp.height) return 'below';
  if (bb.x + bb.width < 0) return 'left';
  if (bb.x > vp.width) return 'right';
  return 'visible';
}

function computeVisibilityPercent(bb: BoundingBox, vp: Viewport): number {
  const visibleW = Math.max(0, Math.min(bb.x + bb.width, vp.width) - Math.max(bb.x, 0));
  const visibleH = Math.max(0, Math.min(bb.y + bb.height, vp.height) - Math.max(bb.y, 0));
  const totalArea = bb.width * bb.height;
  if (totalArea === 0) return 0;
  return Math.round((visibleW * visibleH) / totalArea * 100);
}
