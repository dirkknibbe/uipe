import type { ElementHandle, Page } from 'playwright';

export interface ClickTarget { label: string; submit: boolean }

const RESOLVE_TIMEOUT_MS = 2_000;
const LABEL_MAX = 300;
const CLICKABLE =
  'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=switch],[onclick]';

/**
 * Runs in the page. Walks up to the nearest clickable ancestor, so an icon inside 'Buy now' reports
 * 'Buy now'. No named inner functions: under tsx they compile to __name(...) calls.
 */
function describeClickTarget(leaf: Element, args: { clickable: string; max: number }): ClickTarget {
  const el = leaf.closest(args.clickable) ?? leaf;
  // The resolved .type, not the attribute: type="foo" on a button is still a submit button.
  const type = (el as HTMLInputElement).type;
  const tag = el.tagName;
  const inForm = !!(el as HTMLButtonElement).form;
  // A formless button with no type attribute cannot submit; every other resolved submit is flagged.
  const submit = (tag === 'INPUT' && (type === 'submit' || type === 'image'))
    || (tag === 'BUTTON' && type === 'submit' && (inForm || el.hasAttribute('type')));
  const parts = [
    el.getAttribute('aria-label'), (el as HTMLElement).innerText, tag === 'INPUT' ? (el as HTMLInputElement).value : '',
    el.getAttribute('alt'), el.getAttribute('title'),
  ];
  const label = parts.filter((p) => p && p.trim()).join(' ').replace(/\s+/g, ' ').trim().slice(0, args.max);
  return { label, submit };
}

/** The element a click or clickSelector would hit; null when it cannot be pinned to exactly one element. */
export async function resolveClickTarget(page: Page, args: Record<string, unknown>): Promise<ClickTarget | null> {
  let handle: ElementHandle | null = null;
  try {
    if (args.type === 'click' && typeof args.x === 'number' && typeof args.y === 'number') {
      const js = await page.evaluateHandle(([x, y]) => document.elementFromPoint(x, y), [args.x, args.y] as const);
      handle = js.asElement();
      if (!handle) await js.dispose();
    } else if (args.type === 'clickSelector' && typeof args.selector === 'string') {
      const base = page.locator(args.selector);
      const loc = args.visible === false ? base : base.filter({ visible: true });
      // clickSelector's locator.click() is strict, so anything but one match would not click anyway.
      if ((await loc.count()) !== 1) return null;
      handle = await loc.elementHandle({ timeout: RESOLVE_TIMEOUT_MS });
    }
    if (!handle) return null;
    return await handle.evaluate(describeClickTarget, { clickable: CLICKABLE, max: LABEL_MAX });
  } catch {
    return null; // an unresolvable target is refused by the rails, never clicked
  } finally {
    await handle?.dispose().catch(() => undefined);
  }
}
