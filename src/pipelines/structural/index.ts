import type { Page } from 'playwright';
import type { StructuralNode } from '../../types/index.js';
import { extractDOMStructure } from './dom-extractor.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('StructuralPipeline');

export class StructuralPipeline {
  async extractStructure(page: Page): Promise<StructuralNode[]> {
    logger.info('Starting structural extraction');
    const nodes = await extractDOMStructure(page);
    logger.info('Structural extraction complete', {
      total: nodes.length,
      visible: nodes.filter(n => n.states.isVisible).length,
      interactable: nodes.filter(n => n.states.isInteractable).length,
    });
    return nodes;
  }

  filterInteractable(nodes: StructuralNode[]): StructuralNode[] {
    return nodes.filter(n => n.states.isVisible && n.states.isInteractable);
  }

  findByRole(nodes: StructuralNode[], role: string): StructuralNode[] {
    return nodes.filter(n => n.role === role || n.tag === role);
  }

  buildIndex(nodes: StructuralNode[]): Map<string, StructuralNode> {
    return new Map(nodes.map(n => [n.id, n]));
  }
}
