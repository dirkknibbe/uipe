import type { BoundingBox, Viewport, ScrollPosition } from './common.js';

export type InteractionType = 'clickable' | 'typeable' | 'scrollable' | 'hoverable' | 'draggable' | 'static';
export type ViewportPosition = 'above' | 'visible' | 'below' | 'left' | 'right';
export type VisualState = 'normal' | 'hovered' | 'active' | 'selected' | 'error';
export type FusionMethod = 'visual_only' | 'structural_only' | 'fused';

export interface SpatialRelationship {
  targetId: string;
  relation: 'inside' | 'above' | 'below' | 'left_of' | 'right_of' | 'overlapping' | 'adjacent';
}

export interface SceneNode {
  id: string;

  // Identity
  tag: string;
  role: string;
  label: string;
  description?: string;

  // Spatial
  boundingBox: BoundingBox;
  viewportPosition: ViewportPosition;
  visibilityPercent: number;           // 0–100
  zLayer: number;

  // Content
  text?: string;
  value?: string;
  placeholder?: string;
  imageAlt?: string;

  // State
  interactionType: InteractionType;
  isDisabled: boolean;
  isLoading: boolean;
  isFocused: boolean;
  visualState: VisualState;

  // Relationships
  parent?: string;
  children: string[];
  spatialRelationships: SpatialRelationship[];

  // Source confidence
  visualConfidence: number;
  structuralConfidence: number;
  fusionMethod: FusionMethod;
}

export interface SceneGraph {
  timestamp: number;
  url: string;
  viewport: Viewport;
  scrollPosition: ScrollPosition;
  nodes: SceneNode[];
  focusedNodeId?: string;
  rootNodeIds: string[];
}
