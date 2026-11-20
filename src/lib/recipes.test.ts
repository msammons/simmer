import { describe, expect, it, vi } from "vitest";
// Names resolve without the network: "intranet.example" is a private address, everything else public.
vi.mock("node:dns/promises", () => {
  const lookup = async (host: string) => [{ address: host === "intranet.example" ? "10.0.0.5" : "93.184.216.34", family: 4 }];
  return { lookup, default: { lookup } };
});
import { checkAgainst, deleteRecipe, guessIdeas, fromDraft, isoMinutes, loadRecipes, looksLikeIdeas, opener, parseIngredient, privateAddress, publicOnly, readLink, readRecipeFile, recipeInPage, saveRecipe, searchRecipes } from "./recipes";

describe("the recipe collection", () => {
  it("reads ingredient lines", () => {
    expect(parseIngredient("1 lb ground turkey")).toMatchObject({ quantity: "1", unit: "lb", item: "ground turkey", section: "fresh" });
    expect(parseIngredient("1/2 cup onion, diced")).toMatchObject({ quantity: "1/2", unit: "cup", item: "onion" });
    expect(parseIngredient("1 ½ cups rice")).toMatchObject({ quantity: "1 1/2", unit: "cups", item: "rice", section: "pantry" });
    expect(parseIngredient("15 ounce can canned pumpkin")).toMatchObject({ quantity: "15", unit: "ounce", item: "canned pumpkin" });
    expect(parseIngredient("1 (15 ounce) can canned pumpkin")).toMatchObject({ unit: "can", item: "canned pumpkin" });
    expect(parseIngredient("2 (15 oz) cans black beans")).toMatchObject({ quantity: "2", unit: "cans", item: "black beans", section: "pantry" });
    expect(parseIngredient("Salt to taste")).toMatchObject({ quantity: "", item: "salt" });
    expect(parseIngredient("1 packet taco seasoning")).toMatchObject({ quantity: "1", unit: "packet", item: "taco seasoning", section: "pantry" });
    expect(parseIngredient("a pinch of cumin")).toMatchObject({ quantity: "1", unit: "pinch", item: "cumin" });
  });

  it("searches by name, ingredient, tag, effort, store and who it's for", async () => {
    const all = await loadRecipes();
    expect(searchRecipes(all, "tacos")[0].name).toBe("Tacos");
    expect(searchRecipes(all, "something with salmon").map((r) => r.name)).toEqual(["Salmon and broccoli"]);
    expect(searchRecipes(all, "black beans").map((r) => r.name)).toEqual(["Turkey chili"]);
    expect(searchRecipes(all, "quick").every((r) => r.effort === "quick")).toBe(true);
    expect(searchRecipes(all, "soup").map((r) => r.name)).toEqual(["Turkey chili"]);
    expect(searchRecipes(all, "quick soup")).toEqual([]);
    expect(searchRecipes(all, "kids").map((r) => r.name)).toContain("Mac and cheese");
  });

  it("saves new recipes and edits in place", async () => {
    const r = fromDraft({ name: " Lemon pasta ", effort: "quick", minutes: 20, serves: 4, protein: "", ingredients: ["1 lb spaghetti", "2 lemons"], steps: ["Boil.", "Toss."], store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: ["Pasta"], source: "Typed in", rating: null, notes: "" });
    expect(r.name).toBe("Lemon pasta");
    await saveRecipe(r);
    await saveRecipe({ ...r, effort: "regular" });
    const all = await loadRecipes();
    expect(all.filter((x) => x.name === "Lemon pasta")).toHaveLength(1);
    expect(all.find((x) => x.id === r.id)?.effort).toBe("regular");
    expect(() => fromDraft({ ...r, ingredients: [], name: "  " })).toThrow();
  });

  it("reads a recipe page's own recipe data", () => {
    const html = `<html><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, {
      "@type": ["Recipe"], name: "Sheet-Pan Chicken &amp; Potatoes", totalTime: "PT40M", recipeYield: ["4", "4 servings"],
      recipeIngredient: ["1 1/2 lb chicken thighs", "1 lb baby potatoes"], recipeCategory: "Dinner", keywords: "sheet pan, easy",
      recipeInstructions: [{ "@type": "HowToSection", itemListElement: [{ "@type": "HowToStep", text: "Heat oven to 425." }, { "@type": "HowToStep", text: "Roast 35 minutes." }] }],
    }] })}</script></html>`;
    const d = recipeInPage(html, "https://example.com/chicken")!;
    expect(d).toMatchObject({ name: "Sheet-Pan Chicken & Potatoes", minutes: 40, serves: 4, effort: "regular", steps: ["Heat oven to 425.", "Roast 35 minutes."], source: "https://example.com/chicken" });
    expect(d.ingredients).toHaveLength(2);
    expect(d.tags).toContain("sheet pan");
    expect(recipeInPage("<html>no recipe here</html>", "x")).toBeNull();
    expect(isoMinutes("PT1H30M")).toBe(90);
    expect(isoMinutes("")).toBeNull();
  });

  it("tells a list of meal ideas from a recipe", () => {
    expect(looksLikeIdeas("Tacos\nSalmon and broccoli\n- Chicken soup\nPizza night")).toEqual(["Tacos", "Salmon and broccoli", "Chicken soup", "Pizza night"]);
    expect(looksLikeIdeas("Pancakes\n2 cups flour\n1 egg\nMix and cook")).toBeNull();
    expect(looksLikeIdeas("Chicken stir fry")).toEqual(["Chicken stir fry"]);
    expect(looksLikeIdeas("Chicken stir fry\nBreakfast burritos")).toEqual(["Chicken stir fry", "Breakfast burritos"]);
    expect(looksLikeIdeas("Mix the flour and eggs, then bake for 20 minutes")).toBeNull();
  });

  it("never keeps an amount or time the text didn't have", () => {
    const d = checkAgainst("Grandma's soup: 2 carrots, an onion, cook until soft", { name: "Grandma's soup", minutes: 45, serves: 6, ingredients: ["2 carrots", "1 onion", ""], steps: ["Cook until soft."], effort: "regular" }, "Typed in");
    expect(d.minutes).toBeNull();
    expect(d.serves).toBeNull();
    expect(d.ingredients).toEqual(["2 carrots", "onion"]);
  });
});

