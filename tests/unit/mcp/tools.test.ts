import { describe, it, expect } from 'vitest';
import { TOOL_NAMES } from '../../../src/mcp/server.js';
import { TemporalEventStream } from '../../../src/pipelines/temporal/event-stream.js';
import { makeGetTimelineTool } from '../../../src/mcp/tools/get-timeline.js';
import type { InputPayload, MutationPayload } from '../../../src/pipelines/temporal/collectors/types.js';

describe('MCP Tools', () => {
  it('TOOL_NAMES has exactly 14 entries', () => {
    expect(TOOL_NAMES).toHaveLength(14);
  });

  it('contains all 7 original tools', () => {
    expect(TOOL_NAMES).toContain('navigate');
    expect(TOOL_NAMES).toContain('get_scene');
    expect(TOOL_NAMES).toContain('get_affordances');
    expect(TOOL_NAMES).toContain('act');
    expect(TOOL_NAMES).toContain('get_console_logs');
    expect(TOOL_NAMES).toContain('get_network_errors');
    expect(TOOL_NAMES).toContain('get_screenshot');
  });

  it('contains detect_elements tool', () => {
    expect(TOOL_NAMES).toContain('detect_elements');
  });

  it('contains analyze_visual tool', () => {
    expect(TOOL_NAMES).toContain('analyze_visual');
  });

  it('contains compare_states tool', () => {
    expect(TOOL_NAMES).toContain('compare_states');
  });

  it('contains watch tool', () => {
    expect(TOOL_NAMES).toContain('watch');
  });

  it('contains stop_watch tool', () => {
    expect(TOOL_NAMES).toContain('stop_watch');
  });

  it('contains get_timeline tool', () => {
    expect(TOOL_NAMES).toContain('get_timeline');
  });

  it('contains get_component_index tool', () => {
    expect(TOOL_NAMES).toContain('get_component_index');
  });
});

describe('get_timeline MCP tool', () => {
  const inputClick: InputPayload = { kind: 'click' };
  const mutationPayload: MutationPayload = { added: 1, removed: 0, attributes: 0, characterData: 0 };

  it('returns sorted events from the stream', async () => {
    const stream = new TemporalEventStream();
    stream.push({ id: 'e2', type: 'input', timestamp: 200, payload: inputClick });
    stream.push({ id: 'e1', type: 'mutation', timestamp: 100, payload: mutationPayload });

    const tool = makeGetTimelineTool(stream);
    const result = await tool.handler({});

    expect(Array.isArray(result.events)).toBe(true);
    expect(result.events.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('respects since filter', async () => {
    const stream = new TemporalEventStream();
    stream.push({ id: 'e1', type: 'input', timestamp: 100, payload: inputClick });
    stream.push({ id: 'e2', type: 'input', timestamp: 200, payload: inputClick });

    const tool = makeGetTimelineTool(stream);
    const result = await tool.handler({ since: 150 });

    expect(result.events.map((e) => e.id)).toEqual(['e2']);
  });

  it('respects types filter', async () => {
    const stream = new TemporalEventStream();
    stream.push({ id: 'e1', type: 'input', timestamp: 100, payload: inputClick });
    stream.push({ id: 'e2', type: 'mutation', timestamp: 200, payload: mutationPayload });

    const tool = makeGetTimelineTool(stream);
    const result = await tool.handler({ types: ['mutation'] });

    expect(result.events.map((e) => e.id)).toEqual(['e2']);
  });

  it('exposes a stable name and description', () => {
    const stream = new TemporalEventStream();
    const tool = makeGetTimelineTool(stream);
    expect(tool.name).toBe('get_timeline');
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(20);
  });
});
