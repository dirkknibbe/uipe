export interface Robots { allowed(path: string): boolean; status: 'ok' | 'missing' | 'disallow-all' }

const PRODUCT_TOKEN = 'uipe-research-crawler';
const ROBOTS_TIMEOUT_MS = 10_000;

interface Rule { allow: boolean; pattern: RegExp; length: number }

function toRule(allow: boolean, value: string): Rule | null {
  if (!value) return null; // empty Disallow = nothing disallowed
  const re = value.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  const anchored = re.endsWith('\\$') ? `${re.slice(0, -2)}$` : re;
  return { allow, pattern: new RegExp(`^${anchored}`), length: value.length };
}

function parse(body: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let inAgents = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === 'user-agent') {
      if (!current || !inAgents) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      inAgents = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      inAgents = false;
      const rule = toRule(key === 'allow', value);
      if (rule) current.rules.push(rule);
    }
  }
  const pick = (name: string) => groups.filter((g) => g.agents.includes(name)).flatMap((g) => g.rules);
  const specific = groups.some((g) => g.agents.includes(PRODUCT_TOKEN));
  return specific ? pick(PRODUCT_TOKEN) : pick('*');
}

export async function fetchRobots(origin: string, userAgent: string, fetchImpl: typeof fetch = fetch): Promise<Robots> {
  let res: Response;
  try {
    res = await fetchImpl(`${origin}/robots.txt`, {
      headers: { 'User-Agent': userAgent }, redirect: 'follow', signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });
  } catch {
    return { status: 'disallow-all', allowed: () => false };
  }
  if (res.status >= 500) return { status: 'disallow-all', allowed: () => false };
  if (res.status >= 400) return { status: 'missing', allowed: () => true };
  const rules = parse(await res.text());
  return {
    status: 'ok',
    allowed(path) {
      let best: Rule | undefined;
      for (const r of rules) {
        if (!r.pattern.test(path)) continue;
        if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}
