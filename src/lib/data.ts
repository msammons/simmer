// The household (the Profile tab: who / type / value rows), kept for a minute per server instance.
import { inTransaction, readTab } from "./store";
import { parseProfile } from "./parse";
import type { IgnoredRow, Profile } from "./types";

export type Household = { profile: Profile; ignored: IgnoredRow[]; stale: boolean };

const CACHE_MS = 60_000;
export const PROFILE_TAB = "Profile";

// Last good copy, kept per server instance. Used when the store can't be reached.
let cache: { at: number; rows: string[][] } | null = null;

export async function loadHousehold(): Promise<Household> {
  let stale = false;
  // Inside a transaction the household comes from the rows it read (Nov 19, review): an answer's ETag names Profile's
  // version, so the minute's copy here could have been answered under a newer version and then kept by "nothing changed".
  if (inTransaction() || !cache || Date.now() - cache.at > CACHE_MS) {
    try {
      cache = { at: Date.now(), rows: await readTab(PROFILE_TAB) };
    } catch (e) {
      if (!cache) throw e;
      stale = true; // fall back to the last good copy
    }
  }
  const { profile, ignored } = parseProfile(cache!.rows);
  return { profile, ignored, stale };
}
