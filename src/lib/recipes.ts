// The recipe collection: one row per recipe in the Recipes tab (docs/PLAN.md, section 3). Reading is forgiving (headers
// in any order, a row without a name skipped); saving rewrites only that recipe's row.
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { generateJson } from "./gemini";
import { atomically, change, load, table } from "./store";
import { loadHousehold } from "./data";
import { AppError } from "./errors";
import { SECTION_READS, savedSections, storeOf, type Section, type Store } from "./groceries";
import { withinCap } from "./ops/caps";
import { norm, parseIngredient, plainFractions, UNIT_NAMES } from "./words";
import { newId, yes } from "./parse";

export { parseIngredient };

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

const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const words = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
/** A list marker ("- ", "2. ", "3) ") before a line; only with a space after, so "1.5 lb" keeps its amount (Nov 19). */
const MARKER = /^\s*(?:[-•*]|\d+[.)])\s+/;
const lines = (s: string) => s.split(/\n/).map((x) => x.replace(MARKER, "").trim()).filter(Boolean);
/** Quick is about half an hour (35 minutes, with the time a page gives); without minutes, the guess given. */
const effortFor = (minutes: number | null | undefined, guess?: string): Effort => (minutes ? (minutes <= 35 ? "quick" : "regular") : guess === "quick" ? "quick" : "regular");
const asEffort = (s: string): Effort => (/quick|fast|easy/i.test(s) ? "quick" : "regular");
const asFor = (s: string): For => (/kid|boy/i.test(s) ? "kids" : /adult|grown/i.test(s) ? "adults" : "everyone");
const asKidOk = (s: string): Recipe["kidOk"] => (/^(yes|y)$/i.test(s) ? "yes" : /some|one/i.test(s) ? "some" : /^(no|n)$/i.test(s) ? "no" : "");

// ---- the tab

const RECIPES = table<Recipe>({
  tab: "Recipes",
  headers: ["id", "name", "effort", "minutes", "serves", "protein", "ingredients", "steps", "store", "season", "for", "kid_ok", "make_ahead", "tags", "source", "rating", "notes", "active", "added_at"],
  // A row without an id is shown with one made from its name, the same on every read, and keeps it once it's saved.
  idFrom: (get) => get("name"),
  read: (get, id) => (get("name") ? {
    id, name: get("name"), effort: asEffort(get("effort")), minutes: num(get("minutes")), serves: num(get("serves")),
    protein: get("protein"), ingredients: lines(get("ingredients")).map(parseIngredient), steps: lines(get("steps")), store: storeOf(get("store")),
    season: words(get("season")).map((s) => s.toLowerCase()), for: asFor(get("for")), kidOk: asKidOk(get("kid_ok")), makeAhead: yes(get("make_ahead")),
    tags: words(get("tags")).map((s) => s.toLowerCase()), source: get("source"), rating: num(get("rating")), notes: get("notes"),
    active: !/^(no|n|false|0)$/i.test(get("active")), addedAt: get("added_at"),
  } : null),
  cells: (r) => ({
    id: r.id, name: r.name, effort: r.effort, minutes: r.minutes ? String(r.minutes) : "", serves: r.serves ? String(r.serves) : "", protein: r.protein,
    ingredients: r.ingredients.map((i) => i.line).join("\n"), steps: r.steps.join("\n"), store: r.store, season: r.season.join(", "), for: r.for,
    kid_ok: r.kidOk, make_ahead: r.makeAhead ? "yes" : "", tags: r.tags.join(", "), source: r.source, rating: r.rating ? String(r.rating) : "",
    notes: r.notes, active: r.active ? "yes" : "no", added_at: r.addedAt,
  }),
  key: (r) => r.id,
});

/** Every tab loadRecipes reads, for its "nothing changed" answers (ops/fresh.ts; a test keeps this in step). */
export const RECIPES_READS = [RECIPES.tab, ...SECTION_READS];

export async function loadRecipes(): Promise<Recipe[]> {
  const rs = await load(RECIPES);
  // An ingredient's section as she set it (Nov 16), over the guess: the same place it goes on the list.
  const saved = await savedSections().catch(() => new Map<string, Section>());
  if (!saved.size) return rs;
  return rs.map((r) => ({ ...r, ingredients: r.ingredients.map((i) => { const s = saved.get(norm(i.item)); return s === "fresh" || s === "pantry" || s === "freezer" ? { ...i, section: s } : i; }) }));
}

export { searchRecipes } from "./search";

// ---- saving

