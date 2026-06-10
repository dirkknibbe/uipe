import { describe, it, expect } from 'vitest';
import { deriveName } from '../../../../src/pipelines/structural/dom-extractor.js';

describe('deriveName (inj-5: cap accessibility-name attributes)', () => {
  it('caps an oversized aria-label at 200 chars', () => {
    // Arrange — a hostile page stuffs a 50 KB string into aria-label
    const attributes = { 'aria-label': 'a'.repeat(50_000) };

    // Act
    const name = deriveName(attributes);

    // Assert
    expect(name).toHaveLength(200);
  });

  it('falls back aria-label -> title -> alt', () => {
    expect(deriveName({ title: 'the title', alt: 'the alt' })).toBe('the title');
    expect(deriveName({ alt: 'the alt' })).toBe('the alt');
  });

  it('returns undefined when no accessible-name attribute is present', () => {
    expect(deriveName({ role: 'button' })).toBeUndefined();
  });

  it('passes a short name through unchanged', () => {
    expect(deriveName({ 'aria-label': 'Sign in' })).toBe('Sign in');
  });
});
