// Ordering's rules (docs/CHECKOUT.md), against copies of Safeway's checkout page the look saved on Nov 12 (names, phone,
// store and card swapped for stand-ins): reading the page, and everything that must stop an order.
import { afterEach, describe, expect, it } from "vitest";
import pages from "./checkout-pages.json";
import { allowedOverCents, APPROVAL_MS, cartKey, cents, chargeOk, loadSettings, NO_ORDERING, readFinal, recordedForTests, resetCheckout, saveSettings, settingsOf, stops, unusual, type Approval, type CheckoutSettings, type Final } from "./checkout";

const pickup = readFinal(pages.pickup.text, pages.pickup.buttons);
// Safeway's page as it will be with the card fixed (Nov 12: it no longer asks for the security code).
const fixed = readFinal(pages.pickup.text.replace(/Confirm CVV /, ""), pages.pickup.buttons);
const on: CheckoutSettings = { on: true, limitCents: 2000, store: "100 Main St", card: "4242" };
const cart = cartKey([{ productId: "184420001", qty: 1 }]);
const approval = (f: Final, p: Partial<Approval> = {}): Approval => ({
  id: "a1", at: 1_000_000, used: false, cartKey: cart, store: f.store, card: f.card, items: f.items!, totalCents: f.totalCents!,
  slot: { ready: f.slot.ready, type: f.slot.type, priceCents: f.slot.priceCents! }, ...p,
});
const now = 1_000_000 + 30_000;

afterEach(() => resetCheckout());

describe("reading Safeway's checkout page", () => {
  it("reads the store, card, items, fees, total and pickup slot", () => {
    expect(pickup).toMatchObject({
      store: "100 Main St, Springfield, CA 90000", card: "4242", items: 1, itemsCents: 299, feesCents: 395, taxCents: 0, totalCents: 694,
      slot: { ready: "9:05 PM", type: "FLASH", priceCents: 395 }, asksCard: true, placeButton: true,
    });
  });

  it("finds no pickup slot and no total before they're on the page, and never guesses", () => {
    const before = readFinal(pages.before.text, pages.before.buttons);
    expect(before.slot).toEqual({ ready: "", type: "", priceCents: null });
    expect(readFinal("", [])).toMatchObject({ store: "", card: "", items: null, totalCents: null, placeButton: false, asksCard: false });
  });

  it("counts Place Order only when exactly one button says exactly that", () => {
    expect(readFinal(pages.pickup.text, ["Place Order", "Place Order"]).placeButton).toBe(false);
    expect(readFinal(pages.pickup.text, ["Place Order Now"]).placeButton).toBe(false);
  });

  it("reads nothing a product name could fake: a figure shown twice is unreadable, and stops the order", () => {
    const faked = readFinal(pages.pickup.text.replace("Order summary", "Gift Card Estimated total $50.00 Order summary"), pages.pickup.buttons);
    expect(faked.totalCents).toBeNull();
    expect(stops(on, faked, null, now, cart, true)).toContain("Safeway's total couldn't be read.");
  });

  it("reads money exactly", () => {
    expect(cents("$1,234.56")).toBe(123456);
    expect(cents("$3.9")).toBeNull();
    expect(cents("about $4")).toBeNull();
  });
});