describe("typed meal ideas", () => {
  it("get an ingredient list each, and are kept without one when the writer fails", async () => {
    const gemini = await import("./gemini");
    const spy = vi.spyOn(gemini, "generateJson").mockImplementation((async (prompt: string) => {
      if (prompt.includes("ingredient list")) return { data: { ideas: [{ name: "Tacos", ingredients: ["1 lb ground beef", "8 tortillas", ""] }, { name: "Pizza night", ingredients: ["1 pizza dough"] }] }, model: "m", sources: [] };
      return { data: { ideas: [{ name: "Tacos", effort: "quick" }, { name: "Pizza night", effort: "regular" }] }, model: "m", sources: [] };
    }) as never);
    const made = await guessIdeas(["Tacos", "Pizza night"], "Typed in");
    expect(made.map((d) => d.ingredients)).toEqual([["1 lb ground beef", "8 tortillas"], ["1 pizza dough"]]);
    expect(made[0].effort).toBe("quick");
    spy.mockRejectedValue(new Error("no key"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const bare = await guessIdeas(["Tacos", "Pizza night"], "Typed in");
    expect(bare.map((d) => [d.name, d.ingredients])).toEqual([["Tacos", []], ["Pizza night", []]]);
    err.mockRestore(); spy.mockRestore();
  });
});

describe("deleting a recipe (Nov 14)", () => {
  it("takes it out of the collection, once", async () => {
    const r = await saveRecipe(fromDraft({ name: "delete-test soup", effort: "quick", minutes: null, serves: null, protein: "", ingredients: [], steps: [], store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [], source: "", rating: null, notes: "" }));
    expect((await loadRecipes()).some((x) => x.id === r.id)).toBe(true);
    expect(await deleteRecipe(r.id)).toBe(true);
    expect((await loadRecipes()).some((x) => x.id === r.id)).toBe(false);
    expect(await deleteRecipe(r.id)).toBe(false);
  });
});

describe("an ingredient's section, as she set it (Nov 16)", () => {
  it("shows in every recipe with it once moved", async () => {
    const { fileSection } = await import("./groceries");
    const r = await saveRecipe(fromDraft({ name: "section-test salad", effort: "quick", minutes: null, serves: null, protein: "", ingredients: ["1 cup cashews", "1 head lettuce"], steps: [], store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [], source: "", rating: null, notes: "" }));
    await fileSection("cashews", "pantry");
    const after = (await loadRecipes()).find((x) => x.id === r.id)!;
    expect(after.ingredients.find((i) => i.item === "cashews")?.section).toBe("pantry");
    await fileSection("cashews", "fresh");
    expect((await loadRecipes()).find((x) => x.id === r.id)!.ingredients.find((i) => i.item === "cashews")?.section).toBe("fresh");
  });
});

describe("review fixes (Nov 19)", () => {
  it("keeps decimals and puts each listed step on its own line", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Fish &amp;lt;3 &#x27;n chips", recipeIngredient: ["1.5 lb cod"],
      recipeInstructions: "<ol><li>Heat the oven.</li><li>Add 1.5 cups stock.</li></ol>" })}</script>`;
    const d = recipeInPage(html, "https://example.com/fish")!;
    expect(d.name).toBe("Fish &lt;3 'n chips");
    expect(d.steps).toEqual(["Heat the oven.", "Add 1.5 cups stock."]);
    expect(looksLikeIdeas("1.5 lb chicken")).toBeNull();
  });

  it("drops only invented amounts, and only the unit with them", () => {
    const d = checkAgainst("½ cup milk, chicken breasts, 2 carrots", { name: "x", ingredients: ["1/2 cup milk", "3 chicken breasts", "1/4 cup butter", "2 carrots", "1½ cups flour"], steps: [], effort: "regular" }, "Typed in");
    expect(d.ingredients).toEqual(["1/2 cup milk", "chicken breasts", "butter", "2 carrots", "flour"]);
  });

  it("reads a .jpg picture", async () => {
    const gemini = await import("./gemini");
    const spy = vi.spyOn(gemini, "generateJson").mockResolvedValue({ data: { recipes: [] }, model: "m", sources: [] } as never);
    await readRecipeFile({ name: "card.jpg", mimeType: "image/jpg", data: "AAAA" });
    expect((spy.mock.calls[0][2] as { files: { mimeType: string }[] }).files[0].mimeType).toBe("image/jpeg");
    spy.mockRestore();
  });

  it("is quick on a page with unclosed tags", () => {
    const t = Date.now();
    recipeInPage(`<script type="application/ld+json">${"<script ".repeat(40_000)}${"<".repeat(200_000)}`, "x");
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe("opening a link (review, Nov 19)", () => {
  it("follows redirects itself and stops at one to the server's own network", async () => {
    const f = vi.spyOn(opener, "open").mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    await expect(readLink("https://example.com/r")).rejects.toThrow("doesn't look like a link");
    expect(f).toHaveBeenCalledTimes(1);
    f.mockRestore();
  });
  it("won't open a name that leads to a private address", async () => {
    const f = vi.spyOn(opener, "open");
    await expect(readLink("https://intranet.example/x")).rejects.toThrow("doesn't look like a link");
    expect(f).not.toHaveBeenCalled();
    f.mockRestore();
  });
  it("reads a page past a redirect, without its scripts and styles", async () => {
    const page = `<html><style>.a{}</style><script>var x</script><p>Soup: 2 cups carrots</p><script>unclosed ${"<script ".repeat(20_000)}`;
    const f = vi.spyOn(opener, "open")
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/soup" } }))
      .mockResolvedValueOnce(new Response(page, { status: 200 }));
    const gemini = await import("./gemini");
    const spy = vi.spyOn(gemini, "generateJson").mockResolvedValue({ data: { recipes: [{ name: "Soup", ingredients: ["2 cups carrots"], steps: [], effort: "quick" }] }, model: "m", sources: [] } as never);
    const t = Date.now();
    const got = await readLink("https://example.com/r");
    expect(Date.now() - t).toBeLessThan(1000);
    expect(String(f.mock.calls[1][0])).toBe("https://example.com/soup");
    expect(got[0].ingredients).toEqual(["2 cups carrots"]);
    const prompt = String(spy.mock.calls[0][0]);
    expect(prompt).toContain("Soup: 2 cups carrots");
    expect(prompt).not.toContain("var x");
    f.mockRestore(); spy.mockRestore();
  });
  it("connects only to an address checked as the connection is made (review, Nov 19)", async () => {
    const ask = (host: string, all: boolean) => new Promise<unknown>((ok, bad) => publicOnly(host, { all } as never, ((e: Error | null, a: unknown) => (e ? bad(e) : ok(a))) as never));
    await expect(ask("intranet.example", false)).rejects.toThrow("doesn't look like a link");
    await expect(ask("intranet.example", true)).rejects.toThrow("doesn't look like a link");
    await expect(ask("example.com", false)).resolves.toBe("93.184.216.34");
    await expect(ask("example.com", true)).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
  it("knows the private addresses, IPv6 forms that carry an IPv4 one included", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "::127.0.0.1", "::a00:1",
      "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1", "64:ff9b:1::1", "2002:7f00:1::", "2002:a00:1::1", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "2001::1", "2001:db8::1", "100::1", "nonsense"]) {
      expect([ip, privateAddress(ip)]).toEqual([ip, true]);
    }
    for (const ip of ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:93.184.216.34", "64:ff9b::5db8:d822", "2002:5db8:d822::1"]) {
      expect([ip, privateAddress(ip)]).toEqual([ip, false]);
    }
  });
});
