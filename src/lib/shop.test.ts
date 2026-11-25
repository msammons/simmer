import { describe, expect, it } from "vitest";
import { addedFor, askOf, notTaken, shownAmount, cartTotal, findItems, nextAfter, priceOf, rankResults } from "./shop";
import type { Item } from "./groceries";
import type { CartLine } from "./safeway";

const item = (id: string, name: string, extra: Partial<Item> = {}): Item => ({ id, item: name, quantity: "", store: "safeway", section: "fresh", for: "", addedBy: "", addedAt: "", checked: false, check: false, ...extra });
const line = (productId: string, itemId: string, qty: number, price = "$1.00"): CartLine => ({ cart: "safeway", productId, name: productId, price, image: "", qty, itemId, item: "", updated: "" });

describe("Find", () => {
  const items = [item("a", "milk", { quantity: "2" }), item("b", "pop tarts"), item("c", "salt", { check: true }), item("d", "lemons", { checked: true }), item("e", "dressing", { store: "trader-joes" }), item("f", "eggs")];
  const staples = [{ item: "milk", store: "safeway" as const, section: "fresh" as const, quantity: "1", product: "Lucerne 2% milk half gallon", kind: "common" as const, group: "" }];

  it("goes through the Safeway items still needed, with Simmer's own search", () => {
    const f = findItems(items, staples, [{ item: "Pop Tarts", id: "77", name: "Pop-Tarts Frosted Strawberry" }]);
    expect(f.map((x) => x.item)).toEqual(["milk", "pop tarts", "eggs"]);
    expect(f[0]).toMatchObject({ query: "milk", usual: "Lucerne 2% milk half gallon", want: 2 });
    expect(f[1]).toMatchObject({ query: "pop tarts", picked: { id: "77" } });
  });

  it("puts a product in the cart for the item showing only when it's plausibly that item", () => {
    const [, pop] = findItems(items, staples, [{ item: "Pop Tarts", id: "77", name: "Pop-Tarts Frosted Strawberry" }]);
    const eggs = { id: "9", name: "O Organics Organic Eggs Large Brown - 18 Count", price: "", image: "" };
    const tarts = { id: "8", name: "Pop-Tarts Toaster Pastries Frosted", price: "", image: "" };
    expect(addedFor(tarts, pop, "toaster pastries")?.id).toBe("b");
    expect(addedFor(eggs, pop, "pop tarts")?.id).toBe("b"); // its own search: whatever it found
    expect(addedFor(eggs, pop, "eggs")).toBeNull(); // something else typed in its search box
    expect(addedFor({ ...eggs, id: "77" }, pop, "eggs")?.id).toBe("b"); // its remembered product
  });

  it("goes Next to the next item still to find, then back to one skipped, then the cart", () => {
    const f = findItems(items, staples, []); // milk, pop tarts, eggs
    expect(nextAfter(f, [line("1", "a", 1)], 0)).toBe(1);
    expect(nextAfter(f, [line("1", "a", 1), line("2", "b", 1)], 0)).toBe(2);
    expect(nextAfter(f, [line("3", "f", 1)], 2)).toBe(0); // the last one: back to the first still to find
    expect(nextAfter(f, f.map((x, i) => line(String(i), x.id, 1)), 1)).toBe(-1);
  });

  it("shows the usual first, then the closest matches", () => {
    const products = [{ id: "1", name: "Oatly Oat Milk", price: "", image: "" }, { id: "2", name: "Lucerne Milk 2% 1/2 Gallon", price: "", image: "" }, { id: "3", name: "Lucerne Milk 2% 1 Gallon", price: "", image: "" }];
    expect(rankResults(products, { picked: { id: "3" }, item: "milk" }).map((r) => [r.product.id, r.usual])).toEqual([["3", true], ["1", false], ["2", false]]);
    // No remembered product: a clear match with the house's usual one is marked.
    expect(rankResults(products, { usual: "Lucerne 2% milk 1/2 gallon", item: "milk" })[0]).toMatchObject({ product: { id: "2" }, usual: true });
    // Nothing clear: none marked.
    expect(rankResults(products, { item: "milk" }).some((r) => r.usual)).toBe(false);
  });
});

describe("the cart", () => {
  it("adds up, and says when it's only an estimate", () => {
    expect(priceOf("$0.29 each")).toBe(0.29);
    expect(priceOf("about")).toBeNull();
    expect(cartTotal([line("1", "a", 2, "$3.49"), line("2", "b", 1, "$1.00")])).toEqual({ total: 7.98, estimate: false });
    expect(cartTotal([line("1", "a", 1, "$4.99 /lb")]).estimate).toBe(true);
  });

});

describe("amounts on rows (Nov 14: always shown)", () => {
  it("shows the recipe's amount whatever it is, tidied", () => {
    expect(shownAmount("1 1/2 lb")).toBe("1½ lb");
    expect(shownAmount("1/2 lb (Tacos)")).toBe("½ lb");
    expect(shownAmount("2 tbsp")).toBe("2 tbsp");
    expect(shownAmount("15 ounce")).toBe("15 ounce");
    expect(shownAmount("2")).toBe("2");
    expect(shownAmount("")).toBe("");
  });
});

describe("ranking by her own words (Nov 18)", () => {
  it("ranks by what she typed when it differs from the list item", () => {
    const ps = [{ id: "1", name: "Kraft Grated Parmesan Cheese - 8 Oz" }, { id: "2", name: "BelGioioso Fresh Parmesan Wedge - 8 Oz" }] as never[];
    expect(rankResults(ps, { item: "grated parmesan", query: "Fresh parmesan wedge" })[0].product).toMatchObject({ id: "2" });
    expect(rankResults(ps, { item: "grated parmesan", query: "grated parmesan" })[0].product).toMatchObject({ id: "1" });
  });
});

// Sam, Nov 24 night: adding and taking out bread over and over.
describe("Cart changes on their way", () => {
  const p = { id: "960147370", name: "Whole wheat bread", price: "", image: "" };
  it("sends taps made while a change is on its way as one, still for the list item and on the cart page", () => {
    // − on the row's cart line (no list item, the cart page), then + on the same row (its list item, a search).
    const minus = { p, qty: 0, query: "bread: whole wheat", forItem: null, how: { alt: p.name, on: "cart" as const } };
    const plus = { p, qty: 1, query: "bread: whole wheat", forItem: { id: "row", item: "bread: whole wheat" } };
    expect(askOf(minus, plus)).toEqual({ p, qty: 1, query: "bread: whole wheat", forItem: plus.forItem, how: { alt: p.name, on: "cart" } });
    // The other way round: the list item from the first tap stays.
    expect(askOf(plus, minus)).toMatchObject({ qty: 0, forItem: plus.forItem, how: { on: "cart" } });
    expect(askOf(undefined, plus)).toBe(plus);
  });
  it("says a take-out Safeway didn't take in its own words", () => {
    expect(notTaken({ qty: 1, reached: false }, 0)).toBe("Safeway still has it in the cart: taking it out didn't go through. Try again.");
    expect(notTaken({ qty: 1, reached: false, why: "said", said: "Try later" }, 0)).toContain("It said: “Try later”");
    expect(notTaken({ qty: 1, reached: false }, 2)).toBe("Safeway didn't take all of that. The cart shows what's there now.");
  });
});
