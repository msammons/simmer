// Text helpers shared by the server and the phone (nothing here touches the server's files or services).
import type { Section, Store } from "./groceries";
import type { Ingredient } from "./recipes";

/** The words for an item, the same however it's typed ("Lemons", "lemon"), for matching and merging. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/(?<=[a-z]{2})ies$/, "y").replace(/(?<=[a-z]{2}(?:ss|x|z|ch|sh|o))es$/, "").replace(/(?<=[a-z]{2}[^s])s$/, "");

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

/** "2 lemons" → 2, lemons; "2 lb ground beef" → 2 lb, ground beef; "1 1/2 lb beef" → 1 1/2 lb, beef; "lemons x2" → 2, lemons; "TP" → TP. */
export function parseEntry(text: string): { item: string; quantity: string } {
  const t = text.trim().replace(/\s+/g, " ");
  const lead = t.match(/^((?:\d+\s+\d+\/\d+|\d+(?:\.\d+)?|\d+\/\d+)(?:\s*(?:lbs?|pounds?|oz|ounces?|gallons?|gal|quarts?|pints?|liters?|kg|g)\.?(?=\s))?|a dozen|dozen|a couple|a few)\s+(.+)$/i);
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
const KNOWN: Record<string, [Store, Section]> = Object.fromEntries(([
  ["milk, egg, yogurt, butter, cheese, cream, sour cream, half and half, banana, apple, orange, lemon, lime, grape, strawberr, raspberr, blueberr, berry, avocado, tomato, onion, garlic, potato, carrot, celery, lettuce, spinach, broccoli, cucumber, bell pepper, cilantro, parsley, fresh basil, herb, bread, tortilla, ground beef, ground turkey, chicken, salmon, fish, shrimp, bacon, ham, deli, turkey, salad, zucchini, squash, mushroom, kale, cabbage, ginger root, jalapeno, scallion, green onion, mint, thyme, rosemary, dill, shallot, leek, asparagus, green bean, pork, sausage, steak, tofu, mozzarella, parmesan, cheddar, feta, ricotta, hummus, pie crust", "safeway", "fresh"],
  ["rice, pasta, spaghetti, penne, macaroni, lasagna noodle, flour, bread flour, dressing, salad dressing, cornmeal, corn meal, polenta, sugar, salt, oil, olive oil, vinegar, cereal, oat, oatmeal, peanut butter, jam, jelly, honey, cracker, goldfish, chip, pretzel, snack, granola, granola bar, canned, broth, stock, soup, sauce, salsa, ketchup, mustard, mayo, spice, coffee, tea, cumin, paprika, oregano, chili powder, cinnamon, vanilla, baking soda, baking powder, breadcrumb, panko, soy sauce, coconut milk, evaporated milk, condensed milk, tomato paste, tomato sauce, crushed tomato, diced tomato, noodle, quinoa, lentil, chickpea, black bean, refried bean, kidney bean, pinto bean, brown sugar, corn syrup, seasoning, taco seasoning, pecan, walnut, almond", "safeway", "pantry"],
  ["frozen, ice cream, nugget, frozen pizza, frozen vegetable", "safeway", "freezer"],
  ["toilet paper, tp, paper towel, napkin, soap, detergent, dish soap, trash bag, foil, plastic wrap, sponge, tissue, shampoo, toothpaste", "costco", "household"],
] as const).flatMap(([words, st, sec]) => words.split(",").map((w) => [w.trim(), [st, sec]])));

export function known(name: string): { store: Store; section: Section } | null {
  // Spices first: "ground cumin" isn't ground beef, "black pepper" isn't a bell pepper.
  if (isSpice(name)) return { store: "safeway", section: "pantry" };
  const n = norm(name);
  // The longest entry that matches from the start of a word wins: "goldfish crackers" is goldfish (pantry), not fish
  // (fresh); "graham crackers" isn't ham.
  const at = (w: string) => ` ${n} `.includes(` ${norm(w)}`);
  const hit = KNOWN[n] ?? Object.entries(KNOWN).filter(([w]) => w.length > 2 && at(w)).sort((x, y) => y[0].length - x[0].length)[0]?.[1];
  return hit ? { store: hit[0], section: hit[1] } : null;
}

// ---- ingredient lines (the phone reads them too, so a recipe shows its ingredients before the server answers)

export const FRACTIONS: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8" };
const UNITS = "cups?|c|tablespoons?|tbsps?|tbsp|T|teaspoons?|tsps?|tsp|t|pounds?|lbs?|ounces?|oz|grams?|g|kilograms?|kg|ml|liters?|l|quarts?|qt|pints?|pt|cans?|jars?|packages?|pkgs?|bags?|boxes|box|bunch(?:es)?|heads?|cloves?|sticks?|slices?|pinch(?:es)?|dash(?:es)?|sprigs?|stalks?|handfuls?|containers?|bottles?|packets?|envelopes?|pouch(?:es)?|loaf|loaves|dozen";
const LINE = new RegExp(String.raw`^((?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)(?:\s*(?:-|to)\s*(?:\d+/\d+|\d+(?:\.\d+)?))?|an?|one|two|three|four)\s+(?:\((?:[^)]*)\)\s*)?(?:(${UNITS})\.?\s+(?:of\s+)?)?(.+)$`, "i");

/** "1 lb ground turkey" → 1, lb, ground turkey; "1/2 cup onion, diced" → 1/2, cup, onion; "Salt to taste" → salt. */
/** Sizes and cuts before the name ("large", "chopped", "skinless, boneless"), as many as there are. */
const LEADING = /^(?:(?:extra[- ]large|small|medium|large|jumbo|skinless|boneless|bone-in|skin-on|chopped(?!\s+(?:tomato|spinach|clam))|diced(?!\s+(?:tomato|green chile|chile))|minced(?!\s+(?:clam))|finely|roughly|coarsely|thinly|peeled)\s*,?\s+)+/i;

/**
 * One line that's two things to buy: "salt and black pepper" is salt and black pepper, when each is something known
 * (never "half and half" or "mac and cheese"). Anything else stays one.
 */
export function bothOf(item: string): string[] {
  if (KNOWN[norm(item)]) return [item];
  const m = item.match(/^(.+?)\s+(?:and|&)\s+(.+)$/i);
  return m && known(m[1]) && known(m[2]) ? [m[1].trim(), m[2].trim()] : [item];
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

export function parseIngredient(raw: string): Ingredient {
  const line = raw.replace(/[½¼¾⅓⅔⅛]/g, (f) => ` ${FRACTIONS[f]}`).replace(/(\d)\s+(\d\/)/, "$1 $2").replace(/\s+/g, " ").trim()
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
  if (or) item = !/\s/.test(or[1].trim()) && /\s/.test(or[2].trim()) && !known(or[1]) ? or[2].replace(/^\d[\d/ ]*\s*(?:(?:${UNITS})\.?\s+)?/i, "") : or[1];
  item = item.replace(LEADING, "").split(/,| - | – /)[0].replace(/\b(to taste|as needed|optional|for serving|divided|of choice)\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
  return { line: raw.trim(), quantity, unit, item: item || line.toLowerCase(), section: known(item)?.section ?? "fresh" };
}
