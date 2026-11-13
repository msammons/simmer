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
});
