// src/pipelines/fusion/index.ts
import type { VisualElement, StructuralNode, SceneGraph, Viewport, ScrollPosition } from '../../types/index.js';
import { matchElements } from './matcher.js';
import { buildSceneNode } from './node-builder.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('FusionEngine');

export interface FusionContext {
  url: string;
  viewport: Viewport;
  scrollPosition: ScrollPosition;
}

export class FusionEngine {
  fuse(
    visual: VisualElement[],
    structural: StructuralNode[],
    context: FusionContext,
  ): SceneGraph {
    logger.info('Fusing visual + structural', { visual: visual.length, structural: structural.length });

    const pairs = matchElements(visual, structural);
    const nodes = pairs.map(pair => buildSceneNode(pair, context.viewport));

    const nodeIds = new Set(nodes.map(n => n.id));
    const rootNodeIds = nodes
      .filter(n => !n.parent || !nodeIds.has(n.parent))
      .map(n => n.id);

    const focusedNodeId = nodes.find(n => n.isFocused)?.id;

    logger.info('Fusion complete', {
      total: nodes.length,
      fused: nodes.filter(n => n.fusionMethod === 'fused').length,
      visualOnly: nodes.filter(n => n.fusionMethod === 'visual_only').length,
      structuralOnly: nodes.filter(n => n.fusionMethod === 'structural_only').length,
    });

    return {
      timestamp: Date.now(),
      url: context.url,
      viewport: context.viewport,
      scrollPosition: context.scrollPosition,
      nodes,
      focusedNodeId,
      rootNodeIds,
    };
  }
}
