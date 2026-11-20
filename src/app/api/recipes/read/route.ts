import { AppError } from "@/lib/errors";
import { readRecipeFile, readLink, readText } from "@/lib/recipes";
import { counting, READ_CAP_REACHED, withinCap } from "@/lib/ops/caps";
import { api, body } from "@/lib/ops/route";

export const maxDuration = 60;

/** POST { link }, { text } or { file: { name, type, data (base64) } }: the recipes found in it, for her to look over before anything is saved. */
export const POST = api(async (req) => {
  const b = await body(req);
  const link = typeof b?.link === "string" ? b.link.trim().slice(0, 2000) : "";
  const text = typeof b?.text === "string" ? b.text.slice(0, 20_000) : "";
  const f = b?.file && typeof b.file.data === "string" ? { name: String(b.file.name ?? "").slice(0, 120), mimeType: String(b.file.type ?? "").toLowerCase(), data: b.file.data as string } : null;
  if (f && f.data.length > 4_300_000) throw new AppError("That file is too big. Try a smaller one, or a picture of the page.");
  if (!link && !text.trim() && !f) throw new AppError("Paste a link or type a recipe first.");
  // A day's readings are capped (Nov 19): anyone with the passcode could otherwise run them without end. Counted once
  // for the whole request, however many readings it takes.
  if (!(await withinCap("read"))) throw new AppError(READ_CAP_REACHED);
  const found = await counting("read", () => (f ? readRecipeFile(f) : link ? readLink(link) : readText(text)));
  if (!found.length) throw new AppError("Couldn't find a recipe in that. Try adding the ingredients, one per line.");
  return Response.json({ found });
});
