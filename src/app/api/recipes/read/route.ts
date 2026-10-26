import { AppError } from "@/lib/errors";
import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { readRecipeFile, readLink, readText } from "@/lib/recipes";

export const maxDuration = 60;

/** POST { link }, { text } or { file: { name, type, data (base64) } }: the recipes found in it, for her to look over before anything is saved. */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  try {
    const link = typeof b?.link === "string" ? b.link.trim().slice(0, 2000) : "";
    const text = typeof b?.text === "string" ? b.text.slice(0, 20_000) : "";
    const f = b?.file && typeof b.file.data === "string" ? { name: String(b.file.name ?? "").slice(0, 120), mimeType: String(b.file.type ?? "").toLowerCase(), data: b.file.data as string } : null;
    if (f && f.data.length > 4_300_000) throw new AppError("That file is too big. Try a smaller one, or a picture of the page.");
    if (!link && !text.trim() && !f) throw new AppError("Paste a link or type a recipe first.");
    const found = f ? await readRecipeFile(f) : link ? await readLink(link) : await readText(text);
    if (!found.length) throw new AppError("Couldn't find a recipe in that. Try adding the ingredients, one per line.");
    return Response.json({ found });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
