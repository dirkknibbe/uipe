import { describe, it, expect } from 'vitest';
import {
  isElementVisible, isElementInteractable, isElementEditable, isElementDisabled,
} from '../../../../src/pipelines/structural/visibility.js';

const viewport = { width: 1280, height: 720 };
const visibleRect = { x: 10, y: 10, width: 100, height: 40, top: 10, right: 110, bottom: 50, left: 10 };
const baseStyle = {
  display: 'block', visibility: 'visible', opacity: '1',
  overflow: 'visible', pointerEvents: 'auto', cursor: 'default',
  position: 'static', zIndex: 'auto',
};

describe('isElementVisible', () => {
  it('returns true for a normally visible element', () => {
    expect(isElementVisible(baseStyle, visibleRect, viewport)).toBe(true);
  });
  it('returns false for display:none', () => {
    expect(isElementVisible({ ...baseStyle, display: 'none' }, visibleRect, viewport)).toBe(false);
  });
  it('returns false for visibility:hidden', () => {
    expect(isElementVisible({ ...baseStyle, visibility: 'hidden' }, visibleRect, viewport)).toBe(false);
  });
  it('returns false for opacity:0', () => {
    expect(isElementVisible({ ...baseStyle, opacity: '0' }, visibleRect, viewport)).toBe(false);
  });
  it('returns false for zero-size element', () => {
    expect(isElementVisible(baseStyle, { ...visibleRect, width: 0, height: 0 }, viewport)).toBe(false);
  });
  it('returns false for off-screen element (above viewport)', () => {
    expect(isElementVisible(baseStyle, { ...visibleRect, top: -100, bottom: -10, y: -100 }, viewport)).toBe(false);
  });
});

describe('isElementInteractable', () => {
  it('returns true for a button tag', () => {
    expect(isElementInteractable('button', baseStyle, {}, true)).toBe(true);
  });
  it('returns true for an anchor', () => {
    expect(isElementInteractable('a', baseStyle, { href: '/home' }, true)).toBe(true);
  });
  it('returns false for plain div without role', () => {
    expect(isElementInteractable('div', baseStyle, {}, true)).toBe(false);
  });
  it('returns false when not visible', () => {
    expect(isElementInteractable('button', baseStyle, {}, false)).toBe(false);
  });
  it('returns false when pointer-events:none', () => {
    expect(isElementInteractable('button', { ...baseStyle, pointerEvents: 'none' }, {}, true)).toBe(false);
  });
  it('returns true for div with cursor:pointer', () => {
    expect(isElementInteractable('div', { ...baseStyle, cursor: 'pointer' }, {}, true)).toBe(true);
  });
  it('returns true for div with role=button', () => {
    expect(isElementInteractable('div', baseStyle, { role: 'button' }, true)).toBe(true);
  });
  it('returns false when disabled attribute present', () => {
    expect(isElementInteractable('button', baseStyle, { disabled: '' }, true)).toBe(false);
  });
});

describe('isElementEditable', () => {
  it('returns true for textarea', () => {
    expect(isElementEditable('textarea', {})).toBe(true);
  });
  it('returns true for text input', () => {
    expect(isElementEditable('input', { type: 'text' })).toBe(true);
  });
  it('returns false for submit input', () => {
    expect(isElementEditable('input', { type: 'submit' })).toBe(false);
  });
  it('returns true for contenteditable div', () => {
    expect(isElementEditable('div', { contenteditable: 'true' })).toBe(true);
  });
});

describe('isElementDisabled', () => {
  it('returns true when disabled attr present', () => {
    expect(isElementDisabled('button', { disabled: '' })).toBe(true);
  });
  it('returns true when aria-disabled=true', () => {
    expect(isElementDisabled('div', { 'aria-disabled': 'true' })).toBe(true);
  });
  it('returns false for normal element', () => {
    expect(isElementDisabled('button', {})).toBe(false);
  });
});
