// Google Sheets via a service account (no SDK). The Sheet must be shared with the service account's email.
import { createSign } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getCache } from "@vercel/functions";
import * as R from "./redis-tabs";
import { redis } from "./redis-tabs";

type ServiceAccount = { client_email: string; private_key: string };
let token: { value: string; expires: number } | null = null;

// This app's Sheet. Not a secret (it grants no access without the service account key); SHEET_ID in Vercel overrides it.
const SHEET = "1FOQPuSPWntp6VURMw97-olFmd-xFs3LbuK104Eo6uEM";
const sheetId = () => process.env.SHEET_ID || SHEET;

/** The Google Sheet is there (the service account key is set). */
const googleConfigured = () => Boolean(sheetId() && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
/**
 * The app keeps its data somewhere lasting: Redis (Nov 11), or the Google Sheet. Without either (local dev, tests) it
 * reads data/*.csv.
 */
export function sheetsConfigured() {
  return Boolean(redis()) || googleConfigured();
}
/** A tab not in Redis yet comes from the Sheet, once; null when the Sheet doesn't have it (or there's no Sheet). */
const fromSheet = async (tab: string) => (googleConfigured() ? gReadTabIfAny(tab).then((rows) => (rows.length ? rows : null)) : null);

function serviceAccount(): ServiceAccount {
  // The whole key file's JSON, pasted into one env var (works locally and on Vercel).
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  return { client_email: sa.client_email, private_key: String(sa.private_key).replace(/\\n/g, "\n") };
}

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const sa = serviceAccount();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Google sign-in for Sheets failed (${r.status})`);
  const j = await r.json();
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

const base = () => `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values`;

/**
 * Reloads that only show something (the GET routes, wrapped in `forViewing`) reuse what this server read in the last
 * few seconds (Nov 11: a reset and a few meals sent ~40 reloads a minute and went over Google's 60 reads a minute).
 * Changes always read the Sheet itself, and every write drops what was kept for that tab.
 */
const viewing = new AsyncLocalStorage<boolean>();
export const forViewing = <T>(f: () => Promise<T>): Promise<T> => viewing.run(true, f);
const VIEW_MS = 8_000;
const kept = new Map<string, { at: number; rows: string[][] }>();
// On Vercel the copies are shared by every running server through its Runtime Cache, and a write anywhere expires that
// tab's copy for all of them; elsewhere (on the Mac, in tests) each server keeps its own for a few seconds.
const shared = () => (process.env.VERCEL ? getCache({ namespace: "simmer-sheet" }) : null);
const SHARED_S = 30;
const tagOf = (tab: string) => `tab:${sheetId()}:${tab}`.replace(/,/g, " ");
async function keptFor(tab: string): Promise<string[][] | null> {
  if (!viewing.getStore()) return null;
  const c = shared();
  if (!c) { const k = kept.get(tab); return k && Date.now() - k.at < VIEW_MS ? k.rows : null; }
  try { const v = (await c.get(`${sheetId()}:${tab}`)) as { rows?: string[][] } | undefined; return v?.rows ?? null; } catch { return null; }
}
async function keep(tab: string, rows: string[][]) {
  const c = shared();
  if (!c) { kept.set(tab, { at: Date.now(), rows }); return; }
  try { await c.set(`${sheetId()}:${tab}`, { rows }, { ttl: SHARED_S, tags: [tagOf(tab)], name: "sheet tab" }); } catch { /* reads still work without it */ }
}
/** A write to a tab: what was kept for it is out of date. Ranges like "List!A2:K2" name their tab before the "!". */
async function dropKept(range: string) {
  const tab = range.split("!")[0].replace(/^'|'$/g, "");
  kept.delete(tab);
  const c = shared();
  if (c) try { await c.expireTag(tagOf(tab)); } catch { /* the copy expires in seconds anyway */ }
}

/**
 * A request to Google Sheets, waited out and tried again while Google says "too many" (429): its limits are a minute
 * at a time, so a short wait succeeds where failing at once showed "That didn't go through" (Nov 11). A refused request
 * changed nothing, so trying a write again is safe.
 */
async function sheetsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const waits = [1_500, 4_000, 8_000];
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (r.status !== 429 || i >= waits.length) return r;
    await new Promise((ok) => setTimeout(ok, waits[i] + Math.random() * 500));
  }
}

export class ReadFailed extends Error { constructor(tab: string, public status: number) { super(`Couldn't read the "${tab}" tab (${status})`); } }

// Tabs known to be there (read or created by this server), so ensureTab needn't spend a write asking again (an
// addSheet counts against the same writes-a-minute limit as a change).
const known = new Set<string>();

async function gReadTab(tab: string): Promise<string[][]> {
  const hit = await keptFor(tab);
  if (hit) return hit;
  const get = async () => sheetsFetch(`${base()}/${encodeURIComponent(tab)}`, {
    headers: { authorization: `Bearer ${await accessToken()}` }
  });
  const r = await get();
  // Over the Sheet's reads-a-minute limit: one more try a moment later.
  if (!r.ok) { if (r.status === 400) known.delete(tab); throw new ReadFailed(tab, r.status); }
  known.add(tab);
  const rows = ((await r.json()).values ?? []) as string[][];
  await keep(tab, rows);
  return rows;
}

// The Sheet's tab names, asked for at most every ten minutes, so several tabs can be read in one request (a request
// for a tab that isn't there fails the whole batch).
let titles: { at: number; names: Set<string> } | null = null;
async function tabTitles(): Promise<Set<string>> {
  if (titles && Date.now() - titles.at < 600_000) return titles.names;
  const r = await sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}?fields=sheets.properties.title`, {
    headers: { authorization: `Bearer ${await accessToken()}` }
  });
  if (!r.ok) throw new ReadFailed("tab list", r.status);
  const names = new Set<string>(((await r.json()).sheets ?? []).map((s: { properties?: { title?: string } }) => s.properties?.title ?? ""));
  for (const n of names) known.add(n);
  titles = { at: Date.now(), names };
  return names;
}

/**
 * Several tabs read in one request (Nov 10: loading the plan read nine tabs one by one, and a few taps went over
 * Google's 60 reads a minute: "That didn't go through"). Tabs that don't exist yet come back empty.
 */
async function gReadTabsIfAny(tabs: string[]): Promise<string[][][]> {
  const hits = await Promise.all(tabs.map(keptFor));
  if (hits.every(Boolean)) return hits as string[][][];
  const names = await tabTitles();
  const want = tabs.filter((t) => names.has(t) || known.has(t));
  if (!want.length) return tabs.map(() => []);
  const get = async () => sheetsFetch(`${base()}:batchGet?${want.map((t) => `ranges=${encodeURIComponent(t)}`).join("&")}`, {
    headers: { authorization: `Bearer ${await accessToken()}` }
  });
  const r = await get();
  // A tab removed since the names were read: ask again for the names next time, and read these one by one.
  if (r.status === 400) { titles = null; return Promise.all(tabs.map(gReadTabIfAny)); }
  if (!r.ok) throw new ReadFailed(want.join(", "), r.status);
  const ranges: { values?: string[][] }[] = (await r.json()).valueRanges ?? [];
  const got = new Map<string, string[][]>(ranges.map((v, i) => [want[i], v.values ?? []]));
  await Promise.all([...got].map(([t, rows]) => keep(t, rows)));
  return tabs.map((t) => got.get(t) ?? []);
}

/** A tab's rows, or none when the tab doesn't exist yet. Any other failure throws (it isn't an empty tab). */
const gReadTabIfAny = (tab: string) => gReadTab(tab).catch((e) => { if (e instanceof ReadFailed && e.status === 400) return [] as string[][]; throw e; });

async function gAppendRows(tab: string, rows: string[][]): Promise<void> {
  if (!rows.length) return;
  await dropKept(tab);
  const r = await sheetsFetch(`${base()}/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ values: rows })
  });
  if (!r.ok) throw new Error(`Couldn't write to the "${tab}" tab (${r.status})`);
}

