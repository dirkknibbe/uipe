import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, createServerWithEngine } from '../../../../src/mcp/server.js';
import type { StructuralPipeline } from '../../../../src/pipelines/structural/index.js';
import { InProcessTools } from '../../../../src/dataset/tools/in-process-tools.js';

let tools: InProcessTools | undefined;
afterEach(async () => {
  await tools?.close();
  tools = undefined;
  vi.restoreAllMocks();
});

describe('InProcessTools', () => {
  it('tool_call_round_trips_through_real_server', async () => {
    tools = await InProcessTools.connect(createServer());
    const res = await tools.call('get_scene', {});
    expect(res.isError).toBe(false);
    expect(res.text).toContain('No scene captured yet');
  });

  it('navigate_result_is_wrapped_in_untrusted_envelope', async () => {
    const { server, engine } = createServerWithEngine();
    vi.spyOn(engine.runtime, 'launch').mockResolvedValue(undefined);
    vi.spyOn(engine.runtime, 'navigate').mockResolvedValue(undefined as never);
    vi.spyOn(engine.runtime, 'currentUrl').mockReturnValue('http://localhost:1/');
    vi.spyOn(engine.runtime, 'getPage').mockReturnValue({
      evaluate: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
    } as never);
    vi.spyOn(engine.eventStream, 'attach').mockResolvedValue(undefined as never);
    vi.spyOn((engine as unknown as { structural: StructuralPipeline }).structural, 'extractStructure').mockResolvedValue([]);
    tools = await InProcessTools.connect(server);
    const res = await tools.call('navigate', { url: 'http://localhost:1/' });
    expect(res.isError).toBe(false);
    expect(res.text.startsWith('<untrusted_page_content>')).toBe(true);
  });
});
