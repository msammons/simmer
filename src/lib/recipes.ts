// The recipe collection: one row per recipe in the Recipes tab (docs/PLAN.md, section 3). Reading is forgiving (headers
// in any order, a row without a name skipped); saving writes only that recipe's row. Without the Sheet (local dev, tests)
// the collection lives in memory, seeded from data/recipes.csv.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateJson } from "./google/gemini";
import { appendRows, ensureTab, readTab, sheetsConfigured, updateRange } from "./google/sheets";
import { loadHousehold } from "./data";
import { AppError } from "./errors";
import { known, type Section, type Store } from "./groceries";
import { norm } from "./words";
import { parseCsv, records } from "./parse";

export type Effort = "quick" | "regular";
export type For = "everyone" | "kids" | "adults";
export type Ingredient = { line: string; quantity: string; unit: string; item: string; section: Section };
export type Recipe = {
  id: string; name: string; effort: Effort; minutes: number | null; serves: number | null; protein: string;
  ingredients: Ingredient[]; steps: string[]; store: Store | ""; season: string[]; for: For; kidOk: "yes" | "some" | "no" | "";
  makeAhead: boolean; tags: string[]; source: string; rating: number | null; notes: string; active: boolean; addedAt: string;
};
/** A recipe as it's typed or read in, before it has an id: what the import screens show and the editor sends back. */
export type Draft = Omit<Recipe, "id" | "ingredients" | "addedAt" | "active"> & { id?: string; ingredients: string[]; active?: boolean };

const TAB = "Recipes";
const HEADERS = ["id", "name", "effort", "minutes", "serves", "protein", "ingredients", "steps", "store", "season", "for", "kid_ok", "make_ahead", "tags", "source", "rating", "notes", "active", "added_at"];

const yes = (s: string) => /^(yes|y|true|1|x)$/i.test(s.trim());
const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const words = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
const lines = (s: string) => s.split(/\n/).map((x) => x.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim()).filter(Boolean);
const asEffort = (s: string): Effort => (/quick|fast|easy/i.test(s) ? "quick" : "regular");
const asFor = (s: string): For => (/kid|boy/i.test(s) ? "kids" : /adult|grown/i.test(s) ? "adults" : "everyone");
const asKidOk = (s: string): Recipe["kidOk"] => (/^(yes|y)$/i.test(s) ? "yes" : /some|one/i.test(s) ? "some" : /^(no|n)$/i.test(s) ? "no" : "");
const asStore = (s: string): Store | "" => {
  const k = s.toLowerCase().replace(/[^a-z]/g, "");
  return !k ? "" : k.startsWith("trader") || k === "tj" || k === "tjs" ? "trader-joes" : k.startsWith("costco") ? "costco" : k.startsWith("safeway") ? "safeway" : "";
};

// ---- ingredient lines

const FRACTIONS: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8" };
const UNITS = "cups?|c|tablespoons?|tbsps?|tbsp|T|teaspoons?|tsps?|tsp|t|pounds?|lbs?|ounces?|oz|grams?|g|kilograms?|kg|ml|liters?|l|quarts?|qt|pints?|pt|cans?|jars?|packages?|pkgs?|bags?|boxes|box|bunch(?:es)?|heads?|cloves?|sticks?|slices?|pinch(?:es)?|dash(?:es)?|sprigs?|stalks?|handfuls?|containers?|bottles?|packets?|envelopes?|pouch(?:es)?|loaf|loaves|dozen";
const LINE = new RegExp(String.raw`^((?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(?:\d+/\d+|\d+(?:\.\d+)?))?|an?|one|two|three|four)\s+(?:\((?:[^)]*)\)\s*)?(?:(${UNITS})\.?\s+(?:of\s+)?)?(.+)$`, "i");

