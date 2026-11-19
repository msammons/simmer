// Simmer's data, tab by tab, in Upstash Redis (Nov 11): the Google Sheet allowed about 60 reads and 60 writes a minute,
// and a busy minute ran out ("That didn't go through"). Each tab is kept as its rows, exactly as on the Sheet, so the
// rest of the app reads and writes the same rows it always did. Everything was copied from the Sheet once (Nov 11); the
// Sheet is now only an export (Settings → Copy to Google Sheet).
//
// Changes are transactions (Nov 19): a change reads its tabs, works out the new rows and writes them only if no one else
// wrote those tabs in between (two phones, or two quick taps, are two server calls at once, and the later write erased
// the earlier one). If someone did, the change is worked out again from the rows as they are now.
import { AsyncLocalStorage } from "node:async_hooks";
import { Redis } from "@upstash/redis";
import { AppError } from "../errors";

/** What this file needs from a Redis client (Upstash's, or a pretend one in tests). */
export type TabStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  keys(pattern: string): Promise<string[]>;
  /** Upstash's EVAL. Pretend stores in tests leave it out (see setIfUnchanged). */
  eval?(script: string, keys: string[], args: string[]): Promise<unknown>;
};

let client: TabStore | null | undefined;
/** The Redis client, when the app has one (its keys come from Vercel). */
export function redis(): TabStore | null {
  if (client !== undefined) return client;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? (new Redis({ url, token, automaticDeserialization: false }) as unknown as TabStore) : null;
  return client;
}
/** Tests: a pretend Redis (or none). */
export const useTabStore = (s: TabStore | null) => { client = s; };

const PREFIX = "simmer:tab:";
const keyOf = (tab: string) => `${PREFIX}${tab}`;
/** Each tab's version, counted up by every write (outside the tab prefix, so Copy to Google Sheet leaves it out). */
const versionOf = (tab: string) => `simmer:tabv:${tab}`;
const parse = (v: string | null): string[][] | null => (v == null ? null : (JSON.parse(v) as string[][]));
const copy = (rows: string[][]) => rows.map((r) => [...r]);

// ---- transactions

type Tx = { s: TabStore; rows: Map<string, string[][]>; seen: Map<string, string>; loading: Map<string, Promise<void>>; dirty: Set<string>; memo: Map<string, unknown> };
const current = new AsyncLocalStorage<Tx>();
// Each round lets at least one waiting change through, so n changes at the same moment need up to n rounds (Nov 19: six
// at once against the real database ran out at 5).
const TRIES = 12;

/**
 * Runs a change as one transaction: every tab it reads is read once (later reads see its own writes), and what it
 * writes is written together, only if none of the tabs it read changed meanwhile; otherwise it runs again from fresh
 * rows. Inside another transaction it's part of that one. A tab that isn't there yet reads as no rows, and the first
 * write makes it (Nov 19: reading used to write an empty tab, which could land over one just made).
 */
export async function transact<T>(s: TabStore, change: () => Promise<T>): Promise<T> {
  if (current.getStore()) return change();
  const memo = new Map<string, unknown>(); // kept across tries (a guess asked of Gemini isn't asked again)
  for (let i = 0; i < TRIES; i++) {
    const tx: Tx = { s, rows: new Map(), seen: new Map(), loading: new Map(), dirty: new Set(), memo };
    const out = await current.run(tx, change);
    if (!tx.dirty.size || (await commit(tx))) return out;
  }
  throw new AppError("Someone changed that at the same moment. Try again.");
}

/**
 * Runs `fn` outside any transaction (Nov 19, review): next/server's after() keeps the request's async context, so work
 * left for after the answer would otherwise join a transaction that has already been written, and its writes be lost.
 */
export const outside = <T>(fn: () => T): T => current.exit(fn);

/** Something worked out once per change, kept if the change runs again (a Gemini guess). */
export const memo = (): Map<string, unknown> => current.getStore()?.memo ?? new Map();

// KEYS: each tab's rows key, then its version key. ARGV[i]: the version read ("!" when it wasn't read); ARGV[n + i]: the
// new rows ("!" when it isn't written). Nothing is written unless every tab read is still at the version read.
const CAS = `local n = math.floor(#KEYS / 2)
for i = 1, n do
  if ARGV[i] ~= "!" and (redis.call("GET", KEYS[2 * i]) or "") ~= ARGV[i] then return 0 end
end
for i = 1, n do
  if ARGV[n + i] ~= "!" then redis.call("SET", KEYS[2 * i - 1], ARGV[n + i]); redis.call("INCR", KEYS[2 * i]) end
end
return 1`;

