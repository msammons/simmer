// Simmer's data, tab by tab, in Upstash Redis (Nov 11): the Google Sheet allowed about 60 reads and 60 writes a minute,
// and a busy minute ran out ("That didn't go through"). Each tab is kept as its rows, exactly as on the Sheet, so the
// rest of the app reads and writes the same rows it always did. Everything was copied from the Sheet once (Nov 11); the
// Sheet is now only an export (Settings → Copy to Google Sheet).
import { Redis } from "@upstash/redis";

/** What this file needs from a Redis client (Upstash's, or a pretend one in tests). */
export type TabStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  keys(pattern: string): Promise<string[]>;
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
const parse = (v: string | null): string[][] | null => (v === null ? null : (JSON.parse(v) as string[][]));

/** Where a tab not in Redis yet comes from: the Google Sheet (null when the Sheet doesn't have it either). */
export type Importer = (tab: string) => Promise<string[][] | null>;

export async function readTab(s: TabStore, tab: string, from: Importer): Promise<string[][]> {
  const have = parse(await s.get(keyOf(tab)));
  if (have) return have;
  const rows = (await from(tab)) ?? [];
  await s.set(keyOf(tab), JSON.stringify(rows));
  return rows;
}

export async function readTabs(s: TabStore, tabs: string[], from: Importer): Promise<string[][][]> {
  if (!tabs.length) return [];
  const got = (await s.mget(...tabs.map(keyOf))).map(parse);
  return Promise.all(tabs.map((t, i) => got[i] ?? readTab(s, t, from)));
}

export async function writeTab(s: TabStore, tab: string, rows: string[][]) {
  await s.set(keyOf(tab), JSON.stringify(rows));
}

export async function appendRows(s: TabStore, tab: string, rows: string[][], from: Importer) {
  if (!rows.length) return;
  // Google's append goes after the last row with anything in it.
  const all = (await readTab(s, tab, from)).filter((r, i, a) => i < a.length - 1 || r.some(Boolean));
  while (all.length && !all[all.length - 1].some(Boolean)) all.pop();
  await writeTab(s, tab, [...all, ...rows]);
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

/** Cells written at A1 ranges, as Google's values update does: each tab read once and written once. */
export async function updateRanges(s: TabStore, data: { range: string; values: string[][] }[], from: Importer) {
  const byTab = new Map<string, { col: number; row: number; values: string[][] }[]>();
  for (const d of data) {
    const p = parseRange(d.range);
    byTab.set(p.tab, [...(byTab.get(p.tab) ?? []), { col: p.col, row: p.row, values: d.values }]);
  }
  for (const [tab, puts] of byTab) {
    const all = (await readTab(s, tab, from)).map((r) => [...r]);
    for (const { col, row, values } of puts) {
      values.forEach((vals, i) => {
        const target = (all[row + i] ??= []);
        for (let k = 0; k < row + i; k++) all[k] ??= [];
        vals.forEach((v, j) => { while (target.length < col + j) target.push(""); target[col + j] = v; });
      });
    }
    await writeTab(s, tab, all);
  }
}

/** Every tab Redis holds, with its rows: what Copy to Google Sheet sends. */
export async function allTabs(s: TabStore): Promise<[string, string[][]][]> {
  const keys = (await s.keys(`${PREFIX}*`)).sort();
  if (!keys.length) return [];
  const rows = (await s.mget(...keys)).map(parse);
  return keys.map((k, i) => [k.slice(PREFIX.length), rows[i] ?? []]);
}
