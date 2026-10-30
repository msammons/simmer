import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { loadWeek, markMade, saveWeek } from "@/lib/plan";
import { todayIn } from "@/lib/time";
import { LUNCH_PARTS, weekOf, type Lunch, type Night } from "@/lib/week";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (s: unknown, max = 80) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

function night(x: Record<string, unknown>): Night | null {
  if (!DATE.test(String(x?.date))) return null;
  return {
    date: String(x.date), kind: x.kind === "quick" || x.kind === "skip" ? x.kind : "regular", meal: text(x.meal), kidsMeal: text(x.kidsMeal),
    away: Array.isArray(x.away) ? x.away.map((a) => text(a, 20)).filter(Boolean).slice(0, 4) : [], split: Boolean(x.split), pinned: Boolean(x.pinned),
    plannedBy: text(x.plannedBy, 20), made: x.made === "yes" || x.made === "no" ? x.made : "", notes: text(x.notes, 200),
  };
}
function lunch(x: Record<string, unknown>): Lunch | null {
  if (!DATE.test(String(x?.date)) || !text(x.kid)) return null;
  return { date: String(x.date), kid: text(x.kid, 20), schoolLunch: Boolean(x.schoolLunch), noSchool: Boolean(x.noSchool), ...(Object.fromEntries(LUNCH_PARTS.map((p) => [p, text(x[p])])) as Record<(typeof LUNCH_PARTS)[number], string>) };
}

/** GET ?week=YYYY-MM-DD (any day of it; this week by default): the week's nights and lunches, and what planning needs. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  const w = new URL(req.url).searchParams.get("week") ?? "";
  try {
    return Response.json(await loadWeek(weekOf(DATE.test(w) ? w : todayIn())), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}

/** POST { op: "save", nights, lunches, by } or { op: "made", date, made }. Answers with that week as it is now. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    let added = 0, week = "";
    if (b?.op === "save") {
      const nights = (Array.isArray(b.nights) ? b.nights : []).slice(0, 14).map(night).filter((n: Night | null): n is Night => n !== null);
      if (!nights.length) throw new AppError("Nothing to save.");
      const lunches = (Array.isArray(b.lunches) ? b.lunches : []).slice(0, 40).map(lunch).filter((l: Lunch | null): l is Lunch => l !== null);
      ({ added } = await saveWeek(nights, lunches, text(b.by, 20)));
      week = nights[0].date;
    } else if (b?.op === "made" && DATE.test(String(b.date))) {
      await markMade(String(b.date), Boolean(b.made));
      week = String(b.date);
    } else return Response.json({ error: "Unknown change." }, { status: 400 });
    return Response.json({ ...(await loadWeek(weekOf(week))), added }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502 });
  }
}
