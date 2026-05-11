import type { Page } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';

interface MutationBridgePayload {
  added: number;
  removed: number;
  attributes: number;
  characterData: number;
  wallTimeMs: number;
}

let nextId = 0;

// Module-level registry indirection (see input.ts for rationale).
type MutationDispatch = (raw: MutationBridgePayload) => void;
const pageDispatchers = new WeakMap<Page, MutationDispatch>();

export class MutationCollector implements Collector {
  readonly name = 'mutation';
  private page: Page | undefined;

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('MutationCollector: stream not attached, skipping');
      return;
    }

    const dispatch: MutationDispatch = (raw) => {
      stream.push({
        id: `mut-${++nextId}`,
        type: 'mutation',
        timestamp: normalizer.fromWallTimeMs(raw.wallTimeMs),
        payload: {
          added: raw.added,
          removed: raw.removed,
          attributes: raw.attributes,
          characterData: raw.characterData,
        },
      });
    };
    pageDispatchers.set(page, dispatch);

    try {
      await page.exposeFunction('__uipeOnMutation', (raw: MutationBridgePayload) => {
        const fn = pageDispatchers.get(page);
        if (fn) fn(raw);
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('registered')) {
        // Binding from a prior attach persists across the page lifecycle.
        // The registry indirection above ensures it now invokes our new dispatch.
        console.debug('MutationCollector: __uipeOnMutation already registered, redirecting via dispatcher');
      } else {
        throw err;
      }
    }

    await page.evaluate(() => {
      const win = window as any;
      if (win.__uipeMutationInstalled) return;
      win.__uipeMutationInstalled = true;

      let pending = { added: 0, removed: 0, attributes: 0, characterData: 0 };
      let scheduled = false;

      const flush = () => {
        if (pending.added || pending.removed || pending.attributes || pending.characterData) {
          win.__uipeOnMutation?.({
            ...pending,
            wallTimeMs: Date.now(),
          });
        }
        pending = { added: 0, removed: 0, attributes: 0, characterData: 0 };
        scheduled = false;
      };

      const observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'childList') {
            pending.added += r.addedNodes.length;
            pending.removed += r.removedNodes.length;
          } else if (r.type === 'attributes') {
            pending.attributes += 1;
          } else if (r.type === 'characterData') {
            pending.characterData += 1;
          }
        }
        if (!scheduled) {
          scheduled = true;
          requestAnimationFrame(flush);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
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
