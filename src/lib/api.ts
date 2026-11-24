"use client";
// Talking to Simmer's server: every request carries the passcode; a turned-down passcode signs the app out. Too many
// wrong passcodes from this address (429) never does: the saved passcode stays, and the problem is said in plain words.
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { framed, tellPanelQueued } from "./panel";
import { store } from "./storage";
import { UNCHANGED, type Unchanged } from "./synced";

export type Person = { key: string; name: string; isAdult?: boolean };

export class AuthError extends Error {}
/** Too many wrong passcodes from this address lately (429): try again in a few minutes; nothing is signed out. */
export class LockedError extends Error {}
/** Sent on the window whenever the server turns the passcode down, so the app goes back to the passcode screen from any request. */
export const SIGNED_OUT = "sm:signed-out";

/** An error as a person should read it: a dropped connection (fetch's TypeError) in plain words, anything else as the server wrote it. */
export const errorText = (e: unknown) =>
  e instanceof TypeError ? "No connection. Check your signal and try again." : e instanceof Error ? e.message : String(e);

// Each answer's ETag (Nov 19: "nothing changed" answers, src/lib/ops/fresh.ts), kept beside the answer it came with.
const etags = new WeakMap<object, string>();
/** The ETag an answer from the server came with, if it had one. */
export const etagOf = (v: unknown): string | null => (typeof v === "object" && v !== null ? etags.get(v) ?? null : null);
const tag = <V>(v: V, etag: string | null): V => { if (etag && typeof v === "object" && v !== null) etags.set(v, etag); return v; };
/** A collection answer's ETag names its recipes too (screens keep the array). */
const tagRecipes = <R extends { recipes: Recipe[] }>(r: R): R => { tag(r.recipes, etagOf(r)); return r; };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", "x-passcode": store.passcode() ?? "", ...(init.headers ?? {}) },
  });
  // Only ever an answer to If-None-Match, sent by `since` below.
  if (r.status === 304) return UNCHANGED as T;
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) { window.dispatchEvent(new Event(SIGNED_OUT)); throw new AuthError(body.error ?? "Wrong passcode."); }
  if (r.status === 429) throw new LockedError(body.error ?? "Too many wrong passcodes. Try again in a few minutes.");
  if (!r.ok) throw new Error(body.error ?? `Something went wrong (${r.status}).`);
  return tag(body, r.headers.get("etag")) as T;
}

/** A read that answers UNCHANGED when the server's copy is still `etag`, the one this phone has. */
const since = <T>(path: string, etag: string | null, signal?: AbortSignal) =>
  call<T | Unchanged>(path, { signal, ...(etag && { headers: { "if-none-match": etag } }) });

import type { Item, Section, Staple, StapleKind, Store } from "./groceries";
/** Where a recipe's ingredient goes (Nov 17: Freezer too). */
export type RecipeSection = "fresh" | "pantry" | "freezer";
export type { Item, Section, Staple, StapleKind, Store };
import type { Draft, Effort, Ingredient, Recipe } from "./recipes";
export type { Draft, Effort, Ingredient, Recipe };
import type { NewDish, NewLunch, PlanData } from "./plan";
import type { CartLine, Pick } from "./safeway";
export type { CartLine, Pick };
import type { Activity, Job, JobKind } from "./jobs";
import type { Choices, OrderResult, ReadyView, RunResult, TimesView, Waiting } from "./checkout-run";
export type { Choices, OrderResult, ReadyView, RunResult, TimesView, Waiting };
export type { Activity, Job, JobKind };
import type { Counts, Dish, Frozen, Kind, Lunch, LunchPart } from "./week";
export type { Counts, Dish, Frozen, Kind, Lunch, LunchPart, NewDish, NewLunch, PlanData };
export type Kitchen = { freezer: Frozen[] };
/** A change to one planned thing: another recipe, another part of a lunch, made (or packed), or off. */
export type PlanChange = { op: "change"; id: string; recipe: string; pinned?: boolean } | { op: "change"; id: string; day: string } | { op: "change"; id: string; part: LunchPart; item: string } | { op: "made"; id: string } | { op: "remove"; id: string } | { op: "clear" } | { op: "count"; recipe: string; kind: Kind; count: number };
export type ListState = { items: Item[]; staples: Staple[] };
export type ListChange = { op: "need"; id: string } | { op: "unneed"; id: string } | { op: "haveIt"; id: string } | { op: "have" } | { op: "add"; text: string; by: string; store?: Store; section?: Section; amount?: string; have?: boolean } | { op: "check"; id: string; checked: boolean } | { op: "move"; id: string; store?: Store; section?: Section } | { op: "many"; items: { item: string; quantity: string; check?: boolean }[]; for: string; by: string } | { op: "remove"; id: string } | { op: "done"; store: Store; cart?: boolean }
  | { op: "keepAdd"; text: string; section?: Section; kind?: StapleKind; group?: string; need?: boolean; by?: string } | { op: "keepSet"; item: string; kind?: StapleKind; group?: string } | { op: "keepGroup"; from: string; to: string } | { op: "keepRemove"; item: string } | { op: "keepMove"; item: string; section: Section };

