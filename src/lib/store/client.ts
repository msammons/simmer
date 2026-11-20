// Which store the tabs are in (Nov 19: one path). In production, Upstash Redis; without Redis keys (local dev, tests,
// the smoke and helper checks) the in-memory store seeded from data/ (memory.ts). Nothing else asks which.
import { Redis } from "@upstash/redis";
import { memoryStore } from "./memory";
import * as T from "./tabs";
import type { TabStore } from "./tabs";

let client: TabStore | null | undefined;
// One per server process, however many route bundles load this file (they'd each have their own otherwise).
const g = globalThis as { simmerMemoryStore?: ReturnType<typeof memoryStore> };
const memory = (g.simmerMemoryStore ??= memoryStore());

/** The Redis client, when the app has one (its keys come from Vercel); null in local dev and tests. */
export function redis(): TabStore | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? (new Redis({ url, token, automaticDeserialization: false }) as unknown as TabStore) : null;
  return client;
}
/** Tests: a pretend Redis, or null for none (the in-memory store again). */
export const useTabStore = (s: TabStore | null) => { client = s; };
/** Tests: these tabs (or every one) back to their samples in the in-memory store. */
export const resetTabs = (tabs?: string[]) => memory.reset(tabs);

/** The store the tabs are in: Redis, or the in-memory one. */
export const store = (): TabStore => redis() ?? memory;

export const readTab = (tab: string) => T.readTab(store(), tab);
export const readTabs = (tabs: string[]) => T.readTabs(store(), tabs);
export const writeTab = (tab: string, rows: string[][]) => T.writeTab(store(), tab, rows);
export const allTabs = () => T.allTabs(store());

/**
 * A change as one transaction (tabs.ts, Nov 19): what it reads and writes is checked and written together, and it runs
 * again from fresh rows if someone else wrote meanwhile.
 */
export const transact = <R>(change: () => Promise<R>): Promise<R> => T.transact(store(), change);
/** A transaction answered with the versions of `tabs` its answer was made from (tabs.ts). */
export const transactAt = <R>(tabs: string[], change: () => Promise<R>) => T.transactAt(store(), tabs, change);
/** These tabs' versions now: one small read. */
export const tabVersions = (tabs: string[]) => T.versions(store(), tabs);
/** A function whose every call is one transaction. */
export const atomically = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => (...a: A): Promise<R> => transact(() => f(...a));
