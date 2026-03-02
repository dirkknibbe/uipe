import type { InteractionType } from './scene-graph.js';

export interface ActionPrediction {
  action: InteractionType;
  predictedOutcome: string;
  confidence: number;
  sideEffects?: string[];
}

export interface Affordance {
  nodeId: string;
  predictions: ActionPrediction[];
  priority: 'high' | 'medium' | 'low';
  reasoning?: string;
}

export type AffordanceMap = Map<string, Affordance>;
