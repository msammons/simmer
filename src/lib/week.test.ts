import { describe, expect, it } from "vitest";
import { fromDraft, type Draft, type Recipe } from "./recipes";
import { firstCounts, isDinner, kindOf, lunchShopping, nextOption, pickMany, planLunches, rank, somethingElse, type Context, type LunchOption } from "./week";

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
const ctx: Context = {
  recipes, lastMade: { "roast chicken": "2026-10-28", chili: "2026-03-10" },
  people: [{ name: "Sam", isAdult: true, likes: ["Spicy food"], dislikes: [] }, { name: "Theo", isAdult: false, likes: [], dislikes: ["Mushrooms"] }],
  trips: { traderJoes: false, costco: false },
  today: "2026-11-03",
};
const ids = (xs: { recipe: Recipe }[]) => xs.map((o) => o.recipe.id);

describe("what a recipe is planned as", () => {
  it("is a dessert, side or breakfast by its tags, a kids' dinner by who it's for, else by its effort", () => {
    expect(isDinner(r("pie", { tags: ["pumpkin", "pie", "Dessert", "thanksgiving"] }))).toBe(false);
    expect(isDinner(r("pot pie", { tags: ["chicken", "pie"] }))).toBe(true);
    expect(kindOf(recipes.find((x) => x.id === "pumpkin pie")!)).toBe("dessert");
    expect(kindOf(recipes.find((x) => x.id === "slaw")!)).toBe("side");
    expect(kindOf(recipes.find((x) => x.id === "pancakes")!)).toBe("breakfast");
    expect(kindOf(recipes.find((x) => x.id === "nuggets")!)).toBe("kids");
    expect(kindOf(recipes.find((x) => x.id === "chili")!)).toBe("regular");
    expect(kindOf(recipes.find((x) => x.id === "trail mix")!)).toBe(null); // snacks live in Stock, never planned
  });
});

