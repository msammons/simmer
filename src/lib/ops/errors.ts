// Errors reach the owner (Nov 19): unexpected server failures (the ones people see as a plain "try again") are kept as
// the newest 200 in one Redis list, `${NS}:errors`, read through scripts/errors.mjs. Never a request's body, the
// passcode or anything personal: the route, the message (cleaned and cut short), the digest and the time. No screen.
import { UpstreamError } from "../errors";
import { kv } from "../kv";
import { NS } from "../store/tabs";

export const ERRORS_KEY = `${NS}:errors`;
export const KEEP_ERRORS = 200;

export type ErrorEntry = { at: string; route: string; method?: string; message: string; digest?: string; where?: string };

/** The message with anything that could be private taken out: the passcode, email addresses, long numbers, links' queries. */
export function scrub(message: string): string {
  let m = String(message ?? "");
  const pass = process.env.HOUSEHOLD_PASSCODE;
  if (pass && pass.length >= 3) m = m.split(pass).join("[passcode]");
  return m
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1")
    .replace(/\d{6,}/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Just the path ("/api/list"), never the query. */
export function pathOf(url: string): string {
  try { return new URL(url, "http://x").pathname.slice(0, 120); } catch { return ""; }
}

/**
 * An error as the list keeps it. A SyntaxError (a reply that didn't read as JSON) or another service's failure keeps
 * only its kind and status (Nov 19, review): their messages can quote a model's reply, a recipe or a name.
 */
export function messageOf(e: unknown): string {
  if (e instanceof UpstreamError) return `${e.name}: ${e.service} ${e.status}`;
  if (e instanceof Error && e.name === "SyntaxError") return "SyntaxError";
  return e instanceof Error ? `${e.name && e.name !== "Error" ? e.name + ": " : ""}${e.message}` : String(e);
}

/** Adds one to the list and keeps the newest 200. */
export async function recordError(e: Omit<ErrorEntry, "at"> & { at?: string }): Promise<void> {
  const entry: ErrorEntry = {
    at: e.at ?? new Date().toISOString(),
    route: pathOf(e.route) || e.route.slice(0, 120),
    ...(e.method && { method: e.method.slice(0, 10) }),
    message: scrub(e.message),
    ...(e.digest && { digest: String(e.digest).slice(0, 40) }),
    ...(e.where && { where: e.where.slice(0, 40) }),
  };
  const s = kv();
  await s.rpush(ERRORS_KEY, JSON.stringify(entry));
  await s.ltrim(ERRORS_KEY, -KEEP_ERRORS, -1);
}

/** The newest `n`, newest last. */
export async function latestErrors(n = 50): Promise<ErrorEntry[]> {
  return (await kv().lrange(ERRORS_KEY, -n, -1)).flatMap((v) => { try { return [JSON.parse(v) as ErrorEntry]; } catch { return []; } });
}
