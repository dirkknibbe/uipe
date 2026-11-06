import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TSX = join(here, '../../../node_modules/.bin/tsx');

// `pnpm dataset:run` runs under tsx, which vitest does not reproduce: run one collector there for real.
describe('collectors under tsx', () => {
  it('tsx_input_and_mutation_collectors_attach_and_emit', async () => {
    const { stdout } = await promisify(execFile)(TSX, [join(here, 'tsx/collector-smoke.ts')], { timeout: 90_000 });
    const result = JSON.parse(stdout.trim().split('\n').filter((l) => l.startsWith('{')).at(-1) ?? '{}');
    expect(result).toEqual({ mutation: true, input: true, warnings: [] });
  }, 120_000);
});
