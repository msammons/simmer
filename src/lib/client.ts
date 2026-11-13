"use client";
// Browser-side helpers: storage (always try/catch; private mode can throw), API calls, themes, dates.
import { startAuthentication, startRegistration, WebAuthnError } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { addDays, todayIn, TZ } from "./time";

const KEYS = { passcode: "sm.passcode", people: "sm.people", theme: "sm.theme", list: "sm.list", me: "sm.me", recipes: "sm.recipes", plan: "sm.plan" };

function get<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function set(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export type Person = { key: string; name: string; isAdult?: boolean };

/**
 * Inside the Safeway helper's panel, Simmer runs in a frame and the helper hands it the passcode by message (never in
 * the address). It's kept for this visit only.
 */
let framedPasscode: string | null = null;
export const framed = () => typeof window !== "undefined" && window.parent !== window;

export const store = {
  passcode: () => framedPasscode ?? get<string>(KEYS.passcode),
  setPasscode: (p: string | null) => {
    if (framed()) { framedPasscode = p; return; }
    if (p === null) { try { localStorage.removeItem(KEYS.passcode); } catch {} } else set(KEYS.passcode, p);
  },
  /** The household from last time, so the app works when it opens offline. */
  people: () => get<Person[]>(KEYS.people),
  setPeople: (p: Person[]) => set(KEYS.people, p),
  /** The list from last time, for opening offline. */
  list: () => get<ListState>(KEYS.list),
  setList: (l: ListState) => set(KEYS.list, l),
  /** The collection from last time, for opening offline. */
  recipes: () => get<Recipe[]>(KEYS.recipes),
  setRecipes: (r: Recipe[]) => set(KEYS.recipes, r),
  /** What's planned, from last time, for opening offline. */
  plan: () => get<PlanData>(KEYS.plan),
  setPlan: (p: PlanData) => set(KEYS.plan, p),
  /** Who's using the app here, for "added by". */
  me: () => get<string>(KEYS.me) ?? "",
  setMe: (name: string) => set(KEYS.me, name),
  theme: (): Theme => {
    const t = get<string>(KEYS.theme);
    return THEMES.some((x) => x.id === t) ? (t as Theme) : "simmer";
  },
  setTheme: (t: Theme) => { set(KEYS.theme, t); applyTheme(t); },

};

/** Themes (defined in globals.css): Simmer's own looks (Simmer, tomato, is the default and matches the icon), then plain iOS accent colors. swatch is CSS for the picker. */
export const THEMES = [
  { id: "simmer", label: "Simmer", swatch: "linear-gradient(160deg, #EE6A45, #D9512F 55%, #B5381F)" },
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
/** Sent on the window whenever the server turns the passcode down, so the app goes back to the passcode screen from any request. */
export const SIGNED_OUT = "sm:signed-out";

/** An error as a person should read it: a dropped connection (fetch's TypeError) in plain words, anything else as the server wrote it. */
export const errorText = (e: unknown) =>
  e instanceof TypeError ? "No connection. Check your signal and try again." : e instanceof Error ? e.message : String(e);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-passcode": store.passcode() ?? "", ...(init.headers ?? {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) { window.dispatchEvent(new Event(SIGNED_OUT)); throw new AuthError(body.error ?? "Wrong passcode."); }
  if (!r.ok) throw new Error(body.error ?? `Something went wrong (${r.status}).`);
  return body as T;
}

import type { Item, Section, Staple, Store } from "./groceries";
export type { Item, Section, Staple, Store };
import type { Draft, Effort, Ingredient, Recipe } from "./recipes";
export type { Draft, Effort, Ingredient, Recipe };
import type { NewDish, NewLunch, PlanData } from "./plan";
import type { Order, OrderAnswer } from "./order";
export type { Order, OrderAnswer };
import type { CartLine, Pick } from "./safeway";
export type { CartLine, Pick };
import type { Activity, Job, JobKind } from "./jobs";
export type { Activity, Job, JobKind };
import type { Counts, Dish, Frozen, Kind, Lunch, LunchPart } from "./week";
export type { Counts, Dish, Frozen, Kind, Lunch, LunchPart, NewDish, NewLunch, PlanData };
export type Kitchen = { freezer: Frozen[]; trips: PlanData["trips"] };
/** A change to one planned thing: another recipe, another part of a lunch, made (or packed), or off. */
export type PlanChange = { op: "change"; id: string; recipe: string; pinned?: boolean } | { op: "change"; id: string; part: LunchPart; item: string } | { op: "made"; id: string } | { op: "remove"; id: string } | { op: "clear" } | { op: "count"; recipe: string; kind: Kind; count: number };
export type ListState = { items: Item[]; staples: Staple[] };
type Change = { op: "need"; id: string } | { op: "unneed"; id: string } | { op: "haveIt"; id: string } | { op: "have" } | { op: "add"; text: string; by: string; store?: Store; section?: Section; amount?: string; have?: boolean } | { op: "check"; id: string; checked: boolean } | { op: "move"; id: string; store?: Store; section?: Section } | { op: "many"; items: { item: string; quantity: string; check?: boolean }[]; for: string; by: string } | { op: "remove"; id: string } | { op: "done"; store: Store; cart?: boolean }
  | { op: "clear"; ids: string[] } | { op: "putBack"; items: Item[] } | { op: "keepAdd"; text: string; section?: Section } | { op: "keepRemove"; item: string } | { op: "keepMove"; item: string; section: Section };

/** Every request takes an optional AbortSignal, so it can be stopped. */
/** Ordering's settings, as /api/checkout keeps them (src/lib/checkout.ts). */
export type CheckoutSettings = { on: boolean; limitCents: number; store: string; card: string };

const passkey = <T>(body: Record<string, unknown>) => call<T>("/api/checkout/passkey", { method: "POST", body: JSON.stringify(body) });

export const api = {
  list: (signal?: AbortSignal) => call<ListState>("/api/list", { signal }),
  change: (c: Change) => call<ListState & { cleared?: Item[] }>("/api/list", { method: "POST", body: JSON.stringify(c) }),
  recipes: (signal?: AbortSignal) => call<{ recipes: Recipe[] }>("/api/recipes", { signal }),
  saveRecipes: (recipes: Draft[], duplicates?: "skip" | "replace") => call<{ recipes: Recipe[]; saved: string[] }>("/api/recipes", { method: "POST", body: JSON.stringify({ op: "save", recipes, duplicates }) }),
  recipeChange: (c: { op: "effort"; id: string; effort: Effort } | { op: "active"; id: string; active: boolean }) => call<{ recipes: Recipe[]; saved: string[] }>("/api/recipes", { method: "POST", body: JSON.stringify(c) }),
  readRecipe: (from: { link: string } | { text: string } | { file: { name: string; type: string; data: string } }, signal?: AbortSignal) => call<{ found: Draft[] }>("/api/recipes/read", { method: "POST", body: JSON.stringify(from), signal }),
  /** What's still to make and pack. */
  plan: (signal?: AbortSignal) => call<PlanData>("/api/plan", { signal }),
  /** More to make and pack, on top of what's there; `added`: how many things went on the grocery list. */
  savePlan: (dishes: NewDish[], lunches: NewLunch[], counts: Counts | null, by: string) => call<PlanData & { added: number; removed?: number }>("/api/plan", { method: "POST", body: JSON.stringify({ op: "plan", dishes, lunches, counts, by }) }),
  planChange: (c: PlanChange, by: string) => call<PlanData & { added: number; removed?: number }>("/api/plan", { method: "POST", body: JSON.stringify({ ...c, by }) }),
  kitchen: (signal?: AbortSignal) => call<Kitchen>("/api/freezer", { signal }),
  /** Settings → Copy to Google Sheet: answers how many tabs were copied. */
  exportSheet: () => call<{ tabs: number }>("/api/export", { method: "POST" }),
  /** Ordering from Simmer (docs/CHECKOUT.md): its settings, and whether the server allows it at all. */
  checkout: (signal?: AbortSignal) => call<{ settings: CheckoutSettings; server: boolean; faceId: number; adding: { code: string } | null }>("/api/checkout", { signal }),
  /** Face ID for ordering (src/lib/passkeys.ts): start setting it up or a check, then send the phone's answer. */
  // With a phone already set up, setting up needs the token of a request another phone approved (Nov 12).
  faceIdSetUpOptions: (token?: string) => passkey<{ options: PublicKeyCredentialCreationOptionsJSON }>({ op: "register-options", token }),
  faceIdCheckOptions: () => passkey<{ options: PublicKeyCredentialRequestOptionsJSON }>({ op: "check-options" }),
  /** A new phone asks to be added: its token (kept on it only) and the code both phones show. */
  faceIdAsk: () => passkey<{ token: string; code: string }>({ op: "add" }),
  /** A phone with Face ID: the check that approves the new phone waiting now, and that phone's code. */
  faceIdApproveOptions: () => passkey<{ options: PublicKeyCredentialRequestOptionsJSON; code: string }>({ op: "approve-options" }),
  faceIdApprove: (response: unknown) => passkey<{ ok: true }>({ op: "approve", response }),
  faceIdRegister: (response: unknown) => passkey<{ ok: true; count: number }>({ op: "register", response }),
  faceIdCheck: (response: unknown) => passkey<{ ok: boolean; credentialId?: string; why?: string }>({ op: "check", response }),
  /** Turning on, raising the limit, or changing the store or card needs `faceId`, a Face ID answer (Nov 13). */
  saveCheckout: (s: CheckoutSettings, faceId?: unknown) => call<{ settings: CheckoutSettings; server: boolean }>("/api/checkout", { method: "POST", body: JSON.stringify({ ...s, faceId }) }),
  freezer: (c: { op: "add"; text: string } | { op: "use"; id: string }) => call<Kitchen>("/api/freezer", { method: "POST", body: JSON.stringify(c) }),
  household: (signal?: AbortSignal) => call<{ people: Person[]; stale: boolean }>("/api/household", { signal }),
  /** The exact Safeway product picked for each item before (by the Safeway helper). */
  picks: (signal?: AbortSignal) => call<{ picks: Pick[] }>("/api/safeway", { signal }),
  /** The Safeway order filled by the helper on a computer: start it, follow it, answer it, stop it. */
  order: (signal?: AbortSignal) => call<{ order: Order | null }>("/api/safeway/order", { signal }),
  orderChange: (c: { op: "start" } | { op: "answer"; id: string; answer: OrderAnswer } | { op: "stop"; id: string }) => call<{ order: Order | null }>("/api/safeway/order", { method: "POST", body: JSON.stringify(c) }),
  /**
   * The Safeway cart as Simmer knows it, the picks, whether the computer is answering (and when it last checked in, and
   * whether that's long enough ago to grey the cart), and whether its Simmer needs an update.
   */
  cart: (signal?: AbortSignal) => call<{ cart: CartLine[]; picks: Pick[]; answering: boolean; away?: boolean; seen?: string; outdated?: boolean }>("/api/safeway/cart", { signal }),
  /** A job for the Safeway helper on the computer: queue it, follow it, or call it off. */
  // Queued from the helper's panel: the panel is told too, so the helper looks at once (Nov 12: it doesn't wait on the push).
  queueJob: (kind: JobKind, args: Record<string, unknown>) => call<{ job: Job; answering: boolean }>("/api/safeway/jobs", { method: "POST", body: JSON.stringify({ op: "queue", kind, ...args, from: framed() ? "panel" : "app" }) })
    .then((r) => { if (framed() && panelOrigin) window.parent.postMessage({ type: "simmer:queued" }, panelOrigin); return r; }),
  /** The helper's recent searches and cart changes, for the panel's activity log. */
  activity: (signal?: AbortSignal) => call<{ jobs: Activity[]; answering: boolean }>("/api/safeway/jobs?recent=1", { signal }),
  /** How a job stands, answered once it's finished (or after about 20 seconds, still going): the server waits, not the app. */
  job: (id: string, signal?: AbortSignal) => call<{ job: Job | null; answering: boolean }>(`/api/safeway/jobs?id=${encodeURIComponent(id)}&wait=1`, { signal }),
  cancelJob: (id: string) => call<{ ok: boolean }>("/api/safeway/jobs", { method: "POST", body: JSON.stringify({ op: "cancel", id }) }),
};

/**
 * Face ID on this phone (Nov 12). Safari only shows Face ID straight from a tap, so the options are fetched before the
 * tap (`faceIdSetUpOptions` and the like) and these are called at the tap with them; the server's answer comes after. Cancelling Face ID,
 * or anything else going wrong, comes back as an Error in plain words.
 */
export async function setUpFaceId(options: PublicKeyCredentialCreationOptionsJSON, onAnswer?: () => void): Promise<number> {
  const response = await faceId(() => startRegistration({ optionsJSON: options }));
  onAnswer?.();
  return (await api.faceIdRegister(response)).count;
}
export async function checkFaceId(options: PublicKeyCredentialRequestOptionsJSON): Promise<{ ok: boolean; credentialId?: string; why?: string }> {
  return api.faceIdCheck(await faceId(() => startAuthentication({ optionsJSON: options })));
}
/** A Face ID answer to send with something that needs it (a settings change, Nov 13). */
export const faceIdAnswer = (options: PublicKeyCredentialRequestOptionsJSON) => faceId(() => startAuthentication({ optionsJSON: options }));

/** A phone with Face ID approves the new phone waiting (the options are bound to that one request). */
export async function approveWithFaceId(options: PublicKeyCredentialRequestOptionsJSON, onAnswer?: () => void): Promise<void> {
  const response = await faceId(() => startAuthentication({ optionsJSON: options }));
  onAnswer?.();
  await api.faceIdApprove(response);
}
async function faceId<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof WebAuthnError && e.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") throw new Error("Face ID is already set up here.");
    if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError")) throw new Error("Face ID was cancelled, or didn't finish in time.");
    throw new Error("Face ID isn't available here.");
  }
}

