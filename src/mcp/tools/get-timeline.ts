import type { TemporalEventStream } from '../../pipelines/temporal/event-stream.js';
import type { EventType, TimelineEvent } from '../../pipelines/temporal/collectors/types.js';

export interface GetTimelineArgs {
  since?: number;
  types?: EventType[];
}

export interface GetTimelineTool {
  readonly name: 'get_timeline';
  readonly description: string;
  readonly inputSchema: {
    type: 'object';
    properties: {
      since: { type: 'number'; description: string };
      types: { type: 'array'; items: { type: 'string' }; description: string };
    };
    required: never[];
  };
  handler(args: GetTimelineArgs): Promise<{ events: TimelineEvent[] }>;
}

export const makeGetTimelineTool = (stream: TemporalEventStream): GetTimelineTool => ({
  name: 'get_timeline',
  description:
    'Returns the time-synchronized event stream from the active browser session as ordered events on a single monotonic clock. Use this to see what happened: clicks, DOM mutations, network requests, CSS animations, and pHash changes, all timestamped in stream-relative milliseconds.',
  inputSchema: {
    type: 'object',
    properties: {
      since: { type: 'number', description: 'Only return events with timestamp >= since (stream-relative ms)' },
      types: { type: 'array', items: { type: 'string' }, description: 'Filter by event types (input, mutation, network-request, network-response, animation-start, animation-end, phash-change)' },
    },
    required: [],
  },
  async handler(args) {
    return { events: stream.getEvents(args) };
  },
});
