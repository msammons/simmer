"use client";
// What this phone keeps (always try/catch; private mode can throw).
import type { ListState, PlanData, Recipe } from "./api";
import { panelPasscode, framed, setPanelPasscode } from "./panel";
import { applyTheme, THEMES, type Theme } from "./theme";

const KEYS = { passcode: "sm.passcode", theme: "sm.theme", list: "sm.list", recipes: "sm.recipes", plan: "sm.plan", showGot: "sm.showGot" };

function get<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function set(k: string, v: unknown): boolean {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; /* storage unavailable */ }
}
const drop = (k: string) => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } };

/**
 * A copy kept with its ETag (Nov 19: "nothing changed" answers), both in one key, so they're always written together:
 * two open copies of the app saving at once can never leave one's copy with the other's ETag, and a copy that couldn't
 * be saved (storage full) leaves no ETag naming it. A copy saved before Nov 19 is plain, with no ETag.
 */
type Kept = { kept: unknown; etag: string | null };
const isKept = (x: unknown): x is Kept => typeof x === "object" && x !== null && "kept" in x && "etag" in x;
function keep(k: string, v: unknown, etag: string | null) {
  if (!set(k, { kept: v, etag } satisfies Kept)) drop(k);
  drop(`${k}.etag`); // where the ETag was kept before
}
function copy<T>(k: string): T | null { const x = get<unknown>(k); return (isKept(x) ? x.kept : x) as T | null; }
const etagFor = (k: string) => { const x = get<unknown>(k); return isKept(x) ? x.etag : null; };

export const store = {
  /** Shop's Show got (Nov 14): on unless this phone turned it off. */
  showGot: () => get<boolean>(KEYS.showGot) !== false,
  setShowGot: (on: boolean) => set(KEYS.showGot, on),
  passcode: () => panelPasscode() ?? get<string>(KEYS.passcode),
  setPasscode: (p: string | null) => {
    if (framed()) { setPanelPasscode(p); return; }
    if (p === null) { try { localStorage.removeItem(KEYS.passcode); } catch {} } else set(KEYS.passcode, p);
  },
  /** The list from last time, for opening offline. */
  list: () => copy<ListState>(KEYS.list),
  /** The ETag of the list from last time, if it was kept with one. */
  listEtag: () => etagFor(KEYS.list),
  setList: (l: ListState, etag: string | null = null) => keep(KEYS.list, l, etag),
  /** The collection from last time, for opening offline. */
  recipes: () => copy<Recipe[]>(KEYS.recipes),
  recipesEtag: () => etagFor(KEYS.recipes),
  setRecipes: (r: Recipe[], etag: string | null = null) => keep(KEYS.recipes, r, etag),
  /** What's planned, from last time, for opening offline. */
  plan: () => copy<PlanData>(KEYS.plan),
  planEtag: () => etagFor(KEYS.plan),
  setPlan: (p: PlanData, etag: string | null = null) => keep(KEYS.plan, p, etag),
  theme: (): Theme => {
    const t = get<string>(KEYS.theme);
    return THEMES.some((x) => x.id === t) ? (t as Theme) : "simmer";
  },
  setTheme: (t: Theme) => { set(KEYS.theme, t); applyTheme(t); },
};
