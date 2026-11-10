import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { changePlanned, loadPlan, markMade, removePlanned, savePlan, type NewDish, type NewLunch, clearPlanned } from "@/lib/plan";
import { KINDS, LUNCH_PARTS, MAX_COUNT, type Counts, type Kind, type LunchPart } from "@/lib/week";

const text = (s: unknown, max = 80) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const isKind = (s: unknown): s is Kind => typeof s === "string" && (KINDS as readonly string[]).includes(s);
const isPart = (s: unknown): s is LunchPart => typeof s === "string" && (LUNCH_PARTS as readonly string[]).includes(s);
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNT, Math.round(n))) : 0);

function dish(x: Record<string, unknown>): NewDish | null {
  return isKind(x?.kind) && text(x.recipe) ? { kind: x.kind, recipe: text(x.recipe), pinned: Boolean(x.pinned) } : null;
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
const fresh = { headers: { "cache-control": "no-store" } };

/** GET: what's still to make and pack, and what planning needs (see loadPlan). */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json(await loadPlan(), fresh);
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}

/**
 * POST { op: "plan", dishes, lunches, counts, by }: more to make and pack, on top of what's there.
 * { op: "change", id, recipe?, pinned?, part?, item?, by }, { op: "made", id }, { op: "remove", id }: one planned thing.
 * Answers with everything as it is now, and `added`: how many things went on the grocery list.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    let added = 0, removed = 0;
    const id = text(b?.id, 40);
    if (b?.op === "plan") {
      const dishes = (Array.isArray(b.dishes) ? b.dishes : []).slice(0, KINDS.length * MAX_COUNT).map(dish).filter((d: NewDish | null): d is NewDish => d !== null);
      const lunches = (Array.isArray(b.lunches) ? b.lunches : []).slice(0, 8 * MAX_COUNT).map(lunch).filter((l: NewLunch | null): l is NewLunch => l !== null);
      ({ added, removed } = await savePlan(dishes, lunches, counts(b.counts), text(b.by, 20)));
    } else if (b?.op === "change" && id) {
      ({ added, removed = 0 } = await changePlanned(id, { ...(text(b.recipe) && { recipe: text(b.recipe), pinned: Boolean(b.pinned) }), ...(isPart(b.part) && { part: b.part, item: text(b.item) }) }, text(b.by, 20)));
    } else if (b?.op === "made" && id) await markMade(id);
    else if (b?.op === "remove" && id) ({ removed } = await removePlanned(id));
    else if (b?.op === "clear") await clearPlanned();
    else return Response.json({ error: "Unknown change." }, { status: 400 });
    return Response.json({ ...(await loadPlan()), added, removed }, fresh);
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}