/** "1 lb ground turkey" → 1, lb, ground turkey; "1/2 cup onion, diced" → 1/2, cup, onion; "Salt to taste" → salt. */
export function parseIngredient(raw: string): Ingredient {
  const line = raw.replace(/[½¼¾⅓⅔⅛]/g, (f) => ` ${FRACTIONS[f]}`).replace(/(\d)\s+(\d\/)/, "$1 $2").replace(/\s+/g, " ").trim();
  const m = line.match(LINE);
  let quantity = "", unit = "", item = line;
  if (m) { quantity = m[1].toLowerCase().replace(/^(an?|one)$/, "1").replace(/^two$/, "2").replace(/^three$/, "3").replace(/^four$/, "4"); unit = (m[2] ?? "").toLowerCase(); item = m[3]; }
  // What's bought, not how it's cut: "onion, diced" → onion; "garlic (minced)" → garlic; "salt to taste" → salt.
  item = item.replace(/\([^)]*\)/g, "").split(/,| - | – /)[0].replace(/\b(to taste|as needed|optional|for serving|divided)\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  return { line: raw.trim(), quantity, unit, item: item || line.toLowerCase(), section: known(item)?.section ?? "fresh" };
}

// ---- reading

let memory: Recipe[] | null = null;

function toRecipes(rows: string[][]): Recipe[] {
  return records(rows).flatMap((r) => {
    const name = r.get("name");
    if (!name) return [];
    return [{
      id: r.get("id") || `row-${r.rowNumber}`, name, effort: asEffort(r.get("effort")), minutes: num(r.get("minutes")), serves: num(r.get("serves")),
      protein: r.get("protein"), ingredients: lines(r.get("ingredients")).map(parseIngredient), steps: lines(r.get("steps")), store: asStore(r.get("store")),
      season: words(r.get("season")).map((s) => s.toLowerCase()), for: asFor(r.get("for")), kidOk: asKidOk(r.get("kid_ok")), makeAhead: yes(r.get("make_ahead")),
      tags: words(r.get("tags")).map((s) => s.toLowerCase()), source: r.get("source"), rating: num(r.get("rating")), notes: r.get("notes"),
      active: !/^(no|n|false|0)$/i.test(r.get("active")), addedAt: r.get("added_at"),
    }];
  });
}

const local = () => readFile(path.join(process.cwd(), "data", "recipes.csv"), "utf8").then(parseCsv, () => [] as string[][]);

export async function loadRecipes(): Promise<Recipe[]> {
  if (!sheetsConfigured()) return [...(memory ??= toRecipes(await local()))];
  return toRecipes(await readTab(TAB).catch(() => [] as string[][]));
}

export { searchRecipes } from "./search";

// ---- saving