const recipeId = (name: string) => newId(`${norm(name).replace(/ /g, "-").slice(0, 24) || "recipe"}-`);

const str = (x: unknown) => (typeof x === "string" ? x : "");
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((l): l is string => typeof l === "string") : []);
const positive = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null);

/** A draft as a recipe: tidied, with its ingredient lines read. Drafts come from the phone, so nothing in one is trusted to be the right type. */
export function fromDraft(d: Draft, existing?: Recipe): Recipe {
  const name = str(d.name).replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) throw new AppError("Give the recipe a name.");
  const minutes = positive(d.minutes), serves = positive(d.serves), rating = positive(d.rating);
  return {
    id: existing?.id ?? (str(d.id).slice(0, 40) || recipeId(name)), name, effort: d.effort === "quick" ? "quick" : "regular",
    minutes: minutes && Math.round(minutes), serves: serves && Math.round(serves),
    protein: str(d.protein).trim().toLowerCase(), ingredients: strs(d.ingredients).map((l) => l.trim()).filter(Boolean).slice(0, 80).map(parseIngredient),
    steps: strs(d.steps).map((s) => s.trim()).filter(Boolean).slice(0, 60), store: storeOf(str(d.store)), season: strs(d.season), for: d.for === "kids" || d.for === "adults" ? d.for : "everyone",
    kidOk: asKidOk(str(d.kidOk)), makeAhead: Boolean(d.makeAhead), tags: strs(d.tags).map((t) => t.trim().toLowerCase()).filter(Boolean), source: str(d.source),
    rating: rating && rating >= 1 ? Math.min(3, Math.round(rating)) : null, notes: str(d.notes).trim(), active: d.active ?? existing?.active ?? true,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
  };
}

/** Saves a recipe: a new row, or only its own row when it's already in the collection (matched by id). */
export const saveRecipe = async (r: Recipe): Promise<Recipe> => (await saveRecipes([r]))[0];

/**
 * Saves several recipes as saveRecipe does, in one write however many there are (Nov 10: an import of many saved each
 * with its own read and writes).
 */
export const saveRecipes = async (rs: Recipe[]): Promise<Recipe[]> => {
  if (!rs.length) return rs;
  const byId = new Map(rs.map((r) => [r.id, r])); // the same recipe twice: the later one, in the first one's place
  await change(RECIPES, (all) => [...all.map((r) => byId.get(r.id) ?? r), ...[...byId.values()].filter((r) => !all.some((x) => x.id === r.id))]);
  return rs;
};

/** Deletes a recipe from the collection (Sam, Nov 14: from its Edit sheet, asked first). Answers whether it was there. */
export async function deleteRecipe(id: string): Promise<boolean> {
  let was = false;
  await change(RECIPES, (all) => ((was = all.some((r) => r.id === id)) ? all.filter((r) => r.id !== id) : all));
  return was;
}

export const updateRecipe = atomically(async (id: string, change: (r: Recipe) => Recipe): Promise<Recipe> => {
  const r = (await loadRecipes()).find((x) => x.id === id);
  if (!r) throw new AppError("That recipe isn't in the collection anymore.");
  return saveRecipe(change(r));
});

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

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', lt: "<", gt: ">", ndash: "–", mdash: "—", frac12: "½", frac14: "¼", frac34: "¾", deg: "°" };
/** A page's characters for its entities, in one pass (Nov 19: "&amp;lt;" became "<"), numbered ones in hex too. */
const entities = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]\w*);/gi, (m, e: string) => {
  const n = e[0] !== "#" ? NaN : e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return e[0] === "#" ? (n > 0 && n <= 0x10ffff ? (n === 0xa0 ? " " : String.fromCodePoint(n)) : m) : ENTITIES[e.toLowerCase()] ?? m;
});
/** Text without tags, on one line. A tag ends at the next "<" too, so a page of unclosed tags is read in one pass. */
const decode = (s: string) => entities(s.replace(/<[^<>]*>?/g, " ")).replace(/\s+/g, " ").trim();
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(strings) : typeof v === "string" ? [decode(v)] : typeof v === "number" ? [String(v)] : []);

