// Ordering from Simmer (Safeway pickup): the rules, as plain code with tests. docs/CHECKOUT.md is the agreement; nothing
// here may be loosened without Sam's yes. Phase 2 (Nov 12): settings, reading Safeway's final page, and checking it
// against an approval. Nothing in Simmer or the helper presses Place Order yet; dry runs stop one press short.
import { readTabIfAny, replaceTab, appendRows, sheetsConfigured } from "./google/sheets";
import type { CheckoutSettings } from "./checkout-rules";
export { needsFaceId } from "./checkout-rules";

/** Ordering's settings. Off and $0 until the household changes them; anything missing or unreadable reads as off / $0. */
export type { CheckoutSettings };
export const NO_ORDERING: CheckoutSettings = { on: false, limitCents: 0, store: "", card: "" };

/** The server's own switch (`CHECKOUT_ENABLED=on` in Vercel), which stops ordering with no release. Off unless set. */
export const serverOn = () => process.env.CHECKOUT_ENABLED === "on";

/** What Safeway's final checkout page says, read from its words. Anything not found is empty or null, never a guess. */
export type Final = {
  store: string; card: string; items: number | null; itemsCents: number | null; feesCents: number | null; taxCents: number | null;
  totalCents: number | null; slot: { ready: string; type: string; priceCents: number | null }; asksCard: boolean; placeButton: boolean;
};

/** "$1,234.56" → 123456; anything else → null. */
export function cents(s: string | undefined): number | null {
  const m = s?.replace(/,/g, "").match(/^\$?(\d+)\.(\d\d)$/);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}
/**
 * The one match of `re` in the page, or null when it's there more than once (a product named like a summary line could
 * otherwise be read as the total; outside review, Nov 12). Null stops an order.
 */
const once = (text: string, re: RegExp): RegExpMatchArray | null => {
  const all = [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))];
  return all.length === 1 ? all[0] : null;
};
const money = (text: string, re: RegExp) => cents(once(text, re)?.[1]);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Reads Safeway's checkout page (its words and its buttons' words, as the helper's look saves them). Safeway's page, Nov
 * 12: "Pick up your order here <store>", "Ready by 9:05 PM Slot type FLASH price $3.95", "Visa •••• 1234", "Confirm
 * CVV" while it wants the card's security code, "Safeway Items (3) $17.22", "Est. taxes and fees $3.95", "Sales Tax
 * $0.00", "Estimated total $21.17", and a button that says "Place Order".
 */
export function readFinal(text: string, buttons: string[]): Final {
  const t = squash(text);
  const items = once(t, /Safeway Items \((\d+)\) (\$[\d,]+\.\d\d)/);
  const slot = once(t, /Slot type (\w+) price (\$[\d,]+\.\d\d)/);
  return {
    store: squash(once(t, /Pick up your order here (.+?) (?:Schedule pickup time|Email Address|Contact Number|Continue|Pickup date)/)?.[1] ?? ""),
    card: once(t, /(?:Visa|Mastercard|MasterCard|Amex|American Express|Discover)\s*[•·*]+\s*(\d{4})\b/)?.[1] ?? "",
    items: items ? Number(items[1]) : null,
    itemsCents: cents(items?.[2]),
    feesCents: money(t, /Est\. taxes and fees (\$[\d,]+\.\d\d)/),
    taxCents: money(t, /Sales Tax (\$[\d,]+\.\d\d)/),
    totalCents: money(t, /Estimated total (\$[\d,]+\.\d\d)/),
    slot: { ready: once(t, /Ready by (\d{1,2}:\d\d ?[AP]M)/i)?.[1] ?? "", type: slot?.[1] ?? "", priceCents: cents(slot?.[2]) },
    asksCard: /\bCVV\b|security code|card number|expiration date/i.test(t),
    placeButton: buttons.filter((b) => squash(b) === "Place Order").length === 1,
  };
}

/** What the household approved with Face ID: fixed at the tap (docs/CHECKOUT.md, "Each order"). */
export type Approval = {
  id: string; at: number; used: boolean; cartKey: string;
  store: string; card: string; items: number; totalCents: number; slot: { ready: string; type: string; priceCents: number };
};
export const APPROVAL_MS = 2 * 60_000;

/** The cart as a fixed key (product and count, in order), so any change to it after the tap shows. */
export const cartKey = (lines: { productId: string; qty: number }[]) =>
  lines.filter((l) => l.qty > 0).map((l) => `${l.productId}x${l.qty}`).sort().join(",");

const sameStore = (pinned: string, shown: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Safeway's address starts with the pinned one ("389 Main St" in "389 Main St, Town, CA"); appearing later doesn't count.
  return Boolean(norm(pinned)) && (norm(shown) === norm(pinned) || norm(shown).startsWith(`${norm(pinned)} `));
};

/**
 * Everything that stops an order, in words for the confirm sheet; none means it may go ahead. Checked when the approval
 * is made and again on Safeway's final page just before the press. Any difference, a cent or an item, stops it.
 */
