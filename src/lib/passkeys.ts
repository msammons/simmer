// Face ID for ordering (docs/CHECKOUT.md, "Each order", Nov 12): each phone in the household sets up a passkey in
// Settings → Ordering, and placing an order will need a Face ID check on one of them. This file only sets them up and
// checks them, single use; nothing here approves or places an order. Every set-up and every check, ok or not, is recorded.
// Adding a phone (Sam, Nov 12, after the outside review): the passcode alone sets up the first phone; after that a new
// phone asks, a phone that already has Face ID approves it with Face ID, and only then can the new one set up.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { randomBytes, randomInt } from "node:crypto";
import { record } from "./checkout";
import { AppError } from "./errors";
import { appendRows, readTabIfAny, replaceTab, sheetsConfigured } from "./google/sheets";
import { redis } from "./google/redis-tabs";
import { TZ } from "./time";

export type Passkey = { id: string; publicKey: string; counter: number; name: string; created: string };
export type Purpose = "register" | "check" | "approve";
export type Checked = { ok: boolean; credentialId?: string; why?: string };
/** A result with what the library said went wrong, kept for the record only (never sent to the phone). */
type Inner = Checked & { error?: string };

/** A challenge is good for 2 minutes, the same as an approval (docs/CHECKOUT.md). */
export const CHALLENGE_MS = 2 * 60_000;
/** A new phone's request to be added is good for 5 minutes (Sam, Nov 12). */
export const ADD_MS = 5 * 60_000;

// ---- where Simmer is: the passkey belongs to the address the phone is on

/**
 * The site's id and address, from the request's host. Https everywhere but on this computer (localhost), where the
 * browser allows Face ID over http. The browser itself binds the passkey to the address it's on, so a wrong host only
 * makes the check fail; it can't make one pass.
 */
export function site(req: Request): { rpID: string; origin: string } {
  const host = (req.headers.get("host") || new URL(req.url).host).toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(host)) throw new AppError("Face ID can't be used from this address.");
  const rpID = host.replace(/:\d+$/, "");
  const local = rpID === "localhost" || rpID.endsWith(".localhost");
  return { rpID, origin: `${local ? "http" : "https"}://${host}` };
}

// ---- short-lived things kept on the server: challenges and a new phone's request

/**
 * What Redis needs to give here. Not tabs like the rest of the data (Nov 12): a tab is read, changed and written back,
 * so two answers sent at once with the same challenge (or the same approval) could both read it before either took it
 * out. GETDEL takes it out in one step, so only one can ever have it; the expiry makes Redis drop the ones never used.
 */
type Kv = {
  set(k: string, v: string, o: { ex: number }): Promise<unknown>;
  get(k: string): Promise<string | null>;
  getdel(k: string): Promise<string | null>;
  del(k: string): Promise<unknown>;
};
// Without Redis (tests, the click-through checks): in memory, each with the time it's dropped.
const memoryKv = new Map<string, { v: string; until: number }>();
const memoryGet = (k: string) => {
  const e = memoryKv.get(k);
  if (e && e.until < Date.now()) memoryKv.delete(k);
  return e && e.until >= Date.now() ? e.v : null;
};
const inMemory: Kv = {
  set: async (k, v, o) => { memoryKv.set(k, { v, until: Date.now() + o.ex * 1000 }); },
  get: async (k) => memoryGet(k),
  getdel: async (k) => { const v = memoryGet(k); memoryKv.delete(k); return v; },
  del: async (k) => { memoryKv.delete(k); },
};
const kv = (): Kv => (redis() as unknown as Kv | null) ?? inMemory;
const json = <T>(v: string | null): T | null => { if (!v) return null; try { return JSON.parse(v) as T; } catch { return null; } };
const secs = (ms: number) => Math.ceil(ms / 1000) + 5;

/** A challenge; one for approving a new phone carries that request's token, so it can approve only that one. */
type Challenge = { purpose: Purpose; created: number; rpID: string; token?: string };
const CHALLENGE_KEY = "simmer:checkout-challenge:";

const keepChallenge = (challenge: string, c: Challenge) => kv().set(CHALLENGE_KEY + challenge, JSON.stringify(c), { ex: secs(CHALLENGE_MS) });
/** The challenge, taken out as it's read: whatever happens next, it can't be used again. */
const takeChallenge = async (challenge: string) => json<Challenge>(await kv().getdel(CHALLENGE_KEY + challenge));

