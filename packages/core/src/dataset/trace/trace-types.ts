import type { RejectReason } from '../types.js';

interface Base { id: string; runId: string; site: string; step: number; ts: number }

export type TraceRecord =
  | (Base & { type: 'run-start' })
  | (Base & { type: 'run-end' })
  | (Base & { type: 'explorer-step'; observationSummary: string; decision: string; rationale: string; inputTokens: number; outputTokens: number; usd: number })
  | (Base & { type: 'tool-call'; tool: string; detail?: string })
  | (Base & { type: 'tool-refused'; tool: string; detail?: string })
  | (Base & { type: 'trigger'; triggerId: string; detail?: string })
  | (Base & { type: 'episode'; episodeId: string; detail?: string })
  | (Base & { type: 'clip-kept'; episodeId: string; clipId: string })
  | (Base & { type: 'clip-rejected'; episodeId: string; reason: RejectReason; detail: string })
  | (Base & { type: 'clip-duplicate'; episodeId: string; duplicateOf: string })
  | (Base & { type: 'cap-hit'; cap: string })
  | (Base & { type: 'error'; message: string });
