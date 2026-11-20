// What every API route does the same way (Nov 19): the passcode (with the wrong-guess limit, lockout.ts), reading the
// body, the friendly answer when something fails (unexpected failures also go to the owner's error list, errors.ts),
// and answers that are never cached.
import { after } from "next/server";
import { unauthorized } from "../auth";
import { AppError } from "../errors";
import { friendly } from "../friendly";
import { outside } from "../store/tabs";
import { messageOf, recordError } from "./errors";
import { checkPasscode, deviceCookie, LOCKED } from "./lockout";

export const noStore = { headers: { "cache-control": "no-store" } };

/** A string from the body, on one line and cut to `max` (anything else is ""). */
export const clean = (s: unknown, max = 80) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The request's JSON body, or null when it has none or it can't be read. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a body is checked field by field where it's used
export const body = (req: Request): Promise<any> => req.json().catch(() => null);

/** A 400 with a message written for people ("Unknown change."). */
export const refuse = (error: string) => Response.json({ error }, { status: 400, ...noStore });

/** An unexpected failure, sent to the error list once the answer has gone. */
export function report(e: unknown, req: Request, where?: string) {
  const entry = {
    route: req.url, method: req.method, message: messageOf(e), where,
    digest: typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : undefined,
  };
  const save = () => outside(() => recordError(entry)).catch((x) => console.error("couldn't record an error", x));
  try { after(save); } catch { void save(); } // outside a request (tests)
}

/** What a person sees when something goes wrong: an AppError as written (400), anything else a plain "try again" (502). */
export function failed(e: unknown, req: Request): Response {
  if (!(e instanceof AppError)) report(e, req);
  return Response.json({ error: friendly(e) }, { status: e instanceof AppError ? 400 : 502, ...noStore });
}

/** The answer with this phone's device proof set (lockout.ts), copied when its headers can't be changed. */
function proved(res: Response): Response {
  try { res.headers.append("set-cookie", deviceCookie()); return res; } catch {
    const copy = new Response(res.body, res);
    copy.headers.append("set-cookie", deviceCookie());
    return copy;
  }
}

/**
 * A route's handler with the passcode checked first and failures answered by `failed`. A wrong passcode is a 401 (the
 * app goes back to the passcode screen); an address with too many wrong ones is a 429 with a plain message, which never
 * signs anyone out.
 */
export function api(fn: (req: Request) => Promise<Response> | Response): (req: Request) => Promise<Response> {
  return async (req) => {
    const v = await checkPasscode(req);
    if (!v.ok) return v.status === 429 ? Response.json({ error: LOCKED }, { status: 429, ...noStore }) : unauthorized();
    let res: Response;
    try { res = await fn(req); } catch (e) { res = failed(e, req); }
    return v.prove ? proved(res) : res;
  };
}
