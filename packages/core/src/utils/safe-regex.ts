const MAX_PATTERN_LEN = 200;

/**
 * Compile an agent-supplied exclude pattern with a length cap and no throw.
 * Returns null (caller treats as "no filter") on over-long or invalid input.
 *
 * The pattern is attacker-influenced: a visited page can steer the agent into
 * calling get_console_logs with a catastrophic-backtracking regex run over
 * page-controlled log text, pinning the single MCP event loop (mcp-2, web-6).
 * The length cap removes the worst ReDoS cases; a fully linear engine (re2) or
 * a worker timeout is the Phase-4 follow-up noted in the security report.
 */
export function compileExcludePattern(pattern: string): RegExp | null {
  if (pattern.length > MAX_PATTERN_LEN) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
