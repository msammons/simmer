// Wrong passcodes (Nov 19): the household passcode had no limit on guesses. Twenty different wrong ones from one
// address in 15 minutes and that address is turned down for 15 minutes (429, "Too many wrong passcodes…"), even with
// the right passcode, so guessing can't tell. The same wrong one again (a phone whose saved passcode changed sends it
// with every load) counts once.
//
// Counted before judging, in one step in Redis (Nov 19, review: a burst of guesses sent at once all read the count as
// 0 and were all judged): a new wrong passcode is counted only while the address is under the limit, so however many
// arrive together, at most LIMIT are ever answered "Wrong passcode."; every other answer is "too many", right or wrong.
//
// A phone that has signed in before carries a device proof (an HttpOnly cookie made from the passcode, set on a right
// passcode): with it and the right passcode, it's let in even while its address is turned down, so a guesser sharing
// the address (a phone network, the house's Wi-Fi) never signs the household out.
import { createHmac, timingSafeEqual } from "node:crypto";
import { authorized } from "../auth";
import { kv } from "../kv";
import { NS } from "../store/tabs";

export const LIMIT = 20;
export const WINDOW = 15 * 60;
export const LOCKED = "Too many wrong passcodes. Try again in a few minutes.";
export const DEVICE_COOKIE = "sm_device";

/** An IPv6 address's first 64 bits (one home or phone has a whole /64), as "a:b:c:d::/64"; null when it isn't one. */
function v6prefix(ip: string): string | null {
  const parts = ip.split("::");
  if (!ip.includes(":") || parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [], tail = parts[1] ? parts[1].split(":") : [];
  const groups = parts.length === 1 ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

/** The caller's address as Vercel gives it (x-real-ip), an IPv6 one by its /64, or "local" on a computer. */
export function clientIp(req: Request): string {
  const raw = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim().replace(/[^0-9A-Fa-f:.]/g, "").slice(0, 64);
  if (!raw) return "local";
  const mapped = raw.match(/:ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];
  return v6prefix(raw) ?? raw;
}

const countKey = (ip: string) => `${NS}:lock:${ip}`;

// KEYS: the address's count, the key for this wrong passcode. ARGV: the window, the limit, "1" when the passcode is
// wrong. A wrong one not yet seen is counted only while under the limit (nothing is written once it's reached).
// Answers { count after this attempt, 1 when this attempt was counted }.
const ATTEMPT = `local n = tonumber(redis.call("GET", KEYS[1]) or "0")
local limit = tonumber(ARGV[2])
if ARGV[3] == "1" and n < limit then
  if redis.call("SET", KEYS[2], "1", "EX", tonumber(ARGV[1]), "NX") then
    n = redis.call("INCR", KEYS[1])
    if n == 1 or n == limit then redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1])) end
    return {n, 1}
  end
end
return {n, 0}`;

// Without Redis (tests, the checks): the same in memory, with no await between reading and counting.
const local = new Map<string, number>(); // key → when it goes (ms)
const localCount = new Map<string, { n: number; until: number }>();
function attemptHere(count: string, seen: string, wrong: boolean): [number, boolean] {
  const now = Date.now();
  const c = localCount.get(count);
  const e = c && c.until > now ? c : { n: 0, until: now + WINDOW * 1000 };
  if (wrong && e.n < LIMIT && !((local.get(seen) ?? 0) > now)) {
    local.set(seen, now + WINDOW * 1000);
    e.n++;
    if (e.n === 1 || e.n === LIMIT) e.until = now + WINDOW * 1000;
    localCount.set(count, e);
    return [e.n, true];
  }
  return [e.n, false];
}
/** For tests. */
export const resetLockout = () => { local.clear(); localCount.clear(); };

/** One attempt, counted (when it's a new wrong passcode) and answered in one step: the count after it, and whether it counted. */
async function attempt(ip: string, typed: string, wrong: boolean): Promise<[number, boolean]> {
  // A wrong passcode is kept only as a keyed hash (the real passcode is the key), never as typed.
  const h = createHmac("sha256", process.env.HOUSEHOLD_PASSCODE ?? "").update(typed).digest("hex").slice(0, 16);
  const keys = [countKey(ip), `${countKey(ip)}:${h}`];
  const s = kv();
  if (!s.eval) return attemptHere(keys[0], keys[1], wrong);
  const [n, counted] = (await s.eval(ATTEMPT, keys, [String(WINDOW), String(LIMIT), wrong ? "1" : "0"])) as [number, number];
  return [Number(n) || 0, Number(counted) === 1];
}

/** The device proof for the passcode as it is now: a keyed hash (the passcode is the key), so only it can make one. */
const proof = () => createHmac("sha256", process.env.HOUSEHOLD_PASSCODE ?? "").update("simmer device proof v1").digest("hex").slice(0, 32);

function cookie(req: Request, name: string): string {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** Whether the request carries this passcode's device proof. */
export function hasDeviceProof(req: Request): boolean {
  if (!process.env.HOUSEHOLD_PASSCODE) return false;
  const a = Buffer.from(cookie(req, DEVICE_COOKIE)), b = Buffer.from(proof());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The Set-Cookie for this phone's device proof: a year, sent only to the API, never readable by the page. */
export const deviceCookie = () => `${DEVICE_COOKIE}=${proof()}; Path=/api; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;

export type Verdict = { ok: true; prove: boolean } | { ok: false; status: 401 | 429 };

/**
 * The passcode check every route makes. The right passcode with the device proof is let in without counting; anything
 * else is counted (when it's a new wrong one) and judged in one step. `prove`: set the device proof on the answer. A
 * failure to count never locks anyone out.
 */
export async function checkPasscode(req: Request): Promise<Verdict> {
  const right = authorized(req);
  if (right && hasDeviceProof(req)) return { ok: true, prove: false };
  // Every header is read before the catch (Nov 19): reading them is how Next learns a route is live, and a catch around
  // them swallowed that at build time (twice).
  const ip = clientIp(req), typed = req.headers.get("x-passcode") ?? "";
  let n = 0, counted = false;
  try { [n, counted] = await attempt(ip, typed, !right); } catch (e) { console.error("couldn't count a passcode", e); }
  if (right) return n >= LIMIT ? { ok: false, status: 429 } : { ok: true, prove: true };
  return !counted && n >= LIMIT ? { ok: false, status: 429 } : { ok: false, status: 401 };
}
