import type { SceneNode } from './scene-graph.js';

export interface NodeModification {
  nodeId: string;
  changes: Array<{
    field: string;
    from: unknown;
    to: unknown;
  }>;
  interpretation?: string;
}

export interface SceneGraphDiff {
  added: SceneNode[];
  removed: SceneNode[];
  modified: NodeModification[];
  stable: string[];                    // unchanged node IDs
}

export type TransitionType =
  | 'navigation'
  | 'modal_open'
  | 'modal_close'
  | 'content_loaded'
  | 'form_feedback'
  | 'list_updated'
  | 'expand_collapse'
  | 'scroll_reveal'
  | 'animation'
  | 'page_load'
  | 'content_update'
  | 'error_state'
  | 'loading_state'
  | 'idle';

export interface StateTransition {
  type: TransitionType;
  timestamp: number;
  diff: SceneGraphDiff;
  trigger?: string;
  duration?: number;
}

export interface KeyframeEvent {
  frame: Buffer;
  timestamp: number;
  trigger: 'periodic' | 'user_event' | 'dom_mutation' | 'significant_diff';
  metadata?: Record<string, unknown>;
}
