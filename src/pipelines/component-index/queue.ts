import sharp from 'sharp';
import { createLogger } from '../../utils/logger.js';
import type { ComponentIndexStore } from './store.js';
import type { IndexedComponent } from './types.js';

const logger = createLogger('ComponentClassificationQueue');

export interface PendingClassification {
  origin: string;
  signature: string;
  html: string;
  bbox: { x: number; y: number; w: number; h: number };
}

export type VlmClassifierFn = (args: { html: string; screenshotCrop: Buffer }) => Promise<string>;

export interface DrainOptions {
  classifier: VlmClassifierFn;
  screenshotProvider: () => Promise<Buffer | null>;
  store: ComponentIndexStore;
}

export class ClassificationQueue {
  private pending = new Map<string, PendingClassification>();

  size(): number {
    return this.pending.size;
  }

  enqueue(item: PendingClassification): void {
    const key = `${item.origin}|${item.signature}`;
    if (!this.pending.has(key)) this.pending.set(key, item);
  }

  /**
   * Drain all pending classifications. For each item: fetch the page
   * screenshot, crop to the bbox, classify via VLM, persist to the store
   * grouped by origin (one load+save per origin).
   *
   * Never throws. Per-item errors are logged and skipped.
   */
  async drainOnce(opts: DrainOptions): Promise<void> {
    if (this.pending.size === 0) return;

    const items = Array.from(this.pending.values());
    this.pending.clear();

    // Group by origin so we do one load+save per origin.
    const byOrigin = new Map<string, PendingClassification[]>();
    for (const item of items) {
      const list = byOrigin.get(item.origin);
      if (list) list.push(item);
      else byOrigin.set(item.origin, [item]);
    }

    const screenshot = await opts.screenshotProvider().catch((err) => {
      logger.warn('Screenshot provider failed during drain', { error: String(err) });
      return null;
    });
    if (!screenshot) return;

    for (const [origin, originItems] of byOrigin) {
      const index = await opts.store.load(origin);
      const now = new Date().toISOString();
      let mutated = false;

      for (const item of originItems) {
        try {
          const crop = await cropToBbox(screenshot, item.bbox);
          const classification = await opts.classifier({ html: item.html, screenshotCrop: crop });
          const existing = index.entries[item.signature];
          const entry: IndexedComponent = existing ?? {
            signature: item.signature,
            classification,
            classificationSource: 'vlm',
            firstSeen: now,
            lastSeen: now,
            occurrences: 1,
            domSample: item.html.slice(0, 500),
            source: 'first-traversal',
          };
          if (existing) {
            entry.classification = classification;
            entry.classificationSource = 'vlm';
            entry.lastSeen = now;
          }
          index.entries[item.signature] = entry;
          mutated = true;
        } catch (err) {
          logger.warn('Per-item classification failed, skipping', { signature: item.signature, error: String(err) });
        }
      }

      if (mutated) await opts.store.save(origin, index);
    }
  }
}

async function cropToBbox(png: Buffer, bbox: { x: number; y: number; w: number; h: number }): Promise<Buffer> {
  // sharp wants non-negative integer coordinates and width/height ≥ 1.
  const left = Math.max(0, Math.round(bbox.x));
  const top = Math.max(0, Math.round(bbox.y));
  const width = Math.max(1, Math.round(bbox.w));
  const height = Math.max(1, Math.round(bbox.h));
  return sharp(png).extract({ left, top, width, height }).png().toBuffer();
}