const newId = (name: string) => `${norm(name).replace(/ /g, "-").slice(0, 24) || "recipe"}-${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`;
const col = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : col(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

function cells(r: Recipe): Record<string, string> {
  return {
    id: r.id, name: r.name, effort: r.effort, minutes: r.minutes ? String(r.minutes) : "", serves: r.serves ? String(r.serves) : "", protein: r.protein,
    ingredients: r.ingredients.map((i) => i.line).join("\n"), steps: r.steps.join("\n"), store: r.store, season: r.season.join(", "), for: r.for,
    kid_ok: r.kidOk, make_ahead: r.makeAhead ? "yes" : "", tags: r.tags.join(", "), source: r.source, rating: r.rating ? String(r.rating) : "",
    notes: r.notes, active: r.active ? "yes" : "no", added_at: r.addedAt,
  };
}

/** A draft as a recipe: tidied, with its ingredient lines read. */
export function fromDraft(d: Draft, existing?: Recipe): Recipe {
  const name = d.name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) throw new AppError("Give the recipe a name.");
  return {
    id: existing?.id ?? d.id ?? newId(name), name, effort: d.effort === "quick" ? "quick" : "regular",
    minutes: d.minutes && d.minutes > 0 ? Math.round(d.minutes) : null, serves: d.serves && d.serves > 0 ? Math.round(d.serves) : null,
    protein: (d.protein ?? "").trim().toLowerCase(), ingredients: d.ingredients.map((l) => l.trim()).filter(Boolean).slice(0, 80).map(parseIngredient),
    steps: d.steps.map((s) => s.trim()).filter(Boolean).slice(0, 60), store: d.store ?? "", season: d.season ?? [], for: d.for ?? "everyone",
    kidOk: d.kidOk ?? "", makeAhead: Boolean(d.makeAhead), tags: (d.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean), source: d.source ?? "",
    rating: d.rating && d.rating >= 1 ? Math.min(3, Math.round(d.rating)) : null, notes: (d.notes ?? "").trim(), active: d.active ?? existing?.active ?? true,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
}

/** Saves a recipe: a new row, or only its own row when it's already in the collection (matched by id). */
export async function saveRecipe(r: Recipe): Promise<Recipe> {
  if (!sheetsConfigured()) {
    const m = (memory ??= toRecipes(await local()));
    const i = m.findIndex((x) => x.id === r.id);
    if (i >= 0) m[i] = r; else m.push(r);
    return r;
  }
  await ensureTab(TAB);
  const rows = await readTab(TAB);
  const c = cells(r);
  if (!rows.length) { await appendRows(TAB, [HEADERS, HEADERS.map((h) => c[h])]); return r; }
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const at = records(rows).find((x) => x.get("id") === r.id);
  if (!at) {
    // A column the tab doesn't have yet is added at the end, so nothing's lost.
    const missing = HEADERS.filter((h) => !headers.includes(h));
    if (missing.length) { await updateRange(`${TAB}!${col(headers.length)}1:${col(headers.length + missing.length - 1)}1`, [missing]); headers.push(...missing); }
    await appendRows(TAB, [headers.map((h) => c[h] ?? "")]);
    return r;
  }
  const old = rows[at.rowNumber - 1];
  await updateRange(`${TAB}!A${at.rowNumber}:${col(headers.length - 1)}${at.rowNumber}`, [headers.map((h, i) => (h in c ? c[h] : old[i] ?? ""))]);
  return r;
}

export async function updateRecipe(id: string, change: (r: Recipe) => Recipe): Promise<Recipe> {
  const r = (await loadRecipes()).find((x) => x.id === id);
  if (!r) throw new AppError("That recipe isn't in the collection anymore.");
  return saveRecipe(change(r));
}

/** The recipe already in the collection with the same name, if there is one. */
export const sameName = (all: Recipe[], name: string) => all.find((r) => norm(r.name) === norm(name));

// ---- bringing recipes in

/** Minutes in an ISO duration from a recipe page ("PT1H30M" → 90). */
export function isoMinutes(s: unknown): number | null {
  const m = typeof s === "string" ? s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i) : null;
  if (!m) return null;
  const total = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return total > 0 ? total : null;
}

const decode = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&#8217;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(strings) : typeof v === "string" ? [decode(v)] : typeof v === "number" ? [String(v)] : []);

function steps(v: unknown): string[] {
  if (typeof v === "string") return lines(decode(v.replace(/<\/(p|li)>|<br\s*\/?>/gi, "\n")).replace(/ (?=\d+\. )/g, "\n"));
  if (Array.isArray(v)) return v.flatMap(steps);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.itemListElement) return steps(o.itemListElement);
    return strings(o.text ?? o.name);
  }
  return [];
}

/** The recipe a page describes in its own structured data (most recipe sites include it), or null. */
export function recipeInPage(html: string, url: string): Draft | null {
  const found: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const type = ([] as unknown[]).concat(o["@type"]);
    if (type.some((t) => typeof t === "string" && /recipe$/i.test(t))) found.push(o);
    if (o["@graph"]) walk(o["@graph"]);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* a page's broken block: try the next */ }
  }
  const r = found[0];
  if (!r) return null;
  const name = strings(r.name)[0];
  const ingredients = strings(r.recipeIngredient ?? r.ingredients);
  if (!name || !ingredients.length) return null;
  const minutes = isoMinutes(r.totalTime) ?? (((isoMinutes(r.prepTime) ?? 0) + (isoMinutes(r.cookTime) ?? 0)) || null);
  const serves = num(strings(r.recipeYield)[0] ?? "");
  const tags = [...strings(r.recipeCategory), ...strings(r.recipeCuisine), ...strings(r.keywords).flatMap((k) => k.split(","))]
    .map((t) => t.trim().toLowerCase()).filter((t) => t && t.length < 24);
  return {
    name, effort: minutes && minutes <= 35 ? "quick" : "regular", minutes, serves, protein: "", ingredients, steps: steps(r.recipeInstructions),
    store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [...new Set(tags)].slice(0, 6), source: url, rating: null, notes: "",
  };
}

