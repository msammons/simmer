import { describe, expect, it } from "vitest";
import { fromDraft, type Draft, type Recipe } from "./recipes";
import { applyShape, choices, eatingText, emptyNight, lunchShopping, nextOption, planLunches, rank, readEating, suggestWeek, weekDates, weekOf, type Context, type LunchOption } from "./week";

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
];
const ctx: Context = {
  recipes, lastMade: { "roast chicken": "2026-10-28", chili: "2026-03-10" },
  people: [{ name: "Matt", isAdult: true, likes: ["Spicy food"], dislikes: [] }, { name: "Felix", isAdult: false, likes: [], dislikes: ["Mushrooms"] }],
  trips: { traderJoes: false, costco: false },
};
const monday = "2026-11-02";

describe("planning the week", () => {
  it("knows the week and the shapes", () => {
    expect(weekOf("2026-11-04")).toBe(monday);
    expect(weekOf("2026-11-08")).toBe(monday);
    expect(weekOf(monday)).toBe(monday);
    const nights = applyShape(weekDates(monday).map((d) => emptyNight(d)), "2-quick-3-regular");
    expect(nights.map((n) => n.kind)).toEqual(["quick", "regular", "regular", "quick", "regular", "regular", "regular"]);
    expect(readEating(eatingText({ away: ["Matt"], split: true }))).toEqual({ away: ["Matt"], split: true });
    expect(eatingText({ away: [], split: false })).toBe("everyone");
  });

  it("only suggests what fits the night", () => {
    const nights = weekDates(monday).map((d, i) => emptyNight(d, i < 2 ? "quick" : "regular"));
    const quick = rank(nights, 0, ctx).map((o) => o.recipe.id);
    expect(quick.every((id) => recipes.find((x) => x.id === id)!.effort === "quick")).toBe(true);
    expect(quick).not.toContain("tj meatballs"); // no Trader Joe's trip this week
    expect(quick).not.toContain("mac and cheese"); // the boys' own dinners only on split nights
    expect(rank(nights, 0, { ...ctx, trips: { traderJoes: true, costco: false } }).map((o) => o.recipe.id)).toContain("tj meatballs");
    const regular = rank(nights, 2, ctx).map((o) => o.recipe.id);
    expect(regular).not.toContain("roast chicken"); // made 6 days before
    expect(regular).not.toContain("old soup"); // stopped suggesting
    expect(regular[0]).toBe("chili"); // a favorite, in season, not made since March
    expect(rank(nights, 2, ctx)[0].why).toBe("You haven't made this since March");
    expect(regular.indexOf("mushroom risotto")).toBeGreaterThan(regular.indexOf("gazpacho") - 1); // Felix and mushrooms
  });

  it("fills the open nights without repeats, keeping pinned and skipped ones", () => {
    const nights = weekDates(monday).map((d, i) => emptyNight(d, i === 5 ? "skip" : i % 2 ? "regular" : "quick"));
    nights[1] = { ...nights[1], meal: "Dinner with G&G", pinned: true };
    const week = suggestWeek(nights, ctx);
    expect(week[1].meal).toBe("Dinner with G&G");
    expect(week[5].meal).toBe("");
    const meals = week.map((n) => n.meal).filter(Boolean);
    expect(new Set(meals).size).toBe(meals.length);
    expect(suggestWeek(nights, ctx)).toEqual(week); // the same week always gives the same plan
  });

  it("avoids the same protein two nights running", () => {
    const nights = [emptyNight(monday, "quick"), emptyNight("2026-11-03", "quick")];
    nights[0].meal = "tacos";
    expect(rank(nights, 1, ctx)[0].recipe.id).not.toBe("beef bowls");
  });

  it("splits a night into a grown-up dinner and the boys' own", () => {
    const nights = [{ ...emptyNight(monday, "quick"), split: true }];
    const [n] = suggestWeek(nights, ctx);
    expect(["mac and cheese", "nuggets"]).toContain(n.kidsMeal);
    expect(n.meal).toBe("salmon"); // a grown-up dinner on a split night
  });

  it("leaves out what's mostly for whoever is away", () => {
    const nights = [{ ...emptyNight(monday, "regular"), away: ["Matt"] }];
    const away = rank(nights, 0, ctx).map((o) => o.recipe.id);
    const home = rank([emptyNight(monday, "regular")], 0, ctx).map((o) => o.recipe.id);
    expect(away.indexOf("spicy noodles")).toBeGreaterThan(home.indexOf("spicy noodles"));
  });

  it("favors what's in the freezer, the oldest most", () => {
    const nights = [emptyNight(monday, "quick")];
    const withSalmon = { ...ctx, freezer: [{ id: "f1", item: "Chicken", amount: "2", added: "2026-09-01", store: "" }] };
    const top = rank(nights, 0, withSalmon)[0];
    expect(top.recipe.id).toBe("quesadillas");
    expect(top.why).toBe("Uses the chicken in the freezer");
  });

  it("gives three new ideas for Something else", () => {
    const nights = [emptyNight(monday, "regular")];
    const a = choices(nights, 0, ctx, 0).map((o) => o.recipe.id), b = choices(nights, 0, ctx, 1).map((o) => o.recipe.id);
    expect(a).toHaveLength(3);
    expect(b.filter((x) => a.includes(x)).length).toBeLessThan(3);
  });
});

describe("the boys' lunches", () => {
  const options: LunchOption[] = [
    { kid: "Felix", part: "main", item: "Bean and cheese burrito", ingredients: ["tortillas", "refried beans", "shredded cheese"] },
    ...["Grapes", "Raspberries", "Strawberries"].map((item) => ({ kid: "Felix", part: "fruit" as const, item, ingredients: [] })),
    { kid: "Felix", part: "side", item: "Goldfish", ingredients: [] },
    { kid: "Felix", part: "snack", item: "Cheese and crackers", ingredients: ["cheese sticks", "crackers"] },
    { kid: "Nico", part: "main", item: "Hummus roll-up", ingredients: ["tortillas", "hummus"] },
    { kid: "Nico", part: "fruit", item: "Strawberries", ingredients: [] },
  ];
  const kids = [{ name: "Felix", rules: ["School lunch on Thursdays (pizza day)"] }, { name: "Nico", rules: [] }];

  it("plans each school day for each boy, rotating his options", () => {
    const l = planLunches(monday, kids, options, ["2026-11-06"]);
    expect(l).toHaveLength(10);
    const felix = l.filter((x) => x.kid === "Felix");
    expect(new Set(felix.slice(0, 3).map((x) => x.fruit)).size).toBe(3);
    const thu = felix.find((x) => x.date === "2026-11-05")!;
    expect(thu).toMatchObject({ schoolLunch: true, main: "", fruit: "", snack: "Cheese and crackers" });
    expect(felix.find((x) => x.date === "2026-11-06")).toMatchObject({ noSchool: true, main: "", snack: "" });
    expect(nextOption(felix[0], "fruit", options)).not.toBe(felix[0].fruit);
  });

  it("lists what the lunches need, once each", () => {
    const need = lunchShopping(planLunches(monday, kids, options), options);
    expect(need.filter((x) => x === "tortillas")).toHaveLength(1);
    expect(need).toEqual(expect.arrayContaining(["refried beans", "hummus", "Strawberries", "crackers"]));
  });
});