function steps(v: unknown): string[] {
  // Each step decoded on its own line (Nov 19: decoding the whole put every <li> on one line).
  if (typeof v === "string") return lines(v.replace(/<\/(p|li)>|<(li|br)\b[^<>]*>/gi, "\n").split("\n").map((l) => decode(l).replace(/ (?=\d+\. )/g, "\n")).join("\n"));
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
  for (const block of blocks(html, "script")) {
    if (!/type=["']?application\/ld\+json/i.test(block.open)) continue;
    try { walk(JSON.parse(block.body.trim())); } catch { /* a page's broken block: try the next */ }
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
    name, effort: effortFor(minutes), minutes, serves, protein: "", ingredients, steps: steps(r.recipeInstructions),
    store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [...new Set(tags)].slice(0, 6), source: url, rating: null, notes: "",
  };
}

/**
 * Each `<tag …>…</tag>` in a page, found with indexOf so it's one pass however the page is written (Nov 19: a regex
 * took seconds on unclosed tags). One left open runs to the end.
 */
function blocks(html: string, tag: string): { open: string; body: string; start: number; end: number }[] {
  const out: { open: string; body: string; start: number; end: number }[] = [];
  const lower = html.toLowerCase(), close = `</${tag}`;
  for (let at = lower.indexOf(`<${tag}`); at >= 0; at = lower.indexOf(`<${tag}`, at)) {
    const gt = lower.indexOf(">", at), bodyAt = gt < 0 ? html.length : gt + 1;
    const c = lower.indexOf(close, bodyAt), end = c < 0 ? html.length : (lower.indexOf(">", c) + 1 || html.length);
    out.push({ open: html.slice(at, bodyAt), body: html.slice(bodyAt, c < 0 ? html.length : c), start: at, end });
    at = end;
  }
  return out;
}
/** A page's words without its scripts, styles and site furniture. */
export function pageText(html: string): string {
  let s = html;
  for (const tag of ["script", "style", "nav", "header", "footer"]) {
    let out = "", from = 0;
    for (const b of blocks(s, tag)) { out += `${s.slice(from, b.start)} `; from = b.end; }
    s = out + s.slice(from);
  }
  return decode(s);
}

/** An IPv4 address that isn't an ordinary public one. */
function private4(v4: string): boolean {
  const [a, b, c] = v4.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224;
}
/** An IPv6 address as its 16 bytes (a trailing IPv4 part included), or null. */
function bytes6(ip: string): number[] | null {
  let h = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = h.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (v4) { const n = v4.split(".").map(Number); h = `${h.slice(0, -v4.length)}${((n[0] << 8) | n[1]).toString(16)}:${((n[2] << 8) | n[3]).toString(16)}`; }
  const [head, tail, more] = h.split("::");
  if (more !== undefined) return null;
  const left = head ? head.split(":") : [], right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
}
/**
 * An address on the server's own network or the machine itself: IPv4, and IPv6 including the forms that carry an IPv4
 * address (mapped, ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16, checked by the address they carry; Nov 19, review).
 * Exported for tests.
 */
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return private4(ip);
  const b = isIP(ip) === 6 ? bytes6(ip) : null;
  if (!b) return true;
  const v4 = (i: number) => b.slice(i, i + 4).join(".");
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zero(0, 10) && b[10] === 255 && b[11] === 255) return private4(v4(12)); // ::ffff:0:0/96
  if (zero(0, 12)) return true; // ::/96: unspecified, loopback, IPv4-compatible
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return zero(4, 12) ? private4(v4(12)) : true; // NAT64, and its local-use 64:ff9b:1::/48
  if (b[0] === 0x20 && b[1] === 0x02) return private4(v4(2)); // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && (zero(2, 4) || (b[2] === 0x0d && b[3] === 0xb8))) return true; // Teredo, documentation
  if (b[0] === 1 && zero(1, 8)) return true; // discard-only 100::/64
  return (b[0] & 0xfe) === 0xfc || (b[0] === 0xfe && (b[1] & 0x80) === 0x80) || b[0] === 0xff; // unique local, link and site local, multicast
}

const NOT_A_PAGE = "That doesn't look like a link to a recipe page.";
/**
 * The address a page is opened at, looked up as the connection is made and refused when any address the name leads to is
 * private (Nov 19, review: the name was checked, then looked up again by the fetch, and could lead somewhere else the
 * second time). The connection goes to an address checked here. Exported for tests.
 */
