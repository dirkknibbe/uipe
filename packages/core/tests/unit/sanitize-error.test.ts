import { describe, it, expect } from 'vitest';
import { sanitizeToolError } from '../../src/utils/sanitize-error.js';

describe('sanitizeToolError', () => {
  it('strips absolute host paths', () => {
    const msg = sanitizeToolError(new Error("ENOENT: open '/Users/dirk/secret.txt'"));
    expect(msg).not.toContain('/Users/dirk');
    expect(msg).toMatch(/error|enoent/i);
  });

  it('strips nested host paths', () => {
    const msg = sanitizeToolError(new Error("ENOTDIR: not a directory, mkdir '/var/folders/x/y/sub'"));
    expect(msg).not.toContain('/var/folders');
  });

  it('caps very long messages', () => {
    expect(sanitizeToolError(new Error('x'.repeat(500))).length).toBeLessThanOrEqual(200);
  });

  it('handles non-Error throwables', () => {
    expect(typeof sanitizeToolError('boom')).toBe('string');
    expect(typeof sanitizeToolError(undefined)).toBe('string');
  });
});
