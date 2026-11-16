import { describe, expect, it } from "vitest";
import { fromDraft, type Draft, type Recipe } from "./recipes";
import { firstCounts, kindOf, lunchShopping, type LunchOption } from "./week";

const base: Draft = { name: "", effort: "quick", minutes: null, serves: null, protein: "", ingredients: [], steps: [], store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [], source: "", rating: null, notes: "" };
const r = (id: string, p: Partial<Draft>): Recipe => fromDraft({ ...base, name: id, id, ...p });
const recipes = [
  r("tacos", { effort: "quick", protein: "ground beef", kidOk: "yes", tags: ["tacos"], rating: 3 }),
  r("salmon", { effort: "quick", protein: "salmon", for: "adults" }),
  r("quesadillas", { effort: "quick", protein: "chicken", kidOk: "yes" }),
  r("beef bowls", { effort: "quick", protein: "ground beef", kidOk: "yes" }),
  r("chili", { effort: "regular", protein: "ground turkey", season: ["fall", "winter"], kidOk: "yes", rating: 3 }),
  r("gazpacho", { effort: "regular", season: ["summer"] }),
  r("mushroom risotto", { effort: "regular", ingredients: ["1 lb mushrooms", "2 cups rice"] }),
  r("roast chicken", { effort: "regular", protein: "chicken", kidOk: "yes" }),
  r("spicy noodles", { effort: "regular", tags: ["spicy"], kidOk: "some" }),
  r("tj meatballs", { effort: "quick", store: "trader-joes", kidOk: "yes" }),
  r("mac and cheese", { for: "kids" }),
  r("nuggets", { for: "kids" }),
  r("old soup", { effort: "regular", active: false }),
  r("pumpkin pie", { effort: "regular", tags: ["pumpkin", "Dessert"], rating: 3 }),
  r("slaw", { tags: ["side dish"] }),
  r("pancakes", { tags: ["breakfast"], kidOk: "yes" }),
  r("trail mix", { tags: ["snack"] }),
];
describe("what a recipe is planned as", () => {
  it("is a dessert, side or breakfast by its tags, a kids' dinner by who it's for, else by its effort", () => {
    expect(kindOf(r("pie", { tags: ["pumpkin", "pie", "Dessert", "thanksgiving"] }))).toBe("dessert");
    expect(kindOf(r("pot pie", { effort: "regular", tags: ["chicken", "pie"] }))).toBe("regular");
    expect(kindOf(recipes.find((x) => x.id === "pumpkin pie")!)).toBe("dessert");
    expect(kindOf(recipes.find((x) => x.id === "slaw")!)).toBe("side");
    expect(kindOf(recipes.find((x) => x.id === "pancakes")!)).toBe("breakfast");
    expect(kindOf(recipes.find((x) => x.id === "nuggets")!)).toBe("kids");
    expect(kindOf(recipes.find((x) => x.id === "chili")!)).toBe("regular");
    expect(kindOf(recipes.find((x) => x.id === "trail mix")!)).toBe(null); // snacks live in Stock, never planned
  });
});

describe("the usual counts, the first time", () => {
  it("is 2 quick, 3 regular, and the boys' own dinner when they have one", () => {
    expect(firstCounts(["Theo", "Leo"], true)).toEqual({ quick: 2, regular: 3, kids: 1, dessert: 0, side: 0, breakfast: 0, lunchmeal: 0, lunches: { Theo: 5, Leo: 5 } });
  });
});

describe("the boys' lunches", () => {
  const options: LunchOption[] = [
    { kid: "Theo", part: "main", item: "Bean and cheese burrito", ingredients: ["tortillas", "refried beans", "shredded cheese"] },
    ...["Grapes", "Raspberries", "Strawberries"].map((item) => ({ kid: "Theo", part: "fruit" as const, item, ingredients: [] })),
    { kid: "Theo", part: "side", item: "Goldfish", ingredients: [] },
    { kid: "Theo", part: "snack", item: "Cheese and crackers", ingredients: ["cheese sticks", "crackers"] },
    { kid: "Leo", part: "main", item: "Hummus roll-up", ingredients: ["tortillas", "hummus"] },
    { kid: "Leo", part: "fruit", item: "Strawberries", ingredients: [] },
  ];

  it("lists what the lunches need, once each", () => {
    const lunch = (kid: string, main: string, fruit: string, side = "", snack = "") => ({ kid, main, fruit, side, treat: "", snack });
    const need = lunchShopping([lunch("Theo", "Bean and cheese burrito", "Grapes", "Goldfish", "Cheese and crackers"), lunch("Theo", "Bean and cheese burrito", "Raspberries"), lunch("Leo", "Hummus roll-up", "Strawberries")], options);
    expect(need.filter((x) => x === "tortillas")).toHaveLength(1);
    expect(need).toEqual(expect.arrayContaining(["refried beans", "hummus", "Strawberries", "crackers"]));
  });
});
