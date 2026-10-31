import { describe, expect, it } from "vitest";
import { addedFor, cartTotal, findItems, firstToFind, inCartLine, nextToFind, priceOf, rankResults } from "./shop";
import type { Item } from "./groceries";
import type { CartLine } from "./safeway";

const item = (id: string, name: string, extra: Partial<Item> = {}): Item => ({ id, item: name, quantity: "", store: "safeway", section: "fresh", for: "", addedBy: "", addedAt: "", checked: false, check: false, ...extra });
const line = (productId: string, itemId: string, qty: number, price = "$1.00"): CartLine => ({ cart: "safeway", productId, name: productId, price, image: "", qty, itemId, item: "", updated: "" });

describe("Find", () => {
  const items = [item("a", "milk", { quantity: "2" }), item("b", "pop tarts"), item("c", "salt", { check: true }), item("d", "lemons", { checked: true }), item("e", "dressing", { store: "trader-joes" }), item("f", "eggs")];
  const staples = [{ item: "milk", store: "safeway" as const, section: "fresh" as const, quantity: "1", product: "Lucerne 2% milk half gallon" }];

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

  it("starts on the first item with nothing in the cart, and moves on to the next", () => {
    const f = findItems(items, staples, []);
    expect(firstToFind(f, [line("1", "a", 2)])).toBe(1);
    expect(nextToFind(f, [line("1", "a", 2), line("2", "b", 1)], 0)).toBe(2);
    expect(nextToFind(f, [line("2", "f", 1)], 1)).toBe(-1);
    expect(firstToFind(f, f.map((x, i) => line(String(i), x.id, 1)))).toBe(0);
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

  it("shows on the list what's in the cart for an item", () => {
    expect(inCartLine([line("1", "a", 2)], { id: "a" })).toBe("In the cart · 2");
    expect(inCartLine([line("1", "a", 2)], { id: "b" })).toBe("");
  });
});
