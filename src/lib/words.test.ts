import { describe, expect, it } from "vitest";
import { bothOf, isSpice, listName } from "./words";
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

describe("lines typed the way people write cards (Nov 18)", () => {
  const p = (s: string) => { const i = parseIngredient(s); return [i.quantity, i.unit, i.item, i.section]; };
  it("reads a unit stuck to the number, and T as a tablespoon, t as a teaspoon", () => {
    expect(p("2c Shredded cheese")).toEqual(["2", "cup", "shredded cheese", "fresh"]);
    expect(p("4 T vegetable oil (try 3T next time)")).toEqual(["4", "tbsp", "vegetable oil", "pantry"]);
    expect(p("1/2 t salt")).toEqual(["1/2", "tsp", "salt", "pantry"]);
  });
  it("drops Optional: and a little, and files flour, cornmeal and a misspelt turmeric with the pantry", () => {
    expect(p("Optional: add dressing of choice")).toEqual(["", "", "dressing", "pantry"]);
    expect(p("a little ginger (fresh or ground is optional, but yummy!)")).toEqual(["", "", "ginger", "fresh"]);
    expect(p("1 cup bread flour")[3]).toBe("pantry");
    expect(p("1 cup yellow cornmeal")[3]).toBe("pantry");
    expect(p("1/2 T tumeric")[3]).toBe("pantry");
    expect(p("2 eggs")).toEqual(["2", "", "eggs", "fresh"]);
  });
});

describe("what goes on the list (Nov 18)", () => {
  const item = (s: string) => bothOf(parseIngredient(s).item);
  it("leaves off sizes and cuts, so a large onion and an onion are one thing", () => {
    expect(item("1 large Sweet potato")).toEqual(["sweet potato"]);
    expect(item("1 chopped onion")).toEqual(["onion"]);
    expect(item("1 large onion, diced")).toEqual(["onion"]);
    expect(item("8 skinless, boneless chicken thighs")).toEqual(["chicken thighs"]);
    expect(item("2 cups whole milk")).toEqual(["whole milk"]);
  });
  it("takes one choice of two, and puts two things on two lines", () => {
    expect(item("1 teaspoon red wine vinegar or balsamic vinegar")).toEqual(["red wine vinegar"]);
    expect(item("2 teaspoons chopped fresh rosemary or 1 teaspoon dried rosemary")).toEqual(["fresh rosemary"]);
    expect(item("1 (8- to 9-ounce) package refrigerated or frozen cheese tortellini")).toEqual(["frozen cheese tortellini"]);
    expect(item("Rice or quinoa")).toEqual(["rice"]);
    expect(item("Kosher salt (such as Diamond Crystal) and black pepper")).toEqual(["kosher salt", "black pepper"]);
    expect(item("1 cup half and half")).toEqual(["half and half"]);
    expect(item("1 box mac and cheese")).toEqual(["mac and cheese"]);
  });
});

describe("one name for one thing (Nov 18)", () => {
  it("merges a spice with and without ground, and names that mean the same", () => {
    expect(listName("ground cumin")).toBe("cumin");
    expect(listName("crushed red pepper")).toBe("red pepper flakes");
    expect(listName("red chili powder")).toBe("chili powder");
    expect(listName("kosher salt")).toBe("salt");
    expect(listName("ground black pepper")).toBe("ground black pepper");
    expect(listName("ground turkey")).toBe("ground turkey");
    expect(listName("garlic cloves")).toBe("garlic");
  });
});
