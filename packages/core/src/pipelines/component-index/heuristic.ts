import type { StructuralNode } from '../../types/index.js';

const SEMANTIC_TAGS = new Set([
  'button', 'input', 'textarea', 'select', 'form',
  'dialog', 'nav', 'article', 'header', 'footer',
  'main', 'section',
]);

const QUALIFYING_ROLES = new Set([
  'button', 'dialog', 'navigation', 'article', 'form',
]);

const MIN_DIMENSION = 40;

/**
 * Returns true if the node is "component-shaped enough to fingerprint and
 * classify." Three branches, any one is sufficient:
 *
 *   1. Semantic tag (button, input, dialog, nav, article, ...; <a> requires href)
 *   2. Multi-child styled unit: ≥1 class && ≥1 child && bbox ≥ 40×40
 *   3. Explicit role (button, dialog, navigation, article, form)
 */
export function qualifies(node: StructuralNode): boolean {
  if (hasSemanticTag(node)) return true;
  if (hasQualifyingRole(node)) return true;
  if (isMultiChildStyledUnit(node)) return true;
  return false;
}

function hasSemanticTag(node: StructuralNode): boolean {
  if (node.tag === 'a') return typeof node.attributes['href'] === 'string';
  return SEMANTIC_TAGS.has(node.tag);
}

function hasQualifyingRole(node: StructuralNode): boolean {
  return typeof node.role === 'string' && QUALIFYING_ROLES.has(node.role);
}

function isMultiChildStyledUnit(node: StructuralNode): boolean {
  const cls = node.attributes['class'];
  if (!cls || cls.trim().length === 0) return false;
  if (node.children.length === 0) return false;
  const { width, height } = node.boundingBox;
  return width >= MIN_DIMENSION && height >= MIN_DIMENSION;
}