/** The challenge the phone signed, read from its answer (the library checks it again against the one taken). */
function challengeOf(response: { response?: { clientDataJSON?: unknown } } | null | undefined): string {
  const raw = response?.response?.clientDataJSON;
  if (typeof raw !== "string" || raw.length > 4096) return "";
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))?.challenge;
    return typeof c === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(c) ? c : "";
  } catch { return ""; }
}

/**
 * The challenge for this answer, if it's good: there, never used, for this purpose, on this site, under 2 minutes old.
 * It's taken out first, so a failed check uses it up too.
 */
async function goodChallenge(req: Request, response: unknown, purpose: Purpose, now = Date.now()): Promise<{ challenge: string; token?: string } | { why: string }> {
  const challenge = challengeOf(response as { response?: { clientDataJSON?: unknown } });
  if (!challenge) return { why: "That Face ID answer couldn't be read." };
  const c = await takeChallenge(challenge);
  if (!c) return { why: "That Face ID check was already used or ran out. Try again." };
  if (c.purpose !== purpose) return { why: "That Face ID check was for something else. Try again." };
  if (!(now - c.created <= CHALLENGE_MS)) return { why: "That Face ID check ran out. Try again." };
  if (c.rpID !== site(req).rpID) return { why: "That Face ID check came from somewhere else." };
  return { challenge, token: c.token };
}

// ---- passkeys, in the "Checkout passkeys" tab (in memory without Redis)

const TAB = "Checkout passkeys";
const HEADERS = ["id", "public key", "counter", "name", "created"];
let memoryKeys: Passkey[] = [];

const passkeyOf = (r: string[]): Passkey | null => {
  const counter = Number(r[2]);
  if (!r[0] || !r[1] || !Number.isInteger(counter) || counter < 0) return null; // a row that doesn't read never passes a check
  return { id: r[0], publicKey: r[1], counter, name: r[3] ?? "", created: r[4] ?? "" };
};
const rowOf = (p: Passkey) => [p.id, p.publicKey, String(p.counter), p.name, p.created];

export async function loadPasskeys(): Promise<Passkey[]> {
  if (!sheetsConfigured()) return memoryKeys.map((p) => ({ ...p }));
  const rows = await readTabIfAny(TAB);
  return rows.slice(rows[0]?.[0] === "id" ? 1 : 0).map(passkeyOf).filter((p): p is Passkey => p !== null);
}
export const passkeyCount = async () => (await loadPasskeys()).length;

async function addPasskey(p: Passkey) {
  if (!sheetsConfigured()) { memoryKeys.push({ ...p }); return; }
  const rows = await readTabIfAny(TAB);
  if (!rows.length) await replaceTab(TAB, [HEADERS, rowOf(p)]);
  else await appendRows(TAB, [rowOf(p)]);
}

async function saveCounter(id: string, counter: number) {
  if (!sheetsConfigured()) { memoryKeys = memoryKeys.map((p) => (p.id === id ? { ...p, counter } : p)); return; }
  const rows = await readTabIfAny(TAB);
  await replaceTab(TAB, rows.map((r, i) => (i > 0 && r[0] === id ? [r[0], r[1], String(counter), ...r.slice(3)] : r)));
}

/** "Face ID on this phone, Nov 12", by the household's calendar. */
const nameNow = (at: Date) => `Face ID on this phone, ${at.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })}`;

// ---- adding a phone once one has Face ID: the new phone asks, a phone with Face ID approves, the new one sets up

/**
 * The one request to be added (a new one replaces it): a token only the new phone gets, a 6-digit code shown on both
 * phones so the person approving can see it's the right one, and when it was made. The approval is kept under its own
 * key, by token, so a request replaced while it was being approved can never come back approved.
 */
type Add = { token: string; code: string; created: number };
const ADD_KEY = "simmer:checkout-add";
const APPROVED_KEY = "simmer:checkout-add-approved:";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const currentAdd = async (now = Date.now()): Promise<Add | null> => {
  const a = json<Add>(await kv().get(ADD_KEY));
  return a && TOKEN.test(a.token ?? "") && now - a.created <= ADD_MS ? a : null;
};
const isApproved = async (token: string) => Boolean(await kv().get(APPROVED_KEY + token));

