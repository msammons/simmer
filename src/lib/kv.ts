// Short-lived things Simmer keeps on the server (Nov 12, moved here Nov 13): Face ID challenges, a new phone's request,
// and ordering's prepared checkout and approvals. Kept in Redis with an expiry, outside the tabs (so Copy to Google
// Sheet leaves them out), each under a "simmer:" key; in memory without Redis (tests, the click-through checks).
// Since Nov 19 also the helper's jobs (one key each, with a sorted set as their index) and the checkout record (a list).
import { redis } from "./google/redis-tabs";

/**
 * What Redis needs to give here. Not tabs like the rest of the data (Nov 12): a tab is read, changed and written back,
 * so two answers sent at once with the same challenge (or the same approval) could both read it before either took it
 * out. GETDEL takes it out in one step, so only one can ever have it; the expiry makes Redis drop the ones never used.
 */
type Kv = {
  /** `nx`: only if the key isn't there yet, in one step (answers "OK" when it was set, null when it was there). */
  set(k: string, v: string, o: { ex: number; nx?: boolean }): Promise<unknown>;
  get(k: string): Promise<string | null>;
  getdel(k: string): Promise<string | null>;
  del(k: string): Promise<unknown>;
  mget(...k: string[]): Promise<(string | null)[]>;
  expire(k: string, secs: number): Promise<unknown>;
  // A list (the checkout record, Nov 19): added to at the end, never read and written back.
  rpush(k: string, ...v: string[]): Promise<unknown>;
  ltrim(k: string, start: number, stop: number): Promise<unknown>;
  lrange(k: string, start: number, stop: number): Promise<string[]>;
  // A sorted set (the jobs' index, Nov 19): members by a number, here when they were queued.
  zadd(k: string, m: { score: number; member: string }): Promise<unknown>;
  zrange(k: string, start: number, stop: number): Promise<string[]>;
  /** With `byScore` (the panel's log, Nov 19): the members scored from `min` to `max`, lowest first. */
  zrange(k: string, min: number, max: number | "+inf", o: { byScore: true }): Promise<string[]>;
  zrem(k: string, ...m: string[]): Promise<unknown>;
  zremrangebyscore(k: string, min: number, max: number): Promise<unknown>;
  // A set (the pickup times offered, Nov 19).
  sadd(k: string, ...m: string[]): Promise<unknown>;
  sismember(k: string, m: string): Promise<unknown>;
  /** Upstash's EVAL (Redis runs the script in one step). The in-memory stand-in has none (see swap). */
  eval?(script: string, keys: string[], args: string[]): Promise<unknown>;
};

// Without Redis (tests, the click-through checks): in memory, each with the time it's dropped.
type Held = { v: string | string[] | Map<string, number> | Set<string>; until: number };
const memoryKv = new Map<string, Held>();
const FOREVER = Number.MAX_SAFE_INTEGER;
const held = (k: string) => {
  const e = memoryKv.get(k);
  if (e && e.until < Date.now()) memoryKv.delete(k);
  return e && e.until >= Date.now() ? e : null;
};
const memoryGet = (k: string) => { const v = held(k)?.v; return typeof v === "string" ? v : null; };
function holding<T extends Held["v"]>(k: string, make: () => T): T {
  const e = held(k);
  if (e) return e.v as T;
  const v = make();
  memoryKv.set(k, { v, until: FOREVER });
  return v;
}
const span = <T>(all: T[], start: number, stop: number) => {
  const n = all.length, a = start < 0 ? Math.max(0, n + start) : start, b = stop < 0 ? n + stop : Math.min(stop, n - 1);
  return a > b ? [] : all.slice(a, b + 1);
};
const inMemory: Kv = {
  set: async (k, v, o) => { if (o.nx && memoryGet(k) !== null) return null; memoryKv.set(k, { v, until: Date.now() + o.ex * 1000 }); return "OK"; },
  get: async (k) => memoryGet(k),
  getdel: async (k) => { const v = memoryGet(k); memoryKv.delete(k); return v; },
  del: async (k) => { memoryKv.delete(k); },
  mget: async (...ks) => ks.map(memoryGet),
  expire: async (k, secs) => { const e = held(k); if (e) e.until = Date.now() + secs * 1000; },
  rpush: async (k, ...v) => { holding<string[]>(k, () => []).push(...v); },
  ltrim: async (k, start, stop) => { const e = held(k); if (e && Array.isArray(e.v)) e.v = span(e.v, start, stop); },
  lrange: async (k, start, stop) => { const v = held(k)?.v; return Array.isArray(v) ? span(v, start, stop) : []; },
  zadd: async (k, m) => { holding<Map<string, number>>(k, () => new Map()).set(m.member, m.score); },
  zrange: async (k: string, start: number, stop: number | "+inf", o?: { byScore: true }) => {
    const v = held(k)?.v;
    if (!(v instanceof Map)) return [];
    const all = [...v].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
    if (o?.byScore) return all.filter(([, n]) => n >= start && (stop === "+inf" || n <= stop)).map(([m]) => m);
    return span(all.map(([m]) => m), start, stop as number);
  },
  zrem: async (k, ...m) => { const v = held(k)?.v; if (v instanceof Map) m.forEach((x) => v.delete(x)); },
  zremrangebyscore: async (k, min, max) => { const v = held(k)?.v; if (v instanceof Map) for (const [m, s] of v) if (s >= min && s <= max) v.delete(m); },
  sadd: async (k, ...m) => { const s = holding<Set<string>>(k, () => new Set()); m.forEach((x) => s.add(x)); },
  sismember: async (k, m) => { const v = held(k)?.v; return v instanceof Set && v.has(m) ? 1 : 0; },
};
export const kv = (): Kv => (redis() as unknown as Kv | null) ?? inMemory;
export const json = <T>(v: string | null): T | null => { if (!v) return null; try { return JSON.parse(v) as T; } catch { return null; } };
export const secs = (ms: number) => Math.ceil(ms / 1000) + 5;

// KEYS[1]; ARGV: the value it must still hold, the value to write ("" deletes it), and its expiry in seconds.
const SWAP = `if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == "" then redis.call("DEL", KEYS[1]) else redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3])) end
return 1`;

/**
 * Writes `after` (or deletes the key, for "") only if the key still holds exactly `before`, in one step (Nov 19): a
 * job's status or an order's outcome changes only from what was read, so two changes at once can't both win. Without
 * EVAL (in memory) nothing else runs between the read and the write.
 */
export async function swap(k: string, before: string, after: string, ex: number): Promise<boolean> {
  const s = kv();
  if (s.eval) return Number(await s.eval(SWAP, [k], [before, after, String(ex)])) === 1;
  // In memory, read and written with no await between (Nov 19, review: two at once could both read `before` first).
  if (s === inMemory) {
    if (memoryGet(k) !== before) return false;
    if (after) memoryKv.set(k, { v: after, until: Date.now() + ex * 1000 }); else memoryKv.delete(k);
    return true;
  }
  if ((await s.get(k)) !== before) return false;
  if (after) await s.set(k, after, { ex }); else await s.del(k);
  return true;
}

/** For tests: everything, or only the keys starting with `prefix`. */
export const resetKv = (prefix = "") => { for (const k of [...memoryKv.keys()]) if (k.startsWith(prefix)) memoryKv.delete(k); };
