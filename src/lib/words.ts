// Text helpers shared by the server and the phone (nothing here touches the server's files or services).
import type { Section, Store } from "./groceries";
import type { Ingredient } from "./recipes";

/** The words for an item, the same however it's typed ("Lemons", "lemon"), for matching and merging. */
// Nov 19: accents are dropped, not spaced ("jalapeño" was "jalape o"), an apostrophe joins ("joe's" is "joes"), and
// "-ie" ends like "-ies" (cookies was "cooky" but cookie stayed "cookie"; brownies, smoothies, veggies too).
export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/(?<=[a-z]{2})ies?$/, "y").replace(/(?<=[a-z]{2}(?:ss|x|z|ch|sh|o))es$/, "").replace(/(?<=[a-z]{2}[^s])s$/, "");

// Spices and dried herbs: what the house nearly always has, so a recipe's go to "Check you have these", not "To buy".
const SPICES = new Set(("salt cumin paprika oregano cinnamon nutmeg turmeric tumeric coriander cayenne allspice cardamom peppercorn " +
  "clove anise saffron sumac marjoram tarragon fenugreek masala spice seasoning zaatar adobo").split(" "));
/** Things that are spices only in some phrases: "chili powder" but not "baking powder", "black pepper" but not "bell pepper". */
const SPICE_PHRASES = /\b(?:chil[ei] powder|garlic powder|onion powder|curry powder|mustard powder|ground (?:ginger|mustard|pepper)|(?:black|white|cracked|ground) pepper|pepper flake|chil[ei] flake|red pepper flake|crushed red pepper|(?:fennel|cumin|mustard|celery|caraway|coriander) seed|garlic salt|onion salt|celery salt|five spice|herbes de provence|bay lea(?:f|ves)|dried (?:\w+ )?(?:basil|thyme|rosemary|oregano|parsley|dill|sage|mint|chive|herb|chil[ei])|(?:basil|thyme|rosemary|parsley|dill|sage|mint) dried)s?\b/;
/** Not the spice, even with a spice word in it: cloves of garlic, sea salt chips, fresh coriander. */
const NOT_SPICE = /\b(?:garlic|fresh|chip|cracker|caramel|roll|bun|bread|pork|butter|water)s?\b/;

