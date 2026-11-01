import { describe, it, expect, vi } from 'vitest';
import type { Page, CDPSession } from 'playwright';
import { ScreencastRecorder } from '../../../../src/dataset/capture/screencast-recorder.js';
import type { ClockNormalizer } from '../../../../src/pipelines/temporal/event-stream.js';

const norm = { fromWallTimeMs: (w: number) => w - 1000 } as unknown as ClockNormalizer;
const setup = async () => {
  const handlers = new Map<string, Function>();
  const cdp = {
    send: vi.fn(async () => undefined),
    on: vi.fn((e: string, h: Function) => handlers.set(e, h)),
    off: vi.fn(), detach: vi.fn(async () => undefined),
  } as unknown as CDPSession;
  const page = { context: () => ({ newCDPSession: async () => cdp }) } as unknown as Page;
  const rec = new ScreencastRecorder(page, () => norm);
  await rec.start();
  const emit = (t: number, sx = 0, sy = 0, sessionId = 1) =>
    handlers.get('Page.screencastFrame')!({ data: Buffer.from('x').toString('base64'), sessionId, metadata: { timestamp: t, scrollOffsetX: sx, scrollOffsetY: sy } });
  return { rec, cdp, emit };
};

describe('ScreencastRecorder', () => {
  it('frames_use_metadata_timestamp_not_Date_now', async () => {
    const { rec, cdp, emit } = await setup();
    emit(5.0);
    expect(rec.framesBetween(0, 1e9)[0].ts).toBe(4000);
    expect(cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 1 });
    expect((cdp.send as any).mock.calls[0]).toEqual(['Page.startScreencast',
      { format: 'jpeg', quality: 70, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 }]);
  });
  it('frames_between_filters_by_ts_and_carries_scroll_offsets', async () => {
    const { rec, emit } = await setup();
    emit(2, 0, 10); emit(3, 5, 20); emit(4, 0, 30);
    const f = rec.framesBetween(2000, 2000);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ ts: 2000, scrollX: 5, scrollY: 20 });
    rec.dropBefore(2000);
    expect(rec.framesBetween(0, 1e9)).toHaveLength(2);
  });
  it('ring_buffer_caps_at_900_frames', async () => {
    const { rec, emit } = await setup();
    for (let i = 0; i < 950; i++) emit(1 + i / 1000);
    expect(rec.framesBetween(-1e9, 1e9)).toHaveLength(900);
  });
});
