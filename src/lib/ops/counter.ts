// A counter that runs out (Nov 19): the day's recipe readings and filings (wrong passcodes count in lockout.ts). Kept in
// Redis under NS keys with an expiry, so nothing ever has to clear it; in memory without Redis (tests, the checks).
import { kv } from "../kv";

// KEYS[1]; ARGV: the expiry in seconds, and a count at which the expiry starts again (0: never). One step in Redis.
const BUMP = `local n = redis.call("INCR", KEYS[1])
if n == 1 or n == tonumber(ARGV[2]) then redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1])) end
return n`;

const local = new Map<string, { n: number; until: number }>();

/** Counts one more; the key goes `secs` after its first count (and again from `restartAt`, when it's reached). */
export async function bump(key: string, secs: number, restartAt = 0): Promise<number> {
  const s = kv();
  if (s.eval) return Number(await s.eval(BUMP, [key], [String(secs), String(restartAt)]));
  const now = Date.now(), e = local.get(key);
  const c = e && e.until > now ? e : { n: 0, until: now + secs * 1000 };
  c.n++;
  if (c.n === restartAt) c.until = now + secs * 1000;
  local.set(key, c);
  return c.n;
}

/** For tests. */
export const resetCounters = () => local.clear();
