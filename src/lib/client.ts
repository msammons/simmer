"use client";
// Browser-side helpers: storage (always try/catch; private mode can throw), API calls, themes, date labels.
import { addDays, todayIn, TZ } from "./time";

const KEYS = { passcode: "sm.passcode", people: "sm.people", theme: "sm.theme", list: "sm.list", me: "sm.me", recipes: "sm.recipes", week: "sm.week" };

function get<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function set(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export type Person = { key: string; name: string; isAdult?: boolean };

export const store = {
  passcode: () => get<string>(KEYS.passcode),
  setPasscode: (p: string | null) => (p === null ? (() => { try { localStorage.removeItem(KEYS.passcode); } catch {} })() : set(KEYS.passcode, p)),
  /** The household from last time, so the app works when it opens offline. */
  people: () => get<Person[]>(KEYS.people),
  setPeople: (p: Person[]) => set(KEYS.people, p),
  /** The list from last time, for opening offline. */
  list: () => get<ListState>(KEYS.list),
  setList: (l: ListState) => set(KEYS.list, l),
  /** The collection from last time, for opening offline. */
  recipes: () => get<Recipe[]>(KEYS.recipes),
  setRecipes: (r: Recipe[]) => set(KEYS.recipes, r),
  /** This week's plan from last time, for opening offline. */
  week: () => get<WeekData>(KEYS.week),
  setWeek: (w: WeekData) => set(KEYS.week, w),
  /** Who's using the app here, for "added by". */
  me: () => get<string>(KEYS.me) ?? "",
  setMe: (name: string) => set(KEYS.me, name),
  theme: (): Theme => {
    const t = get<string>(KEYS.theme);
    return THEMES.some((x) => x.id === t) ? (t as Theme) : "simmer";
  },
  setTheme: (t: Theme) => { set(KEYS.theme, t); applyTheme(t); },

};

/** Themes (defined in globals.css): Simmer's own looks (Simmer is the default and matches the icon), then plain iOS accent colors. swatch is CSS for the picker. */
export const THEMES = [
  { id: "simmer", label: "Simmer", swatch: "linear-gradient(160deg, #B5C9A8, #94B08A 55%, #7E9C76)" },
  { id: "apricot", label: "Apricot", swatch: "linear-gradient(160deg, #F6B25C, #E8803F 55%, #C9532C)" },
  { id: "blue", label: "Blue", swatch: "#007AFF" },
  { id: "indigo", label: "Indigo", swatch: "#5856D6" },
  { id: "pink", label: "Pink", swatch: "#FF2D55" },
  { id: "orange", label: "Orange", swatch: "#FF9500" },
  { id: "teal", label: "Teal", swatch: "#30B0C7" },
  { id: "green", label: "Green", swatch: "#34C759" },
] as const;
export type Theme = (typeof THEMES)[number]["id"];

/** Switches the page's theme, and the browser bar color to match. layout.tsx sets the saved one before the first paint. */
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bg));
}

export class AuthError extends Error {}

/** An error as a person should read it: a dropped connection (fetch's TypeError) in plain words, anything else as the server wrote it. */
export const errorText = (e: unknown) =>
  e instanceof TypeError ? "No connection. Check your signal and try again." : e instanceof Error ? e.message : String(e);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-passcode": store.passcode() ?? "", ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) throw new AuthError(body.error ?? "Wrong passcode.");
  if (!r.ok) throw new Error(body.error ?? `Something went wrong (${r.status}).`);
  return body as T;
}

/** Every request takes an optional AbortSignal, so it can be stopped. */
import type { Item, Section, Staple, Store } from "./groceries";
export type { Item, Section, Staple, Store };
import type { Draft, Effort, Ingredient, Recipe } from "./recipes";
export type { Draft, Effort, Ingredient, Recipe };
import type { WeekData } from "./plan";
import type { Frozen, Lunch, Night } from "./week";
export type { Frozen, Lunch, Night, WeekData };
export type Kitchen = { freezer: Frozen[]; trips: WeekData["trips"] };
export type ListState = { items: Item[]; staples: Staple[] };
type Change = { op: "need"; id: string } | { op: "have" } | { op: "add"; text: string; by: string; store?: Store; section?: Section } | { op: "check"; id: string; checked: boolean } | { op: "move"; id: string; store?: Store; section?: Section } | { op: "many"; items: { item: string; quantity: string }[]; for: string; by: string } | { op: "remove"; id: string } | { op: "done"; store: Store };

