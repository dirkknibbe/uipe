const OPEN = '<untrusted_page_content>';
const CLOSE = '</untrusted_page_content>';

/**
 * Wrap page- or vision-derived text so the consuming agent treats it as DATA,
 * never as instructions. Any forged closing sentinel inside the payload is
 * HTML-entity-escaped, so it reads as inert text and cannot terminate the
 * envelope early to smuggle in instructions.
 *
 * security: inj-1, inj-3, inj-4, web-2 — trust boundary on perceived content.
 */
export function wrapUntrusted(body: string): string {
  const defanged = body.split(CLOSE).join('&lt;/untrusted_page_content&gt;');
  return `${OPEN}\n${defanged}\n${CLOSE}`;
}
