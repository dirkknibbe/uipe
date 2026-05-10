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

export class InputCollector implements Collector {
  readonly name = 'input';
  private attached = false;

  async attach(page: Page, stream: TemporalEventStream): Promise<void> {
    if (this.attached) return;
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('InputCollector: stream not attached, skipping');
      return;
    }

    await page.exposeFunction('__uipeOnInput', (raw: InputBridgePayload) => {
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
    });

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

    this.attached = true;
  }

  async detach(): Promise<void> {
    this.attached = false;
  }
}