/** Creates the tab if it doesn't exist yet. */
async function gEnsureTab(title: string): Promise<void> {
  if (known.has(title)) return;
  const r = await sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}:batchUpdate`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
  });
  if (!r.ok && !(await r.text()).includes("already exists")) throw new Error(`Couldn't create the "${title}" tab (${r.status})`);
  known.add(title);
}

/**
 * Replaces a tab's contents. `before`: the tab as it was just read, so the new rows go in one request, with blanks over
 * whatever is left of the old rows and columns (without it: create if missing, clear, then write).
 */
async function gReplaceTab(title: string, rows: string[][], before?: string[][]): Promise<void> {
  await dropKept(title);
  const auth = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
  let values = rows;
  if (before?.length) {
    const width = Math.max(0, ...before.map((r) => r.length), ...rows.map((r) => r.length));
    values = Array.from({ length: Math.max(before.length, rows.length) }, (_, i) => { const r = rows[i] ?? []; return [...r, ...Array<string>(width - r.length).fill("")]; });
  } else {
    await gEnsureTab(title);
    const clear = await sheetsFetch(`${base()}/${encodeURIComponent(title)}:clear`, { method: "POST", headers: auth });
    if (!clear.ok) throw new Error(`Couldn't clear the "${title}" tab (${clear.status})`);
  }
  const put = await sheetsFetch(`${base()}/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ values })
  });
  if (!put.ok) throw new Error(`Couldn't write the "${title}" tab (${put.status})`);
}

/**
 * Many A1 ranges written in one request (Nov 10: one write per cell ran into Google's limit of about 60 writes a
 * minute, "It's busy right now", after a few quick taps).
 */
async function gUpdateRanges(data: { range: string; values: string[][] }[]): Promise<void> {
  if (!data.length) return;
  await Promise.all(data.map((d) => dropKept(d.range)));
  const r = await sheetsFetch(`${base()}:batchUpdate`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ valueInputOption: "RAW", data })
  });
  if (!r.ok) throw new Error(`Couldn't update ${data[0].range.split("!")[0]} (${r.status})`);
}

