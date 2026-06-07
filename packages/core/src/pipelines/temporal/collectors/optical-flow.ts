import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright';
import { createLogger } from '../../../utils/logger.js';
import { TemporalEventStream } from '../event-stream.js';
import type {
  Collector,
  EventType,
  OpticalFlowMotionPayload,
  OpticalFlowRawPayload,
  OpticalFlowRegionPayload,
  TimelineEvent,
} from './types.js';

interface ProducerLike {
  on(event: 'event', listener: (raw: unknown) => void): unknown;
  off(event: 'event', listener: (raw: unknown) => void): unknown;
}

const log = createLogger('flow-collector');
const OPTICAL_FLOW_TYPES: ReadonlySet<EventType> = new Set([
  'optical-flow-raw',
  'optical-flow-region',
  'optical-flow-motion',
]);

export class FlowCollector implements Collector {
  readonly name = 'optical-flow';
  private stream: TemporalEventStream | null = null;
  private readonly listener: (raw: unknown) => void;

  constructor(private readonly producer: ProducerLike) {
    this.listener = (raw) => this.handle(raw);
  }

  async attach(_page: Page, stream: TemporalEventStream): Promise<void> {
    this.stream = stream;
    this.producer.on('event', this.listener);
  }

  async detach(): Promise<void> {
    this.producer.off('event', this.listener);
    this.stream = null;
  }

  private handle(raw: unknown): void {
    if (!this.stream || !raw || typeof raw !== 'object') return;
    const evt = raw as Record<string, unknown>;
    const type = evt.type;
    if (typeof type !== 'string' || !OPTICAL_FLOW_TYPES.has(type as EventType)) return;

    const ts = typeof evt.ts === 'number' ? evt.ts : Date.now();
    const normalizer = this.stream.getNormalizer();
    const timestamp = normalizer ? normalizer.fromPerformanceNow(ts) : ts;

    if (type === 'optical-flow-raw') {
      const event: TimelineEvent<'optical-flow-raw'> = {
        id: randomUUID(),
        type: 'optical-flow-raw',
        timestamp,
        payload: extractRawPayload(evt),
      };
      this.stream.push(event);
    } else if (type === 'optical-flow-region') {
      const event: TimelineEvent<'optical-flow-region'> = {
        id: randomUUID(),
        type: 'optical-flow-region',
        timestamp,
        payload: extractRegionPayload(evt),
      };
      this.stream.push(event);
    } else if (type === 'optical-flow-motion') {
      const event: TimelineEvent<'optical-flow-motion'> = {
        id: randomUUID(),
        type: 'optical-flow-motion',
        timestamp,
        payload: extractMotionPayload(evt),
      };
      this.stream.push(event);
    } else {
      log.warn('unrecognized optical-flow event type after set check', { type });
    }
  }
}

function extractRawPayload(evt: Record<string, unknown>): OpticalFlowRawPayload {
  return {
    frameTimestamp: Number(evt.frameTimestamp),
    keypoints: (evt.keypoints as OpticalFlowRawPayload['keypoints']) ?? [],
    gridSummary: (evt.gridSummary as OpticalFlowRawPayload['gridSummary']) ?? {
      cols: 0,
      rows: 0,
      vectors: [],
    },
  };
}

function extractRegionPayload(evt: Record<string, unknown>): OpticalFlowRegionPayload {
  return {
    frameTimestamp: Number(evt.frameTimestamp),
    regionId: String(evt.regionId),
    bbox: evt.bbox as OpticalFlowRegionPayload['bbox'],
    primitives: evt.primitives as OpticalFlowRegionPayload['primitives'],
  };
}

function extractMotionPayload(evt: Record<string, unknown>): OpticalFlowMotionPayload {
  return {
    endTs: typeof evt.endTs === 'number' ? evt.endTs : undefined,
    regionId: String(evt.regionId),
    pattern: evt.pattern as OpticalFlowMotionPayload['pattern'],
    params: evt.params as OpticalFlowMotionPayload['params'],
    confidence: Number(evt.confidence),
  };
}
