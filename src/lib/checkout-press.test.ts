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

  it("presses nothing that's turned off", async () => {
    cart(["Checkout"]);
    document.querySelector("button")!.setAttribute("aria-disabled", "true");
    expect((await press()).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });
});
