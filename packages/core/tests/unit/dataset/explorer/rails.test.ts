import { describe, it, expect } from 'vitest';
import { checkRails } from '../../../../src/dataset/explorer/rails.js';
import type { ExplorerCall } from '../../../../src/dataset/explorer/model.js';

const ctx = { startOrigin: 'https://site.test' };
const call = (tool: string, args: Record<string, unknown> = {}): ExplorerCall =>
  ({ tool, args, rationale: 'r' }) as ExplorerCall;
const refused = (c: ExplorerCall, extra: Partial<Parameters<typeof checkRails>[1]> = {}) => !checkRails(c, { ...ctx, ...extra }).ok;

describe('checkRails', () => {
  it('allows on-origin navigation and harmless acts', () => {
    expect(checkRails(call('navigate', { url: 'https://site.test/about' }), ctx)).toEqual({ ok: true });
    expect(checkRails(call('act', { type: 'hover', x: 10, y: 10 }), ctx).ok).toBe(true);
    expect(checkRails(call('act', { type: 'click', x: 10, y: 10, target: 'Open menu' }), ctx).ok).toBe(true);
    expect(checkRails(call('act', { type: 'pressKey', key: 'Escape' }), ctx).ok).toBe(true);
    expect(checkRails(call('get_scene'), ctx).ok).toBe(true);
    expect(checkRails(call('done'), ctx).ok).toBe(true);
  });

  it('rejects unknown tools', () => {
    expect(refused(call('get_screenshot'))).toBe(true);
  });

  it('rejects off-origin navigate and act:navigate, and unparseable urls', () => {
    expect(refused(call('navigate', { url: 'https://evil.test/' }))).toBe(true);
    expect(refused(call('navigate', { url: 'http://site.test/' }))).toBe(true);
    expect(refused(call('navigate', { url: 'not a url' }))).toBe(true);
    expect(refused(call('act', { type: 'navigate', url: 'https://evil.test/' }))).toBe(true);
  });

  it('rejects type, pressKey Enter and setViewport', () => {
    expect(refused(call('act', { type: 'type', text: 'hi', selector: 'input' }))).toBe(true);
    expect(refused(call('act', { type: 'pressKey', key: 'Enter' }))).toBe(true);
    expect(refused(call('act', { type: 'setViewport', width: 400, height: 400 }))).toBe(true);
  });

  it('rejects clicks on risky labels from the declared target, the selector, or the resolved scene label', () => {
    expect(refused(call('act', { type: 'click', x: 1, y: 1, target: 'Buy now' }))).toBe(true);
    expect(refused(call('act', { type: 'clickSelector', selector: 'button:has-text("Log in")' }))).toBe(true);
    expect(refused(call('act', { type: 'click', x: 1, y: 1, target: 'Pretty card' }), { targetLabel: 'Sign up free' })).toBe(true);
    expect(refused(call('act', { type: 'hover', x: 1, y: 1, target: 'Checkout' }))).toBe(false);
  });

  it('rejects arguments that fail actInputSchema', () => {
    expect(refused(call('act', { type: 'explode' }))).toBe(true);
    expect(refused(call('act', { type: 'wait', ms: 10_000_000 }))).toBe(true);
  });
});
