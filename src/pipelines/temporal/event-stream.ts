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

export class TemporalEventStream {
  private buffer: TimelineEvent[] = [];
  private readonly capacity: number;

  constructor(options: TemporalEventStreamOptions = {}) {
    this.capacity = options.capacity ?? 10000;
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
