import { describe, expect, it } from "vitest";
import { bothOf, FRACTIONS, isSpice, listName, norm, parseEntry, UNIT_NAMES } from "./words";
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
    expect(item("1 (14-ounce) can diced tomatoes")).toEqual(["diced tomatoes"]);
    expect(item("1 box chopped spinach")).toEqual(["chopped spinach"]);
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

describe("text parsing fixes (Nov 19)", () => {
  it("takes the second choice without its amount and unit", () => {
    expect(parseIngredient("1/4 cup tahini or 2 tbsp peanut butter").item).toBe("peanut butter");
    expect(parseIngredient("tahini or 2 cans chickpeas").item).toBe("chickpeas");
  });
  it("gives a thing and its plural one name, and drops accents", () => {
    for (const [a, b] of [["cookies", "cookie"], ["brownies", "brownie"], ["smoothies", "smoothie"], ["veggies", "veggie"], ["berries", "berry"],
      ["tomatoes", "tomato"], ["peaches", "peach"], ["lemons", "lemon"], ["pies", "pie"], ["cheeses", "cheese"], ["Jalapeños", "jalapeno"]])
      expect(norm(a), a).toBe(norm(b));
    expect(norm("jalapeño")).toBe("jalapeno");
    expect(norm("crème fraîche")).toBe("creme fraiche");
    expect(norm("Trader Joe's")).toBe(norm("trader joes"));
  });
  it("files broth, soup, canned things and bottled juice with the pantry, whatever's in them", () => {
    for (const s of ["chicken broth", "chicken stock", "tomato soup", "cream of mushroom soup", "canned tomatoes", "lemon juice", "curry paste", "cocoa powder", "dried cranberries"])
      expect(known(s)?.section, s).toBe("pantry");
    expect(known("frozen chicken")?.section).toBe("freezer");
    expect(known("orange juice")?.section).toBe("fresh");
    expect(known("chicken thighs")?.section).toBe("fresh");
    expect(known("constructor")).toBeNull();
    expect(known("toString")).toBeNull();
  });
  it("splits a line only when both halves are plain things, and never a dish", () => {
    expect(bothOf("macaroni and cheese")).toEqual(["macaroni and cheese"]);
    expect(bothOf("salt and vinegar chips")).toEqual(["salt and vinegar chips"]);
    expect(bothOf("bread and butter pickles")).toEqual(["bread and butter pickles"]);
    expect(bothOf("salt and pepper")).toEqual(["salt", "pepper"]);
    expect(bothOf("lemons and limes")).toEqual(["lemons", "limes"]);
    expect(bothOf("kosher salt and black pepper")).toEqual(["kosher salt", "black pepper"]);
  });
  it("reads ranges with a dash and every fraction glyph", () => {
    expect(parseIngredient("2–3 cloves garlic")).toMatchObject({ quantity: "2–3", unit: "cloves", item: "garlic" });
    expect(parseIngredient("2—3 cups flour")).toMatchObject({ quantity: "2—3", unit: "cups", item: "flour" });
    expect(parseIngredient("⅜ cup sugar")).toMatchObject({ quantity: "3/8", unit: "cup", item: "sugar" });
    expect(parseIngredient("1⅝ cups milk")).toMatchObject({ quantity: "1 5/8", unit: "cups", item: "milk" });
    for (const g of ["⅞", "⅕", "⅙"]) expect(parseIngredient(`${g} tsp salt`).quantity, g).toBe(FRACTIONS[g]);
  });
  it("reads every unit on a typed item", () => {
    expect(parseEntry("2 cans black beans")).toEqual({ quantity: "2 cans", item: "black beans" });
    expect(parseEntry("1 bag spinach")).toEqual({ quantity: "1 bag", item: "spinach" });
    expect(parseEntry("3 heads lettuce")).toEqual({ quantity: "3 heads", item: "lettuce" });
    expect(parseEntry("½ gallon milk")).toEqual({ quantity: "1/2 gallon", item: "milk" });
    expect(parseEntry("2 tomatoes")).toEqual({ quantity: "2", item: "tomatoes" });
    expect(parseEntry("2 t-shirts")).toEqual({ quantity: "2", item: "t-shirts" });
    expect(UNIT_NAMES.cans).toBe("can");
  });
});
