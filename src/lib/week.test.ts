import { describe, expect, it } from "vitest";
import { fromDraft, type Draft, type Recipe } from "./recipes";
import { firstCounts, isOld, kindOf, onTheList, plainName, lunchShopping, type LunchOption } from "./week";

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

describe("old meals, kept and dimmed (Nov 24)", () => {
  const today = "2026-11-24";
  it("dims a meal once it's shopped for, whatever its day, and every meal whose day has passed", () => {
    expect(isOld({ made: "2026-11-20", day: "2026-11-28" }, today)).toBe(true);
    expect(isOld({ made: "2026-10-01" }, today)).toBe(true);
    expect(isOld({ day: "2026-11-23" }, today)).toBe(true);
    expect(isOld({ day: today }, today)).toBe(false);
    expect(isOld({ day: "2026-11-30" }, today)).toBe(false);
    expect(isOld({ day: "" }, today)).toBe(false);
  });
  it("keeps a meal's things on the list till it's shopped for or its day passes; one put on a passed day keeps them", () => {
    expect(onTheList({ day: today, added: "2026-11-20" }, today)).toBe(true);
    expect(onTheList({ day: "2026-11-23", added: "2026-11-20" }, today)).toBe(false);
    expect(onTheList({ day: "2026-11-23", added: "2026-11-23" }, today)).toBe(false);
    expect(onTheList({ day: "2026-11-20", added: today }, today)).toBe(true);
    expect(onTheList({ day: "2026-11-20", added: today, made: today }, today)).toBe(false);
    expect(onTheList({ day: "", added: "2026-11-01" }, today)).toBe(true);
  });
});

describe("a deleted recipe's name on an old meal (Nov 24)", () => {
  it("reads its name from the id; free text stays as typed", () => {
    expect(plainName("pumpkin-pie-recipe-pq0c5d")).toBe("Pumpkin pie recipe");
    expect(plainName("turkey-chili-1")).toBe("Turkey chili");
    expect(plainName("sheet-pan-gnocchi-3f9a0c1b2d4e5f6a7b")).toBe("Sheet pan gnocchi");
    expect(plainName("Dinner with G&G")).toBe("Dinner with G&G");
    expect(plainName("tacos")).toBe("tacos");
  });
});