/** Only ordinary public pages: never the server's own network. */
function checkLink(raw: string): URL {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new AppError("That doesn't look like a link."); }
  const h = u.hostname.toLowerCase();
  if (!/^https?:$/.test(u.protocol) || !h.includes(".") || /^[\d.]+$|:|^localhost$|\.(local|internal|localhost)$/.test(h)) throw new AppError("That doesn't look like a link to a recipe page.");
  return u;
}

/** Reads the recipe at a link: the page's own recipe data first, the model only when a page doesn't have it. */
export async function readLink(raw: string): Promise<Draft[]> {
  const u = checkLink(raw);
  let html = "";
  try {
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", accept: "text/html", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12_000), redirect: "follow" });
    if (!r.ok) throw new Error(`page ${r.status}`);
    html = (await r.text()).slice(0, 3_000_000);
  } catch (e) {
    // Some big recipe sites turn away servers like ours; the model can still open the page from its side.
    console.error("couldn't open", u.hostname, e);
    const read = await readElsewhere(u.toString()).catch((err) => { console.error("couldn't read elsewhere", err); return []; });
    if (read.length) return read;
    throw new AppError("Couldn't open that page. Copy the recipe from it and use Type it in.");
  }
  const own = recipeInPage(html, u.toString());
  if (own) return [await withGuesses(own, own.minutes ? "" : own.steps.join(" "))];
  const text = decode(html.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, " ")).slice(0, 14_000);
  const read = await readText(text, u.toString());
  if (!read.length) throw new AppError("Couldn't find a recipe on that page. Try typing it in.");
  return read;
}

/** A page our server can't open, read by the model (it opens the link itself). She reviews it before it's saved. */
async function readElsewhere(url: string): Promise<Draft[]> {
  const { data } = await generateJson<{ recipes: ModelRecipe[] }>(
    `Open this recipe page and read its recipe into structured form: ${url}\nCopy ingredient lines exactly as the page writes them (amount, unit, item) and the steps in order. Only include minutes or servings the page states. effort: "quick" if it's about 30 minutes or less on a weeknight, else "regular". make_ahead: true if it can be made earlier in the day or the night before. protein: the main protein in a few words. tags: up to 4 short words to find it by. If the page has no recipe, return an empty list.`,
    DRAFT_SCHEMA, { urls: true, timeoutMs: 45_000 },
  );
  return (data.recipes ?? []).filter((r) => r.name?.trim() && r.ingredients?.length).slice(0, 1).map((r) => ({
    name: r.name.trim(), effort: r.minutes ? (r.minutes <= 35 ? "quick" : "regular") : r.effort === "quick" ? "quick" : "regular", minutes: r.minutes || null, serves: r.serves || null,
    protein: (r.protein ?? "").toLowerCase(), ingredients: r.ingredients.map((l) => l.trim()).filter(Boolean), steps: (r.steps ?? []).map((x) => x.trim()).filter(Boolean),
    store: "", season: [], for: asFor(r.for ?? ""), kidOk: "", makeAhead: Boolean(r.make_ahead), tags: (r.tags ?? []).map((t) => t.toLowerCase()).slice(0, 6), source: url, rating: null, notes: "",
  }));
}

/** Many short lines with no amounts or steps: a list of meal ideas ("Tacos", "Salmon and broccoli"), one recipe each. */
export function looksLikeIdeas(text: string): string[] | null {
  const ls = text.split(/\n/).map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  if (ls.length < 3 || ls.length > 300) return null;
  const idea = (l: string) => l.length <= 50 && !/^[\d½¼¾⅓⅔]/.test(l) && !/:\s*$|\b(cups?|tbsp|tsp|teaspoons?|tablespoons?|oz|lbs?|minutes|preheat|stir|bake|heat)\b/i.test(l);
  return ls.every(idea) ? [...new Set(ls)] : null;
}

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    recipes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" }, minutes: { type: "INTEGER" }, serves: { type: "INTEGER" }, protein: { type: "STRING" },
          ingredients: { type: "ARRAY", items: { type: "STRING" } }, steps: { type: "ARRAY", items: { type: "STRING" } },
          effort: { type: "STRING", enum: ["quick", "regular"] }, make_ahead: { type: "BOOLEAN" }, for: { type: "STRING", enum: ["everyone", "kids", "adults"] },
          tags: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["name", "ingredients", "steps", "effort"],
      },
    },
  },
  required: ["recipes"],
};
type ModelRecipe = { name: string; minutes?: number; serves?: number; protein?: string; ingredients: string[]; steps: string[]; effort: string; make_ahead?: boolean; for?: string; tags?: string[] };