export const api = {
  list: (signal?: AbortSignal) => call<ListState>("/api/list", { signal }),
  change: (c: Change) => call<ListState>("/api/list", { method: "POST", body: JSON.stringify(c) }),
  recipes: (signal?: AbortSignal) => call<{ recipes: Recipe[] }>("/api/recipes", { signal }),
  saveRecipes: (recipes: Draft[], duplicates?: "skip" | "replace") => call<{ recipes: Recipe[]; saved: string[] }>("/api/recipes", { method: "POST", body: JSON.stringify({ op: "save", recipes, duplicates }) }),
  recipeChange: (c: { op: "effort"; id: string; effort: Effort } | { op: "active"; id: string; active: boolean }) => call<{ recipes: Recipe[]; saved: string[] }>("/api/recipes", { method: "POST", body: JSON.stringify(c) }),
  readRecipe: (from: { link: string } | { text: string } | { file: { name: string; type: string; data: string } }, signal?: AbortSignal) => call<{ found: Draft[] }>("/api/recipes/read", { method: "POST", body: JSON.stringify(from), signal }),
  week: (date: string, signal?: AbortSignal) => call<WeekData>(`/api/plan?week=${date}`, { signal }),
  saveWeek: (nights: Night[], lunches: Lunch[], by: string) => call<WeekData & { added: number }>("/api/plan", { method: "POST", body: JSON.stringify({ op: "save", nights, lunches, by }) }),
  made: (date: string, made: boolean) => call<WeekData & { added: number }>("/api/plan", { method: "POST", body: JSON.stringify({ op: "made", date, made }) }),
  kitchen: (signal?: AbortSignal) => call<Kitchen>("/api/freezer", { signal }),
  freezer: (c: { op: "add"; text: string } | { op: "use"; id: string }) => call<Kitchen>("/api/freezer", { method: "POST", body: JSON.stringify(c) }),
  household: (signal?: AbortSignal) => call<{ people: Person[]; stale: boolean }>("/api/household", { signal }),
};

/**
 * A picked file, ready to send: pictures are made smaller first (a phone photo is several megabytes; the recipe reads
 * just as well at 2000 pixels), and anything else is sent as it is if it's small enough.
 */
export async function fileToSend(f: File): Promise<{ name: string; type: string; data: string }> {
  const b64 = (blob: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = () => bad(r.error); r.readAsDataURL(blob); });
  if (f.type.startsWith("image/")) {
    try {
      const img = await createImageBitmap(f);
      const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
      if (blob) return { name: f.name, type: "image/jpeg", data: await b64(blob) };
    } catch { /* a picture the browser can't open (some HEIC): send it as it is */ }
  }
  if (f.size > 3_200_000) throw new Error("That file is too big. Try a smaller one, or a picture of the page.");
  return { name: f.name, type: f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : /\.txt$/i.test(f.name) ? "text/plain" : ""), data: await b64(f) };
}

/*
 * Dates read the same everywhere: today and tomorrow are words, later days get the weekday.
 * weekday: "Today", "Tomorrow", "Sunday". dayLabel: "Today", "Tomorrow", "Sunday, Oct 25". shortDay: "Today", "Sat 26".
 */
/** The date offsetDays from today, by the calendar. */
export const dateIn = (offsetDays: number) => addDays(todayIn(), offsetDays);
/** 0-23; hourCycle h23 because some browsers write midnight as 24. */
export const hourNow = () => Number(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));
export const weekday = (date: string) =>
  date === dateIn(0) ? "Today" : date === dateIn(1) ? "Tomorrow" : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
/** "Sunday, Oct 25": for anything that will be read later, where "Tomorrow" would go stale. */
export const fullDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
export const dayLabel = (date: string) => (date === dateIn(0) || date === dateIn(1) ? weekday(date) : fullDate(date));
export const shortDay = (date: string) => {
  if (date === dateIn(0)) return "Today";
  if (date === dateIn(1)) return "Tomorrow";
  const d = new Date(`${date}T12:00:00Z`);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
};
/** "A", "A & B", "A, B & C". */
export const list = (xs: string[]) => (xs.length <= 2 ? xs.join(" & ") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`);
