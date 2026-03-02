import type { VisualElement, StructuralNode, FusionMethod } from '../../types/index.js';
import { computeIoU } from '../../utils/geometry.js';

const IOU_MATCH_THRESHOLD = 0.3;

export interface MatchPair {
  visualElement: VisualElement | null;
  structuralNode: StructuralNode | null;
  iou: number;
  fusionMethod: FusionMethod;
}

export function matchElements(
  visualElements: VisualElement[],
  structuralNodes: StructuralNode[],
): MatchPair[] {
  const pairs: MatchPair[] = [];
  const claimedStructuralIds = new Set<string>();

  // Sort visual elements by area descending (larger elements match first — more stable)
  const sortedVisual = [...visualElements].sort(
    (a, b) => (b.boundingBox.width * b.boundingBox.height) - (a.boundingBox.width * a.boundingBox.height),
  );

  for (const visual of sortedVisual) {
    let bestNode: StructuralNode | null = null;
    let bestIou = 0;

    for (const structural of structuralNodes) {
      if (!structural.states.isVisible) continue;
      if (claimedStructuralIds.has(structural.id)) continue;
      const iou = computeIoU(visual.boundingBox, structural.boundingBox);
      if (iou > bestIou) {
        bestIou = iou;
        bestNode = structural;
      }
    }

    if (bestNode && bestIou >= IOU_MATCH_THRESHOLD) {
      claimedStructuralIds.add(bestNode.id);
      pairs.push({ visualElement: visual, structuralNode: bestNode, iou: bestIou, fusionMethod: 'fused' });
    } else {
      pairs.push({ visualElement: visual, structuralNode: null, iou: 0, fusionMethod: 'visual_only' });
    }
  }

  // Unmatched structural nodes
  for (const structural of structuralNodes) {
    if (!claimedStructuralIds.has(structural.id)) {
      pairs.push({ visualElement: null, structuralNode: structural, iou: 0, fusionMethod: 'structural_only' });
    }
  }

  return pairs;
}
