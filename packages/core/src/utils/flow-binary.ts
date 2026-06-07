import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const BINARY_REL = 'target/release/uipe-vision';

type ExistsFn = (path: string) => boolean;

/**
 * Walk up from `startDir` until a directory containing the workspace marker is
 * found. Returns that directory, or null if the filesystem root is reached
 * first. Used to locate the repo root independent of cwd and of whether we're
 * running from `src/` (tsx) or `dist/` (compiled), whose depths differ.
 */
export function findWorkspaceRoot(
  startDir: string,
  exists: ExistsFn = existsSync,
): string | null {
  let dir = startDir;
  for (;;) {
    if (exists(resolve(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Resolve the Rust optical-flow sidecar binary. Precedence:
 *   1. `UIPE_FLOW_BINARY` env override (set explicitly in the Fly container).
 *   2. `<workspace-root>/target/release/uipe-vision`, located by walking up from
 *      the caller's module dir to the workspace marker.
 *   3. Fallback to a cwd-relative path (legacy behavior) if no root is found.
 */
export function resolveFlowBinaryPath(
  env: NodeJS.ProcessEnv,
  startDir: string,
  exists: ExistsFn = existsSync,
): string {
  if (env.UIPE_FLOW_BINARY) return env.UIPE_FLOW_BINARY;
  const root = findWorkspaceRoot(startDir, exists);
  return resolve(root ?? process.cwd(), BINARY_REL);
}
