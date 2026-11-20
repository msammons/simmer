// Production safety (Nov 19): the wrong-passcode limit, the day's caps, the owner's error list, backups on events, and
// the routes' shared wrapper. All in memory (no Redis), except the backup, which runs against a pretend Redis.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => { void fn(); } }));

import { AppError } from "../errors";
import { resetKv } from "../kv";
import { UpstreamError } from "../errors";
import { resetCounters } from "./counter";
import { checkPasscode, clientIp, DEVICE_COOKIE, LIMIT, LOCKED, resetLockout } from "./lockout";
import { CAPS, counting, withinCap } from "./caps";
import { latestErrors, messageOf, recordError, scrub, KEEP_ERRORS } from "./errors";
import { BACKUP_PREFIX, KEEP_BACKUPS, MAX_TAB_BYTES, snapshot, writeBackup } from "./backup";
import { api, clean } from "./route";
import { backupTimes, readBackup, restoreCommand, run as restore, RESTORE } from "../../../scripts/restore.mjs";

const req = (passcode: string, ip = "1.2.3.4", url = "http://x/api/list?secret=1", cookie = "") =>
  new Request(url, { headers: { "x-passcode": passcode, "x-real-ip": ip, ...(cookie && { cookie }) } });
/** True when let in. */
const passcodeOk = async (r: Request) => (await checkPasscode(r)).ok;
const status = async (r: Request) => { const v = await checkPasscode(r); return v.ok ? 200 : v.status; };

beforeEach(() => {
  process.env.HOUSEHOLD_PASSCODE = "right-one";
  resetKv();
  resetCounters();
  resetLockout();
});