export const publicOnly: LookupFunction = (host, options, callback) => {
  const cb = callback as (e: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
  lookup(host, { all: true }).then((found) => {
    if (!found.length || found.some((a) => privateAddress(a.address))) return cb(new AppError(NOT_A_PAGE), options.all ? [] : "", 4);
    if (options.all) cb(null, found.map((a) => ({ address: a.address, family: a.family })));
    else cb(null, found[0].address, found[0].family);
  }, (e) => cb(e, options.all ? [] : "", 4));
};

/**
 * One request for a page, connected only to an address `publicOnly` checked (fetch can't be given its own lookup on
 * Vercel's Node runtime without another package). Redirects aren't followed here; openPage follows them itself. Answers
 * a web Response, its body unpacked (gzip, deflate, br). On an object, so tests can stand in for it.
 */
export const opener = {
  open(u: URL, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
    return new Promise((resolve, reject) => {
      const req = (u.protocol === "https:" ? httpsRequest : httpRequest)(u, { method: "GET", headers: { ...headers, "accept-encoding": "gzip, deflate, br" }, lookup: publicOnly, signal }, (res) => {
        const status = res.statusCode ?? 0;
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v != null) h.set(k, Array.isArray(v) ? v.join(", ") : v);
        if (status < 200 || status > 599 || (status >= 300 && status < 400) || status === 204 || status === 205) {
          res.resume();
          resolve(new Response(null, { status: status >= 200 && status <= 599 ? status : 502, headers: h }));
          return;
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase().trim();
        const unpack = enc === "gzip" ? createGunzip() : enc === "br" ? createBrotliDecompress() : enc === "deflate" ? createInflate() : null;
        const body = unpack ? pipeline(res, unpack, () => {}) : res;
        h.delete("content-encoding"); h.delete("content-length");
        resolve(new Response(Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, { status, headers: h }));
      });
      req.on("error", reject);
      req.end();
    });
  },
};

/** Only ordinary public pages: never the server's own network, by name or by what the name leads to. */
async function checkLink(raw: string | URL): Promise<URL> {
  let u: URL;
  try { u = new URL(typeof raw !== "string" || /^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new AppError("That doesn't look like a link."); }
  const h = u.hostname.toLowerCase();
  const bad = () => new AppError(NOT_A_PAGE);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || !h.includes(".") || /^[\d.]+$|:|^\[|^localhost$|\.(local|internal|localhost)$/.test(h)) throw bad();
  // A name that can't be looked up is left to the fetch, which fails as any unreachable page does.
  const found = await lookup(h, { all: true }).catch(() => []);
  if (found.some((a) => privateAddress(a.address))) throw bad();
  return u;
}

const PAGE_MAX = 3_000_000;
/** A page's text: redirects followed one at a time, each checked as the link was (Nov 19), and at most PAGE_MAX read. */
async function openPage(first: URL): Promise<{ html: string; url: URL }> {
  const signal = AbortSignal.timeout(10_000); // the whole of it: every hop and the body
  let u = first;
  for (let hop = 0; ; hop++) {
    const r = await opener.open(u, { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", accept: "text/html", "accept-language": "en-US,en;q=0.9" }, signal);
    const to = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (to) {
      await r.body?.cancel();
      if (hop >= 5) throw new Error("too many redirects");
      u = await checkLink(new URL(to, u)); // an AppError here is the answer: it isn't read elsewhere either
      continue;
    }
    if (!r.ok || !r.body) throw new Error(`page ${r.status}`);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let html = "";
    while (html.length < PAGE_MAX) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => {});
    return { html: html.slice(0, PAGE_MAX), url: u };
  }
}

/** Reads the recipe at a link: the page's own recipe data first, the model only when a page doesn't have it. */
export async function readLink(raw: string): Promise<Draft[]> {
  const u = await checkLink(raw);
  let page: { html: string; url: URL };
  try {
    page = await openPage(u);
  } catch (e) {
    if (e instanceof AppError) throw e;
    // Some big recipe sites turn away servers like ours; the model can still open the page from its side.
    console.error("couldn't open", u.hostname, e);
    const read = await readElsewhere(u.toString()).catch((err) => { console.error("couldn't read elsewhere", err); return []; });
    if (read.length) return read;
    throw new AppError("Couldn't open that page. Copy the recipe from it and use Type it in.");
  }
  const own = recipeInPage(page.html, u.toString());
  if (own) return [await withGuesses(own, own.minutes ? "" : own.steps.join(" "))];
  const read = await readText(pageText(page.html).slice(0, 14_000), u.toString());
  if (!read.length) throw new AppError("Couldn't find a recipe on that page. Try typing it in.");
  return read;
}

/** A page our server can't open, read by the model (it opens the link itself). She reviews it before it's saved. */
async function readElsewhere(url: string): Promise<Draft[]> {
  const { data } = await generateJson<{ recipes: ModelRecipe[] }>(
    `Open this recipe page and read its recipe into structured form: ${url}\nCopy ingredient lines exactly as the page writes them (amount, unit, item) and the steps in order. Only include minutes or servings the page states. effort: "quick" if it's about 30 minutes or less on a weeknight, else "regular". make_ahead: true if it can be made earlier in the day or the night before. protein: the main protein in a few words. tags: up to 4 short words to find it by. If the page has no recipe, return an empty list.`,
    DRAFT_SCHEMA, { urls: true, timeoutMs: 40_000 }, // with the 10 s the page had: inside the route's 60 s
  );
  return (data.recipes ?? []).filter((r) => r.name?.trim() && r.ingredients?.length).slice(0, 1).map((r) => ({
    name: r.name.trim(), effort: effortFor(r.minutes, r.effort), minutes: r.minutes || null, serves: r.serves || null,
    protein: (r.protein ?? "").toLowerCase(), ingredients: r.ingredients.map((l) => l.trim()).filter(Boolean), steps: (r.steps ?? []).map((x) => x.trim()).filter(Boolean),
    store: "", season: [], for: asFor(r.for ?? ""), kidOk: "", makeAhead: Boolean(r.make_ahead), tags: (r.tags ?? []).map((t) => t.toLowerCase()).slice(0, 6), source: url, rating: null, notes: "",
  }));
}

/** Many short lines with no amounts or steps: a list of meal ideas ("Tacos", "Salmon and broccoli"), one recipe each. */
export function looksLikeIdeas(text: string): string[] | null {
  const ls = lines(text);
  // One or two short names are ideas too ("Chicken stir fry" alone read as a recipe and failed, Nov 3).
  if (!ls.length || ls.length > 300) return null;
  const idea = (l: string) => l.length <= 50 && !/^[\d½¼¾⅓⅔]/.test(l) && !/:\s*$|\b(cups?|tbsp|tsp|teaspoons?|tablespoons?|oz|lbs?|minutes|preheat|stir(?![ -]?fr(?:y|ied))|bake|heat)\b/i.test(l); // "stir fry" is a dish, "stir" a step
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

/** Every number in a text, fractions written as glyphs included ("1½" → 1, 1/2). */
const numbersIn = (s: string) => plainFractions(s).match(/\d+(?:[./]\d+)?/g) ?? [];
/** A leading amount, then its unit only if it is one ("3 chicken breasts" keeps its chicken), and "of". */
const AMOUNT = new RegExp(String.raw`^(?:\(?[\d\s./-]+\)?\s*)+(?:(?:${Object.keys(UNIT_NAMES).filter((w) => w.length > 1).sort((a, b) => b.length - a.length).join("|")})\.?\s+)?(?:of\s+)?`, "i");

/**
 * Checked by code: a number of minutes, servings or an amount must appear in the source text (never invented; Nov 19:
 * fractions were let through whatever the text said), so an amount the model added is dropped, with its unit, and the
 * ingredient kept; empty lines go.
 */
export function checkAgainst(source: string, r: ModelRecipe, src: string): Draft {
  const nums = new Set(numbersIn(source));
  const has = (n: number | undefined) => (n && nums.has(String(n)) ? n : null);
  const ingredients = r.ingredients.map((l) => l.trim()).filter(Boolean).map((l) =>
    numbersIn(l).every((a) => nums.has(a)) ? l : plainFractions(l).replace(AMOUNT, "").trim() || l);
  const minutes = has(r.minutes);
  return {
    name: r.name.trim(), effort: effortFor(minutes, r.effort), minutes, serves: has(r.serves),
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
/** The type as Gemini knows it: some phones and browsers say image/jpg. */
const typeOf = (t: string) => (t === "image/jpg" || t === "image/pjpeg" ? "image/jpeg" : t);

/**
 * Reads the recipes in a picture (a screenshot, a photo of a card or a cookbook page) or a PDF. The model writes out
 * each recipe's text as it appears, and the amounts and times it reports are checked against that text, as with typed
 * recipes; anything it couldn't read stays blank for her.
 */
export async function readRecipeFile(file: { name: string; mimeType: string; data: string }): Promise<Draft[]> {
  const f = { ...file, mimeType: typeOf(file.mimeType) };
  // A picture is "Photo": its file name is the camera's (IMG_0045), not where the recipe came from (Nov 18).
  const src = f.mimeType.startsWith("image/") ? "Photo" : f.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "File";
  if (/^text\//.test(f.mimeType)) return readText(Buffer.from(f.data, "base64").toString("utf8"), src);
  if (!READABLE.test(f.mimeType)) throw new AppError("Use a picture, a PDF or a text file.");
  const schema = structuredClone(DRAFT_SCHEMA) as typeof DRAFT_SCHEMA & { properties: { recipes: { items: { properties: Record<string, unknown>; required: string[] } } } };
  schema.properties.recipes.items.properties.text = { type: "STRING" };
  schema.properties.recipes.items.required.push("text");
  const { data } = await generateJson<{ recipes: (ModelRecipe & { text: string })[] }>(
    `Read every recipe in this ${f.mimeType === "application/pdf" ? "document" : "picture"} into structured form. For each: text is the recipe's own words as they appear (the title, ingredient lines and steps), copied exactly; then the same recipe in fields. Copy ingredient lines as written; only include minutes or servings it states. If a part is unreadable, leave it out rather than guess. effort: "quick" if it's about 30 minutes or less on a weeknight, else "regular". make_ahead: true if it can be made earlier in the day or the night before. for: "kids" for a children's dinner, else "everyone". protein: the main protein in a few words. tags: up to 4 short words. If there's no recipe, return an empty list.`,
    schema, { files: [{ mimeType: f.mimeType, data: f.data }], timeoutMs: 50_000 },
  );
  return (data.recipes ?? []).filter((r) => r.name?.trim()).slice(0, 60).map((r) => checkAgainst(r.text ?? "", r, src));
}

/** Meal ideas ("Tacos") become recipes that are just a name and a guessed effort: enough to plan with. */
export async function guessIdeas(names: string[], src: string): Promise<Draft[]> {
  const [drafts, lists] = await Promise.all([guessEffort(names, src), ingredientLists(names)]);
  return drafts.map((d, i) => ({ ...d, ingredients: lists[i] }));
}

/**
 * A short plain ingredient list for each idea (Nov 3), so an idea can go on the grocery list. Any failure leaves the lists
 * empty: the idea is saved anyway and reads "No ingredients yet" until she adds them.
 */
async function ingredientLists(names: string[]): Promise<string[][]> {
  try {
    if (!(await withinCap("read"))) return names.map(() => []);
    const { text, restore } = await privately(names.join("\n"));
    const { data } = await generateJson<{ ideas: { name: string; ingredients: string[] }[] }>(
      `Each line is a family dinner idea. For each, in the same order and with the name exactly as written, write a short plain ingredient list for a typical family version: 5 to 10 lines, each an amount and an item ("1 lb ground turkey", "2 lemons"), no steps.\n\n${text}`,
      { type: "OBJECT", properties: { ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, ingredients: { type: "ARRAY", items: { type: "STRING" } } }, required: ["name", "ingredients"] } } }, required: ["ideas"] },
      { light: true, timeoutMs: 15_000 },
    );
    const by = new Map((data.ideas ?? []).map((g) => [norm(restore(g.name)), g]));
    return names.map((n, i) => ((by.get(norm(n)) ?? data.ideas?.[i])?.ingredients ?? []).map((l) => restore(String(l)).replace(/\s+/g, " ").trim().slice(0, 100)).filter(Boolean).slice(0, 14));
  } catch (e) {
    console.error("couldn't write ingredients for ideas", e);
    return names.map(() => []);
  }
}

async function guessEffort(names: string[], src: string): Promise<Draft[]> {
  const bare = (name: string, effort: Effort, makeAhead = false, forWho: For = "everyone"): Draft => ({
    name, effort, minutes: null, serves: null, protein: "", ingredients: [], steps: [], store: "", season: [], for: forWho, kidOk: "", makeAhead, tags: [], source: src, rating: null, notes: "",
  });
  try {
    if (!(await withinCap("read"))) return names.map((n) => bare(n, "regular"));
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
  if (!stepsText || !(await withinCap("read"))) return d;
  try {
    const { data } = await generateJson<{ effort: string; make_ahead: boolean }>(
      `A family dinner recipe, "${d.name}". Steps: ${stepsText.slice(0, 4000)}\nIs it "quick" (about 30 minutes or less on a weeknight) or "regular"? Can it be made ahead (earlier in the day or the night before)?`,
      { type: "OBJECT", properties: { effort: { type: "STRING", enum: ["quick", "regular"] }, make_ahead: { type: "BOOLEAN" } }, required: ["effort", "make_ahead"] },
      { light: true, timeoutMs: 10_000 },
    );
    return { ...d, effort: data.effort === "quick" ? "quick" : "regular", makeAhead: Boolean(data.make_ahead) };
  } catch { return d; }
}
