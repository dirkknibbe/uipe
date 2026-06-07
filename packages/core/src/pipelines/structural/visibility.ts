export interface RawElementStyle {
  display: string;
  visibility: string;
  opacity: string;
  overflow: string;
  pointerEvents: string;
  cursor: string;
  position: string;
  zIndex: string;
}

export interface RawElementRect {
  x: number; y: number; width: number; height: number;
  top: number; right: number; bottom: number; left: number;
}

export interface ViewportSize { width: number; height: number; }

export function isElementVisible(style: RawElementStyle, rect: RawElementRect, viewport: ViewportSize): boolean {
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom < 0 || rect.right < 0) return false;
  if (rect.top > viewport.height || rect.left > viewport.width) return false;
  return true;
}

export function isElementInteractable(tag: string, style: RawElementStyle, attributes: Record<string, string>, isVisible: boolean): boolean {
  if (!isVisible) return false;
  if (style.pointerEvents === 'none') return false;
  if (attributes['disabled'] !== undefined) return false;
  if (attributes['aria-disabled'] === 'true') return false;
  const interactableTags = new Set(['a', 'button', 'input', 'textarea', 'select', 'details', 'summary']);
  if (interactableTags.has(tag)) return true;
  if (attributes['onclick'] !== undefined) return true;
  if (attributes['role'] === 'button' || attributes['role'] === 'link') return true;
  if (attributes['tabindex'] !== undefined && attributes['tabindex'] !== '-1') return true;
  if (style.cursor === 'pointer') return true;
  if (attributes['contenteditable'] === 'true') return true;
  return false;
}

export function isElementEditable(tag: string, attributes: Record<string, string>): boolean {
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    const type = attributes['type'] ?? 'text';
    const nonEditable = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color']);
    return !nonEditable.has(type);
  }
  if (attributes['contenteditable'] === 'true') return true;
  return false;
}

export function isElementDisabled(tag: string, attributes: Record<string, string>): boolean {
  if (attributes['disabled'] !== undefined) return true;
  if (attributes['aria-disabled'] === 'true') return true;
  return false;
}
