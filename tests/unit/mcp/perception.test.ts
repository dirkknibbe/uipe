import { describe, it, expect, vi } from 'vitest';
import {
  createPerceptionState,
  makeStartPerceptionTool,
  makeStopPerceptionTool,
  makeGetPerceptionSessionTool,
} from '../../../src/mcp/tools/perception.js';

function mkDeps() {
  const session = {
    isRunning: vi.fn(() => false),
    start: vi.fn(),
    stop: vi.fn(),
    getSummary: vi.fn(() => ({
      startedAt: 100,
      durationMs: 0,
      tickCounts: { frame: 0, semantic: 0, intent: 0 },
    } as any)),
    getStartedAt: vi.fn(() => 100),
  };
  const ensureLaunched = vi.fn(async () => {});
  const ensureWatchStarted = vi.fn(async () => {});
  const getPage = vi.fn(() => ({ url: () => 'http://x', on: vi.fn(), off: vi.fn() } as any));
  const getDeps = vi.fn(() => ({
    page: getPage(),
    frameCapture: {} as any,
    indexer: {} as any,
    structuralPipeline: {} as any,
    classifyByVlm: vi.fn() as any,
    getScreenshot: vi.fn() as any,
  }));
  return { session, ensureLaunched, ensureWatchStarted, getPage, getDeps };
}

describe('start_perception', () => {
  it('starts a session and reports startedAt', async () => {
    const deps = mkDeps();
    const state = createPerceptionState();
    state.createSession = vi.fn(() => deps.session as any);
    const tool = makeStartPerceptionTool({
      state,
      ensureLaunched: deps.ensureLaunched,
      ensureWatchStarted: deps.ensureWatchStarted,
      getSessionDeps: deps.getDeps,
    });
    const result = await tool.handler({});
    expect(result).toEqual({ status: 'started', startedAt: expect.any(Number) });
    expect(deps.ensureWatchStarted).toHaveBeenCalled();
    expect(deps.session.start).toHaveBeenCalled();
  });

  it('returns already-running if session is active', async () => {
    const deps = mkDeps();
    const state = createPerceptionState();
    deps.session.isRunning = vi.fn(() => true);
    state.currentSession = deps.session as any;
    const tool = makeStartPerceptionTool({
      state,
      ensureLaunched: deps.ensureLaunched,
      ensureWatchStarted: deps.ensureWatchStarted,
      getSessionDeps: deps.getDeps,
    });
    const result = await tool.handler({});
    expect(result).toEqual({ status: 'already-running', startedAt: 100 });
    expect(deps.ensureWatchStarted).not.toHaveBeenCalled();
  });
});

describe('stop_perception', () => {
  it('stops the session, stores summary, clears currentSession', async () => {
    const deps = mkDeps();
    deps.session.isRunning = vi.fn(() => true);
    const state = createPerceptionState();
    state.currentSession = deps.session as any;
    const tool = makeStopPerceptionTool({ state });
    const result = await tool.handler({});
    expect(deps.session.stop).toHaveBeenCalled();
    expect(state.currentSession).toBeNull();
    expect((result as any).startedAt).toBe(100);
  });

  it('returns lastSummary if no session is running', async () => {
    const state = createPerceptionState();
    state.lastSummary = { startedAt: 50, durationMs: 200 } as any;
    const tool = makeStopPerceptionTool({ state });
    const result = await tool.handler({});
    expect((result as any).startedAt).toBe(50);
  });

  it('returns error if no session and no last summary', async () => {
    const state = createPerceptionState();
    const tool = makeStopPerceptionTool({ state });
    const result = await tool.handler({});
    expect((result as any).error).toMatch(/no session/i);
  });
});

describe('get_perception_session', () => {
  it('returns the running summary without stopping', async () => {
    const deps = mkDeps();
    deps.session.isRunning = vi.fn(() => true);
    const state = createPerceptionState();
    state.currentSession = deps.session as any;
    const tool = makeGetPerceptionSessionTool({ state });
    const result = await tool.handler({});
    expect((result as any).startedAt).toBe(100);
    // session must NOT be stopped
    expect(deps.session.stop).not.toHaveBeenCalled();
  });

  it('falls back to lastSummary when no session is running', async () => {
    const state = createPerceptionState();
    state.lastSummary = { startedAt: 33 } as any;
    const tool = makeGetPerceptionSessionTool({ state });
    const result = await tool.handler({});
    expect((result as any).startedAt).toBe(33);
  });

  it('returns error when no session and no last summary', async () => {
    const state = createPerceptionState();
    const tool = makeGetPerceptionSessionTool({ state });
    const result = await tool.handler({});
    expect((result as any).error).toMatch(/no session/i);
  });
});