export function stops(s: CheckoutSettings, f: Final, a: Approval | null, now: number, cart: string, server = serverOn()): string[] {
  const out: string[] = [];
  if (!server) out.push("Ordering is turned off for now.");
  if (!s.on) out.push("Ordering is off in Settings.");
  if (f.totalCents === null) out.push("Safeway's total couldn't be read.");
  else if (f.totalCents > s.limitCents) out.push(`$${(f.totalCents / 100).toFixed(2)} is over the limit of $${(s.limitCents / 100).toFixed(2)}.`);
  if (!sameStore(s.store, f.store)) out.push("Safeway shows a different pickup store.");
  if (!/^\d{4}$/.test(s.card) || f.card !== s.card) out.push("Safeway shows a different card.");
  if (f.asksCard) out.push("Safeway is asking for card details; finish on Safeway.");
  if (!f.placeButton) out.push("Safeway's Place Order button isn't where it should be.");
  if (f.items === null) out.push("Safeway's item count couldn't be read.");
  if (f.slot.priceCents === null || !f.slot.ready) out.push("No pickup time is chosen.");
  if (!a) return out;
  if (a.used) out.push("This was already tried; check Safeway.");
  if (now - a.at > APPROVAL_MS) out.push("The approval ran out; look again.");
  if (cart !== a.cartKey) out.push("The cart changed after the approval.");
  if (f.totalCents !== a.totalCents) out.push("Safeway's total changed.");
  if (f.items !== a.items) out.push("Safeway's items changed.");
  if (!sameStore(a.store, f.store)) out.push("Safeway's pickup store changed.");
  if (f.card !== a.card) out.push("Safeway's card changed.");
  if (f.slot.ready !== a.slot.ready || f.slot.type !== a.slot.type || f.slot.priceCents !== a.slot.priceCents) out.push("Safeway's pickup time changed.");
  return out;
}

/** Weighed items (Sam, Nov 12): the charge after picking may be up to 10% over the approved total, and never $5 more. */
export const allowedOverCents = (approvedCents: number) => Math.min(Math.round(approvedCents * 0.1), 500);
export const chargeOk = (approvedCents: number, chargedCents: number) => chargedCents <= approvedCents + allowedOverCents(approvedCents);

/** What the confirm sheet highlights: a count of 5 or more, one item over $30, a total more than 15% over Simmer's estimate. */
export function unusual(lines: { name: string; qty: number; priceCents: number | null }[], estimateCents: number | null, totalCents: number): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.qty >= 5) out.push(`${l.qty} × ${l.name}`);
    if (l.priceCents !== null && l.priceCents > 3000) out.push(`${l.name} is $${(l.priceCents / 100).toFixed(2)}`);
  }
  if (estimateCents && totalCents > estimateCents * 1.15) out.push(`The total is more than Simmer expected ($${(estimateCents / 100).toFixed(2)})`);
  return out;
}

// Settings, kept in the "Checkout" tab as one row: on, limit (cents), store, card.
const TAB = "Checkout";
let memory: CheckoutSettings = NO_ORDERING;

/** Settings as they read; missing or unreadable reads as off with a $0 limit (Sam, Nov 12). */
export function settingsOf(row: string[] | undefined): CheckoutSettings {
  if (!row) return NO_ORDERING;
  const limit = Number(row[1]);
  return {
    on: row[0] === "on",
    limitCents: Number.isInteger(limit) && limit >= 0 && limit <= 100_000 ? limit : 0,
    store: squash(row[2] ?? "").slice(0, 120),
    card: /^\d{4}$/.test(row[3] ?? "") ? row[3] : "",
  };
}

export async function loadSettings(): Promise<CheckoutSettings> {
  if (!sheetsConfigured()) return memory;
  try { return settingsOf((await readTabIfAny(TAB))[1]); } catch { return NO_ORDERING; }
}

/** Settings as they'd be saved: anything unreadable as off / $0. */
export const cleanSettings = (s: CheckoutSettings) => settingsOf([s.on ? "on" : "off", String(s.limitCents), s.store, s.card]);

/** `noted` goes in the record with the change (which Face ID check allowed it, Nov 13). */
export async function saveSettings(s: CheckoutSettings, noted: Record<string, unknown> = {}): Promise<CheckoutSettings> {
  const clean = cleanSettings(s);
  if (!sheetsConfigured()) memory = clean;
  else await replaceTab(TAB, [["on", "limit", "store", "card"], [clean.on ? "on" : "off", String(clean.limitCents), clean.store, clean.card]]);
  await record("settings", { on: clean.on, limitCents: clean.limitCents, store: clean.store, card: clean.card, ...noted });
  return clean;
}

/** The record of every attempt and every settings change, kept even when it fails (docs/CHECKOUT.md). */
const LOG = "Checkout record";
const memoryLog: string[][] = [];
export async function record(what: string, detail: Record<string, unknown>): Promise<void> {
  const row = [new Date().toISOString(), what, JSON.stringify(detail).slice(0, 20_000)];
  if (!sheetsConfigured()) { memoryLog.push(row); return; }
  await appendRows(LOG, [row]);
}
export const resetCheckout = () => { memory = NO_ORDERING; memoryLog.length = 0; };
export const recordedForTests = () => memoryLog;

