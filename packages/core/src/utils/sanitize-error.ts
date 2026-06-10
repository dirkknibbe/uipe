// Single linear quantifier (no nested groups) so the sanitizer itself can't ReDoS.
// Matches a leading "/" then a run of non-space, non-quote chars (slashes included),
// i.e. a whole absolute path, and stops at the surrounding whitespace/quote.
const ABS_PATH = /\/[^\s'"]+/g;

/**
 * Build a generic, host-path-free message for MCP error responses (mcp-4).
 * Thrown Playwright/runtime errors otherwise propagate to the MCP client and
 * can leak absolute filesystem paths. The full error still goes to the logger.
 */
export function sanitizeToolError(e: unknown): string {
  const base = e instanceof Error ? e.message : String(e);
  return base.replace(ABS_PATH, '<path>').slice(0, 200);
}