/** The new phone: ask to be added. Only once a phone has Face ID; the first sets up with the passcode alone. */
export async function askToAdd(): Promise<{ token: string; code: string }> {
  if (!(await passkeyCount())) throw new AppError("No phone has Face ID yet, so this one can set it up straight away.");
  const add: Add = { token: randomBytes(32).toString("base64url"), code: String(randomInt(0, 1_000_000)).padStart(6, "0"), created: Date.now() };
  await kv().set(ADD_KEY, JSON.stringify(add), { ex: secs(ADD_MS) });
  await record("face id add asked", { code: add.code });
  return { token: add.token, code: add.code };
}

/** A phone with Face ID: the code of the request waiting for approval, if there is one. */
export async function addWaiting(): Promise<{ code: string } | null> {
  const a = await currentAdd();
  return a && !(await isApproved(a.token)) ? { code: a.code } : null;
}

/** A phone with Face ID: a Face ID check to approve the request waiting now (and only that one). */
export async function approveOptions(req: Request): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; code: string }> {
  const a = await currentAdd();
  if (!a || (await isApproved(a.token))) throw new AppError("There's no new phone waiting. Tap Add this phone on it first.");
  return { options: await authOptions(req, "approve", a.token), code: a.code };
}

/** A phone with Face ID: approve the new phone, if Face ID passes and the request it was for is still the one waiting. */
export async function verifyApprove(req: Request, response: unknown): Promise<Checked> {
  let out: Inner & { code?: string; token?: string } = await checking(req, response, "approve");
  if (out.ok) {
    const a = await currentAdd();
    if (!a || !out.token || a.token !== out.token) out = { ok: false, credentialId: out.credentialId, why: "That new phone's request ran out or was replaced. Ask again on the new phone." };
    else {
      await kv().set(APPROVED_KEY + a.token, JSON.stringify({ by: out.credentialId, at: Date.now() }), { ex: secs(ADD_MS - (Date.now() - a.created)) });
      out = { ...out, code: a.code };
    }
  }
  await record("face id add approved", { ok: out.ok, credentialId: out.credentialId ?? idOf(response), code: out.code ?? "", why: out.why ?? "", error: out.error ?? "" });
  return { ok: out.ok, credentialId: out.credentialId, why: out.why };
}

/** Why a new phone can't set up with this token yet, or null when it can (unexpired, and approved). */
async function addRefused(token: string | undefined): Promise<string | null> {
  const a = await currentAdd();
  if (!token || !TOKEN.test(token) || !a || a.token !== token) return "Another phone already has Face ID. Tap Add this phone, then approve it there.";
  if (!(await isApproved(token))) return `Approve this phone on the other phone first: it shows ${a.code}.`;
  return null;
}

// ---- setting up Face ID

/** With a phone already set up, `token` must be an approved request to add this one (see above). */
export async function registrationOptions(req: Request, token?: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = site(req);
  const have = await loadPasskeys();
  if (have.length) {
    const why = await addRefused(token);
    if (why) { await record("face id set up refused", { why }); throw new AppError(why); }
  }
  const options = await generateRegistrationOptions({
    rpName: "Simmer",
    rpID,
    userName: "Simmer household",
    userDisplayName: "Simmer household",
    attestationType: "none",
    // A phone already set up isn't set up twice.
    excludeCredentials: have.map((p) => ({ id: p.id })),
    // Face ID itself (not just a tap), kept on the phone so it can be found without a name.
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    timeout: CHALLENGE_MS,
  });
  await keepChallenge(options.challenge, { purpose: "register", created: Date.now(), rpID, ...(have.length && { token }) });
  return options;
}

export async function verifyRegistration(req: Request, response: unknown): Promise<Checked> {
  const out = await registering(req, response);
  await record("face id set up", { ok: out.ok, credentialId: out.credentialId ?? idOf(response), why: out.why ?? "", error: out.error ?? "" });
  return { ok: out.ok, credentialId: out.credentialId, why: out.why };
}

