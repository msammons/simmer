"use client";
// What this phone keeps (always try/catch; private mode can throw).
import type { ListState, PlanData, Recipe } from "./api";
import { panelPasscode, framed, setPanelPasscode } from "./panel";
import { applyTheme, THEMES, type Theme } from "./theme";

const KEYS = { passcode: "sm.passcode", theme: "sm.theme", list: "sm.list", recipes: "sm.recipes", plan: "sm.plan", showGot: "sm.showGot" };

function get<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function set(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

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
  list: () => get<ListState>(KEYS.list),
  setList: (l: ListState) => set(KEYS.list, l),
  /** The collection from last time, for opening offline. */
  recipes: () => get<Recipe[]>(KEYS.recipes),
  setRecipes: (r: Recipe[]) => set(KEYS.recipes, r),
  /** What's planned, from last time, for opening offline. */
  plan: () => get<PlanData>(KEYS.plan),
  setPlan: (p: PlanData) => set(KEYS.plan, p),
  theme: (): Theme => {
    const t = get<string>(KEYS.theme);
    return THEMES.some((x) => x.id === t) ? (t as Theme) : "simmer";
  },
  setTheme: (t: Theme) => { set(KEYS.theme, t); applyTheme(t); },
};
