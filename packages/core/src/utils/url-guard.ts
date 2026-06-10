const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Today (local stdio): blocks file:/data:/javascript:/chrome:/etc. so a
 * prompt-injected agent cannot make Chromium read local files (or run inline
 * code) via navigate(). The agent's URL is attacker-influenced because a
 * previously-perceived page can inject instructions — treat it as semi-trusted.
 *
 * Phase 4 (network mode) must ALSO reject loopback/link-local/private hosts and
 * cloud-metadata IPs, and resolve-then-check to defeat DNS rebinding. That host
 * check is intentionally NOT here yet — see the security-remediation plan's
 * Phase-4 gate checklist.
 */
export function assertNavigableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw.slice(0, 80)}`);
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error(`URL scheme not allowed: ${url.protocol} (only http/https)`);
  }
  return url;
}
