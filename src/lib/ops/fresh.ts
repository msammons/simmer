// "Nothing changed" answers (Nov 19). Every tab has a version that every write counts up (store/tabs.ts), so what a
// read answers is named by the versions of the tabs it was made from: its ETag. The phone keeps the ETag with its copy
// and sends it back (If-None-Match) when it reads again; while none of those tabs has been written, the answer is a 304
// with no body, at the cost of one small read of the version keys. Changes answer with the new ETag too, so the read
// after one's own change is a 304.
//
// Answers stay no-store: nothing (the phone's HTTP cache, Vercel, anything between) keeps a copy; the app keeps its own
// copy and sends If-None-Match itself, and fetch hands a 304 for such a request straight to the app.
import { LIST_READS } from "../groceries";
import { KITCHEN_READS, PLAN_READS } from "../plan";
import { RECIPES_READS } from "../recipes";
import { tabVersions, transactAt } from "../store";
import { todayIn } from "../time";

/** One kind of answer: its name, the tabs it's made from, and anything else it depends on (the day). */
export type Fresh = { name: string; tabs: string[]; also?: () => string };

// A new release may answer the same rows differently, so the build is part of every ETag.
const build = () => (process.env.NEXT_PUBLIC_BUILD ?? "").replace(/[^\w-]/g, "").slice(0, 20);

/** The ETag of an answer made from these versions. */
export const etagOf = (f: Fresh, versions: string[], also = f.also?.() ?? "") =>
  `"${[f.name, build(), also, ...versions].join(".")}"`;

/** Whether If-None-Match names this ETag (a list, or weak forms, are read too; "*" never matches). */
export function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => t.trim().replace(/^W\//, "") === etag);
}

const headers = (etag: string | null) => ({ "cache-control": "no-store", ...(etag && { etag }) });

/** An answer with its ETag (none when it isn't known: then the next read is a full one). */
export const withEtag = (body: unknown, etag: string | null) => Response.json(body, { headers: headers(etag) });

/**
 * A GET: 304 when the phone's copy is current, else `load` answered with its ETag. The versions are read with the rows
 * the answer is made from, in the same MGET, so an ETag never names a newer state than its answer.
 */
export async function freshRead(req: Request, f: Fresh, load: () => Promise<unknown>): Promise<Response> {
  const also = f.also?.() ?? "";
  const asked = req.headers.get("if-none-match");
  if (asked) {
    const now = etagOf(f, await tabVersions(f.tabs), also);
    if (matches(asked, now)) return new Response(null, { status: 304, headers: headers(now) });
  }
  const { out, versions } = await transactAt(f.tabs, load);
  return withEtag(out, versions && etagOf(f, versions, also));
}

/** A change as one transaction (as `transact`), with the ETag its answer goes with. */
export async function freshChange<T>(f: Fresh, change: () => Promise<T>): Promise<{ out: T; etag: string | null }> {
  const also = f.also?.() ?? "";
  const { out, versions } = await transactAt(f.tabs, change);
  return { out, etag: versions && etagOf(f, versions, also) };
}

// ---- the four reads the phone makes on opening and coming back

export const LIST: Fresh = { name: "list", tabs: LIST_READS };
export const RECIPES: Fresh = { name: "recipes", tabs: RECIPES_READS };
/** The plan also says which store trips are due, which turns with the day. */
export const PLAN: Fresh = { name: "plan", tabs: PLAN_READS, also: () => todayIn() };
export const KITCHEN: Fresh = { name: "kitchen", tabs: KITCHEN_READS };
