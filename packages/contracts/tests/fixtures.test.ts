import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  visionAnalyzeRequestSchema,
  visionAnalyzeResponseSchema,
} from '../src/schema.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/v1');
const load = (f: string) => JSON.parse(readFileSync(resolve(dir, f), 'utf-8'));

describe('canonical /v1 fixtures (cross-language source of truth)', () => {
  it('valid request fixture parses', () => {
    expect(() => visionAnalyzeRequestSchema.parse(load('analyze.request.json'))).not.toThrow();
  });
  it.each(['analyze.response.ok.json', 'analyze.response.warming.json', 'analyze.response.degraded.json'])(
    'valid response fixture parses: %s',
    (f) => expect(() => visionAnalyzeResponseSchema.parse(load(f))).not.toThrow(),
  );
  it('invalid response fixture is rejected', () => {
    expect(() => visionAnalyzeResponseSchema.parse(load('analyze.response.invalid-missing-reason.json'))).toThrow();
  });
  it('invalid request fixture is rejected', () => {
    expect(() => visionAnalyzeRequestSchema.parse(load('analyze.request.invalid-bad-version.json'))).toThrow();
  });
});
