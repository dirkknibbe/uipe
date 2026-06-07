import type { Page } from 'playwright';
import type { StructuralNode, BoundingBox } from '../../types/index.js';
import { isElementVisible, isElementInteractable, isElementEditable, isElementDisabled } from './visibility.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('DOMExtractor');

export async function extractDOMStructure(page: Page): Promise<StructuralNode[]> {
  logger.info('Extracting DOM structure');
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  const rawNodes = await page.evaluate(() => {
    let idCounter = 0;
    const nodeMap = new Map<Element, string>();

    function getId(el: Element): string {
      const existing = nodeMap.get(el);
      if (existing) return existing;
      const id = `dom-${idCounter++}`;
      nodeMap.set(el, id);
      return id;
    }

    return Array.from(document.querySelectorAll('*')).map(el => {
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      const attributes: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) { attributes[attr.name] = attr.value; }

      const input = el as HTMLInputElement;
      const isChecked = (el.tagName === 'INPUT' && (input.type === 'checkbox' || input.type === 'radio'))
        ? input.checked : undefined;

      return {
        id: getId(el),
        tag: el.tagName.toLowerCase(),
        text: ((el as HTMLElement).innerText ?? '').trim().slice(0, 200) || undefined,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), left: Math.round(rect.left) },
        style: {
          display: computed.display,
          visibility: computed.visibility,
          opacity: computed.opacity,
          overflow: computed.overflow,
          pointerEvents: computed.pointerEvents,
          cursor: computed.cursor,
          position: computed.position,
          zIndex: computed.zIndex,
        },
        attributes,
        parentId: el.parentElement ? getId(el.parentElement) : null,
        childIds: Array.from(el.children).map(c => getId(c)),
        isFocused: document.activeElement === el,
        isChecked,
        isExpanded: attributes['aria-expanded'] !== undefined ? attributes['aria-expanded'] === 'true' : undefined,
        isSelected: attributes['aria-selected'] !== undefined ? attributes['aria-selected'] === 'true' : undefined,
      };
    });
  });

  return rawNodes.map(raw => {
    const visible = isElementVisible(raw.style, raw.rect, viewport);
    const interactable = isElementInteractable(raw.tag, raw.style, raw.attributes, visible);
    const boundingBox: BoundingBox = { x: raw.rect.x, y: raw.rect.y, width: raw.rect.width, height: raw.rect.height };

    return {
      id: raw.id,
      tag: raw.tag,
      role: raw.attributes['role'],
      name: raw.attributes['aria-label'] ?? raw.attributes['title'] ?? raw.attributes['alt'],
      text: raw.text,
      boundingBox,
      computedStyle: {
        display: raw.style.display,
        visibility: raw.style.visibility,
        opacity: parseFloat(raw.style.opacity) || 1,
        position: raw.style.position,
        zIndex: raw.style.zIndex === 'auto' ? 0 : parseInt(raw.style.zIndex, 10) || 0,
        overflow: raw.style.overflow,
        pointerEvents: raw.style.pointerEvents,
        cursor: raw.style.cursor,
      },
      attributes: raw.attributes,
      states: {
        isVisible: visible,
        isInteractable: interactable,
        isDisabled: isElementDisabled(raw.tag, raw.attributes),
        isFocused: raw.isFocused,
        isChecked: raw.isChecked,
        isExpanded: raw.isExpanded,
        isSelected: raw.isSelected,
        isEditable: isElementEditable(raw.tag, raw.attributes),
      },
      children: raw.childIds,
      parent: raw.parentId ?? undefined,
    } satisfies StructuralNode;
  });
}
