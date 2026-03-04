import type { SceneNode } from '../../types/index.js';

const HIGH_PRIORITY_ROLES = new Set([
  'button', 'link', 'textbox', 'combobox', 'searchbox',
  'menuitem', 'tab', 'checkbox', 'radio',
]);

const HIGH_PRIORITY_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea',
]);

export function assignPriority(node: SceneNode): 'high' | 'medium' | 'low' {
  // Currently focused — always high
  if (node.isFocused) return 'high';

  // Off-screen or barely visible — always low
  if (node.viewportPosition !== 'visible' || node.visibilityPercent <= 20) return 'low';

  // Visible, high-value role or tag, more than half visible — high
  if (
    node.visibilityPercent > 50 &&
    (HIGH_PRIORITY_ROLES.has(node.role.toLowerCase()) || HIGH_PRIORITY_TAGS.has(node.tag.toLowerCase()))
  ) {
    return 'high';
  }

  // Visible but lower prominence — medium
  return 'medium';
}
