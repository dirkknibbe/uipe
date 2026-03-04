import { describe, it, expect } from 'vitest';
import { createServer } from '../../../src/mcp/server.js';

describe('createServer', () => {
  it('returns a server instance without throwing', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it('server is truthy', () => {
    const server = createServer();
    expect(server).toBeTruthy();
  });
});
