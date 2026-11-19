// Gemini with structured JSON output. Free tier sheds load with 503/429, so: retry, then a lighter model.
// Measured 2026-10-23: gemini-2.5-flash retired for new keys; 3.8-flash ~73s per call; 3.5-flash ~1.5s.
const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.5-flash";
const FALLBACK = () => process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
/** Too little time left to be worth another attempt. */
const LAST_MS = 1_500;

/**
 * One answer as JSON matching `schema`. `timeoutMs` is the whole budget, every attempt included (Nov 19: 30-55 s per
 * attempt, three attempts, ran past the route's 60 s), so a caller can count on it. An attempt that fails fast (busy,
 * a server error, a cut-off or unreadable answer) is tried again, the last time on the other model.
 * light: the lighter model first. files: pictures or PDFs sent with the prompt (base64). urls: Gemini may open links
 * named in the prompt (its URL context tool), for pages that refuse our own server; if the API refuses that tool with a
 * schema, it's asked again without the schema and the JSON read out of the text.
 */
export async function generateJson<T>(prompt: string, schema: object, opts: { light?: boolean; urls?: boolean; files?: { mimeType: string; data: string }[]; timeoutMs?: number } = {}): Promise<{ data: T; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini isn't set up (no GEMINI_API_KEY)");
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  let schemaInText = false;
  const body = () => JSON.stringify({
    contents: [{ parts: [...(opts.files ?? []).map((f) => ({ inline_data: { mime_type: f.mimeType, data: f.data } })), { text: schemaInText ? `${prompt}\n\nReply with only JSON matching this schema:\n${JSON.stringify(schema)}` : prompt }] }],
    ...(opts.urls && { tools: [{ url_context: {} }] }),
    generationConfig: schemaInText ? {} : { responseMimeType: "application/json", responseSchema: schema },
  });
  const attempts = opts.light ? [FALLBACK(), FALLBACK(), MODEL()] : [MODEL(), MODEL(), FALLBACK()];
  let last = "";
  for (const [i, model] of attempts.entries()) {
    const left = deadline - Date.now();
    if (left < LAST_MS) break;
    const wait = async (ms: number) => { if (i < attempts.length - 1) await new Promise((res) => setTimeout(res, Math.min(ms, Math.max(0, deadline - Date.now() - LAST_MS)))); };
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: body(), signal: AbortSignal.timeout(left),
      });
    } catch (e) {
      last = `${model}: ${(e as Error).message}`;
      continue; // a dropped connection, or the deadline (the loop then stops)
    }
    if (r.status === 503 || r.status === 429) {
      const why = await busyReason(r);
      last = `${model}: ${why.text}`;
      if (!why.daily) await wait(1_500); // a daily quota won't come back; the other model has its own
      continue;
    }
    if (r.status >= 500) { last = `${model}: server error ${r.status}`; await r.body?.cancel(); await wait(500); continue; }
    if (r.status === 400 && opts.urls && !schemaInText) { schemaInText = true; last = `${model}: links with a schema refused`; await r.body?.cancel(); continue; }
    if (!r.ok) throw new Error(`Gemini error ${r.status}: ${(await r.text()).replace(/\s+/g, " ").slice(0, 200)}`);
    const j = await r.json().catch(() => null);
    const c = j?.candidates?.[0];
    const text = ((c?.content?.parts ?? []) as { text?: string; thought?: boolean }[]).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
    // Blocked (safety, a recitation): asking the same again won't help.
    if (!text) throw new Error(`Gemini gave no answer (${j?.promptFeedback?.blockReason ?? c?.finishReason ?? "empty"})`);
    try {
      return { data: JSON.parse(schemaInText ? jsonIn(text) : text) as T, model };
    } catch {
      last = `${model}: unreadable answer (${c?.finishReason ?? "?"})`; // cut off at its length limit, most often
    }
  }
  throw new Error(`Gemini is busy right now. Try again in a minute. (${last || "out of time"})`);
}

/** The outermost JSON object in a reply that may wrap it in prose or a code fence. */
export function jsonIn(text: string): string {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Gemini's reply had no JSON in it");
  return text.slice(a, b + 1);
}

/** What Google said about a 429/503: which quota, and whether it's a daily one. */
async function busyReason(r: Response): Promise<{ text: string; daily: boolean }> {
  const body = await r.json().catch(() => null);
  const details: { violations?: { quotaId?: string }[] }[] = body?.error?.details ?? [];
  const quota = details.flatMap((d) => d.violations ?? []).map((v) => v.quotaId).filter(Boolean)[0];
  return { text: r.status === 429 ? `rate limited${quota ? ` (${quota})` : ""}` : "busy (503)", daily: /PerDay/i.test(quota ?? "") };
}