/**
 * A pickup window as Safeway's checkout lists it (Nov 12): a radio button whose id carries the store, day, date, REGULAR
 * or FLASH, DUG (pickup) and the times ("…FRI20261113REGULARDUG600700-2026-11-13"), and whose words say the time and
 * price ("6 AM - 7 AM price Free", or "Ready by 10:05 PM Slot type FLASH price $3.95").
 */
export type PickupWindow = { id: string; words: string; date: string; regular: boolean; priceCents: number | null; order: number };

export function windowOf(id: string, words: string, order: number): PickupWindow {
  const w = squash(words);
  const price = w.match(/\bprice (Free|\$[\d,]+\.\d\d)\b/i)?.[1];
  return {
    id, words: w, order,
    date: id.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "",
    regular: /REGULAR/.test(id) && !/FLASH/i.test(`${id} ${w}`),
    priceCents: price === undefined ? null : /^free$/i.test(price) ? 0 : cents(price),
  };
}

/**
 * The window ordering takes (Sam, Nov 12): the earliest free REGULAR window, by date and then as Safeway lists it. Never
 * FLASH, never one with a price, never one whose price can't be read. None: null, and the order stops.
 */
export function pickWindow(windows: PickupWindow[]): PickupWindow | null {
  return windows.filter((w) => w.regular && w.priceCents === 0 && /^\d{4}-\d{2}-\d{2}$/.test(w.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)[0] ?? null;
}

// ---- test runs (phase 2, Nov 13): what Safeway's page says once the helper has chosen a free window

/** The time range in a window's words: "6 AM - 7 AM price Free" → ["6 AM", "7 AM"]. */
const rangeOf = (words: string) => words.match(/\b(\d{1,2}(?::\d\d)? ?[AP]M) ?[-–] ?(\d{1,2}(?::\d\d)? ?[AP]M)\b/i);
const loose = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");

/**
 * The pickup time on Safeway's final page, from the window the helper chose (Nov 13). A REGULAR window's final page
 * hasn't been seen yet; the FLASH one said "Ready by 9:05 PM Slot type FLASH price $3.95". Until it has, the slot comes
 * from the chosen window (its words, price Free → $0, REGULAR from its id), and the page must say the same time range
 * ("6 AM - 7 AM"), or the time counts as unreadable and stops. Only a free REGULAR window passes; a page that shows a
 * paid slot stops too.
 */
export function pickupOf(f: Final, text: string, chosen: { id: string; words: string } | null): { final: Final; why: string[] } {
  const none = { ...f, slot: { ready: "", type: "", priceCents: null } };
  if (!chosen) return { final: none, why: ["No free pickup time was chosen."] };
  const w = windowOf(chosen.id, chosen.words, 0);
  if (!w.regular || w.priceCents !== 0) return { final: none, why: ["Safeway's pickup time isn't a free one."] };
  if (f.slot.type && (f.slot.type !== "REGULAR" || f.slot.priceCents !== 0)) return { final: none, why: ["Safeway's page shows a paid pickup time."] };
  const r = rangeOf(w.words);
  const range = r ? `${squash(r[1])} - ${squash(r[2])}` : "";
  if (!r || !new RegExp(`\\b${loose(squash(r[1]))}\\s*[-–]\\s*${loose(squash(r[2]))}\\b`, "i").test(squash(text))) {
    return { final: none, why: ["Safeway's pickup time couldn't be read."] };
  }
  return { final: { ...f, slot: { ready: range, type: "REGULAR", priceCents: 0 } }, why: [] };
}

/** "Fri 6–7 AM": the day from the window's date, and its time range. */
export function windowWords(chosen: { id: string; words: string }): string {
  const w = windowOf(chosen.id, chosen.words, 0);
  const r = rangeOf(w.words);
  const day = w.date ? new Date(`${w.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) : "";
  if (!r) return day;
  const [a, b] = [squash(r[1]).toUpperCase(), squash(r[2]).toUpperCase()];
  const same = a.slice(-2) === b.slice(-2);
  return `${day} ${same ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`}`.trim();
}

/** Where the helper stopped short of Safeway's final page, in words for the sheet. */
const STOPPED: Record<string, string> = {
  "signed out": "Safeway is signed out on the computer.",
  "page didn't load": "Safeway's page didn't load. Try again.",
  "no button to press": "Safeway's checkout didn't show the button it usually does.",
  "not the checkout page": "Safeway didn't show its checkout page.",
  "no pickup times": "Safeway didn't show any pickup times.",
  "pickup day gone": "That pickup day isn't offered any more. Get ready again.",
  "pickup time gone": "That pickup time isn't offered any more. Get ready again.",
  "no free pickup time": "No free pickup time in the next week.",
  "couldn't choose the pickup time": "The pickup time couldn't be chosen.",
  "no window": "No pickup time could be chosen.",
};
export const stoppedWords = (stopped: string) => STOPPED[stopped] ?? "Safeway's checkout didn't go as expected.";