/** Ordering's settings, as /api/checkout keeps them (src/lib/checkout.ts). */
export type CheckoutSettings = { on: boolean; limitCents: number; store: string; card: string };

const passkey = <T>(body: Record<string, unknown>) => call<T>("/api/checkout/passkey", { method: "POST", body: JSON.stringify(body) });

export const api = {
  list: (signal?: AbortSignal) => call<ListState>("/api/list", { signal }),
  /** The four reads made on opening and coming back, answering UNCHANGED when the phone's copy (`etag`) is current. */
  listSince: (etag: string | null, signal?: AbortSignal) => since<ListState>("/api/list", etag, signal),
  recipesSince: (etag: string | null, signal?: AbortSignal) => since<{ recipes: Recipe[] }>("/api/recipes", etag, signal).then((r) => (r === UNCHANGED ? r : tagRecipes(r))),
  planSince: (etag: string | null, signal?: AbortSignal) => since<PlanData>("/api/plan", etag, signal),
  kitchenSince: (etag: string | null, signal?: AbortSignal) => since<Kitchen>("/api/freezer", etag, signal),
  change: (c: ListChange) => call<ListState>("/api/list", { method: "POST", body: JSON.stringify(c) }),
  recipes: (signal?: AbortSignal) => call<{ recipes: Recipe[] }>("/api/recipes", { signal }).then(tagRecipes),
  saveRecipes: (recipes: Draft[], duplicates?: "skip" | "replace") => call<{ recipes: Recipe[]; saved: string[] }>("/api/recipes", { method: "POST", body: JSON.stringify({ op: "save", recipes, duplicates }) }).then(tagRecipes),
  recipeChange: (c: { op: "effort"; id: string; effort: Effort } | { op: "active"; id: string; active: boolean } | { op: "delete"; id: string } | { op: "section"; id: string; item: string; section: RecipeSection }) => call<{ recipes: Recipe[]; saved: string[] }>("/api/recipes", { method: "POST", body: JSON.stringify(c) }).then(tagRecipes),
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
  faceIdAddStatus: (token: string) => passkey<{ status: "waiting" | "approved" | "gone" }>({ op: "add-status", token }),
  /** A phone with Face ID: the check that approves the new phone waiting now, and that phone's code. */
  faceIdApproveOptions: () => passkey<{ options: PublicKeyCredentialRequestOptionsJSON; code: string }>({ op: "approve-options" }),
  faceIdApprove: (response: unknown) => passkey<{ ok: true }>({ op: "approve", response }),
  faceIdRegister: (response: unknown) => passkey<{ ok: true; count: number }>({ op: "register", response }),
  faceIdCheck: (response: unknown) => passkey<{ ok: boolean; credentialId?: string; why?: string }>({ op: "check", response }),
  /**
   * Test runs (Nov 13): get ready (the helper reads Safeway's checkout; follow it with the job while it's going), approve
   * with a Face ID answer, then the test run (followed the same way). Nothing orders.
   */
  // `since` (Nov 23): following a job, the step time already showing (the last answer's `stepAt`), so the answer comes
  // as soon as the helper reaches its next step.
  checkoutLook: (jobId?: string, signal?: AbortSignal, since?: string) => call<Choices | Waiting>("/api/checkout", { method: "POST", body: JSON.stringify({ op: "look", jobId, since }), signal }),
  checkoutTimes: (jobId: string | undefined, day: string | undefined, signal?: AbortSignal, since?: string) => call<TimesView | Waiting>("/api/checkout", { method: "POST", body: JSON.stringify({ op: "times", jobId, day, since }), signal }),
  checkoutPrepare: (jobId: string | undefined, windowId: string | undefined, signal?: AbortSignal, bagsOwn?: boolean, since?: string) => call<ReadyView | Waiting>("/api/checkout", { method: "POST", body: JSON.stringify({ op: "prepare", jobId, windowId, bagsOwn, since }), signal }),
  // The approval names the reading it approves (Nov 19: another phone getting ready can't swap the figures).
  checkoutApprove: (faceId: unknown, preparedId: string) => call<{ ok: true; approvalId: string; totalCents: number; window: string } | { ok: false; reasons: string[] }>("/api/checkout", { method: "POST", body: JSON.stringify({ op: "approve", faceId, preparedId }) }),
  checkoutPlace: (by: { approvalId: string; totalCents: number | null; window: string } | { jobId: string; since?: string }, signal?: AbortSignal) => call<OrderResult | Waiting>("/api/checkout", { method: "POST", body: JSON.stringify({ op: "place", ...by }), signal }),
  checkoutTestRun: (by: { approvalId: string } | { jobId: string; since?: string }, signal?: AbortSignal) => call<RunResult | Waiting>("/api/checkout", { method: "POST", body: JSON.stringify({ op: "test-run", ...by }), signal }),
  /** Turning on, raising the limit, or changing the store or card needs `faceId`, a Face ID answer (Nov 13). */
  saveCheckout: (s: CheckoutSettings, faceId?: unknown) => call<{ settings: CheckoutSettings; server: boolean }>("/api/checkout", { method: "POST", body: JSON.stringify({ ...s, faceId }) }),
  freezer: (c: { op: "add"; text: string } | { op: "use"; id: string }) => call<Kitchen>("/api/freezer", { method: "POST", body: JSON.stringify(c) }),
  household: (signal?: AbortSignal) => call<{ people: Person[]; stale: boolean }>("/api/household", { signal }),
  /**
   * The Safeway cart as Simmer knows it, the exact product picked before for each item, whether a job went unanswered
   * (`away`), and whether Safeway is signed out on the computer.
   */
  cart: (signal?: AbortSignal) => call<{ cart: CartLine[]; picks: Pick[]; away?: boolean; signedOut?: boolean; noPickup?: boolean }>("/api/safeway/cart", { signal }),
  /** A job for the Safeway helper on the computer: queue it, follow it, or call it off. */
  // Queued from the helper's panel: the panel is told too, so the helper looks at once (Nov 12: it doesn't wait on the push).
  queueJob: (kind: JobKind, args: Record<string, unknown>) => call<{ job: Job; answering: boolean }>("/api/safeway/jobs", { method: "POST", body: JSON.stringify({ op: "queue", kind, ...args, from: framed() ? "panel" : "app" }) })
    .then((r) => { tellPanelQueued(); return r; }),
  /** The helper's recent searches and cart changes, for the panel's activity log. */
  activity: (signal?: AbortSignal) => call<{ jobs: Activity[]; answering: boolean }>("/api/safeway/jobs?recent=1", { signal }),
  /** How a job stands, answered once it's finished (or after about 20 seconds, still going): the server waits, not the app. */
  // `since`: the step time already showing (Nov 23), so the answer also comes when the helper reaches its next step.
  job: (id: string, signal?: AbortSignal, since?: string) => call<{ job: Job | null; answering: boolean }>(`/api/safeway/jobs?id=${encodeURIComponent(id)}&wait=1${since !== undefined ? `&since=${encodeURIComponent(since)}` : ""}`, { signal }),
  cancelJob: (id: string) => call<{ ok: boolean }>("/api/safeway/jobs", { method: "POST", body: JSON.stringify({ op: "cancel", id }) }),
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

