import { computeSignature } from './fingerprint.js';
import { qualifies } from './heuristic.js';
import type { Matcher } from './matcher.js';
import type { ComponentField } from './types.js';
import type { StructuralNode } from '../../types/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('ComponentIndexer');

export interface IndexerOptions {
  matcher: Matcher;
}

export interface IndexerRunContext {
  origin: string;
}

export class Indexer {
  private matcher: Matcher;

  constructor(opts: IndexerOptions) {
    this.matcher = opts.matcher;
  }

  /**
   * Walk the structural-pipeline output. For each qualifying node, compute
   * its signature and consult the matcher. Returns a Map<nodeId, ComponentField>
   * the fusion serializer can attach onto SceneNode entries.
   */
  async run(nodes: StructuralNode[], context: IndexerRunContext): Promise<Map<string, ComponentField>> {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const result = new Map<string, ComponentField>();

    await this.matcher.beginRun(context.origin);
    try {
      for (const node of nodes) {
        if (!qualifies(node)) continue;
        const signature = computeSignature(node, nodeMap);
        const field = this.matcher.lookup({ node, signature, origin: context.origin });
        result.set(node.id, field);
      }
    } finally {
      await this.matcher.endRun(context.origin);
    }

    logger.info('Component-index run complete', {
      origin: context.origin,
      totalNodes: nodes.length,
      qualified: result.size,
    });
    return result;
  }

  async runAndGetStats(
    nodes: StructuralNode[],
    context: IndexerRunContext,
  ): Promise<{ map: Map<string, ComponentField>; hits: number; misses: number }> {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const map = new Map<string, ComponentField>();
    await this.matcher.beginRun(context.origin);
    try {
      for (const node of nodes) {
        if (!qualifies(node)) continue;
        const signature = computeSignature(node, nodeMap);
        const field = this.matcher.lookup({ node, signature, origin: context.origin });
        map.set(node.id, field);
      }
      const stats = this.matcher.runStats();
      return { map, ...stats };
    } finally {
      await this.matcher.endRun(context.origin);
    }
  }
}
