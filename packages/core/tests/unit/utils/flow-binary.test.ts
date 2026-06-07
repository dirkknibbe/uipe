import { describe, it, expect } from 'vitest';
import {
  findWorkspaceRoot,
  resolveFlowBinaryPath,
} from '../../../src/utils/flow-binary.js';

// Simulated monorepo layout. The workspace marker (pnpm-workspace.yaml) and the
// Rust target/ dir both live at the repo root. The engine source lives at
// packages/core/src/..., and compiles to packages/core/dist/src/... — a depth
// that differs from the source by one level. The whole point of the fix is that
// binary resolution must be independent of BOTH the cwd and that depth delta.
const ROOT = '/repo';
const MARKER = '/repo/pnpm-workspace.yaml';
const SRC_DIR = '/repo/packages/core/src/mcp'; // tsx (dev/bench) import.meta.url dir
const DIST_DIR = '/repo/packages/core/dist/src/mcp'; // compiled import.meta.url dir
const EXPECTED = '/repo/target/release/uipe-vision';

const onlyMarker = (p: string) => p === MARKER;

describe('findWorkspaceRoot', () => {
  it('walks up multiple levels to the dir containing the marker', () => {
    expect(findWorkspaceRoot(SRC_DIR, onlyMarker)).toBe(ROOT);
    expect(findWorkspaceRoot(DIST_DIR, onlyMarker)).toBe(ROOT);
  });

  it('returns the start dir when the marker is already there', () => {
    expect(findWorkspaceRoot(ROOT, onlyMarker)).toBe(ROOT);
  });

  it('returns null when no marker exists up to the filesystem root', () => {
    expect(findWorkspaceRoot(SRC_DIR, () => false)).toBeNull();
  });
});

describe('resolveFlowBinaryPath', () => {
  it('prefers the UIPE_FLOW_BINARY env override and skips the walk-up', () => {
    const path = resolveFlowBinaryPath(
      { UIPE_FLOW_BINARY: '/custom/uipe-vision' },
      SRC_DIR,
      () => {
        throw new Error('exists must not be consulted when env override is set');
      },
    );
    expect(path).toBe('/custom/uipe-vision');
  });

  it('resolves the repo-root binary regardless of source vs compiled depth', () => {
    // The bug: a cwd- or fixed-offset-based path drifts between dev and prod.
    // Both call sites must land on the same repo-root binary.
    expect(resolveFlowBinaryPath({}, SRC_DIR, onlyMarker)).toBe(EXPECTED);
    expect(resolveFlowBinaryPath({}, DIST_DIR, onlyMarker)).toBe(EXPECTED);
  });

  it('falls back to a cwd-relative path when no workspace root is found', () => {
    const path = resolveFlowBinaryPath({}, SRC_DIR, () => false);
    expect(path.endsWith('target/release/uipe-vision')).toBe(true);
  });
});
