import { beforeEach, describe, expect, it } from "vitest";
import { clearCart, loadCart, loadPicks, resetSafeway, savePick, setCartLine } from "./safeway";

describe("the Safeway picks", () => {
  beforeEach(resetSafeway);

  it("keeps one pick per item, the latest, however the item is written", async () => {
    await savePick({ item: "Lemons", id: "111", name: "Lemons" });
    await savePick({ item: "milk", id: "222", name: "Lucerne Milk 2% - 1/2 Gallon" });
    await savePick({ item: "lemon", id: "333", name: "Organic Lemons" });
    expect(await loadPicks()).toEqual([
      { item: "milk", id: "222", name: "Lucerne Milk 2% - 1/2 Gallon" },
      { item: "lemon", id: "333", name: "Organic Lemons" },
    ]);
  });

  it("keeps the picture, also when a pick without one comes in for the same product", async () => {
    await savePick({ item: "milk", id: "222", name: "Milk", image: "https://images.example/m.jpg" });
    await savePick({ item: "milk", id: "222", name: "Milk" });
    expect((await loadPicks())[0].image).toBe("https://images.example/m.jpg");
    await savePick({ item: "milk", id: "999", name: "Other milk", image: "javascript:alert(1)" });
    expect((await loadPicks())[0].image).toBeUndefined();
  });
});

describe("Simmer's copy of the Safeway cart", () => {
  beforeEach(resetSafeway);

  it("sets, changes and removes, keeping what it's for", async () => {
    await setCartLine({ productId: "1", qty: 1, name: "Eggs", price: "$3", itemId: "e", item: "eggs" });
    await setCartLine({ productId: "1", qty: 3 });
    expect(await loadCart()).toMatchObject([{ productId: "1", qty: 3, name: "Eggs", itemId: "e" }]);
    await setCartLine({ productId: "1", qty: 0 });
    expect(await loadCart()).toEqual([]);
    await setCartLine({ productId: "2", qty: 1, name: "Bread" });
    await clearCart();
    expect(await loadCart()).toEqual([]);
  });
});
