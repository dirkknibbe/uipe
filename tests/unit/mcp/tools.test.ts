import { describe, it, expect } from 'vitest';
import { TOOL_NAMES } from '../../../src/mcp/server.js';

describe('MCP Tools', () => {
  it('TOOL_NAMES has exactly 12 entries', () => {
    expect(TOOL_NAMES).toHaveLength(12);
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
});
