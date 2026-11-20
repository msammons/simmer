// Backups on events (Nov 19), never on a schedule: New plan, starting the plan over, and Done shopping each copy the
// tabs as they were BEFORE the change (read once, just before it runs), written once the answer has gone. One key per
// tab, `${NS}:backup:<ISO time>:<tab>`, and an index, `${NS}:backup:<ISO time>`, naming the tabs it holds (written
// last, so a backup with an index is whole). The newest 7 are kept; older ones go entirely. A tab too big for one
// Upstash request is left out of its backup (and said in the index and the error list); the others are still kept.
// Ordering's settings and Face ID keys (the Checkout tabs) are never copied. Put back only by hand, scripts/restore.mjs.
import { after } from "next/server";
import { redis } from "../store";
import { allTabs, NS, outside, type TabStore } from "../store/tabs";
import { messageOf, recordError } from "./errors";

export const KEEP_BACKUPS = 7;
/** Upstash's free plan takes requests up to 1 MB: a tab bigger than this (in bytes) is left out rather than half-written. */
export const MAX_TAB_BYTES = 900_000;
export const BACKUP_PREFIX = `${NS}:backup:`;
/** Never in a backup: ordering's settings and the phones' Face ID keys. */
export const NOT_BACKED_UP = new Set(["Checkout", "Checkout passkeys"]);
/** An ISO time's length ("2026-11-19T00:00:00.000Z"), which every backup key starts with after the prefix. */
const TIME = 24;

type Store = TabStore & { del(...k: string[]): Promise<unknown> };
export type Snapshot = { at: Date; tabs: [string, string[][]][] };
export type BackupIndex = { tabs: string[]; skipped: { tab: string; bytes: number }[] };

/** The tabs as they are now (one read), for a backup of what a change is about to replace; null without Redis. */
export async function snapshot(store: TabStore | null = redis(), now = new Date()): Promise<Snapshot | null> {
  if (!store) return null; // no Redis (tests, the checks): the data is the sample files
  const tabs = (await allTabs(store)).filter(([t]) => !NOT_BACKED_UP.has(t));
  return tabs.length ? { at: now, tabs } : null;
}

/** Writes a snapshot as a backup and drops all but the newest 7; answers its index key and what was left out. */
export async function writeBackup(snap: Snapshot, store: TabStore | null = redis()): Promise<{ key: string; skipped: BackupIndex["skipped"] } | null> {
  const s = store as Store | null;
  if (!s) return null;
  const key = `${BACKUP_PREFIX}${snap.at.toISOString()}`;
  const index: BackupIndex = { tabs: [], skipped: [] };
  const writes: [string, string][] = [];
  for (const [tab, rows] of snap.tabs) {
    if (NOT_BACKED_UP.has(tab)) continue;
    const value = JSON.stringify(rows), bytes = Buffer.byteLength(value);
    if (bytes > MAX_TAB_BYTES) { index.skipped.push({ tab, bytes }); continue; }
    writes.push([`${key}:${tab}`, value]);
    index.tabs.push(tab);
  }
  await Promise.all(writes.map(([k, v]) => s.set(k, v)));
  await s.set(key, JSON.stringify(index));
  for (const { tab, bytes } of index.skipped) console.error(`backup ${key}: left out ${tab} (${bytes} bytes)`);
  // Every key of a backup starts with its time, and ISO times sort as they happened, so the oldest come first.
  const all = (await s.keys(`${BACKUP_PREFIX}*`)).filter((k) => k.startsWith(BACKUP_PREFIX));
  const times = [...new Set(all.map((k) => k.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + TIME)))].sort();
  const old = new Set(times.slice(0, Math.max(0, times.length - KEEP_BACKUPS)));
  const gone = all.filter((k) => old.has(k.slice(BACKUP_PREFIX.length, BACKUP_PREFIX.length + TIME)));
  for (let i = 0; i < gone.length; i += 100) await s.del(...gone.slice(i, i + 100));
  return { key, skipped: index.skipped };
}

/** The tabs as they are, read before a change that replaces much of them (from a route); null when there's nothing to keep. */
export async function before(why: string): Promise<Snapshot | null> {
  try { return await snapshot(); } catch (e) {
    console.error("couldn't read the tabs for a backup", e);
    void recordError({ route: "backup", where: why, message: messageOf(e) }).catch(() => {});
    return null; // never stands in the way of the change
  }
}

/** Writes a snapshot once the answer has gone, outside any change's transaction. Failures go to the error list. */
export function backUpAfter(snap: Snapshot | null, why: string) {
  if (!snap) return;
  const fail = (e: unknown) => { console.error("couldn't back up", e); return recordError({ route: "backup", where: why, message: messageOf(e) }).catch(() => {}); };
  after(() => outside(() => writeBackup(snap)).then((r) => {
    if (r?.skipped.length) return recordError({ route: "backup", where: why, message: `left out ${r.skipped.map((x) => `${x.tab} (${x.bytes} bytes)`).join(", ")}` }).catch(() => {});
  }, fail));
}