/** Swaps the household's names for placeholders before text goes to the model, and back after. */
async function privately(text: string): Promise<{ text: string; restore: (s: string) => string }> {
  const names = await loadHousehold().then((h) => h.profile.people.map((p) => p.name).filter((n) => n.length > 1), () => [] as string[]);
  let t = text;
  const back: [string, string][] = [];
  names.forEach((n, i) => {
    const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    if (re.test(t)) { const p = `Person${String.fromCharCode(65 + i)}`; t = t.replace(re, p); back.push([p, n]); }
  });
  return { text: t, restore: (s) => back.reduce((acc, [p, n]) => acc.replaceAll(p, n), s) };
}

/**
 * Checked by code: a number of minutes, servings or an amount must appear in the source text (never invented), so an
 * amount the model added is dropped and the ingredient kept; empty lines go.
 */
export function checkAgainst(source: string, r: ModelRecipe, src: string): Draft {
  const nums = new Set((source.match(/\d+(?:[./]\d+)?/g) ?? ([] as string[])).concat(Object.values(FRACTIONS)));
  const has = (n: number | undefined) => (n && nums.has(String(n)) ? n : null);
  const ingredients = r.ingredients.map((l) => l.trim()).filter(Boolean).map((l) => {
    const amounts = l.match(/\d+(?:[./]\d+)?/g) ?? [];
    return amounts.every((a) => nums.has(a)) ? l : l.replace(/^[\d\s./-]+(?:\w+\s+)?/, "").trim() || l;
  });
  const minutes = has(r.minutes);
  return {
    name: r.name.trim(), effort: minutes ? (minutes <= 35 ? "quick" : "regular") : r.effort === "quick" ? "quick" : "regular", minutes, serves: has(r.serves),
    protein: (r.protein ?? "").toLowerCase(), ingredients, steps: r.steps.map((s) => s.trim()).filter(Boolean), store: "", season: [],
    for: asFor(r.for ?? ""), kidOk: "", makeAhead: Boolean(r.make_ahead), tags: (r.tags ?? []).map((t) => t.toLowerCase()).slice(0, 6), source: src, rating: null, notes: "",
  };
}

/** Reads recipes out of typed, pasted or page text with the model, checked by code. */
export async function readText(raw: string, src = "Typed in"): Promise<Draft[]> {
  const ideas = looksLikeIdeas(raw);
  if (ideas) return guessIdeas(ideas, src);
  const { text, restore } = await privately(raw.slice(0, 14_000));
  const { data } = await generateJson<{ recipes: ModelRecipe[] }>(
    `Read the recipe or recipes in this text into structured form. Copy ingredient lines as written (amount, unit, item); copy steps in order, one per item. Only include minutes or servings if the text states them. effort: "quick" if it's about 30 minutes or less of mostly hands-off weeknight cooking, else "regular". make_ahead: true if it can be made earlier in the day or the night before. for: "kids" if it's a children's dinner (nuggets, mac and cheese), else "everyone". protein: the main protein in a few words, or empty. tags: up to 4 short words to find it by (tacos, soup, one-pan). If there's no recipe, return an empty list.\n\nText:\n${text}`,
    DRAFT_SCHEMA, { timeoutMs: 40_000 },
  );
  return (data.recipes ?? []).filter((r) => r.name?.trim()).slice(0, 40).map((r) => {
    const back: ModelRecipe = JSON.parse(restore(JSON.stringify(r)));
    return checkAgainst(raw, back, src);
  });
}

const READABLE = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

/**
 * Reads the recipes in a picture (a screenshot, a photo of a card or a cookbook page) or a PDF. The model writes out
 * each recipe's text as it appears, and the amounts and times it reports are checked against that text, as with typed
 * recipes; anything it couldn't read stays blank for her.
 */
