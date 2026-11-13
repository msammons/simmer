// Short-lived things Simmer keeps on the server (Nov 12, moved here Nov 13): Face ID challenges, a new phone's request,
// and ordering's prepared checkout and approvals. Kept in Redis with an expiry, outside the tabs (so Copy to Google
// Sheet leaves them out), each under a "simmer:" key; in memory without Redis (tests, the click-through checks).
import { redis } from "./google/redis-tabs";

/**
 * What Redis needs to give here. Not tabs like the rest of the data (Nov 12): a tab is read, changed and written back,
 * so two answers sent at once with the same challenge (or the same approval) could both read it before either took it
 * out. GETDEL takes it out in one step, so only one can ever have it; the expiry makes Redis drop the ones never used.
 */
type Kv = {
  set(k: string, v: string, o: { ex: number }): Promise<unknown>;
  get(k: string): Promise<string | null>;
  getdel(k: string): Promise<string | null>;
  del(k: string): Promise<unknown>;
};
// Without Redis (tests, the click-through checks): in memory, each with the time it's dropped.
const memoryKv = new Map<string, { v: string; until: number }>();
const memoryGet = (k: string) => {
  const e = memoryKv.get(k);
  if (e && e.until < Date.now()) memoryKv.delete(k);
  return e && e.until >= Date.now() ? e.v : null;
};
const inMemory: Kv = {
  set: async (k, v, o) => { memoryKv.set(k, { v, until: Date.now() + o.ex * 1000 }); },
  get: async (k) => memoryGet(k),
  getdel: async (k) => { const v = memoryGet(k); memoryKv.delete(k); return v; },
  del: async (k) => { memoryKv.delete(k); },
};
export const kv = (): Kv => (redis() as unknown as Kv | null) ?? inMemory;
export const json = <T>(v: string | null): T | null => { if (!v) return null; try { return JSON.parse(v) as T; } catch { return null; } };
export const secs = (ms: number) => Math.ceil(ms / 1000) + 5;

/** For tests. */
export const resetKv = () => memoryKv.clear();
