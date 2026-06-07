import type { BoundingBox } from './common.js';

export interface StructuralNode {
  id: string;
  tag: string;                         // div, button, input, a, etc.
  role?: string;                       // ARIA role from a11y tree
  name?: string;                       // accessible name
  text?: string;                       // text content
  boundingBox: BoundingBox;
  computedStyle: {
    display: string;
    visibility: string;
    opacity: number;
    position: string;
    zIndex: number;
    overflow: string;
    pointerEvents: string;
    cursor: string;
  };
  attributes: Record<string, string>;  // href, type, placeholder, aria-*, data-*
  states: {
    isVisible: boolean;
    isInteractable: boolean;
    isDisabled: boolean;
    isFocused: boolean;
    isChecked?: boolean;
    isExpanded?: boolean;
    isSelected?: boolean;
    isEditable: boolean;
  };
  children: string[];                  // child node IDs
  parent?: string;                     // parent node ID
}
