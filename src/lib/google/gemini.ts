// Gemini with structured JSON output. Free tier sheds load with 503/429, so: retry once, then a lighter model.
// Measured 2026-10-23: gemini-2.5-flash retired for new keys; 3.8-flash ~73s per call; 3.5-flash ~1.5s.
const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.5-flash";
const FALLBACK = () => process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";

// search: Gemini may look things up with Google Search first. Search plus a JSON schema is newer API ground; if the API
// refuses the combination, the request is repeated without the schema and the JSON is read out of the text.
// sources: with search on, the web hosts Gemini's answer drew on (from its grounding metadata).
// patient: for work that runs after the response (event search, top-up), wait out a rate limit as long as Google asks, up to 40 s.
export async function generateJson<T>(prompt: string, schema: object, opts: { light?: boolean; search?: boolean; timeoutMs?: number; patient?: boolean } = {}): Promise<{ data: T; model: string; sources: string[] }> {
  let schemaInText = false;
  const body = () => JSON.stringify({
    contents: [{ parts: [{ text: schemaInText ? `${prompt}\n\nReply with only JSON matching this schema:\n${JSON.stringify(schema)}` : prompt }] }],
    ...(opts.search && { tools: [{ google_search: {} }] }),
    generationConfig: schemaInText ? {} : { responseMimeType: "application/json", responseSchema: schema },
  });
  const attempts = opts.light ? [FALLBACK(), FALLBACK(), MODEL()] : [MODEL(), MODEL(), FALLBACK()];
  let last = "";
  for (const [i, model] of attempts.entries()) {
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
        body: body(),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (e) {
      last = `${model}: ${(e as Error).message}`;
      continue; // timeout: try the next attempt
    }
    if (r.status === 503 || r.status === 429) {
      const why = await busyReason(r);
      last = `${model}: ${why.text}`;
      if (why.daily) continue; // waiting won't help; the other model has its own quota
      const wait = opts.patient ? Math.min(why.retryMs ?? 5_000, 40_000) : 1_500;
      if (i < attempts.length - 1) await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (r.status === 400 && opts.search && !schemaInText) {
      schemaInText = true;
      last = `${model}: search with a schema refused`;
      continue;
    }
    if (!r.ok) throw new Error(`Gemini error ${r.status}: ${(await r.text()).replace(/\s+/g, " ").slice(0, 200)}`);
    const j = await r.json();
    const parts: { text?: string; thought?: boolean }[] = j.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    const chunks: { web?: { uri?: string; title?: string } }[] = j.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = [...new Set(chunks.flatMap((c) => [c.web?.title, hostOf(c.web?.uri)]).filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase().replace(/^www\./, "")))];
    return { data: (schemaInText ? JSON.parse(jsonIn(text)) : JSON.parse(text)) as T, model, sources };
  }
  throw new Error(`Gemini is busy right now. Try again in a minute. (${last})`);
}

/** The outermost JSON object in a reply that may wrap it in prose or a code fence. */
export function jsonIn(text: string): string {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Gemini's reply had no JSON in it");
  return text.slice(a, b + 1);
}

export const hostOf = (url?: string) => {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
};

/** What Google said about a 429/503: which quota, whether it's a daily one, and how long it asks us to wait. */
async function busyReason(r: Response): Promise<{ text: string; daily: boolean; retryMs?: number }> {
  const body = await r.json().catch(() => null);
  const details: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[] = body?.error?.details ?? [];
  const quota = details.flatMap((d) => d.violations ?? []).map((v) => v.quotaId).filter(Boolean)[0];
  const delay = details.find((d) => d.retryDelay)?.retryDelay;
  const retryMs = delay ? Math.ceil(parseFloat(delay) * 1000) : undefined;
  const daily = /PerDay/i.test(quota ?? "");
  return { text: r.status === 429 ? `rate limited${quota ? ` (${quota})` : ""}` : "busy (503)", daily, retryMs };
}
