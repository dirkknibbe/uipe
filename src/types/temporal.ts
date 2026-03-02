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
  | 'animation';

export interface StateTransition {
  type: TransitionType;
  timestamp: number;
  diff: SceneGraphDiff;
}
