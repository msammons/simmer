// The household (the Profile tab: who / type / value rows), kept for a minute per server instance.
import { readTab } from "./store";
import { parseProfile } from "./parse";
import type { IgnoredRow, Profile } from "./types";

export type Household = { profile: Profile; ignored: IgnoredRow[]; stale: boolean };

const CACHE_MS = 60_000;

// Last good copy, kept per server instance. Used when the store can't be reached.
let cache: { at: number; rows: string[][] } | null = null;

export async function loadHousehold(): Promise<Household> {
  let stale = false;
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    try {
      cache = { at: Date.now(), rows: await readTab("Profile") };
    } catch (e) {
      if (!cache) throw e;
      stale = true; // fall back to the last good copy
    }
  }
  const { profile, ignored } = parseProfile(cache!.rows);
  return { profile, ignored, stale };
}