/** Writes rows at an A1 range ("List!I5:J5"): how one row's cells change without touching anyone else's rows. */
async function gUpdateRange(range: string, rows: string[][]): Promise<void> {
  await dropKept(range);
  const r = await sheetsFetch(`${base()}/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ values: rows })
  });
  if (!r.ok) throw new Error(`Couldn't update ${range.split("!")[0]} (${r.status})`);
}

// ---- the app's storage: Redis when it has it (each change is one read and one write there, with no per-minute limit
// the family could reach), else the Google Sheet

export async function readTab(tab: string): Promise<string[][]> {
  const r = redis();
  return r ? R.readTab(r, tab, fromSheet) : gReadTab(tab);
}
/** A tab's rows, or none when the tab doesn't exist yet. Any other failure throws (it isn't an empty tab). */
export const readTabIfAny = (tab: string) => { const r = redis(); return r ? R.readTab(r, tab, fromSheet) : gReadTabIfAny(tab); };
/** Several tabs read at once (on the Sheet, one request: see gReadTabsIfAny). */
export async function readTabsIfAny(tabs: string[]): Promise<string[][][]> {
  const r = redis();
  return r ? R.readTabs(r, tabs, fromSheet) : gReadTabsIfAny(tabs);
}
export async function appendRows(tab: string, rows: string[][]): Promise<void> {
  const r = redis();
  return r ? R.appendRows(r, tab, rows, fromSheet) : gAppendRows(tab, rows);
}
/** Creates the tab if it doesn't exist yet (Redis needs nothing: a tab is there once it's written). */
export async function ensureTab(title: string): Promise<void> {
  if (!redis()) await gEnsureTab(title);
}
/** Replaces a tab's contents. `before`: the tab as just read (the Sheet uses it to write in one request). */
export async function replaceTab(title: string, rows: string[][], before?: string[][]): Promise<void> {
  const r = redis();
  return r ? R.writeTab(r, title, rows) : gReplaceTab(title, rows, before);
}
export async function updateRanges(data: { range: string; values: string[][] }[]): Promise<void> {
  const r = redis();
  return r ? R.updateRanges(r, data, fromSheet) : gUpdateRanges(data);
}
export async function updateRange(range: string, rows: string[][]): Promise<void> {
  const r = redis();
  return r ? R.updateRanges(r, [{ range, values: rows }], fromSheet) : gUpdateRange(range, rows);
}

/**
 * Settings → Copy to Google Sheet: every tab, as the app has it, written over the Sheet's tab of the same name (one
 * clear and one write per tab, waited out if Google says too many). Answers how many tabs were copied.
 */
export async function exportToSheet(): Promise<number> {
  const r = redis();
  if (!r) throw new Error("There's nothing to copy: the app already keeps its data in the Sheet.");
  if (!googleConfigured()) throw new Error("There's no Google Sheet to copy to.");
  const tabs = await R.allTabs(r);
  for (const [tab, rows] of tabs) await gReplaceTab(tab, rows);
  return tabs.length;
}
