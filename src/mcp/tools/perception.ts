import { PerceptionSession, type SessionStartDeps } from '../../pipelines/perception/session.js';
import type { TemporalEventStream } from '../../pipelines/temporal/event-stream.js';
import type { PerceptionSessionSummary } from '../../pipelines/perception/types.js';

export interface PerceptionState {
  currentSession: PerceptionSession | null;
  lastSummary: PerceptionSessionSummary | null;
  /** Test seam: factory for creating a new PerceptionSession. */
  createSession: (eventStream: TemporalEventStream) => PerceptionSession;
}

export function createPerceptionState(): PerceptionState {
  return {
    currentSession: null,
    lastSummary: null,
    createSession: (eventStream) => new PerceptionSession({ eventStream }),
  };
}

// ---------------------------------------------------------------------------
// start_perception
// ---------------------------------------------------------------------------

interface StartOptions {
  state: PerceptionState;
  ensureLaunched: () => Promise<void>;
  ensureWatchStarted: () => Promise<void>;
  getEventStream?: () => TemporalEventStream;
  getSessionDeps: () => SessionStartDeps;
}

export interface StartPerceptionTool {
  readonly name: 'start_perception';
  readonly description: string;
  readonly inputSchema: { type: 'object'; properties: Record<string, never>; required: never[] };
  handler(args: Record<string, never>): Promise<{ status: 'started' | 'already-running'; startedAt: number }>;
}

export function makeStartPerceptionTool(opts: StartOptions): StartPerceptionTool {
  return {
    name: 'start_perception',
    description:
      'Begin a perception session. Starts the frame/semantic/intent loop hierarchy on the current page. Auto-starts watch (keyframe capture) if not already running. Use stop_perception to end the session and get a summary.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const s = opts.state.currentSession;
      if (s && s.isRunning()) {
        return { status: 'already-running', startedAt: s.getStartedAt() };
      }
      await opts.ensureLaunched();
      await opts.ensureWatchStarted();
      const eventStream = opts.getEventStream?.();
      const session = eventStream
        ? opts.state.createSession(eventStream)
        : opts.state.createSession(null as unknown as TemporalEventStream);
      const deps = opts.getSessionDeps();
      const startedAt = Date.now();
      await session.start(startedAt, deps);
      opts.state.currentSession = session;
      return { status: 'started', startedAt };
    },
  };
}

// ---------------------------------------------------------------------------
// stop_perception
// ---------------------------------------------------------------------------

interface StopOptions {
  state: PerceptionState;
}

export interface StopPerceptionTool {
  readonly name: 'stop_perception';
  readonly description: string;
  readonly inputSchema: { type: 'object'; properties: Record<string, never>; required: never[] };
  handler(args: Record<string, never>): Promise<PerceptionSessionSummary | { error: string }>;
}

export function makeStopPerceptionTool(opts: StopOptions): StopPerceptionTool {
  return {
    name: 'stop_perception',
    description:
      "End the current perception session and return its summary (tick counts, anomalies, escalations, intent results, VLM cost). Does NOT stop watch — keyframe capture continues for non-perception consumers. If no session is running, returns the previous session's summary if available.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const session = opts.state.currentSession;
      if (session && session.isRunning()) {
        session.stop(Date.now());
        const summary = session.getSummary();
        opts.state.lastSummary = summary;
        opts.state.currentSession = null;
        return summary;
      }
      if (opts.state.lastSummary) {
        return opts.state.lastSummary;
      }
      return { error: 'No session active and no prior summary' };
    },
  };
}

// ---------------------------------------------------------------------------
// get_perception_session
// ---------------------------------------------------------------------------

interface GetOptions {
  state: PerceptionState;
}

export interface GetPerceptionSessionTool {
  readonly name: 'get_perception_session';
  readonly description: string;
  readonly inputSchema: { type: 'object'; properties: Record<string, never>; required: never[] };
  handler(args: Record<string, never>): Promise<PerceptionSessionSummary | { error: string }>;
}

export function makeGetPerceptionSessionTool(opts: GetOptions): GetPerceptionSessionTool {
  return {
    name: 'get_perception_session',
    description:
      "Return the current perception session's summary if one is running. Otherwise return the last completed session's summary if any. Use this to inspect what perception is seeing mid-flight without stopping the session.",
    inputSchema: { type: 'object', properties: {}, required: [] },
    async handler() {
      const session = opts.state.currentSession;
      if (session && session.isRunning()) {
        return session.getSummary();
      }
      if (opts.state.lastSummary) {
        return opts.state.lastSummary;
      }
      return { error: 'No session active and no prior summary' };
    },
  };
}
