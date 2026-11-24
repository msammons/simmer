// Feedback from the long press on Settings (Sam, Nov 24): the text with where the app was and what it showed, one entry
// each in one Redis list, `${NS}:feedback`, newest first, the newest 500 kept. Read with scripts/feedback.mjs; no
// screen. Never the passcode, a card number or Face ID data: the phone sends only what's on screen (lib/feedback.ts),
// each field is cut short here, and the passcode and long numbers are taken out of everything.
import type { FeedbackContext } from "../feedback";
import { AppError } from "../errors";
import { kv } from "../kv";
import { NS } from "../store/tabs";

export const FEEDBACK_KEY = `${NS}:feedback`;
export const KEEP_FEEDBACK = 500;
export const MAX_TEXT = 4000;

/** What the server knows that the phone may not: the helper's last check-in and ordering's switches. */
export type ServerSide = { live: string; helper: string; helperSeen: string; ordering: string };
export type FeedbackEntry = { at: string; text: string } & FeedbackContext & { server: ServerSide };

/** The passcode and anything that looks like a card number (twelve or more digits, spaces or dashes between) taken out. */
export function hide(s: string): string {
  let m = s;
  const pass = process.env.HOUSEHOLD_PASSCODE;
  if (pass && pass.length >= 3) m = m.split(pass).join("[passcode]");
  return m.replace(/\d(?:[ -]?\d){11,}/g, "[number]");
}
const line = (v: unknown, max: number) => (typeof v === "string" ? hide(v.replace(/\s+/g, " ").trim()).slice(0, max) : "");
const lines = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.slice(-n).map((x) => line(x, max)).filter(Boolean) : []);

/** The phone's body as it's kept, or an AppError when there's no text. Unknown fields are dropped; each is cut short. */
export function feedbackOf(b: unknown): { text: string } & FeedbackContext {
  const o = (typeof b === "object" && b !== null ? b : {}) as Record<string, unknown>;
  const text = typeof o.text === "string" ? hide(o.text.replace(/\r\n?/g, "\n").trim()).slice(0, MAX_TEXT) : "";
  if (!text) throw new AppError("Write something first.");
  const state: Record<string, string> = {};
  if (typeof o.state === "object" && o.state !== null && !Array.isArray(o.state))
    for (const [k, v] of Object.entries(o.state).slice(0, 12)) { const key = line(k, 40), val = line(v, 200); if (key && val) state[key] = val; }
  return {
    text,
    release: line(o.release, 20),
    tab: line(o.tab, 40),
    screens: lines(o.screens, 6, 120),
    sheets: (Array.isArray(o.sheets) ? o.sheets.slice(-8) : []).flatMap((s) => {
      const name = line(s?.name, 60);
      return name ? [{ name, detail: line(s?.detail, 200) }] : [];
    }),
    state,
    alerts: lines(o.alerts, 5, 200),
    online: o.online !== false,
    theme: line(o.theme, 40),
    viewport: line(o.viewport, 20),
    userAgent: line(o.userAgent, 300),
  };
}

/** Adds one at the front and keeps the newest 500. */
export async function recordFeedback(f: { text: string } & FeedbackContext, server: ServerSide, at = new Date().toISOString()): Promise<FeedbackEntry> {
  const entry: FeedbackEntry = { at, ...f, server };
  const s = kv();
  await s.lpush(FEEDBACK_KEY, JSON.stringify(entry));
  await s.ltrim(FEEDBACK_KEY, 0, KEEP_FEEDBACK - 1);
  return entry;
}

/** The newest `n`, newest first. */
export async function latestFeedback(n = 20): Promise<FeedbackEntry[]> {
  return (await kv().lrange(FEEDBACK_KEY, 0, n - 1)).flatMap((v) => { try { return [JSON.parse(v) as FeedbackEntry]; } catch { return []; } });
}
