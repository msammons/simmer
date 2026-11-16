// @vitest-environment jsdom
// The checkout look's presses (Nov 12, Sam: "Checkout only", then "Continue only"; docs/CHECKOUT.md), run in copies of
// Safeway's cart page and its suggestions page: only that page's single Checkout or Continue is pressed; else nothing.
import { afterEach, describe, expect, it } from "vitest";
// Plain JavaScript, run inside Safeway's page by the helper.
import { safewayPage } from "../../extension-working/page.js";
import { PAGE } from "./safeway-helper.mjs";

const pressedLabels: string[] = [];
function cart(buttons: string[], path = "/erums/cart") {
  window.history.replaceState(null, "", path);
  document.body.innerHTML = buttons.map((b) => `<button>${b}</button>`).join("");
  // jsdom lays nothing out; every button counts as on screen.
  for (const b of document.querySelectorAll("button")) {
    Object.defineProperty(b, "offsetWidth", { value: 80 });
    b.addEventListener("click", () => pressedLabels.push(b.textContent ?? ""));
  }
}
type Press = { pressed: boolean; found: number; label: string };
const CART = { path: "/erums/cart", words: ["checkout", "safeway"] };
const SUGGESTIONS = { path: "/erums/cart/dnf", words: ["continue", "to", "checkout", "safeway"] };
const CHECKOUT = { path: "/erums/checkout", words: ["continue"] };
const press = async (step = CART) => (await safewayPage("pressCheckout", step, PAGE)) as unknown as Press;
const saved = ["Set substitutions for all items", "Decrease quantity", "Increase quantity", "Remove Iceberg Lettuce", "Add Note Iceberg Lettuce"];

afterEach(() => { pressedLabels.length = 0; });

