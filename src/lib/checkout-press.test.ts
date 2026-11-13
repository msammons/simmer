// @vitest-environment jsdom
// The checkout look's one press (Nov 12, Sam: "Checkout only"; docs/CHECKOUT.md): run in a copy of Safeway's cart page.
// Only the cart page's single Checkout button is ever pressed; anything else, nothing is.
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
const press = async () => (await safewayPage("pressCheckout", { cartPath: "/erums/cart" }, PAGE)) as unknown as Press;
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

  it("presses nothing that's turned off", async () => {
    cart(["Checkout"]);
    document.querySelector("button")!.setAttribute("aria-disabled", "true");
    expect((await press()).pressed).toBe(false);
    expect(pressedLabels).toEqual([]);
  });
});
