import { describe, it, expect } from 'vitest';
import { createServer, TOOL_NAMES } from '../../../src/mcp/server.js';

describe('createServer', () => {
  it('returns a server instance without throwing', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it('server is truthy', () => {
    const server = createServer();
    expect(server).toBeTruthy();
  });

  it('exports get_console_logs tool name', () => {
    expect(TOOL_NAMES).toContain('get_console_logs');
  });

  it('exports get_network_errors tool name', () => {
    expect(TOOL_NAMES).toContain('get_network_errors');
  });

  it('exports get_screenshot tool name', () => {
    expect(TOOL_NAMES).toContain('get_screenshot');
  });
});
