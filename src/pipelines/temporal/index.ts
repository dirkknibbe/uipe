import type { SceneGraph, StateTransition } from '../../types/index.js';
import { diffGraphs } from './differ.js';
import { classifyTransition } from './classifier.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TemporalTracker');

export class TemporalTracker {
  private history: StateTransition[] = [];
  private latest: SceneGraph | null = null;

  observe(graph: SceneGraph): StateTransition | null {
    if (!this.latest) {
      this.latest = graph;
      logger.info('First observation', { nodes: graph.nodes.length, url: graph.url });
      return null;
    }

    const diff = diffGraphs(this.latest, graph);
    const type = classifyTransition(diff, this.latest, graph);
    const transition: StateTransition = { type, timestamp: graph.timestamp, diff };

    this.history.push(transition);
    this.latest = graph;

    logger.info('State transition', {
      type,
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
      stable: diff.stable.length,
    });

    return transition;
  }

  getHistory(): StateTransition[] {
    return [...this.history];
  }

  getLatest(): SceneGraph | null {
    return this.latest;
  }

  reset(): void {
    this.history = [];
    this.latest = null;
    logger.info('TemporalTracker reset');
  }
}