describe("wrong passcodes", () => {
  it("lets the right passcode through and never counts it", async () => {
    for (let i = 0; i < LIMIT * 2; i++) expect(await passcodeOk(req("right-one"))).toBe(true);
  });

  it("turns an address down after twenty different wrong ones, even with the right one, and only that address", async () => {
    expect(LIMIT).toBe(20);
    for (let i = 0; i < LIMIT - 1; i++) expect(await status(req(`guess-${i}`))).toBe(401);
    expect(await passcodeOk(req("right-one"))).toBe(true);
    expect(await status(req("guess-last"))).toBe(401);
    expect(await status(req("right-one"))).toBe(429);
    expect(await status(req("another"))).toBe(429);
    expect(await status(req("guess-0"))).toBe(429);
    expect(await passcodeOk(req("right-one", "5.6.7.8"))).toBe(true);
  });

  it("judges at most the limit of guesses from a burst sent at once", async () => {
    const answers = await Promise.all(Array.from({ length: LIMIT * 3 }, (_, i) => status(req(`burst-${i}`))));
    expect(answers.filter((a) => a === 401)).toHaveLength(LIMIT);
    expect(answers.filter((a) => a === 429)).toHaveLength(LIMIT * 2);
    expect(await status(req("right-one"))).toBe(429);
  });

  it("counts the same wrong passcode again only once (a saved one that changed)", async () => {
    for (let i = 0; i < LIMIT * 3; i++) expect(await status(req("old-one"))).toBe(401);
    expect(await passcodeOk(req("right-one"))).toBe(true);
  });

  it("lifts the lockout after 15 minutes", async () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < LIMIT; i++) await passcodeOk(req(`g${i}`));
      expect(await passcodeOk(req("right-one"))).toBe(false);
      vi.advanceTimersByTime(15 * 60 * 1000 + 1000);
      expect(await passcodeOk(req("right-one"))).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("reads the address Vercel gives, an IPv6 one by its /64, or local", () => {
    const ip = (h: Record<string, string>) => clientIp(new Request("http://x", { headers: h }));
    expect(ip({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" })).toBe("9.9.9.9");
    expect(ip({ "x-real-ip": "2001:db8:aa:bb:1:2:3:4" })).toBe("2001:db8:aa:bb::/64");
    expect(ip({ "x-real-ip": "2001:0db8:00aa:00bb::9" })).toBe("2001:db8:aa:bb::/64");
    expect(ip({ "x-real-ip": "2001:db8::1" })).toBe("2001:db8:0:0::/64");
    expect(ip({ "x-real-ip": "::ffff:1.2.3.4" })).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });

  it("counts every address in one /64 together", async () => {
    for (let i = 0; i < LIMIT; i++) await passcodeOk(req(`g${i}`, `2001:db8:1:2::${(i + 1).toString(16)}`));
    expect(await status(req("right-one", "2001:db8:1:2:ffff::1"))).toBe(429);
    expect(await passcodeOk(req("right-one", "2001:db8:1:3::1"))).toBe(true);
  });
});

describe("reading headers", () => {
  // Next marks a route live by throwing when it reads headers while prerendering; that must never be caught (Nov 19).
  it("lets an error from reading headers through, wrong passcode or none", async () => {
    const sentinel = new Error("dynamic usage");
    const req = { headers: { get: () => { throw sentinel; } } } as unknown as Request;
    await expect(checkPasscode(req)).rejects.toBe(sentinel);
  });
});

describe("a phone that has signed in before", () => {
  const proofFrom = async () => {
    const res = await api(async () => Response.json({ ok: true }))(req("right-one"));
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(new RegExp(`^${DEVICE_COOKIE}=[0-9a-f]{32}; Path=/api; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
    return set.split(";")[0];
  };

  it("gets a device proof with the right passcode, never with a wrong one", async () => {
    await proofFrom();
    const wrong = await api(async () => Response.json({ ok: true }))(req("nope"));
    expect(wrong.headers.get("set-cookie")).toBeNull();
  });

  it("is let in with its proof and the right passcode while its address is turned down", async () => {
    const proof = await proofFrom();
    for (let i = 0; i < LIMIT; i++) await passcodeOk(req(`g${i}`));
    expect(await status(req("right-one"))).toBe(429);
    expect(await status(req("right-one", "1.2.3.4", undefined, `a=b; ${proof}`))).toBe(200);
    // The proof alone is nothing: a wrong passcode with it is still turned down.
    expect(await status(req("guess", "1.2.3.4", undefined, proof))).toBe(429);
    // A proof made with another passcode doesn't count.
    expect(await status(req("right-one", "1.2.3.4", undefined, `${DEVICE_COOKIE}=${"0".repeat(32)}`))).toBe(429);
  });

  it("isn't sent the proof again once it has it", async () => {
    const proof = await proofFrom();
    const res = await api(async () => Response.json({ ok: true }))(req("right-one", "1.2.3.4", undefined, proof));
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("loses its proof's use when the passcode changes", async () => {
    const proof = await proofFrom();
    for (let i = 0; i < LIMIT; i++) await passcodeOk(req(`g${i}`));
    process.env.HOUSEHOLD_PASSCODE = "new-one";
    expect(await status(req("new-one", "1.2.3.4", undefined, proof))).toBe(429);
  });
});

describe("the day's caps", () => {
  it("allows up to the cap, then says no until the next day", async () => {
    const day = new Date("2026-11-19T18:00:00Z"), next = new Date("2026-11-20T18:00:00Z");
    for (let i = 0; i < CAPS.read; i++) expect(await withinCap("read", day)).toBe(true);
    expect(await withinCap("read", day)).toBe(false);
    expect(await withinCap("filing", day)).toBe(true);
    expect(await withinCap("read", next)).toBe(true);
  });

  it("counts a request once, however many readings it makes inside", async () => {
    const day = new Date("2026-11-21T18:00:00Z");
    for (let i = 0; i < CAPS.read - 1; i++) await withinCap("read", day);
    expect(await withinCap("read", day)).toBe(true); // the route's count: the last one today
    expect(await counting("read", async () => [await withinCap("read", day), await withinCap("read", day)])).toEqual([true, true]);
    expect(await withinCap("read", day)).toBe(false);
  });
});

describe("the owner's error list", () => {
  it("takes out the passcode, emails, long numbers and links' queries", () => {
    expect(scrub("bad right-one for sam@example.com card 4111111111111111 at https://a.b/c?token=zz ok")).toBe("bad [passcode] for [email] card [number] at https://a.b/c ok");
  });

  it("keeps only the kind and status of a reply that didn't read and of another service's failure", () => {
    let bad: unknown;
    try { JSON.parse('{"name": "Grandma Rose\'s lasagna" oops'); } catch (e) { bad = e; }
    expect(messageOf(bad)).toBe("SyntaxError");
    expect(messageOf(new UpstreamError("Gemini", 400, "Gemini error 400: Robin's recipe text"))).toBe("UpstreamError: Gemini 400");
    expect(messageOf(new UpstreamError("Gemini", "no answer", "Gemini gave no answer (SAFETY)"))).toBe("UpstreamError: Gemini no answer");
    expect(messageOf(new Error("redis went away"))).toBe("redis went away");
  });

  it("keeps only the path and the newest 200", async () => {
    for (let i = 0; i < KEEP_ERRORS + 5; i++) await recordError({ route: "http://x/api/list?q=private", message: `boom ${i}` });
    const all = await latestErrors(1000);
    expect(all).toHaveLength(KEEP_ERRORS);
    expect(all.at(-1)).toMatchObject({ route: "/api/list", message: `boom ${KEEP_ERRORS + 4}` });
  });
});

describe("the routes' wrapper", () => {
  it("answers a wrong passcode with 401 and runs nothing", async () => {
    const run = vi.fn(async () => Response.json({ ok: true }));
    const res = await api(run)(req("nope"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Wrong passcode." });
    expect(run).not.toHaveBeenCalled();
  });

  it("answers a turned-down address with 429 and a plain message, never 401, and runs nothing", async () => {
    for (let i = 0; i < LIMIT; i++) await api(async () => Response.json({}))(req(`g${i}`));
    const run = vi.fn(async () => Response.json({ ok: true }));
    const res = await api(run)(req("right-one"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: LOCKED });
    expect(LOCKED).toBe("Too many wrong passcodes. Try again in a few minutes.");
    expect(run).not.toHaveBeenCalled();
  });

  it("answers people's problems as written (400) and records nothing", async () => {
    const res = await api(async () => { throw new AppError("Which store?"); })(req("right-one"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Which store?" });
    expect(await latestErrors()).toEqual([]);
  });

  it("answers anything else with a plain try again (502) and records it without the query", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await api(async () => { throw new Error("redis went away"); })(req("right-one"));
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await new Promise((r) => setTimeout(r, 0));
    expect(await latestErrors()).toMatchObject([{ route: "/api/list", method: "GET", message: "redis went away" }]);
  });

  it("cleans strings to one line", () => {
    expect(clean("  two\n  lines  ", 5)).toBe("two l");
    expect(clean(3)).toBe("");
  });
});

describe("backups", () => {
  function pretend() {
    const data = new Map<string, string>();
    return {
      data,
      async get(k: string) { return data.get(k) ?? null; },
      async set(k: string, v: string) { data.set(k, v); return "OK"; },
      async mget(...ks: string[]) { return ks.map((k) => data.get(k) ?? null); },
      async keys(p: string) { const pre = p.replace(/\*$/, ""); return [...data.keys()].filter((k) => k.startsWith(pre)); },
      async del(...ks: string[]) { ks.forEach((k) => data.delete(k)); },
    };
  }
  /** The pretend store as scripts/restore.mjs talks to Redis: one command at a time (EVAL run as RESTORE does). */
  const asRedis = (s: ReturnType<typeof pretend>) => async (cmd: string, ...a: (string | number)[]) => {
    if (cmd === "KEYS") return s.keys(String(a[0]));
    if (cmd === "GET") return s.get(String(a[0]));
    if (cmd === "MGET") return s.mget(...a.map(String));
    if (cmd === "EVAL") {
      expect(a[0]).toBe(RESTORE);
      const n = Number(a[1]), keys = a.slice(2, 2 + n).map(String), args = a.slice(2 + n).map(String), half = n / 2;
      for (let i = 0; i < half; i++) { s.data.set(keys[i], args[i]); s.data.set(keys[half + i], String(Number(s.data.get(keys[half + i]) ?? 0) + 1)); }
      return half;
    }
    throw new Error(`unexpected ${cmd}`);
  };

  it("keeps the tabs as they were before the change, one key per tab and an index, never the Checkout tabs", async () => {
    const s = pretend();
    s.data.set("simmer:tab:List", JSON.stringify([["item"], ["milk"]]));
    s.data.set("simmer:tab:Recipes", JSON.stringify([["name"]]));
    s.data.set("simmer:tab:Checkout", JSON.stringify([["on"], ["yes"]]));
    s.data.set("simmer:tab:Checkout passkeys", JSON.stringify([["cred-1", "key"]]));
    const snap = await snapshot(s, new Date("2026-11-19T00:00:00Z"));
    s.data.set("simmer:tab:List", JSON.stringify([["item"]])); // the change: done shopping
    const out = await writeBackup(snap!, s);
    const key = `${BACKUP_PREFIX}2026-11-19T00:00:00.000Z`;
    expect(out).toEqual({ key, skipped: [] });
    expect(JSON.parse(s.data.get(key)!)).toEqual({ tabs: ["List", "Recipes"], skipped: [] });
    expect(JSON.parse(s.data.get(`${key}:List`)!)).toEqual([["item"], ["milk"]]);
    expect(JSON.parse(s.data.get(`${key}:Recipes`)!)).toEqual([["name"]]);
    expect([...s.data.keys()].some((k) => k.startsWith(BACKUP_PREFIX) && k.includes("Checkout"))).toBe(false);
  });

  it("leaves out only a tab too big to keep, and keeps the rest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = pretend();
    const big = [["notes"], ["é".repeat(MAX_TAB_BYTES / 2 + 10)]]; // fewer characters than the limit, more bytes
    const out = await writeBackup({ at: new Date("2026-11-19T00:00:00Z"), tabs: [["Recipes", big], ["List", [["item"]]]] }, s);
    expect(out!.skipped).toEqual([{ tab: "Recipes", bytes: Buffer.byteLength(JSON.stringify(big)) }]);
    expect(JSON.parse(s.data.get(out!.key)!).tabs).toEqual(["List"]);
    expect(s.data.has(`${out!.key}:Recipes`)).toBe(false);
    expect(s.data.has(`${out!.key}:List`)).toBe(true);
  });

  it("keeps the newest 7, each made at once (no hourly wait), and drops older ones entirely", async () => {
    const s = pretend();
    const t0 = Date.parse("2026-11-19T00:00:00Z");
    for (let i = 0; i < 10; i++) await writeBackup({ at: new Date(t0 + i * 1000), tabs: [["List", [["item"], [`n${i}`]]], ["Recipes", [["name"]]]] }, s);
    const keys = await s.keys(`${BACKUP_PREFIX}*`);
    expect(backupTimes(keys, BACKUP_PREFIX)).toHaveLength(KEEP_BACKUPS);
    expect(keys).toHaveLength(KEEP_BACKUPS * 3);
    expect(keys.some((k) => k.includes("T00:00:02.000Z"))).toBe(false);
    expect(keys.some((k) => k.includes("T00:00:03.000Z"))).toBe(true);
  });

  it("does nothing without Redis", async () => {
    expect(await snapshot(null)).toBeNull();
  });

  it("restore: lists, shows what would change without writing, and puts back every tab in one step", async () => {
    const s = pretend();
    s.data.set("simmer:tab:List", JSON.stringify([["item"], ["milk"]]));
    s.data.set("simmer:tab:Checkout", JSON.stringify([["on"]]));
    s.data.set("simmer:tabv:List", "4");
    await writeBackup((await snapshot(s, new Date("2026-11-19T00:00:00Z")))!, s);
    s.data.set("simmer:tab:List", JSON.stringify([["item"]]));
    const redis = asRedis(s);
    expect((await restore(redis, "simmer", undefined, false)).join("\n")).toContain("2026-11-19T00:00:00.000Z");
    const dry = await restore(redis, "simmer", "latest", false);
    expect(dry).toContain("  List: 2 rows (now 1 rows)");
    expect(dry).toContain("Left as they are (not in the backup): Checkout");
    expect(dry.at(-1)).toBe("Nothing written. Add --apply to put these back.");
    expect(JSON.parse(s.data.get("simmer:tab:List")!)).toEqual([["item"]]); // nothing written
    expect(s.data.get("simmer:tabv:List")).toBe("4");
    await expect(restore(redis, "simmer", "2020-01-01T00:00:00.000Z", false)).rejects.toThrow(/No backup/);
    const done = await restore(redis, "simmer", "latest", true);
    expect(done.at(-1)).toBe("Put back 1 tabs.");
    expect(JSON.parse(s.data.get("simmer:tab:List")!)).toEqual([["item"], ["milk"]]);
    expect(s.data.get("simmer:tabv:List")).toBe("5");
  });

  it("restore: one EVAL with each tab's rows and version keys, and refuses a backup that isn't whole", async () => {
    expect(restoreCommand("simmer", { tabs: { List: [["a"]], Freezer: [["b"]] } })).toEqual(
      ["EVAL", RESTORE, 4, "simmer:tab:Freezer", "simmer:tab:List", "simmer:tabv:Freezer", "simmer:tabv:List", '[["b"]]', '[["a"]]']);
    const s = pretend();
    s.data.set(`${BACKUP_PREFIX}2026-11-19T00:00:00.000Z`, JSON.stringify({ tabs: ["List"], skipped: [] }));
    expect(await readBackup(asRedis(s), BACKUP_PREFIX, "2026-11-19T00:00:00.000Z")).toBeNull();
  });
});