export async function readRecipeFile(f: { name: string; mimeType: string; data: string }): Promise<Draft[]> {
  const src = f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || (f.mimeType.startsWith("image/") ? "Photo" : "File");
  if (/^text\//.test(f.mimeType)) return readText(Buffer.from(f.data, "base64").toString("utf8"), src);
  if (!READABLE.test(f.mimeType)) throw new AppError("Simmer can read pictures, PDFs and text files.");
  const schema = structuredClone(DRAFT_SCHEMA) as typeof DRAFT_SCHEMA & { properties: { recipes: { items: { properties: Record<string, unknown>; required: string[] } } } };
  schema.properties.recipes.items.properties.text = { type: "STRING" };
  schema.properties.recipes.items.required.push("text");
  const { data } = await generateJson<{ recipes: (ModelRecipe & { text: string })[] }>(
    `Read every recipe in this ${f.mimeType === "application/pdf" ? "document" : "picture"} into structured form. For each: text is the recipe's own words as they appear (the title, ingredient lines and steps), copied exactly; then the same recipe in fields. Copy ingredient lines as written; only include minutes or servings it states. If a part is unreadable, leave it out rather than guess. effort: "quick" if it's about 30 minutes or less on a weeknight, else "regular". make_ahead: true if it can be made earlier in the day or the night before. for: "kids" for a children's dinner, else "everyone". protein: the main protein in a few words. tags: up to 4 short words. If there's no recipe, return an empty list.`,
    schema, { files: [{ mimeType: f.mimeType, data: f.data }], timeoutMs: 55_000 },
  );
  return (data.recipes ?? []).filter((r) => r.name?.trim()).slice(0, 60).map((r) => checkAgainst(r.text ?? "", r, src));
}

/** Meal ideas ("Tacos") become recipes that are just a name and a guessed effort: enough to plan with. */
async function guessIdeas(names: string[], src: string): Promise<Draft[]> {
  const bare = (name: string, effort: Effort, makeAhead = false, forWho: For = "everyone"): Draft => ({
    name, effort, minutes: null, serves: null, protein: "", ingredients: [], steps: [], store: "", season: [], for: forWho, kidOk: "", makeAhead, tags: [], source: src, rating: null, notes: "",
  });
  try {
    const { text, restore } = await privately(names.join("\n"));
    const { data } = await generateJson<{ ideas: { name: string; effort: string; make_ahead: boolean; for: string }[] }>(
      `Each line is a family dinner idea. For each, in the same order and with the name exactly as written: effort "quick" (about 30 minutes or less on a weeknight) or "regular"; make_ahead true if it's usually made earlier or the night before; for "kids" if it's a children's dinner (nuggets, mac and cheese), else "everyone".\n\n${text}`,
      { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, effort: { type: "STRING", enum: ["quick", "regular"] }, make_ahead: { type: "BOOLEAN" }, for: { type: "STRING", enum: ["everyone", "kids"] } }, required: ["name", "effort"] } } }, required: ["ideas"] },
      { light: true, timeoutMs: 20_000 },
    );
    const by = new Map((data.ideas ?? []).map((g) => [norm(restore(g.name)), g]));
    return names.map((n, i) => { const g = by.get(norm(n)) ?? data.ideas?.[i]; return bare(n, g?.effort === "quick" ? "quick" : "regular", Boolean(g?.make_ahead), asFor(g?.for ?? "")); });
  } catch (e) {
    console.error("couldn't guess effort for ideas", e);
    return names.map((n) => bare(n, "regular"));
  }
}

/** A recipe read from a page without a total time: the model guesses effort from the steps (she corrects it). */
async function withGuesses(d: Draft, stepsText: string): Promise<Draft> {
  if (!stepsText) return d;
  try {
    const { data } = await generateJson<{ effort: string; make_ahead: boolean }>(
      `A family dinner recipe, "${d.name}". Steps: ${stepsText.slice(0, 4000)}\nIs it "quick" (about 30 minutes or less on a weeknight) or "regular"? Can it be made ahead (earlier in the day or the night before)?`,
      { type: "OBJECT", properties: { effort: { type: "STRING", enum: ["quick", "regular"] }, make_ahead: { type: "BOOLEAN" } }, required: ["effort", "make_ahead"] },
      { light: true, timeoutMs: 10_000 },
    );
    return { ...d, effort: data.effort === "quick" ? "quick" : "regular", makeAhead: Boolean(data.make_ahead) };
  } catch { return d; }
}
