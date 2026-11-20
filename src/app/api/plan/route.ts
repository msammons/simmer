import { changePlanned, loadPlan, markMade, removePlanned, savePlan, type NewDish, type NewLunch, clearPlanned, setCount, tidyStock } from "@/lib/plan";
import { KINDS, LUNCH_PARTS, MAX_COUNT, type Counts, type Kind, type LunchPart } from "@/lib/week";
import { backUpAfter, before } from "@/lib/ops/backup";
import { api, body, clean as text, refuse } from "@/lib/ops/route";
import { freshChange, freshRead, PLAN, withEtag } from "@/lib/ops/fresh";

const isKind = (s: unknown): s is Kind => typeof s === "string" && (KINDS as readonly string[]).includes(s);
const isPart = (s: unknown): s is LunchPart => typeof s === "string" && (LUNCH_PARTS as readonly string[]).includes(s);
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNT, Math.round(n))) : 0);

function dish(x: Record<string, unknown>): NewDish | null {
  const day = typeof x?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.day) ? x.day : "";
  return isKind(x?.kind) && text(x.recipe) ? { kind: x.kind, recipe: text(x.recipe), pinned: Boolean(x.pinned), day } : null;
}
function lunch(x: Record<string, unknown>): NewLunch | null {
  if (!text(x?.kid)) return null;
  return { kid: text(x.kid, 20), ...(Object.fromEntries(LUNCH_PARTS.map((p) => [p, text(x[p])])) as Record<LunchPart, string>) };
}
function counts(x: Record<string, unknown> | null | undefined): Counts | null {
  if (!x || typeof x !== "object") return null;
  const kids = x.lunches && typeof x.lunches === "object" ? Object.entries(x.lunches as Record<string, unknown>).slice(0, 8) : [];
  return { ...(Object.fromEntries(KINDS.map((k) => [k, count(x[k])])) as Record<Kind, number>), lunches: Object.fromEntries(kids.map(([k, n]) => [text(k, 20), count(n)]).filter(([k]) => k)) };
}

/** GET: what's still to make and pack, and what planning needs (see loadPlan). */
export const GET = api((req) => freshRead(req, PLAN, loadPlan));

/**
 * POST { op: "plan", dishes, lunches, counts, by }: more to make and pack, on top of what's there.
 * { op: "change", id, recipe?, pinned?, part?, item?, by }, { op: "made", id }, { op: "remove", id }: one planned thing.
 * Answers with everything as it is now, and `added`: how many things went on the grocery list. The change, the tidy-up
 * and the answer are one transaction (Nov 19): each tab is read once, and a change made elsewhere meanwhile isn't lost.
 */
export const POST = api(async (req) => {
  const b = await body(req);
  // New plan, and starting the plan over (counts given): the tabs as they were are kept as a backup (Nov 19), read
  // before the change and written once the answer has gone (the newest 7 kept).
  const kept = b?.op === "clear" || (b?.op === "plan" && counts(b.counts)) ? await before(b.op === "clear" ? "new plan" : "start over") : null;
  const { out, etag } = await freshChange(PLAN, async () => {
    let added = 0, removed = 0;
    const id = text(b?.id, 40);
    if (b?.op === "plan") {
      const dishes = (Array.isArray(b.dishes) ? b.dishes : []).slice(0, KINDS.length * MAX_COUNT).map(dish).filter((d: NewDish | null): d is NewDish => d !== null);
      const lunches = (Array.isArray(b.lunches) ? b.lunches : []).slice(0, 8 * MAX_COUNT).map(lunch).filter((l: NewLunch | null): l is NewLunch => l !== null);
      ({ added, removed } = await savePlan(dishes, lunches, counts(b.counts), text(b.by, 20)));
    } else if (b?.op === "change" && id) {
      ({ added, removed = 0 } = await changePlanned(id, { ...(text(b.recipe) && { recipe: text(b.recipe), pinned: Boolean(b.pinned) }), ...(isPart(b.part) && { part: b.part, item: text(b.item) }), ...(/^\d{4}-\d{2}-\d{2}$/.test(text(b.day, 10)) && { day: text(b.day, 10) }) }, text(b.by, 20)));
    } else if (b?.op === "made" && id) await markMade(id);
    else if (b?.op === "remove" && id) ({ removed } = await removePlanned(id));
    else if (b?.op === "clear") ({ removed } = await clearPlanned());
    else if (b?.op === "count" && text(b.recipe) && (KINDS as readonly string[]).includes(b.kind) && Number.isFinite(Number(b.count))) ({ added, removed } = await setCount(text(b.recipe), b.kind, Number(b.count), text(b.by, 20)));
    else return null;
    // A dinner's leftovers on Stock for dinners no longer planned come off (Nov 14).
    if (b?.op !== "made") await tidyStock().catch((e) => console.error("couldn't tidy Stock", e));
    return { ...(await loadPlan()), added, removed };
  });
  if (!out) return refuse("Unknown change.");
  backUpAfter(kept, b?.op === "clear" ? "new plan" : "start over");
  return withEtag(out, etag);
});
