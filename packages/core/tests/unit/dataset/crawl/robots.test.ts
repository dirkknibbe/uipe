import { describe, it, expect } from 'vitest';
import { fetchRobots } from '../../../../src/dataset/crawl/robots.js';

const UA = 'UIPE-research-crawler/0.1 (+https://example.com/about)';
const reply = (status: number, body = '') => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('fetchRobots', () => {
  it('robots_5xx_disallows_all', async () => {
    const r = await fetchRobots('https://a.test', UA, reply(503));
    expect(r.status).toBe('disallow-all');
    expect(r.allowed('/')).toBe(false);
  });

  it('network_error_disallows_all', async () => {
    const r = await fetchRobots('https://a.test', UA, (async () => { throw new Error('boom'); }) as unknown as typeof fetch);
    expect(r.status).toBe('disallow-all');
  });

  it('robots_404_allows_all', async () => {
    const r = await fetchRobots('https://a.test', UA, reply(404));
    expect(r.status).toBe('missing');
    expect(r.allowed('/anything')).toBe(true);
  });

  it('robots_longest_match_allow_beats_disallow', async () => {
    const r = await fetchRobots('https://a.test', UA, reply(200, 'User-agent: *\nDisallow: /private\nAllow: /private/open\n'));
    expect(r.status).toBe('ok');
    expect(r.allowed('/private/secret')).toBe(false);
    expect(r.allowed('/private/open/x')).toBe(true);
    expect(r.allowed('/public')).toBe(true);
  });

  it('specific_group_overrides_star_and_empty_disallow_allows', async () => {
    const body = 'User-agent: *\nDisallow: /\n\nUser-agent: UIPE-research-crawler\nDisallow:\n';
    const r = await fetchRobots('https://a.test', UA, reply(200, body));
    expect(r.allowed('/x')).toBe(true);
    const star = await fetchRobots('https://a.test', UA, reply(200, 'User-agent: *\nDisallow: /\n'));
    expect(star.allowed('/x')).toBe(false);
  });

  it('wildcards_and_end_anchor', async () => {
    const r = await fetchRobots('https://a.test', UA, reply(200, 'User-agent: *\nDisallow: /*.pdf$\n# c\n'));
    expect(r.allowed('/a/b.pdf')).toBe(false);
    expect(r.allowed('/a/b.pdf?x=1')).toBe(true);
  });
});