describe("planning by number", () => {
  it("only picks what fits the kind", () => {
    const quick = ids(rank("quick", [], ctx));
    expect(quick.every((id) => recipes.find((x) => x.id === id)!.effort === "quick")).toBe(true);
    expect(quick).not.toContain("tj meatballs"); // no Trader Joe's trip
    expect(quick).not.toContain("mac and cheese"); // the boys' own dinners are their own kind
    expect(ids(rank("quick", [], { ...ctx, trips: { traderJoes: true, costco: false } }))).toContain("tj meatballs");
    const regular = ids(rank("regular", [], ctx));
    expect(regular.at(-1)).toBe("roast chicken"); // made 6 days ago: last, only when nothing else fits
    expect(rank("regular", [], ctx).at(-1)!.why).toBe("Made recently: nothing else fits");
    expect(regular).not.toContain("old soup"); // stopped suggesting
    expect(regular).not.toContain("pumpkin pie"); // a dessert is never a dinner
    expect(regular[0]).toBe("chili"); // a favorite, in season, not made since March
    expect(rank("regular", [], ctx)[0].why).toBe("You haven't made this since March");
    expect(regular.indexOf("mushroom risotto")).toBeGreaterThan(regular.indexOf("gazpacho") - 1); // Theo and mushrooms
    expect(ids(rank("kids", [], ctx)).sort()).toEqual(["mac and cheese", "nuggets"]);
    expect(ids(rank("dessert", [], ctx))).toEqual(["pumpkin pie"]);
    expect(ids(rank("breakfast", [], ctx))).toEqual(["pancakes"]);
  });

  it("picks that many of each, with no repeats and nothing already planned, the same every time", () => {
    const picks = pickMany({ quick: 2, regular: 3, kids: 1, dessert: 1 }, ["tacos"], ctx);
    expect(picks.filter((p) => p.kind === "quick")).toHaveLength(2);
    expect(picks.filter((p) => p.kind === "regular")).toHaveLength(3);
    expect(picks.filter((p) => p.kind === "kids")).toHaveLength(1);
    expect(picks.find((p) => p.kind === "dessert")?.recipe).toBe("pumpkin pie");
    const all = picks.map((p) => p.recipe);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("tacos"); // still to make from last time
    expect(pickMany({ quick: 2, regular: 3, kids: 1, dessert: 1 }, ["tacos"], ctx)).toEqual(picks);
  });

  it("gives fewer when fewer fit", () => {
    expect(pickMany({ side: 3 }, [], ctx).map((p) => p.recipe)).toEqual(["slaw"]);
    expect(pickMany({ quick: 14 }, [], ctx).length).toBe(4); // tacos, salmon, quesadillas, beef bowls
  });

  it("varies the protein", () => {
    expect(rank("quick", ["tacos"], ctx)[0].recipe.id).not.toBe("beef bowls");
    const two = pickMany({ quick: 2 }, [], ctx).map((p) => recipes.find((x) => x.id === p.recipe)!.protein);
    expect(two[0]).not.toBe(two[1]);
  });

  it("Something else is another of the same kind, never one shown already, until nothing else fits", () => {
    const planned = ["chili", "gazpacho"];
    const a = somethingElse("regular", "chili", planned, ctx)!;
    expect(a.recipe.id).not.toBe("chili");
    expect(a.recipe.id).not.toBe("gazpacho"); // planned too
    expect(a.recipe.effort).toBe("regular");
    const seen = ["chili"];
    let at = "chili";
    for (let o = somethingElse("regular", at, planned, ctx, seen); o; o = somethingElse("regular", at, planned, ctx, seen)) { expect(seen).not.toContain(o.recipe.id); seen.push(at = o.recipe.id); }
    expect(somethingElse("regular", at, planned, ctx, seen)).toBeNull(); // the screen says "Nothing else fits"
    expect(somethingElse("dessert", "pumpkin pie", ["pumpkin pie"], ctx)).toBeNull();
  });

  it("favors what's in the freezer, the oldest most", () => {
    const top = rank("quick", [], { ...ctx, freezer: [{ id: "f1", item: "Chicken", amount: "2", added: "2026-09-01", store: "" }] })[0];
    expect(top.recipe.id).toBe("quesadillas");
    expect(top.why).toBe("Uses the chicken in the freezer");
  });

  it("starts from a usual week the first time", () => {
    expect(firstCounts(["Theo", "Leo"], true)).toEqual({ quick: 2, regular: 3, kids: 1, dessert: 0, side: 0, breakfast: 0, lunches: { Theo: 5, Leo: 5 } });
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

  it("plans that many for each boy, rotating his options, carrying on from the ones waiting", () => {
    const l = planLunches([{ name: "Theo", count: 4 }, { name: "Leo", count: 2 }, { name: "Robin", count: 3 }], options);
    expect(l.filter((x) => x.kid === "Theo")).toHaveLength(4);
    expect(l.filter((x) => x.kid === "Leo")).toHaveLength(2);
    expect(l.some((x) => x.kid === "Robin")).toBe(false); // no lunch options
    const theo = l.filter((x) => x.kid === "Theo");
    expect(new Set(theo.slice(0, 3).map((x) => x.fruit)).size).toBe(3);
    expect(theo[0]).toMatchObject({ main: "Bean and cheese burrito", side: "Goldfish", snack: "Cheese and crackers", treat: "" });
    const more = planLunches([{ name: "Theo", count: 1 }], options, { Theo: 1 });
    expect(more[0].fruit).toBe(theo[1].fruit); // the next in turn after the one waiting
    expect(nextOption(theo[0], "fruit", options)).not.toBe(theo[0].fruit);
  });

  it("lists what the lunches need, once each", () => {
    const need = lunchShopping(planLunches([{ name: "Theo", count: 5 }, { name: "Leo", count: 5 }], options), options);
    expect(need.filter((x) => x === "tortillas")).toHaveLength(1);
    expect(need).toEqual(expect.arrayContaining(["refried beans", "hummus", "Strawberries", "crackers"]));
  });
});
