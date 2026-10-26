// Planning the week (docs/PLAN.md, sections 4.2 and 4.9): plain code shared by the server and the phone, so the same week
// and collection always give the same suggestions, and swapping one is instant. Nothing here reads the Sheet.
import type { Recipe } from "./recipes";
import { addDays } from "./time";
import { norm } from "./words";

export type NightKind = "quick" | "regular" | "skip";
export type Night = {
  date: string; kind: NightKind;
  /** A recipe id, free text ("Dinner with G&G"), or blank (not picked yet). */
  meal: string;
  /** The boys' own dinner on a split night: a recipe id, free text or blank. */
  kidsMeal: string;
  away: string[]; split: boolean; pinned: boolean; plannedBy: string; made: "yes" | "no" | ""; notes: string;
};
export const emptyNight = (date: string, kind: NightKind = "regular"): Night => ({ date, kind, meal: "", kidsMeal: "", away: [], split: false, pinned: false, plannedBy: "", made: "", notes: "" });

/** "no Matt, kids separate" ↔ away Matt, split. "everyone" is neither. */
export const eatingText = (n: Pick<Night, "away" | "split">) => [...n.away.map((a) => `no ${a}`), n.split && "kids separate"].filter(Boolean).join(", ") || "everyone";
export function readEating(s: string): Pick<Night, "away" | "split"> {
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  return { away: parts.flatMap((p) => { const m = p.match(/^no\s+(.+)$/i); return m ? [m[1]] : []; }), split: parts.some((p) => /kids?\s+separate|split/i.test(p)) };
}

/** The Monday that starts the week a date is in. */
export function weekOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 Sunday
  return addDays(date, -((day + 6) % 7));
}
export const weekDates = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const monthName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

/** The common shapes, in one tap. Weeknights are Monday to Friday; weekends stay as they are. */
export type Shape = "2-quick-3-regular" | "all-quick" | "last-week";
export function applyShape(nights: Night[], shape: Shape, lastWeek: Night[] = []): Night[] {
  return nights.map((n, i) => {
    if (n.pinned) return n;
    if (shape === "last-week") { const was = lastWeek.find((x) => weekdayOf(x.date) === weekdayOf(n.date)); return was ? { ...n, kind: was.kind, away: was.away, split: was.split } : n; }
    const weeknight = weekdayOf(n.date) >= 1 && weekdayOf(n.date) <= 5;
    if (!weeknight) return n;
    // Two quick nights spread out (Monday and Thursday), the rest regular.
    return { ...n, kind: shape === "all-quick" || i === 0 || i === 3 ? "quick" : "regular" };
  });
}

// ---- suggestions

const SEASONS: Record<string, number[]> = { winter: [12, 1, 2], spring: [3, 4, 5], summer: [6, 7, 8], fall: [9, 10, 11], autumn: [9, 10, 11] };
const inSeason = (r: Recipe, date: string) => {
  const m = Number(date.slice(5, 7));
  return r.season.some((s) => SEASONS[s]?.includes(m));
};

export type Taste = { name: string; isAdult: boolean; likes: string[]; dislikes: string[] };
export type Context = {
  recipes: Recipe[];
  /** Recipe id → the last date it was made. */
  lastMade: Record<string, string>;
  people: Taste[];
  trips: { traderJoes: boolean; costco: boolean };
};
export type Option = { recipe: Recipe; score: number; why: string };

/** Does a dislike ("mushrooms") show up in the recipe, and the notes don't say how to work around it? */
const hasDislike = (r: Recipe, words: string[]) => words.some((w) => {
  const n = norm(w);
  if (!n) return false;
  const inIt = norm(r.name).includes(n) || r.ingredients.some((i) => norm(i.item).includes(n));
  return inIt && !norm(r.notes).includes(n);
});

/**
 * The recipes that fit one night, best first, with a few words on why. Code, not the model: effort matches (a quick
 * night never gets a regular meal), nothing made in the last 10 days or already in this week, variety with the night
 * before, the right store trips, forgotten favorites and the season lifted, the boys' tastes and who's away respected.
 */