describe("what stops an order", () => {
  it("lets a matching page through when everything is on and within the limit", () => {
    expect(stops(on, fixed, approval(fixed), now, cart, true)).toEqual([]);
  });

  it("stops with ordering off, in Settings or on the server, and by default", () => {
    expect(stops({ ...on, on: false }, fixed, null, now, cart, true)).toContain("Ordering is off in Settings.");
    expect(stops(on, fixed, null, now, cart, false)).toContain("Ordering is turned off for now.");
    expect(stops(NO_ORDERING, fixed, null, now, cart, true).length).toBeGreaterThan(2);
  });

  it("stops over the limit, and the limit starts at $0", () => {
    expect(stops({ ...on, limitCents: 693 }, fixed, null, now, cart, true)).toContain("$6.94 is over the limit of $6.93.");
    expect(stops({ ...on, limitCents: 694 }, fixed, null, now, cart, true)).toEqual([]);
    expect(NO_ORDERING.limitCents).toBe(0);
  });

  it("stops for a different store or card, or when Safeway asks for card details", () => {
    expect(stops({ ...on, store: "200 Oak Ave" }, fixed, null, now, cart, true)).toContain("Safeway shows a different pickup store.");
    expect(stops({ ...on, store: "" }, fixed, null, now, cart, true)).toContain("Safeway shows a different pickup store.");
    expect(stops({ ...on, store: "Main St" }, fixed, null, now, cart, true)).toContain("Safeway shows a different pickup store.");
    expect(stops({ ...on, store: "100 Main" }, fixed, null, now, cart, true)).toEqual([]);
    expect(stops({ ...on, store: "100 Mai" }, fixed, null, now, cart, true)).toContain("Safeway shows a different pickup store.");
    expect(stops({ ...on, card: "1111" }, fixed, null, now, cart, true)).toContain("Safeway shows a different card.");
    expect(stops(on, pickup, null, now, cart, true)).toContain("Safeway is asking for card details; finish on Safeway.");
  });

  it("stops when the page can't be read or Place Order isn't there", () => {
    const empty = readFinal("", []);
    expect(stops(on, empty, null, now, cart, true)).toEqual(expect.arrayContaining([
      "Safeway's total couldn't be read.", "Safeway's Place Order button isn't where it should be.", "No pickup time is chosen.",
    ]));
  });

  it("stops on any difference from the approval: a cent, an item, the time, the store, the card", () => {
    const a = approval(fixed);
    expect(stops(on, { ...fixed, totalCents: 695 }, a, now, cart, true)).toContain("Safeway's total changed.");
    expect(stops(on, { ...fixed, items: 2 }, a, now, cart, true)).toContain("Safeway's items changed.");
    expect(stops(on, { ...fixed, slot: { ...fixed.slot, ready: "9:35 PM" } }, a, now, cart, true)).toContain("Safeway's pickup time changed.");
    expect(stops(on, { ...fixed, slot: { ...fixed.slot, priceCents: 0 } }, a, now, cart, true)).toContain("Safeway's pickup time changed.");
    expect(stops(on, fixed, approval(fixed, { card: "1111" }), now, cart, true)).toContain("Safeway's card changed.");
  });

  it("stops when the cart changed, the approval ran out, or it was already tried", () => {
    const a = approval(fixed);
    expect(stops(on, fixed, a, now, cartKey([{ productId: "184420001", qty: 2 }]), true)).toContain("The cart changed after the approval.");
    expect(stops(on, fixed, a, a.at + APPROVAL_MS + 1, cart, true)).toContain("The approval ran out; look again.");
    expect(stops(on, fixed, a, a.at + APPROVAL_MS, cart, true)).toEqual([]);
    expect(stops(on, fixed, { ...a, used: true }, now, cart, true)).toContain("This was already tried; check Safeway.");
  });
});

describe("after the order", () => {
  it("allows weighed items to come in up to 10% over, never more than $5", () => {
    expect(allowedOverCents(2000)).toBe(200);
    expect(allowedOverCents(12840)).toBe(500);
    expect(chargeOk(2000, 2200)).toBe(true);
    expect(chargeOk(2000, 2201)).toBe(false);
    expect(chargeOk(12840, 13340)).toBe(true);
    expect(chargeOk(12840, 13341)).toBe(false);
  });

  it("highlights five or more of a thing, one thing over $30, and a total well over the estimate", () => {
    expect(unusual([{ name: "Milk", qty: 5, priceCents: 499 }, { name: "Salmon", qty: 1, priceCents: 3001 }], 10000, 11501)).toEqual([
      "5 × Milk", "Salmon is $30.01", "The total is more than Simmer expected ($100.00)",
    ]);
    expect(unusual([{ name: "Milk", qty: 4, priceCents: 3000 }], 10000, 11500)).toEqual([]);
  });
});

describe("ordering's settings", () => {
  it("start off with a $0 limit, and anything missing or unreadable reads that way", async () => {
    expect(await loadSettings()).toEqual(NO_ORDERING);
    expect(settingsOf(undefined)).toEqual(NO_ORDERING);
    expect(settingsOf(["yes", "-5", "", "12345"])).toEqual(NO_ORDERING);
    expect(settingsOf(["on", "abc", "", ""]).limitCents).toBe(0);
  });

  it("keep what's set, and note every change", async () => {
    await saveSettings({ on: true, limitCents: 15000, store: "  100 Main St ", card: "4242" });
    expect(await loadSettings()).toEqual({ on: true, limitCents: 15000, store: "100 Main St", card: "4242" });
    expect(recordedForTests().at(-1)?.[1]).toBe("settings");
  });
});