async function registering(req: Request, response: unknown): Promise<Inner> {
  const good = await goodChallenge(req, response, "register");
  if ("why" in good) return { ok: false, why: good.why };
  const { rpID, origin } = site(req);
  let v: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    v = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON, expectedChallenge: good.challenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserPresence: true, requireUserVerification: true,
    });
  } catch (e) {
    return { ok: false, why: "Face ID couldn't be set up.", ...detail(e) };
  }
  if (!v.verified || !v.registrationInfo.userVerified) return { ok: false, why: "Face ID couldn't be set up." };
  const { credential } = v.registrationInfo;
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(credential.id) || !Number.isInteger(credential.counter) || credential.counter < 0) {
    return { ok: false, why: "Face ID couldn't be set up." };
  }
  const have = await loadPasskeys();
  if (have.some((p) => p.id === credential.id)) return { ok: false, credentialId: credential.id, why: "Face ID is already set up here." };
  if (have.length) {
    // Checked again here, as phones may have been set up since the challenge; the approval is taken out in one step,
    // so of two set-ups sent at once with one approval only one is added.
    const why = await addRefused(good.token);
    if (why) return { ok: false, credentialId: credential.id, why };
    if (!(await kv().getdel(APPROVED_KEY + good.token))) return { ok: false, credentialId: credential.id, why: "That approval was already used. Ask again on this phone." };
    await kv().del(ADD_KEY);
  }
  const now = new Date();
  await addPasskey({
    id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter,
    name: nameNow(now), created: now.toISOString(),
  });
  if (have.length) await record("face id phone added", { credentialId: credential.id, phones: have.length + 1 });
  return { ok: true, credentialId: credential.id };
}

// ---- a Face ID check

export const checkOptions = (req: Request) => authOptions(req, "check");

async function authOptions(req: Request, purpose: "check" | "approve", token?: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = site(req);
  const have = await loadPasskeys();
  if (!have.length) throw new AppError("Face ID isn't set up yet. Set it up in Settings.");
  const options = await generateAuthenticationOptions({
    rpID, allowCredentials: have.map((p) => ({ id: p.id })), userVerification: "required", timeout: CHALLENGE_MS,
  });
  await keepChallenge(options.challenge, { purpose, created: Date.now(), rpID, ...(token && { token }) });
  return options;
}

export async function verifyCheck(req: Request, response: unknown): Promise<Checked> {
  const out = await checking(req, response, "check");
  await record("face id check", { ok: out.ok, credentialId: out.credentialId ?? idOf(response), why: out.why ?? "", error: out.error ?? "" });
  return { ok: out.ok, credentialId: out.credentialId, why: out.why };
}

async function checking(req: Request, response: unknown, purpose: "check" | "approve"): Promise<Inner & { token?: string }> {
  // The challenge is taken before anything else, so a check for an unknown passkey uses it up too.
  const good = await goodChallenge(req, response, purpose);
  if ("why" in good) return { ok: false, why: good.why };
  const id = idOf(response);
  const key = id ? (await loadPasskeys()).find((p) => p.id === id) : undefined;
  if (!key) return { ok: false, why: "Face ID here isn't set up for ordering." };
  const { rpID, origin } = site(req);
  let v: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    v = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON, expectedChallenge: good.challenge, expectedOrigin: origin, expectedRPID: rpID,
      credential: { id: key.id, publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")), counter: key.counter },
      requireUserVerification: true,
    });
  } catch (e) {
    return { ok: false, credentialId: key.id, why: "Face ID didn't match.", ...detail(e) };
  }
  const info = v.authenticationInfo;
  if (!v.verified || !info?.userVerified || info.credentialID !== key.id) return { ok: false, credentialId: key.id, why: "Face ID didn't match." };
  // The library checks this too; kept here so it holds whatever the library does. Phones that don't count (always 0)
  // pass; once a phone has counted, the count must go up, or the answer may be a copy.
  if (!Number.isInteger(info.newCounter) || info.newCounter < 0 || ((info.newCounter > 0 || key.counter > 0) && info.newCounter <= key.counter)) {
    return { ok: false, credentialId: key.id, why: "Face ID here answered out of order. Try again." };
  }
  if (info.newCounter !== key.counter) await saveCounter(key.id, info.newCounter);
  return { ok: true, credentialId: key.id, token: good.token };
}

/** The passkey's id from an answer, for the record and the lookup; empty when it isn't one. */
function idOf(response: unknown): string {
  const id = (response as { id?: unknown } | null)?.id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,1024}$/.test(id) ? id : "";
}
/** What the library said went wrong, for the record only (never shown). */
const detail = (e: unknown) => ({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });

/** For tests. */
export const resetPasskeys = () => { memoryKeys = []; memoryKv.clear(); };
