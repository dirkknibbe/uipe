import type { Page } from 'playwright';
import type { Collector } from './types.js';
import type { TemporalEventStream } from '../event-stream.js';

export interface PHashChangeDiff {
  region: { x: number; y: number; width: number; height: number };
  hammingDistance: number;
}

export interface PHashEmitter {
  onPHashChange(callback: (diff: PHashChangeDiff) => void): void;
  offPHashChange(callback: (diff: PHashChangeDiff) => void): void;
}

let nextId = 0;

export class PHashCollector implements Collector {
  readonly name = 'phash';
  private callback: ((diff: PHashChangeDiff) => void) | undefined;

  constructor(private readonly emitter: PHashEmitter | undefined) {}

  async attach(_page: Page, stream: TemporalEventStream): Promise<void> {
    const normalizer = stream.getNormalizer();
    if (!normalizer) {
      console.warn('PHashCollector: stream not attached, skipping');
      return;
    }
    if (!this.emitter) {
      console.warn('PHashCollector: no PHashEmitter provided (visual pipeline not exposing diffs yet); skipping');
      return;
    }

    this.callback = (diff: PHashChangeDiff) => {
      stream.push({
        id: `phash-${++nextId}`,
        type: 'phash-change',
        timestamp: normalizer.fromPerformanceNow(performance.now()),
        payload: {
          region: diff.region,
          hammingDistance: diff.hammingDistance,
        },
      });
    };
    this.emitter.onPHashChange(this.callback);
  }

  async detach(): Promise<void> {
    if (this.emitter && this.callback) {
      this.emitter.offPHashChange(this.callback);
    }
    this.callback = undefined;
  }
}
