// Text helpers shared by the server and the phone (nothing here touches the server's files or services).

/** The words for an item, the same however it's typed ("Lemons", "lemon"), for matching and merging. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/(?<=[a-z]{2})ies$/, "y").replace(/(?<=[a-z]{2}(?:ss|x|z|ch|sh|o))es$/, "").replace(/(?<=[a-z]{2}[^s])s$/, "");

// Spices and dried herbs: what the house nearly always has, so a recipe's go to "Check you have these", not "To buy".
const SPICES = new Set(("salt cumin paprika oregano cinnamon nutmeg turmeric coriander cayenne allspice cardamom peppercorn " +
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
