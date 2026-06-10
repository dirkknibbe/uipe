import { describe, it, expect } from 'vitest';
import { assertNavigableUrl } from '../../src/utils/url-guard.js';

describe('assertNavigableUrl', () => {
  it('allows http and https', () => {
    expect(() => assertNavigableUrl('https://example.com')).not.toThrow();
    expect(() => assertNavigableUrl('http://localhost:3000/x')).not.toThrow();
  });

  it('rejects local-file and code schemes', () => {
    for (const u of [
      'file:///Users/dirk/.ssh/id_rsa',
      'file://etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>x',
      'blob:https://x/y',
      'chrome://settings',
      'about:config',
      'view-source:https://x',
    ]) {
      expect(() => assertNavigableUrl(u), u).toThrow(/scheme not allowed/i);
    }
  });

  it('rejects unparseable input', () => {
    expect(() => assertNavigableUrl('not a url')).toThrow(/invalid url/i);
    expect(() => assertNavigableUrl('')).toThrow(/invalid url/i);
  });

  it('returns the parsed URL for allowed input', () => {
    const u = assertNavigableUrl('https://example.com/a?b=c');
    expect(u.hostname).toBe('example.com');
  });
});