export function rank(nights: Night[], at: number, ctx: Context, forKids = false): Option[] {
  const night = nights[at];
  const used = new Set(nights.flatMap((n, i) => (i === at ? [] : [n.meal, n.kidsMeal])).filter(Boolean));
  const byId = new Map(ctx.recipes.map((r) => [r.id, r]));
  const before = byId.get(nights[at - 1]?.meal ?? "");
  const kids = ctx.people.filter((p) => !p.isAdult);
  const away = ctx.people.filter((p) => night.away.some((a) => norm(a) === norm(p.name)));
  const out: Option[] = [];
  for (const r of ctx.recipes) {
    if (!r.active || used.has(r.id)) continue;
    if (forKids ? r.for !== "kids" : r.for === "kids" || r.effort !== night.kind) continue;
    if (r.store === "trader-joes" && !ctx.trips.traderJoes) continue;
    if (r.store === "costco" && !ctx.trips.costco) continue;
    const last = ctx.lastMade[r.id];
    const ago = last ? daysBetween(last, night.date) : null;
    if (ago !== null && ago >= 0 && ago < (forKids ? 4 : 10)) continue;
    const why: [number, string][] = [];
    let score = (r.rating ?? 1.5) * 0.8;
    if (!forKids) {
      if ((r.rating ?? 0) >= 2 && ago !== null && ago > 60) { score += 2; why.push([2, `You haven't made this since ${monthName(last!)}`]); }
      if (r.season.length) { if (inSeason(r, night.date)) { score += 1.5; why.push([1.5, `Good for ${r.season.find((s) => SEASONS[s]?.includes(Number(night.date.slice(5, 7))))}`]); } else score -= 1.5; }
      if (!night.split) {
        if (r.kidOk === "yes") { score += 1; why.push([1, "The boys like this"]); }
        if (r.kidOk === "no") score -= 2;
        if (r.for === "adults") score -= 3;
        if (hasDislike(r, kids.flatMap((k) => k.dislikes))) score -= 3;
      } else if (r.for === "adults") { score += 2; why.push([2, "A grown-up dinner"]); }
      else if (r.kidOk === "yes") score -= 0.5; // the boys' favorites are better kept for nights everyone eats together
      // Away nights: skip what's mostly for the person who's away ("spicy" for Matt).
      if (away.length && away.some((p) => p.likes.some((l) => { const w = norm(l.split(" ")[0]); return w.length > 2 && (r.tags.some((t) => norm(t).includes(w)) || norm(r.name).includes(w)); }))) score -= 2.5;
      if (before && r.protein && before.protein && norm(r.protein) === norm(before.protein)) score -= 2;
      if (before && r.tags.some((t) => before.tags.includes(t))) score -= 1;
      if (r.store === "trader-joes") { score += 0.5; why.push([0.5, "From this week's Trader Joe's trip"]); }
      if (r.makeAhead && night.kind === "regular") score += 0.2;
    } else {
      if (hasDislike(r, kids.flatMap((k) => k.dislikes))) score -= 3;
      if (ago === null || ago > 14) score += 0.5;
    }
    if (ago === null && !forKids && !why.length) why.push([0, "Not made in a while"]);
    // A steady tie-break, different each week, so equal recipes don't always come in name order.
    score += (hash(`${r.id}|${night.date}`) % 100) / 1000;
    out.push({ recipe: r, score, why: why.sort((a, b) => b[0] - a[0])[0]?.[1] ?? "" });
  }
  return out.sort((a, b) => b.score - a.score);
}

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }

/** The pick and two alternatives for one night; "Something else" moves along the list three at a time (seed). */
export function choices(nights: Night[], at: number, ctx: Context, seed = 0, forKids = false): Option[] {
  const all = rank(nights, at, ctx, forKids);
  if (all.length <= 3) return all;
  const start = (seed * 3) % all.length;
  return [...all.slice(start), ...all.slice(0, start)].slice(0, 3);
}

/** Fills every open night (not skipped, no meal yet) in order, each pick shaping the next night's variety. */
export function suggestWeek(nights: Night[], ctx: Context): Night[] {
  const out = nights.map((n) => ({ ...n }));
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.kind === "skip") continue;
    if (!n.meal) n.meal = choices(out, i, ctx)[0]?.recipe.id ?? "";
    if (n.split && !n.kidsMeal) n.kidsMeal = choices(out, i, ctx, 0, true)[0]?.recipe.id ?? "";
  }
  return out;
}

// ---- the boys' lunches

export const LUNCH_PARTS = ["main", "fruit", "side", "treat", "snack"] as const;
export type LunchPart = (typeof LUNCH_PARTS)[number];
export type LunchOption = { kid: string; part: LunchPart; item: string; ingredients: string[] };
export type Lunch = { date: string; kid: string; schoolLunch: boolean; noSchool: boolean } & Record<LunchPart, string>;

/** "school lunch on Thursdays" (a rule in the boy's Profile rows) → [4]. */
export function schoolLunchDays(rules: string[]): number[] {
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return rules.filter((r) => /school lunch/i.test(r)).flatMap((r) => DAYS.flatMap((d, i) => (r.toLowerCase().includes(d) ? [i] : [])));
}

/**
 * Each school day's lunch for each boy, from his own options. Each part rotates through his options (carrying on from
 * week to week), so the week has variety without randomness. A school-lunch day has no packed lunch but still a snack.
 */
export function planLunches(monday: string, kids: { name: string; rules: string[] }[], options: LunchOption[], noSchool: string[] = []): Lunch[] {
  const week = Math.floor(daysBetween("2026-01-05", monday) / 7);
  return weekDates(monday).slice(0, 5).flatMap((date, d) => kids.flatMap((k) => {
    const mine = options.filter((o) => norm(o.kid) === norm(k.name));
    if (!mine.length) return [];
    const off = noSchool.includes(date);
    const school = schoolLunchDays(k.rules).includes(weekdayOf(date));
    const pick = (part: LunchPart) => {
      const xs = mine.filter((o) => o.part === part);
      return xs.length ? xs[(week * 5 + d) % xs.length].item : "";
    };
    const lunch = { date, kid: k.name, schoolLunch: school, noSchool: off } as Lunch;
    for (const p of LUNCH_PARTS) lunch[p] = off || (school && p !== "snack") ? "" : pick(p);
    return [lunch];
  }));
}

/** The next of his options for one part of a lunch (tap to swap). */
export function nextOption(l: Lunch, part: LunchPart, options: LunchOption[]): string {
  const xs = options.filter((o) => norm(o.kid) === norm(l.kid) && o.part === part).map((o) => o.item);
  if (!xs.length) return l[part];
  return xs[(xs.indexOf(l[part]) + 1) % xs.length];
}

/** What a week's lunches need from the store: each part's ingredients (or the part itself), once each. */
export function lunchShopping(lunches: Lunch[], options: LunchOption[]): string[] {
  const out = new Map<string, string>();
  for (const l of lunches) for (const p of LUNCH_PARTS) {
    if (!l[p]) continue;
    const o = options.find((x) => norm(x.kid) === norm(l.kid) && x.part === p && norm(x.item) === norm(l[p]));
    for (const it of o?.ingredients.length ? o.ingredients : [l[p]]) out.set(norm(it), it);
  }
  return [...out.values()];
}
