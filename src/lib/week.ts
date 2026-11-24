// Planning's plain rules, shared by the server and the phone: the kinds, what a recipe is planned as, freezer matches and
// what lunches need. Simmer doesn't pick meals (Nov 10); the old picking rules were removed Nov 14. Nothing here reads the Sheet.
// Meals and lunches are planned by number, not by day (Nov 3): "2 quick, 3 regular, 5 lunches each", made in any order.
import type { Recipe } from "./recipes";
import { norm } from "./words";

/** The kinds of things planned. Quick and regular are the family's dinners; kids are the boys' own dinners. */
export const KINDS = ["quick", "regular", "kids", "dessert", "side", "breakfast", "lunchmeal"] as const;
export type Kind = (typeof KINDS)[number];
/** `lunchmeal`: a lunch planned for a day (Sam, Nov 16: "keep lunch as an option", for holidays and breaks). */
export const KIND_NAMES: Record<Kind, string> = { quick: "Quick", regular: "Regular", kids: "Kids'", dessert: "Dessert", side: "Side", breakfast: "Breakfast", lunchmeal: "Lunch" };

/**
 * One thing to make. recipe: a recipe id, or free text ("Dinner with G&G"). day: the day it's for, YYYY-MM-DD (Nov 16:
 * Meals is a list of days); "" for one planned before days existed.
 */
export type Dish = { id: string; kind: Kind; recipe: string; pinned: boolean; added: string; day?: string };

/**
 * Old meal plans are kept (Sam, Nov 24: "past and shopped-for meals stay on Meals with their text dimmed"): a meal is
 * dimmed once it's shopped for (New plan gave it a made date) or its day has passed. Answers whether it's dimmed.
 */
export function isOld(d: { made?: string; day?: string }, today: string): boolean {
  return Boolean(d.made) || Boolean(d.day && d.day < today);
}

/**
 * A recipe since deleted, still named on an old meal (Nov 24: "pumpkin-pie-recipe-pq0c5d" showed as it is): its name
 * from the id ("Pumpkin pie recipe"). Free text she typed ("Dinner with G&G") stays as it is.
 */
export function plainName(id: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id)) return id;
  const words = id.replace(/-(?=[a-z0-9]*\d)[a-z0-9]{6,18}$/, "").replace(/-\d+$/, "").replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Whether a meal's things still belong on the list (Stock keeps what waits for it): until it's shopped for, and while
 * its day is still to come. One put on a day that had already passed (added after it) keeps them till the next New
 * plan (Sam, Nov 24: "any new meal goes on the list whatever its day").
 */
export function onTheList(d: { made?: string; day?: string; added?: string }, today: string): boolean {
  if (d.made) return false;
  return !d.day || d.day >= today || Boolean(d.added && d.added > d.day);
}

/** How many of each to plan, and how many lunches for each boy. */
export type Counts = Record<Kind, number> & { lunches: Record<string, number> };
export const MAX_COUNT = 14;
/** The first time: a usual week. Desserts, sides and breakfasts start at none. */
export const firstCounts = (kids: string[], kidsDinners: boolean): Counts => ({
  quick: 2, regular: 3, kids: kidsDinners ? 1 : 0, dessert: 0, side: 0, breakfast: 0, lunchmeal: 0, lunches: Object.fromEntries(kids.map((k) => [k, 5])),
});

/** Not a dinner: a recipe tagged as dessert, a side, breakfast, a snack or a drink (the pumpkin pie was Tuesday's dinner, Nov 3). */
const NOT_DINNER = /^(desserts?|sides?|side dish(es)?|breakfast|brunch|snacks?|drinks?|beverages?|cocktails?|appetizers?|baking|condiments?|sauces?)$/;
const isDinner = (r: Pick<Recipe, "tags">) => !r.tags.some((t) => NOT_DINNER.test(norm(t)));

/**
 * What a recipe is planned as: dessert, side or breakfast by its tags, else the boys' own dinner (for: kids), else a quick
 * or regular dinner by its effort. Snacks, drinks and sauces are never planned (snacks live in Stock).
 */
export function kindOf(r: Pick<Recipe, "tags" | "for" | "effort">): Kind | null {
  const tags = r.tags.map(norm);
  if (tags.some((t) => /^desserts?$/.test(t))) return "dessert";
  if (tags.some((t) => /^(sides?|side dish(es)?)$/.test(t))) return "side";
  if (tags.some((t) => /^(breakfast|brunch)$/.test(t))) return "breakfast";
  if (tags.some((t) => /^lunch(es)?$/.test(t))) return "lunchmeal";
  if (!isDinner(r)) return null;
  return r.for === "kids" ? "kids" : r.effort;
}

// ---- the freezer and tastes

/** Something in the freezer. */
export type Frozen = { id: string; item: string; amount: string; added: string; store: string };
/** Does a freezer item ("salmon fillets") stand for an ingredient ("1 1/2 lb salmon")? Either name inside the other. */
export const freezerMatch = (frozen: string, ingredient: string) => {
  const a = norm(frozen), b = norm(ingredient);
  return a.length > 2 && b.length > 2 && (a.includes(b) || b.includes(a) || a.split(" ").some((w) => w.length > 3 && b.split(" ").includes(w) && !["chicken", "ground", "frozen"].includes(w)) || a === b);
};

export type Taste = { name: string; isAdult: boolean; likes: string[]; dislikes: string[] };

// ---- the boys' lunches

export const LUNCH_PARTS = ["main", "fruit", "side", "treat", "snack"] as const;
export type LunchPart = (typeof LUNCH_PARTS)[number];
export type LunchOption = { kid: string; part: LunchPart; item: string; ingredients: string[] };
/** One lunch to pack. */
export type Lunch = { id: string; kid: string } & Record<LunchPart, string>;

/** What lunches need from the store: each part's ingredients (or the part itself), once each. */
export function lunchShopping(lunches: Pick<Lunch, "kid" | LunchPart>[], options: LunchOption[]): string[] {
  const out = new Map<string, string>();
  for (const l of lunches) for (const p of LUNCH_PARTS) {
    if (!l[p]) continue;
    const o = options.find((x) => norm(x.kid) === norm(l.kid) && x.part === p && norm(x.item) === norm(l[p]));
    for (const it of o?.ingredients.length ? o.ingredients : [l[p]]) out.set(norm(it), it);
  }
  return [...out.values()];
}
