import type { Page } from 'playwright';
import type { TimelineEvent, EventType } from './collectors/types.js';

export interface TemporalEventStreamOptions {
  capacity?: number;
  clearOnNavigate?: boolean;
}

export interface GetEventsFilter {
  since?: number;
  types?: EventType[];
}

export interface ClockNormalizer {
  fromWallTimeMs(wallMs: number): number;
  fromPerformanceNow(perfNow: number): number;
  fromCdpMonotonicSeconds(secs: number): number;
}

interface ClockAnchors {
  wallAnchorMs: number;
  performanceAnchorMs: number;
  pagePerformanceAnchorMs: number;
}

const buildNormalizer = (anchors: ClockAnchors): ClockNormalizer => ({
  fromWallTimeMs: (wallMs) => wallMs - anchors.wallAnchorMs,
  fromPerformanceNow: (perfNow) => perfNow - anchors.performanceAnchorMs,
  fromCdpMonotonicSeconds: (secs) => (secs * 1000) - anchors.pagePerformanceAnchorMs,
});

export class TemporalEventStream {
  private buffer: TimelineEvent[] = [];
  private readonly capacity: number;
  private readonly clearOnNavigate: boolean;
  private attachedPage: Page | undefined;
  private normalizer: ClockNormalizer | undefined;

  constructor(options: TemporalEventStreamOptions = {}) {
    this.capacity = options.capacity ?? 10000;
    this.clearOnNavigate = options.clearOnNavigate ?? true;
  }

  async attach(page: Page): Promise<void> {
    if (this.attachedPage) {
      await this.detach();
    }

    const wallAnchorMs = Date.now();
    const performanceAnchorMs = performance.now();
    const pagePerformanceAnchorMs = await page.evaluate(() => performance.now()).catch(() => 0);

    this.normalizer = buildNormalizer({
      wallAnchorMs,
      performanceAnchorMs,
      pagePerformanceAnchorMs,
    });
    this.attachedPage = page;
  }

  async detach(): Promise<void> {
    this.attachedPage = undefined;
    this.normalizer = undefined;
  }

  getNormalizer(): ClockNormalizer | undefined {
    return this.normalizer;
  }

  push(event: TimelineEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  getEvents(filter: GetEventsFilter = {}): TimelineEvent[] {
    let result = [...this.buffer];
    if (filter.since !== undefined) {
      const since = filter.since;
      result = result.filter(e => e.timestamp >= since);
    }
    if (filter.types !== undefined) {
      const types = new Set(filter.types);
      result = result.filter(e => types.has(e.type));
    }
    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}
