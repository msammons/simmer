import { describe, expect, it } from "vitest";
import { isSpice } from "./words";
import { known } from "./groceries";
import { parseIngredient } from "./recipes";

describe("spices", () => {
  it("knows spices and dried herbs, by word and whatever the case", () => {
    for (const s of ["salt", "Kosher Salt", "sea salt", "pepper", "black pepper", "freshly ground black pepper", "salt and pepper", "ground cumin", "cumin seeds",
      "smoked paprika", "PAPRIKA", "dried oregano", "oregano", "cinnamon", "ground cinnamon", "cinnamon sticks", "chili powder", "chile powder", "garlic powder",
      "onion powder", "curry powder", "red pepper flakes", "crushed red pepper", "cayenne", "turmeric", "ground ginger", "nutmeg", "bay leaves", "bay leaf",
      "dried thyme", "dried basil", "dried parsley", "dried dill", "Italian seasoning", "taco seasoning", "garam masala", "pumpkin pie spice", "whole cloves", "garlic salt"])
      expect(isSpice(s), s).toBe(true);
  });
  it("leaves fresh things and lookalikes alone", () => {
    for (const s of ["red bell pepper", "bell peppers", "jalapeno pepper", "garlic", "cloves garlic", "fresh thyme", "fresh oregano", "fresh ginger", "ginger", "ground beef",
      "ground turkey", "salted butter", "unsalted butter", "cinnamon rolls", "sea salt chips", "baking powder", "cocoa powder", "basil", "fresh cilantro", "bay scallops", "chicken thighs"])
      expect(isSpice(s), s).toBe(false);
  });
  it("files them with the pantry, so a recipe's spices start unticked under the things to buy", () => {
    expect(known("ground cumin")?.section).toBe("pantry"); // not ground beef
    expect(known("black pepper")?.section).toBe("pantry"); // not a bell pepper
    expect(known("garlic powder")?.section).toBe("pantry"); // not garlic
    expect(known("dried thyme")?.section).toBe("pantry");
    expect(known("red bell pepper")?.section).toBe("fresh");
    expect(parseIngredient("1 tsp ground cumin")).toMatchObject({ item: "ground cumin", section: "pantry" });
    expect(parseIngredient("Salt and pepper to taste")).toMatchObject({ item: "salt and pepper", section: "pantry" });
    expect(parseIngredient("2 cloves garlic, minced")).toMatchObject({ item: "garlic", section: "fresh" });
  });
});