async function commit(tx: Tx): Promise<boolean> {
  const tabs = [...new Set([...tx.seen.keys(), ...tx.dirty])];
  const keys = tabs.flatMap((t) => [keyOf(t), versionOf(t)]);
  const args = [...tabs.map((t) => tx.seen.get(t) ?? "!"), ...tabs.map((t) => (tx.dirty.has(t) ? JSON.stringify(tx.rows.get(t)) : "!"))];
  if (tx.s.eval) return Number(await tx.s.eval(CAS, keys, args)) === 1;
  return setIfUnchanged(tx.s, keys, args);
}

/** The same check and write for a pretend store without EVAL (tests: nothing else runs between its steps). */
async function setIfUnchanged(s: TabStore, keys: string[], args: string[]): Promise<boolean> {
  const n = keys.length / 2;
  for (let i = 0; i < n; i++) if (args[i] !== "!" && ((await s.get(keys[2 * i + 1])) ?? "") !== args[i]) return false;
  for (let i = 0; i < n; i++) {
    if (args[n + i] === "!") continue;
    await s.set(keys[2 * i], args[n + i]);
    await s.set(keys[2 * i + 1], String(Number((await s.get(keys[2 * i + 1])) ?? 0) + 1));
  }
  return true;
}

// ---- reading and writing

export async function readTabs(s: TabStore, tabs: string[]): Promise<string[][][]> {
  if (!tabs.length) return [];
  const tx = current.getStore();
  if (!tx) return (await s.mget(...tabs.map(keyOf))).map((v) => parse(v) ?? []);
  const need = [...new Set(tabs.filter((t) => !tx.rows.has(t) && !tx.loading.has(t)))];
  if (need.length) {
    const got = tx.s.mget(...need.flatMap((t) => [keyOf(t), versionOf(t)])).then((v) => need.forEach((t, i) => {
      if (!tx.rows.has(t)) tx.rows.set(t, parse(v[2 * i]) ?? []);
      tx.seen.set(t, v[2 * i + 1] == null ? "" : String(v[2 * i + 1]));
    }));
    for (const t of need) tx.loading.set(t, got);
  }
  await Promise.all(tabs.map((t) => tx.loading.get(t)));
  return tabs.map((t) => copy(tx.rows.get(t)!));
}

export const readTab = async (s: TabStore, tab: string) => (await readTabs(s, [tab]))[0];

export async function writeTab(s: TabStore, tab: string, rows: string[][]): Promise<void> {
  const tx = current.getStore();
  if (!tx) return transact(s, () => writeTab(s, tab, rows));
  tx.rows.set(tab, copy(rows));
  tx.dirty.add(tab);
}

export function appendRows(s: TabStore, tab: string, rows: string[][]) {
  if (!rows.length) return Promise.resolve();
  return transact(s, async () => {
    // Google's append goes after the last row with anything in it.
    const all = await readTab(s, tab);
    while (all.length && !all[all.length - 1].some(Boolean)) all.pop();
    await writeTab(s, tab, [...all, ...rows]);
  });
}

const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
/** "List!B5:K5" → the tab and where the values start. */
function parseRange(range: string) {
  const bang = range.lastIndexOf("!");
  const tab = (bang < 0 ? range : range.slice(0, bang)).replace(/^'|'$/g, "");
  const at = bang < 0 ? "A1" : range.slice(bang + 1).split(":")[0];
  const m = at.match(/^([A-Z]+)(\d+)$/);
  return { tab, col: m ? colNum(m[1]) : 0, row: m ? Number(m[2]) - 1 : 0 };
}

/** Cells written at A1 ranges, as Google's values update does: each tab read once and written once, together. */
export function updateRanges(s: TabStore, data: { range: string; values: string[][] }[]) {
  if (!data.length) return Promise.resolve();
  const byTab = new Map<string, { col: number; row: number; values: string[][] }[]>();
  for (const d of data) {
    const p = parseRange(d.range);
    byTab.set(p.tab, [...(byTab.get(p.tab) ?? []), { col: p.col, row: p.row, values: d.values }]);
  }
  return transact(s, async () => {
    for (const [tab, puts] of byTab) {
      const all = await readTab(s, tab);
      for (const { col, row, values } of puts) {
        values.forEach((vals, i) => {
          const target = (all[row + i] ??= []);
          vals.forEach((v, j) => { while (target.length < col + j) target.push(""); target[col + j] = v; });
        });
      }
      await writeTab(s, tab, Array.from(all, (r) => r ?? [])); // rows skipped over are empty
    }
  });
}

/** Every tab Redis holds, with its rows: what Copy to Google Sheet sends. */
export async function allTabs(s: TabStore): Promise<[string, string[][]][]> {
  const keys = (await s.keys(`${PREFIX}*`)).sort();
  if (!keys.length) return [];
  const rows = (await s.mget(...keys)).map(parse);
  return keys.map((k, i) => [k.slice(PREFIX.length), rows[i] ?? []]);
}
