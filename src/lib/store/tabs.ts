// Simmer's data, tab by tab, in Upstash Redis (Nov 11): the Google Sheet allowed about 60 reads and 60 writes a minute,
// and a busy minute ran out ("That didn't go through"). Each tab is kept as its rows, exactly as on the Sheet (a header
// row, then one row per record); table.ts turns them into typed records. Everything was copied from the Sheet once
// (Nov 11); the Sheet is now only an export (export/sheet.ts).
//
// Changes are transactions (Nov 19): a change reads its tabs, works out the new rows and writes them only if no one else
// wrote those tabs in between (two phones, or two quick taps, are two server calls at once, and the later write erased
// the earlier one). If someone did, the change is worked out again from the rows as they are now.
import { AsyncLocalStorage } from "node:async_hooks";
import { AppError } from "../errors";

/** What this file needs from a Redis client (Upstash's, or a pretend one in tests). */
export type TabStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  keys(pattern: string): Promise<string[]>;
  /** Upstash's EVAL (only ever given CAS). Pretend stores in tests may leave it out (see setIfUnchanged). */
  eval?(script: string, keys: string[], args: string[]): Promise<unknown>;
};

/**
 * Every key's first part (Nov 19): "simmer" for the household's data; the test copy sets SIMMER_DATA_PREFIX (e.g.
 * "simmer-test") so it shares the free database without ever touching the real data.
 */
export const NS = process.env.SIMMER_DATA_PREFIX || "simmer";
export const PREFIX = `${NS}:tab:`;
const keyOf = (tab: string) => `${PREFIX}${tab}`;
/** Each tab's version, counted up by every write (outside the tab prefix, so Copy to Google Sheet leaves it out). */
const versionOf = (tab: string) => `${NS}:tabv:${tab}`;
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
  return (await run(s, change)).out;
}

async function run<T>(s: TabStore, change: () => Promise<T>): Promise<{ out: T; tx: Tx }> {
  const memo = new Map<string, unknown>(); // kept across tries (a guess asked of Gemini isn't asked again)
  for (let i = 0; i < TRIES; i++) {
    const tx: Tx = { s, rows: new Map(), seen: new Map(), loading: new Map(), dirty: new Set(), memo };
    const out = await current.run(tx, change);
    if (!tx.dirty.size || (await commit(tx))) return { out, tx };
  }
  throw new AppError("Someone changed that at the same moment. Try again.");
}

// ---- versions (Nov 19: "nothing changed" answers, ops/fresh.ts)

/** A version as read: a tab never written has none, read as "0" (every write counts up from there). */
const asVersion = (v: unknown) => String(Number(v ?? 0) || 0);

/** These tabs' versions as they are now: one MGET of the version keys alone. */
export async function versions(s: TabStore, tabs: string[]): Promise<string[]> {
  if (!tabs.length) return [];
  return (await s.mget(...tabs.map(versionOf))).map(asVersion);
}

/**
 * A transaction that also answers the versions of `tabs` its answer goes with: they're read first, rows and versions
 * in the one MGET (so the versions are exactly those of the rows the answer was made from), and a tab it writes is
 * answered at the version its write made. Not inside another transaction (versions: null there).
 */
export async function transactAt<T>(s: TabStore, tabs: string[], change: () => Promise<T>): Promise<{ out: T; versions: string[] | null }> {
  if (current.getStore()) return { out: await change(), versions: null };
  const { out, tx } = await run(s, async () => { await readTabs(s, tabs); return change(); });
  return { out, versions: tabs.map((t) => (tx.dirty.has(t) ? String(Number(asVersion(tx.seen.get(t))) + 1) : asVersion(tx.seen.get(t)))) };
}

/**
 * Runs `fn` outside any transaction (Nov 19, review): next/server's after() keeps the request's async context, so work
 * left for after the answer would otherwise join a transaction that has already been written, and its writes be lost.
 */
export const outside = <T>(fn: () => T): T => current.exit(fn);

/** Something worked out once per change, kept if the change runs again (a Gemini guess). */
export const memo = (): Map<string, unknown> => current.getStore()?.memo ?? new Map();
/** Whether a transaction is running here (its reads are already loaded, and must be what an answer is built from). */
export const inTransaction = (): boolean => Boolean(current.getStore());

// KEYS: each tab's rows key, then its version key. ARGV[i]: the version read ("!" when it wasn't read); ARGV[n + i]: the
// new rows ("!" when it isn't written). Nothing is written unless every tab read is still at the version read.
export const CAS = `local n = math.floor(#KEYS / 2)
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

/** Every tab Redis holds, with its rows: what Copy to Google Sheet sends. */
export async function allTabs(s: TabStore): Promise<[string, string[][]][]> {
  const keys = (await s.keys(`${PREFIX}*`)).sort();
  if (!keys.length) return [];
  const rows = (await s.mget(...keys)).map(parse);
  return keys.map((k, i) => [k.slice(PREFIX.length), rows[i] ?? []]);
}
