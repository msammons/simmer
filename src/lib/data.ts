// Where the household data lives: the Google Sheet when configured, else local sample files in data/ (dev only).
// Add a tab by adding it to TABS (and a sample CSV), then parsing it in loadHousehold.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readTab, sheetsConfigured } from "./google/sheets";
import { parseCsv, parseProfile } from "./parse";
import type { IgnoredRow, Profile } from "./types";

export type Household = { profile: Profile; ignored: IgnoredRow[]; source: string; stale: boolean };

const TABS = { profile: "Profile" } as const;
type Raw = Record<keyof typeof TABS, string[][]>;
const CACHE_MS = 60_000;

// Last good copy, kept per server instance. Used when the Sheet can't be reached.
let cache: { at: number; raw: Raw; source: string } | null = null;

async function readRaw(): Promise<{ raw: Raw; source: string }> {
  const keys = Object.keys(TABS) as (keyof typeof TABS)[];
  if (sheetsConfigured()) {
    const tabs = await Promise.all(keys.map((k) => readTab(TABS[k])));
    return { raw: Object.fromEntries(keys.map((k, i) => [k, tabs[i]])) as Raw, source: "Google Sheet" };
  }
  const local = (k: keyof typeof TABS) => readFile(path.join(process.cwd(), "data", `${k}.csv`), "utf8").then(parseCsv);
  const tabs = await Promise.all(keys.map(local));
  return { raw: Object.fromEntries(keys.map((k, i) => [k, tabs[i]])) as Raw, source: "sample data (no Sheet configured)" };
}

export async function loadHousehold(): Promise<Household> {
  let stale = false;
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    try {
      const { raw, source } = await readRaw();
      cache = { at: Date.now(), raw, source };
    } catch (e) {
      if (!cache) throw e;
      stale = true; // fall back to the last good copy
    }
  }
  const { raw, source } = cache!;
  const pr = parseProfile(raw.profile);
  return { profile: pr.profile, ignored: pr.ignored, source, stale };
}
