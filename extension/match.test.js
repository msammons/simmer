import { describe, expect, it } from "vitest";
import { choose, howMany, keyOf, safewayItems, score, searchFor, usualFor, words } from "./match.js";

const milk = { id: "1", name: "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", price: "$3.49" };
const milkGal = { id: "2", name: "Lucerne Milk Reduced Fat 2% - 1 Gallon", price: "$5.29" };
const oat = { id: "3", name: "Oatly Oat Milk - 64 Fl. Oz.", price: "$5.99" };
const bananas = { id: "4", name: "Bananas", price: "$0.29 each" };

describe("words and score", () => {
  it("keeps sizes and percents, drops filler", () => {
    expect(words("Lucerne 2% Milk - 1/2 Gallon, each")).toEqual(["lucerne", "2%", "milk", "1/2", "gallon"]);
  });
  it("scores the share of wanted words found, plurals included", () => {
    expect(score("Bananas", "banana")).toBe(1);
    expect(score("Organic Bananas", "bananas")).toBe(1);
    expect(score("Oatly Oat Milk", "2% milk")).toBe(0.5);
    expect(score("anything", "")).toBe(0);
  });
});

describe("the list", () => {
  const list = { items: [
    { id: "a", item: "milk", store: "safeway", checked: false, check: false },
    { id: "b", item: "salt", store: "safeway", checked: false, check: true },
    { id: "c", item: "eggs", store: "safeway", checked: true, check: false },
    { id: "d", item: "dressing", store: "trader-joes", checked: false, check: false },
  ] };
  it("sends only unchecked Safeway items that are needed", () => {
    expect(safewayItems(list).map((i) => i.id)).toEqual(["a"]);
    expect(safewayItems(null)).toEqual([]);
  });
  it("finds the usual product from the staples", () => {
    const staples = [{ item: "Milk", product: "Lucerne 2% milk, half gallon" }, { item: "eggs", product: "" }];
    expect(usualFor({ item: "milk" }, staples)).toBe("Lucerne 2% milk, half gallon");
    expect(usualFor({ item: "eggs" }, staples)).toBe("");
  });
  it("searches for the remembered product, then the usual one, then the item", () => {
    expect(searchFor({ item: "milk" }, "Lucerne 2%", { id: "1", name: milk.name })).toBe(milk.name);
    expect(searchFor({ item: "milk" }, "Lucerne 2%", null)).toBe("Lucerne 2%");
    expect(searchFor({ item: "milk" }, "", null)).toBe("milk");
  });
  it("remembers picks by the item as written", () => {
    expect(keyOf("  Fresh Bananas ")).toBe("bananas");
  });
});

describe("how many", () => {
  it("adds more than one only for plain counts", () => {
    expect(howMany("3")).toBe(3);
    expect(howMany("couple")).toBe(2);
    expect(howMany("2 lb")).toBe(1);
    expect(howMany("dozen")).toBe(1);
    expect(howMany("")).toBe(1);
    expect(howMany("40")).toBe(12);
  });
});

describe("choosing a product", () => {
  it("says so when nothing came back", () => {
    expect(choose([], { item: "milk" })).toEqual({ none: true });
  });
  it("takes a remembered pick when it's in the results", () => {
    expect(choose([oat, milkGal, milk], { picked: { id: "1" }, item: "milk" })).toEqual({ pick: milk, why: "remembered" });
  });
  it("takes the usual product only on a clear match", () => {
    expect(choose([oat, milk, bananas], { usual: "Lucerne 2% milk 1/2 gallon", item: "milk" })).toEqual({ pick: milk, why: "usual" });
    // The half gallon and the gallon match almost equally: ask.
    expect(choose([milk, milkGal], { usual: "Lucerne 2% milk", item: "milk" }).ask).toHaveLength(2);
  });
  it("asks about the three likeliest otherwise, best match first, Safeway's order breaking ties", () => {
    const r = choose([bananas, oat, milkGal, milk], { item: "2% milk" });
    expect(r.ask.map((p) => p.id)).toEqual(["2", "1", "3"]);
  });
  it("asks even when a remembered pick has gone", () => {
    expect(choose([oat], { picked: { id: "1" }, item: "milk" }).ask).toEqual([oat]);
  });
});
