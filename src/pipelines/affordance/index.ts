import type { SceneGraph, StateTransition, AffordanceMap, Affordance } from '../../types/index.js';
import { predictActions } from './predictor.js';
import { assignPriority } from './prioritizer.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('AffordanceEngine');

export class AffordanceEngine {
  analyze(graph: SceneGraph, history: StateTransition[] = []): AffordanceMap {
    const map: AffordanceMap = new Map();

    for (const node of graph.nodes) {
      const predictions = predictActions(node, history);
      if (predictions.length === 0) continue;

      const affordance: Affordance = {
        nodeId: node.id,
        predictions,
        priority: assignPriority(node),
      };
      map.set(node.id, affordance);
    }

    logger.info('Affordance analysis complete', {
      total: graph.nodes.length,
      interactive: map.size,
      high: [...map.values()].filter(a => a.priority === 'high').length,
      medium: [...map.values()].filter(a => a.priority === 'medium').length,
      low: [...map.values()].filter(a => a.priority === 'low').length,
    });

    return map;
  }
}
