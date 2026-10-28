import { describe, expect, it } from "vitest";
import { loadPicks, savePick } from "./safeway";

describe("the Safeway picks", () => {
  it("keeps one pick per item, the latest, however the item is written", async () => {
    await savePick({ item: "Lemons", id: "111", name: "Lemons" });
    await savePick({ item: "milk", id: "222", name: "Lucerne Milk 2% - 1/2 Gallon" });
    await savePick({ item: "lemon", id: "333", name: "Organic Lemons" });
    expect(await loadPicks()).toEqual([
      { item: "milk", id: "222", name: "Lucerne Milk 2% - 1/2 Gallon" },
      { item: "lemon", id: "333", name: "Organic Lemons" },
    ]);
  });
});