/** "1 tsp ground cumin", "Kosher Salt", "dried oregano", "salt and pepper" → true; "1 red bell pepper", "fresh thyme" → false. */
export function isSpice(name: string) {
  const n = name.toLowerCase().replace(/'/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (SPICE_PHRASES.test(n) || /^(?:salt (?:and|n) )?pepper$/.test(n)) return true;
  const ws = n.split(" ").map((w) => norm(w));
  // "whole cloves" are a spice, "2 cloves garlic" aren't.
  if (NOT_SPICE.test(n)) return false;
  return ws.some((w) => SPICES.has(w));
}

// ---- amounts: one list of units and fractions for typed items and recipe lines (Nov 19: typed items knew only weights
// and volumes, so "2 cans black beans" was the thing "cans black beans").

/** Every spelling of a unit → one name ("lbs", "pounds" → lb). T is a tablespoon and t a teaspoon. */
export const UNIT_NAMES: Readonly<Record<string, string>> = Object.fromEntries(([
  ["cup", "cups c"], ["tbsp", "tablespoon tablespoons tbsps T"], ["tsp", "teaspoon teaspoons tsps t"], ["lb", "lbs pound pounds"],
  ["oz", "ounce ounces"], ["g", "gram grams"], ["kg", "kilogram kilograms"], ["ml", "milliliter milliliters"], ["l", "liter liters litre litres"],
  ["quart", "quarts qt qts"], ["pint", "pints pt pts"], ["gallon", "gallons gal gals"], ["can", "cans"], ["jar", "jars"],
  ["package", "packages pkg pkgs"], ["bag", "bags"], ["box", "boxes"], ["bunch", "bunches"], ["head", "heads"], ["clove", "cloves"],
  ["stick", "sticks"], ["slice", "slices"], ["pinch", "pinches"], ["dash", "dashes"], ["sprig", "sprigs"], ["stalk", "stalks"],
  ["handful", "handfuls"], ["container", "containers"], ["bottle", "bottles"], ["carton", "cartons"], ["packet", "packets"],
  ["envelope", "envelopes"], ["pouch", "pouches"], ["loaf", "loaves"], ["dozen", ""],
] as const).flatMap(([name, more]) => [name, ...more.split(" ").filter(Boolean)].map((w) => [w, name])));
/** The units as a regex alternative, longest first. A typed item leaves out the one-letter ones but g ("2 t-shirts"). */
const unitsRe = (ws: string[]) => [...new Set(ws.map((w) => w.toLowerCase()))].sort((a, b) => b.length - a.length).join("|");
const UNITS = unitsRe(Object.keys(UNIT_NAMES));
const TYPED_UNITS = unitsRe(Object.keys(UNIT_NAMES).filter((w) => w.length > 1 || w === "g"));

export const FRACTIONS: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅐": "1/7", "⅑": "1/9", "⅒": "1/10" };
/** "1½ cups" → "1 1/2 cups", "⅜ tsp" → "3/8 tsp". */
const plainFractions = (s: string) => s.replace(new RegExp(`[${Object.keys(FRACTIONS).join("")}]`, "g"), (f) => ` ${FRACTIONS[f]}`)
  .replace(/(\d)\s+(\d+\/)/, "$1 $2").replace(/\s+/g, " ").trim();

const ENTRY = new RegExp(String.raw`^((?:\d+\s+\d+/\d+|\d+(?:\.\d+)?|\d+/\d+)(?:\s*(?:${TYPED_UNITS})\.?(?=\s))?|a dozen|dozen|a couple|a few)\s+(.+)$`, "i");

/** "2 lemons" → 2, lemons; "2 lb ground beef" → 2 lb, ground beef; "1 1/2 lb beef" → 1 1/2 lb, beef; "lemons x2" → 2, lemons; "TP" → TP. */
export function parseEntry(text: string): { item: string; quantity: string } {
  const t = plainFractions(text);
  const lead = t.match(ENTRY);
  if (lead) return { quantity: lead[1].toLowerCase().replace(/^a /, ""), item: lead[2] };
  const tail = t.match(/^(.+?)\s*(?:x|×)\s*(\d+)$/i);
  if (tail) return { quantity: tail[2], item: tail[1] };
  return { quantity: "", item: t };
}

// ---- filing: which store and section an item goes in (the phone files a stand-in row with it until the server answers)

/**
 * Common things, so most items are filed without asking anyone (spices first, by isSpice in words.ts). Entries are
 * phrases, comma-separated: "ice cream" and "peanut butter" are whole, so cream stays fresh and butter isn't pantry (split
 * into words they filed cream as freezer and milk as pantry, Nov 3). A stem like "strawberr" matches the word's start.
 */
const KNOWN_LIST: [string, [Store, Section]][] = ([
  ["milk, egg, yogurt, butter, cheese, cream, sour cream, half and half, banana, apple, orange, lemon, lime, grape, strawberr, raspberr, blueberr, berry, avocado, tomato, onion, garlic, potato, carrot, celery, lettuce, spinach, broccoli, cucumber, bell pepper, orange juice, cilantro, parsley, fresh basil, herb, bread, tortilla, ground beef, ground turkey, chicken, salmon, fish, shrimp, bacon, ham, deli, turkey, salad, zucchini, squash, mushroom, kale, cabbage, ginger root, jalapeno, scallion, green onion, mint, thyme, rosemary, dill, shallot, leek, asparagus, green bean, pork, sausage, steak, tofu, mozzarella, parmesan, cheddar, feta, ricotta, hummus, pie crust", "safeway", "fresh"],
  ["rice, pasta, spaghetti, penne, macaroni, lasagna noodle, flour, bread flour, dressing, salad dressing, cornmeal, corn meal, polenta, sugar, salt, oil, olive oil, vinegar, cereal, oat, oatmeal, peanut butter, jam, jelly, honey, cracker, goldfish, chip, pretzel, snack, granola, granola bar, canned, broth, stock, soup, sauce, paste, curry paste, juice, lemon juice, lime juice, powder, cocoa powder, dried, salsa, ketchup, mustard, mayo, spice, coffee, tea, cumin, paprika, oregano, chili powder, cinnamon, vanilla, baking soda, baking powder, breadcrumb, panko, soy sauce, coconut milk, evaporated milk, condensed milk, tomato paste, tomato sauce, crushed tomato, diced tomato, noodle, quinoa, lentil, chickpea, black bean, refried bean, kidney bean, pinto bean, brown sugar, corn syrup, seasoning, taco seasoning, pecan, walnut, almond", "safeway", "pantry"],
  ["frozen, ice cream, nugget, frozen pizza, frozen vegetable", "safeway", "freezer"],
  ["toilet paper, tp, paper towel, napkin, soap, detergent, dish soap, trash bag, foil, plastic wrap, sponge, tissue, shampoo, toothpaste", "costco", "household"],
] as const).flatMap(([words, st, sec]) => words.split(",").map((w): [string, [Store, Section]] => [w.trim(), [st, sec]]));

/** The entries by their norm, and those long enough to match inside a name, longest first (worked out once, Nov 19). */
const BY_NORM = new Map(KNOWN_LIST.map(([w, f]) => [norm(w), f]));
const PARTIAL = [...BY_NORM].filter(([w]) => w.length > 2).sort((x, y) => y[0].length - x[0].length);
/**
 * What it's in or how it's kept says where it goes more than what it's made of (Nov 19: chicken broth, tomato soup,
 * canned tomatoes and lemon juice were filed as fresh, the longer word winning).
 */
const KEPT = /\b(?:broth|stock|soup|canned|juice|sauce|paste|powder|dried|frozen)\b/;

export function known(name: string): { store: Store; section: Section } | null {
  // Spices first: "ground cumin" isn't ground beef, "black pepper" isn't a bell pepper.
  if (isSpice(name)) return { store: "safeway", section: "pantry" };
  const n = norm(name);
  // The longest entry that matches from the start of a word wins: "goldfish crackers" is goldfish (pantry), not fish
  // (fresh); "graham crackers" isn't ham. One with a KEPT word wins over one without.
  const hits = BY_NORM.has(n) ? [] : PARTIAL.filter(([w]) => ` ${n} `.includes(` ${w}`));
  const hit = BY_NORM.get(n) ?? (KEPT.test(n) ? hits.find(([w]) => KEPT.test(w)) : undefined)?.[1] ?? hits[0]?.[1];
  return hit ? { store: hit[0], section: hit[1] } : null;
}

// ---- ingredient lines (the phone reads them too, so a recipe shows its ingredients before the server answers)

// Nov 19: a range can have an en or em dash ("2–3 cloves garlic").
const LINE = new RegExp(String.raw`^((?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)(?:\s*(?:-|–|—|to)\s*(?:\d+/\d+|\d+(?:\.\d+)?))?|an?|one|two|three|four)\s+(?:\((?:[^)]*)\)\s*)?(?:(${UNITS})\.?\s+(?:of\s+)?)?(.+)$`, "i");

/** "1 lb ground turkey" → 1, lb, ground turkey; "1/2 cup onion, diced" → 1/2, cup, onion; "Salt to taste" → salt. */
/** Sizes and cuts before the name ("large", "chopped", "skinless, boneless"), as many as there are. */
const LEADING = /^(?:(?:extra[- ]large|small|medium|large|jumbo|skinless|boneless|bone-in|skin-on|chopped(?!\s+(?:tomato|spinach|clam))|diced(?!\s+(?:tomato|green chile|chile))|minced(?!\s+(?:clam))|finely|roughly|coarsely|thinly|peeled)\s*,?\s+)+/i;

/** Dishes and flavours named with "and" (Nov 19: macaroni and cheese, salt and vinegar chips were split). */
const ONE_THING = /^(?:mac(?:aroni)? and cheese|salt and vinegar|bread and butter|fish and chip|cookies and cream|peaches and cream|pork and bean|franks and bean|sweet and sour|biscuits and gravy|chicken and (?:dumpling|rice|waffle)|spaghetti and meatball|shrimp and grit|surf and turf|peanut butter and jelly)/;
/**
 * One line that's two things to buy: "salt and black pepper" is salt and black pepper, when each half is a whole known
 * thing or a spice (Nov 19: not just a word of one, so "bread and butter pickles" stays one). Anything else stays one.
 */
export function bothOf(item: string): string[] {
  const n = norm(item.replace(/&/g, " and "));
  if (BY_NORM.has(n) || ONE_THING.test(n)) return [item];
  const m = item.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  const plain = (s: string) => BY_NORM.has(norm(s)) || isSpice(s);
  return m && plain(m[1]) && plain(m[2]) ? [m[1].trim(), m[2].trim()] : [item];
}

/**
 * One name for one thing on the list (Nov 18: cumin and ground cumin, red pepper flakes and crushed red pepper were two
 * lines each): a spice without "ground", and a few names that mean the same.
 */
const SAME: Record<string, string> = { "crushed red pepper": "red pepper flakes", "red chili powder": "chili powder", "kosher salt": "salt", "sea salt": "salt", "garlic cloves": "garlic", "garlic clove": "garlic", "cloves garlic": "garlic", "extra-virgin olive oil": "olive oil", "extra virgin olive oil": "olive oil" };
export function listName(item: string): string {
  const n = item.trim().toLowerCase();
  const plain = isSpice(n) && /^ground\s+/.test(n) && !/pepper$/.test(n) ? n.replace(/^ground\s+/, "") : n;
  return SAME[plain] ?? plain;
}

/** The amount on a second choice: "or 2 tbsp peanut butter" (Nov 19: a plain regex left ${UNITS} unread, so it was "tbsp peanut butter"). */
const OR_AMOUNT = new RegExp(String.raw`^\d[\d/ ]*\s*(?:(?:${UNITS})\.?\s+(?:of\s+)?)?`, "i");

export function parseIngredient(raw: string): Ingredient {
  const line = plainFractions(raw)
    // Typed the way people write cards (Nov 18): "Optional: dressing", "a little ginger", "2c cheese".
    .replace(/^optional\s*:\s*(?:add\s+)?/i, "").replace(/^(?:a little|a bit of|a few|a splash of|a drizzle of|some)\s+/i, "")
    .replace(/^(\d+(?:\/\d+)?)(c|T|t|tbsp|tsp|oz|lbs?|g|kg|ml)\.?\s/, "$1 $2 ");
  const m = line.match(LINE);
  let quantity = "", unit = "", item = line;
  // T is a tablespoon and t a teaspoon, so the case counts before it's lowered.
  if (m) { quantity = m[1].toLowerCase().replace(/^(an?|one)$/, "1").replace(/^two$/, "2").replace(/^three$/, "3").replace(/^four$/, "4"); unit = m[2] === "T" ? "tbsp" : m[2] === "t" ? "tsp" : /^c$/i.test(m[2] ?? "") ? "cup" : (m[2] ?? "").toLowerCase(); item = m[3]; }
  // "15 ounce can pumpkin": the size came first, so the container is still on the name.
  if (unit) item = item.replace(/^(?:cans?|jars?|packages?|pkgs?|bags?|boxes|box|containers?|bottles?|cartons?)\s+(?:of\s+)?/i, "");
  // What's bought, not how it's cut: "onion, diced" → onion; "garlic (minced)" → garlic; "salt to taste" → salt.
  // What's bought, without its size or how it's cut (Nov 18: "large onion" and "onion" were two lines; "8 skinless,
  // boneless chicken thighs" came out "skinless"). One choice of two: "red wine or balsamic vinegar" is the first, and
  // "refrigerated or frozen tortellini" the tortellini.
  item = item.replace(/\([^)]*\)/g, "").replace(LEADING, "");
  const or = item.split(/,| - | – /)[0].match(/^(.+?)\s+or\s+(.+)$/i);
  if (or) item = !/\s/.test(or[1].trim()) && /\s/.test(or[2].trim()) && !known(or[1]) ? or[2].replace(OR_AMOUNT, "") : or[1];
  item = item.replace(LEADING, "").split(/,| - | – /)[0].replace(/\b(to taste|as needed|optional|for serving|divided|of choice)\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  return { line: raw.trim(), quantity, unit, item: item || line.toLowerCase(), section: known(item)?.section ?? "fresh" };
}
