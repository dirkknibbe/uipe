import { describe, it, expect } from 'vitest';
import { compileExcludePattern } from '../../src/utils/safe-regex.js';

describe('compileExcludePattern', () => {
  it('returns a usable RegExp for sane input', () => {
    const re = compileExcludePattern('HMR|webpack');
    expect(re).not.toBeNull();
    expect(re!.test('HMR update')).toBe(true);
    expect(re!.test('unrelated')).toBe(false);
  });

  it('returns null for over-long input (DoS guard)', () => {
    expect(compileExcludePattern('a'.repeat(201))).toBeNull();
  });

  it('returns null for invalid regex instead of throwing', () => {
    expect(compileExcludePattern('([')).toBeNull();
  });
});