/**
 * Framed in the helper's panel: ask the panel for the passcode and wait for it (a moment at most). Only a message from
 * the frame's own parent, and only from a Chrome helper's page, is taken.
 */
export function passcodeFromPanel(ms = 3000): Promise<string | null> {
  if (!framed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (v: string | null) => { window.removeEventListener("message", on); clearTimeout(t); resolve(v); };
    const on = (e: MessageEvent) => {
      if (e.source !== window.parent || !/^chrome-extension:\/\/[a-p]{32}$/.test(e.origin)) return;
      if (e.data?.type === "simmer:passcode" && typeof e.data.passcode === "string") { panelOrigin = e.origin; framedPasscode = e.data.passcode; done(e.data.passcode); }
    };
    const t = setTimeout(() => done(null), ms);
    window.addEventListener("message", on);
    window.parent.postMessage({ type: "simmer:ready" }, "*"); // carries nothing private
  });
}
let panelOrigin = "";
/** Framed: tell the panel the passcode was turned down, so it asks for it again itself. */
export function tellPanelSignedOut() {
  if (framed() && panelOrigin) window.parent.postMessage({ type: "simmer:signed-out" }, panelOrigin);
}

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

/** The date offsetDays from today, by the calendar. */
export const dateIn = (offsetDays: number) => addDays(todayIn(), offsetDays);
/** 0-23; hourCycle h23 because some browsers write midnight as 24. */
export const hourNow = () => Number(new Date().toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));
