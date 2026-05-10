import type { Page } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';

interface InputBridgePayload {
  kind: 'click' | 'keydown';
  x?: number;
  y?: number;
  key?: string;
  target?: string;
  wallTimeMs: number;
}

let nextId = 0;

// Module-level registry indirection. The page-side `__uipeOnInput` binding,
// once exposed, persists across page navigations and cannot be re-pointed.
// We dispatch through this registry so each attach() can install a fresh
// callback (bound to the current stream + normalizer) without re-exposing.
type InputDispatch = (raw: InputBridgePayload) => void;
const pageDispatchers = new WeakMap<Page, InputDispatch>();

export class InputCollector implements Collector {
  readonly name = 'input';
  private page: Page | undefined;

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('InputCollector: stream not attached, skipping');
      return;
    }

    const dispatch: InputDispatch = (raw) => {
      stream.push({
        id: `input-${++nextId}`,
        type: 'input',
        timestamp: normalizer.fromWallTimeMs(raw.wallTimeMs),
        payload: {
          kind: raw.kind,
          ...(raw.x !== undefined && raw.y !== undefined ? { position: { x: raw.x, y: raw.y } } : {}),
          ...(raw.key !== undefined ? { key: raw.key } : {}),
          ...(raw.target !== undefined ? { target: raw.target } : {}),
        },
      });
    };
    pageDispatchers.set(page, dispatch);

    try {
      await page.exposeFunction('__uipeOnInput', (raw: InputBridgePayload) => {
        const fn = pageDispatchers.get(page);
        if (fn) fn(raw);
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('registered')) {
        // Binding from a prior attach persists across the page lifecycle.
        // The registry indirection above ensures it now invokes our new dispatch.
        console.debug('InputCollector: __uipeOnInput already registered, redirecting via dispatcher');
      } else {
        throw err;
      }
    }

    await page.evaluate(() => {
      const win = window as any;
      if (win.__uipeInputInstalled) return;
      win.__uipeInputInstalled = true;

      const targetSelector = (el: Element | null): string | undefined => {
        if (!el || !(el instanceof Element)) return undefined;
        if (el.id) return `#${el.id}`;
        const cls = (el.className && typeof el.className === 'string')
          ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
          : '';
        return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
      };

      document.addEventListener('click', (e) => {
        win.__uipeOnInput?.({
          kind: 'click',
          x: e.clientX,
          y: e.clientY,
          target: targetSelector(e.target as Element),
          wallTimeMs: Date.now(),
        });
      }, true);

      document.addEventListener('keydown', (e) => {
        win.__uipeOnInput?.({
          kind: 'keydown',
          key: e.key,
          target: targetSelector(e.target as Element),
          wallTimeMs: Date.now(),
        });
      }, true);
    });

    this.page = page;
  }

  async detach(): Promise<void> {
    if (this.page) {
      pageDispatchers.delete(this.page);
      this.page = undefined;
    }
  }
}
