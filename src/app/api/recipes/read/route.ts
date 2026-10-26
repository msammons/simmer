import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { readLink, readText } from "@/lib/recipes";

export const maxDuration = 60;

/** POST { link } or { text }: the recipes found in it, for her to look over before anything is saved. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    const link = typeof b?.link === "string" ? b.link.trim().slice(0, 2000) : "";
    const text = typeof b?.text === "string" ? b.text.slice(0, 20_000) : "";
    if (!link && !text.trim()) throw new AppError("Paste a link or type a recipe first.");
    const found = link ? await readLink(link) : await readText(text);
    if (!found.length) throw new AppError("Couldn't find a recipe in that. Try adding the ingredients, one per line.");
    return Response.json({ found });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