describe("the checkout look's one press", () => {
  it("presses Safeway's Checkout button on the cart page, and nothing else", async () => {
    cart([...saved, "Safeway Checkout Checkout", "Make this order a gift"]);
    expect(await press()).toMatchObject({ pressed: true, found: 1 });
    expect(pressedLabels).toEqual(["Safeway Checkout Checkout"]);
  });

  it("presses nothing off the cart page, where Place order would be", async () => {
    cart(["Checkout", "Place order"], "/erums/checkout");
    expect((await press()).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });

  it("presses nothing that says more than Checkout, or when there's more than one", async () => {
    cart([...saved, "Place order", "Checkout and pay", "Confirm checkout"]);
    expect(await press()).toMatchObject({ pressed: false, found: 0 });
    cart(["Checkout", "Safeway Checkout"]);
    expect(await press()).toMatchObject({ pressed: false, found: 2 });
    expect(pressedLabels).toEqual([]);
  });

  it("presses the suggestions page's Continue, never its Add or coupon buttons", async () => {
    const tiles = ["Add 1 unit of Banana Add", "Clip coupon for $5.99 Each for O Organics Avocados Bagged 4 Count", "Next products set"];
    cart([...tiles, "Continue to checkout"], "/erums/cart/dnf");
    expect(await press(SUGGESTIONS)).toMatchObject({ pressed: true, found: 1 });
    expect(pressedLabels).toEqual(["Continue to checkout"]);
    pressedLabels.length = 0;
    cart([...tiles, "Continue shopping"], "/erums/cart/dnf");
    expect((await press(SUGGESTIONS)).pressed).toBe(false);
    cart(["Continue", "Place order"], "/erums/checkout");
    expect((await press(SUGGESTIONS)).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });

  it("presses the checkout page's Order info Continue, never Place Order, a payment or a donation", async () => {
    const page = ["Order info", "Pickup date & time", "Payment heading level 2 edit Payment", "Make this order a gift", "Place Order",
      "Round order to $22.00", "$1.00", "Promo code Promo code"];
    cart([...page, "Continue"], "/erums/checkout");
    expect(await press(CHECKOUT)).toMatchObject({ pressed: true, found: 1 });
    expect(pressedLabels).toEqual(["Continue"]);
    pressedLabels.length = 0;
    cart([...page, "Continue to payment"], "/erums/checkout");
    expect((await press(CHECKOUT)).pressed).toBe(false);
    cart([...page, "Continue", "Continue"], "/erums/checkout");
    expect((await press(CHECKOUT)).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });

  it("presses one pickup day, the first not chosen, never a time or anything else", async () => {
    const days = ["SelectedTHURSDAY Nov, 12 Thu Nov 12", "select slots for FRIDAY Nov, 13 Fri Nov 13", "select slots for SATURDAY Nov, 14 Sat Nov 14"];
    const day = async () => (await safewayPage("pressDay", { path: "/erums/checkout" }, PAGE)) as unknown as Press;
    cart(["Place Order", "9:00 AM - 10:00 AM $0.00", "Continue", ...days], "/erums/checkout");
    expect(await day()).toMatchObject({ pressed: true, label: "select slots for FRIDAY Nov, 13 Fri Nov 13" });
    expect(pressedLabels).toEqual(["select slots for FRIDAY Nov, 13 Fri Nov 13"]);
    pressedLabels.length = 0;
    const named = async (label: string) => (await safewayPage("pressDay", { path: "/erums/checkout", label }, PAGE)) as unknown as Press;
    cart(days, "/erums/checkout");
    expect(await named("select slots for SATURDAY Nov, 14 Sat Nov 14")).toMatchObject({ pressed: true, label: "select slots for SATURDAY Nov, 14 Sat Nov 14" });
    expect(await named("select slots for SUNDAY Nov, 15 Sun Nov 15")).toMatchObject({ pressed: false });
    pressedLabels.length = 0;
    cart(["Place Order", "select slots for 9:00 AM", "Select FRIDAY 9 AM slot"], "/erums/checkout");
    expect((await day()).pressed).toBe(false);
    cart(days, "/erums/cart");
    expect((await day()).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });

  it("chooses only the free window Simmer picked, never Flash, a priced one, or off the checkout page", async () => {
    const page = (slots: { id: string; text: string }[], path = "/erums/checkout") => {
      window.history.replaceState(null, "", path);
      document.body.innerHTML = slots.map((x) => `<div class="row"><div class="col"><input type="radio" name="slot" id="${x.id}"><label for="${x.id}">${x.text.replace(/ price .*/, "")}</label></div> <div class="col">${x.text.replace(/.* price /, "price ")}</div></div>`).join("") + "<button>Place Order</button>";
      document.querySelectorAll("input,button").forEach((b) => b.addEventListener("click", () => pressedLabels.push((b as HTMLElement).id || b.textContent || "")));
    };
    const choose = async (id: string) => (await safewayPage("chooseWindow", { path: "/erums/checkout", id }, PAGE)) as unknown as { pressed: boolean; why?: string };
    const free = { id: "9999FRI20261113REGULARDUG600700-2026-11-13", text: "6 AM - 7 AM price Free" };
    const flash = { id: "9999DUGTHUFLASH06:0506:00-2026-11-12-865302", text: "Ready by 10:05 PM Slot type FLASH price $3.95" };
    const paid = { id: "9999SAT20261114REGULARDUG600700-2026-11-14", text: "6 AM - 7 AM price $2.95" };
    page([flash, free, paid]);
    const read = (await safewayPage("readWindows", null, PAGE)) as unknown as { windows: { id: string; words: string }[] };
    expect(read.windows.map((w) => w.words)).toEqual([flash, free, paid].map((x) => x.text));
    expect(await choose(free.id)).toMatchObject({ pressed: true });
    expect(pressedLabels).toEqual([free.id]);
    pressedLabels.length = 0;
    expect(await choose(flash.id)).toMatchObject({ pressed: false, why: "not free" });
    expect(await choose(paid.id)).toMatchObject({ pressed: false, why: "not free" });
    expect(await choose("nope")).toMatchObject({ pressed: false });
    page([free], "/erums/cart");
    expect((await choose(free.id)).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });

  it("presses nothing that's turned off", async () => {
    cart(["Checkout"]);
    document.querySelector("button")!.setAttribute("aria-disabled", "true");
    expect((await press()).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });

  it("reopens the pickup times with that one Edit, on the checkout page only, never another Edit or Place Order (Nov 14)", async () => {
    const edit = async (path = "/erums/checkout") => (await safewayPage("pressPickupEdit", { path }, PAGE)) as unknown as Press;
    cart(["Order info Edit", "Pickup date & time Edit", "Payment heading level 2 edit Payment", "Make this order a gift Edit", "Place Order", "Edit"], "/erums/checkout");
    expect(await edit()).toMatchObject({ pressed: true, found: 1 });
    expect(pressedLabels).toEqual(["Pickup date & time Edit"]);
    pressedLabels.length = 0;
    cart(["Pickup date & time Edit"], "/erums/cart");
    expect((await edit("/erums/checkout")).pressed).toBe(false);
    cart(["Pickup date & time Edit", "Pickup date & time Edit"], "/erums/checkout");
    expect((await edit()).pressed).toBe(false);
    cart(["Order info Edit", "Edit", "Place Order"], "/erums/checkout");
    expect((await edit()).pressed).toBe(false);
    // Inside a form, a plain <button> would send it: not pressed.
    window.history.replaceState(null, "", "/erums/checkout");
    document.body.innerHTML = `<form><button>Pickup date & time Edit</button></form>`;
    const b = document.querySelector("button")!; Object.defineProperty(b, "offsetWidth", { value: 80 }); b.addEventListener("click", () => pressedLabels.push("form"));
    expect(await edit()).toMatchObject({ pressed: false, why: "submits a form" });
    expect(pressedLabels).toEqual([]);
  });
});

describe("More times (Nov 14)", () => {
  const more = async (path = "/erums/checkout") => (await safewayPage("pressMoreTimes", { path }, PAGE)) as unknown as Press;
  it("presses only the one More times on the checkout page, never Place Order or another button", async () => {
    cart(["More times collapsed", "Learn more about Nourishing Neighbors Nourishing Neighbors", "Place Order", "Continue"], "/erums/checkout");
    expect(await more()).toMatchObject({ pressed: true, found: 1 });
    expect(pressedLabels).toEqual(["More times collapsed"]);
    pressedLabels.length = 0;
    cart(["More times collapsed"], "/erums/cart");
    expect((await more()).pressed).toBe(false);
    cart(["More times", "More times"], "/erums/checkout");
    expect((await more()).pressed).toBe(false);
    cart(["Show more", "Place Order"], "/erums/checkout");
    expect((await more()).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });
});

describe("waiting for Safeway's page (Nov 14: no guessed pauses)", () => {
  const wait = async (until: string, extra: Record<string, unknown> = {}, ms = 500) => (await safewayPage("waitFor", { until, ms, ...extra }, PAGE)) as unknown as { ok: boolean };
  const tile = (label: string, active = false) => { const t = document.createElement("div"); t.className = `date-tile${active ? " date-is-active" : ""}`; t.setAttribute("role", "button"); t.textContent = label; Object.defineProperty(t, "offsetWidth", { value: 80 }); return t; };
  const radio = (id: string) => { const r = document.createElement("input"); r.type = "radio"; r.name = "slot"; r.id = id; return r; };

  it("answers at once when the page already shows it", async () => {
    window.history.replaceState(null, "", "/erums/checkout");
    document.body.innerHTML = "";
    document.body.append(tile("select slots for SATURDAY Nov, 14 Sat Nov 14", true));
    expect(await wait("times")).toEqual({ ok: true });
  });

  it("answers as soon as the times appear, well before the limit", async () => {
    document.body.innerHTML = "<p>Pickup date & time</p>";
    const started = Date.now();
    setTimeout(() => document.body.append(tile("select slots for SUNDAY Nov, 15 Sun Nov 15")), 30);
    expect(await wait("times", {}, 3000)).toEqual({ ok: true });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("gives up at its limit when the page never shows it", async () => {
    document.body.innerHTML = "<p>Pickup date & time</p>";
    expect(await wait("timesOpen", {}, 100)).toEqual({ ok: false });
  });

  it("waits for a pressed day's own times, not the last day's still showing", async () => {
    const sat = tile("select slots for SATURDAY Nov, 14 Sat Nov 14", true), sun = tile("select slots for SUNDAY Nov, 15 Sun Nov 15");
    document.body.innerHTML = "";
    document.body.append(sat, sun, radio("3011SAT20261114REGULARDUG18001900-2026-11-14"));
    setTimeout(() => { sat.classList.remove("date-is-active"); sun.classList.add("date-is-active"); }, 20);
    expect(await wait("day", { label: "select slots for SUNDAY Nov, 15 Sun Nov 15", dd: "15" }, 150)).toEqual({ ok: false });
    setTimeout(() => document.body.append(radio("3011SUN20261115REGULARDUG600700-2026-11-15")), 20);
    expect(await wait("day", { label: "select slots for SUNDAY Nov, 15 Sun Nov 15", dd: "15" }, 2000)).toEqual({ ok: true });
  });

  it("waits for the pickup step's one Continue to turn on", async () => {
    document.body.innerHTML = `<button disabled>Continue</button>`;
    const b = document.querySelector("button")!; Object.defineProperty(b, "offsetWidth", { value: 80 });
    setTimeout(() => { b.disabled = false; }, 20);
    expect(await wait("continueOn", {}, 2000)).toEqual({ ok: true });
  });
});

describe("the one press that orders (phase 3, Nov 14)", () => {
  const EXPECT = {
    total: "$30.96", items: 4, itemsLine: "Safeway Items (4) $32.96", card: "3184", storeLine: "Pick up your order here 100 Main St, Springfield, CA 90000",
    whenLine: "Pickup date & time Edit Sunday, Nov 15, 6 AM - 7 AM", deadline: Date.now() + 60_000,
  };
  const PAGE_TEXT = "Pick up your order here 100 Main St, Springfield, CA 90000 Pickup date & time Edit Sunday, Nov 15, 6 AM - 7 AM Payment $30.96 Visa •••• 3184 Edit Place Order Order summary Safeway Items (4) $32.96 Estimated total $30.96";
  const place = async (expect: Record<string, unknown> = EXPECT, path = "/erums/checkout") => (await safewayPage("placeOrder", { path, expect }, PAGE)) as unknown as { pressed: boolean; why: string };
  function checkout(text: string, buttons = ["Place Order"], path = "/erums/checkout") {
    window.history.replaceState(null, "", path);
    document.body.innerHTML = `<p>${text}</p>` + buttons.map((b) => `<button>${b}</button>`).join("");
    for (const b of document.querySelectorAll("button")) {
      Object.defineProperty(b, "offsetWidth", { value: 80 });
      b.addEventListener("click", () => pressedLabels.push(b.textContent ?? ""));
    }
  }

  it("presses Place Order once when the page says exactly what was approved", async () => {
    checkout(PAGE_TEXT);
    expect(await place()).toMatchObject({ pressed: true });
    expect(pressedLabels).toEqual(["Place Order"]);
  });

  it("presses nothing when any figure differs, a card detail is asked for, or the button isn't exactly one", async () => {
    const cases: [string, string[], Record<string, unknown>, string][] = [
      [PAGE_TEXT.replace("Estimated total $30.96", "Estimated total $31.96"), ["Place Order"], EXPECT, "total"],
      [PAGE_TEXT.replace("Safeway Items (4)", "Safeway Items (5)"), ["Place Order"], EXPECT, "items"],
      [PAGE_TEXT.replace("•••• 3184", "•••• 9999"), ["Place Order"], EXPECT, "card"],
      [`${PAGE_TEXT} Mastercard •••• 5555`, ["Place Order"], EXPECT, "another card"],
      [PAGE_TEXT.replace("100 Main St", "200 Elm St"), ["Place Order"], EXPECT, "store"],
      [`${PAGE_TEXT.replace("Pick up your order here 100 Main St", "Pick up your order here 200 Elm St")} 100 Main St, Springfield, CA 90000`, ["Place Order"], EXPECT, "store"],
      [PAGE_TEXT.replace("6 AM - 7 AM", "7 AM - 8 AM"), ["Place Order"], EXPECT, "pickup time"],
      [`${PAGE_TEXT.replace("Edit Sunday, Nov 15, 6 AM - 7 AM", "Edit Sunday, Nov 15, 7 AM - 8 AM")} Sunday, Nov 15, 6 AM - 7 AM`, ["Place Order"], EXPECT, "pickup time"],
      [PAGE_TEXT.replace("Safeway Items (4) $32.96", "Safeway Items (4) $33.96"), ["Place Order"], EXPECT, "items subtotal"],
      [PAGE_TEXT.replace("Payment $30.96 Visa •••• 3184", "Payment $30.96 Visa •••• 9999 Saved Visa •••• 3184"), ["Place Order"], EXPECT, "card"],
      [PAGE_TEXT, ["Place Order"], { ...EXPECT, deadline: Date.now() - 1 }, "approval ran out"],
      [`${PAGE_TEXT} Confirm CVV`, ["Place Order"], EXPECT, "asks for card details"],
      [PAGE_TEXT, ["Place Order", "Place Order"], EXPECT, "place order buttons: 2"],
      [PAGE_TEXT, ["Place order now"], EXPECT, "place order buttons: 0"],
      [`${PAGE_TEXT} Estimated total $30.96`, ["Place Order"], EXPECT, "total"],
      [PAGE_TEXT, ["Place Order"], { ...EXPECT, total: "" }, "total"],
    ];
    for (const [text, buttons, expect_, why] of cases) {
      checkout(text, buttons);
      expect(await place(expect_)).toMatchObject({ pressed: false, why });
    }
    checkout(PAGE_TEXT, ["Place Order"], "/erums/cart");
    expect((await place()).pressed).toBe(false);
    checkout(PAGE_TEXT, [], "/erums/checkout");
    document.body.innerHTML += `<button disabled>Place Order</button>`;
    Object.defineProperty(document.querySelector("button")!, "offsetWidth", { value: 80 });
    expect(await place()).toMatchObject({ pressed: false, why: "place order turned off" });
    expect(pressedLabels).toEqual([]);
  });
});

describe("waiting for Place Order to turn on (Nov 16)", () => {
  it("answers as soon as the one Place Order turns on", async () => {
    window.history.replaceState(null, "", "/erums/checkout");
    document.body.innerHTML = `<button disabled>Place Order</button>`;
    const b = document.querySelector("button")!; Object.defineProperty(b, "offsetWidth", { value: 80 });
    setTimeout(() => { b.disabled = false; }, 30);
    expect(await safewayPage("waitFor", { until: "placeOn", ms: 2000 }, PAGE)).toEqual({ ok: true });
    b.disabled = true;
    expect(await safewayPage("waitFor", { until: "placeOn", ms: 100 }, PAGE)).toEqual({ ok: false });
  });
});
