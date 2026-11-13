// Face ID for ordering (docs/CHECKOUT.md, "Each order", Nov 12): each phone in the household sets up a passkey in
// Settings → Ordering, and placing an order will need a Face ID check on one of them. This file only sets them up and
// checks them, single use; nothing here approves or places an order. Every set-up and every check, ok or not, is recorded.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { record } from "./checkout";
import { AppError } from "./errors";
import { appendRows, readTabIfAny, replaceTab, sheetsConfigured } from "./google/sheets";
import { redis } from "./google/redis-tabs";
import { TZ } from "./time";

export type Passkey = { id: string; publicKey: string; counter: number; name: string; created: string };
export type Purpose = "register" | "check";
export type Checked = { ok: boolean; credentialId?: string; why?: string };
/** A result with what the library said went wrong, kept for the record only (never sent to the phone). */
type Inner = Checked & { error?: string };

/** A challenge is good for 2 minutes, the same as an approval (docs/CHECKOUT.md). */
export const CHALLENGE_MS = 2 * 60_000;

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

// ---- challenges: kept on the server, 2 minutes, single use

type Challenge = { purpose: Purpose; created: number; rpID: string };
const CHALLENGE_KEY = "simmer:checkout-challenge:";
const memoryChallenges = new Map<string, Challenge>();

/**
 * What Redis needs to give for challenges. Not a tab like the rest of the data (Nov 12): a tab is read, changed and
 * written back, so two checks sent at once with the same challenge could both read it before either took it out.
 * GETDEL takes it out in one step, so only one can ever have it; the expiry makes Redis drop the ones never used.
 */
type ChallengeStore = { set(k: string, v: string, o: { ex: number }): Promise<unknown>; getdel(k: string): Promise<string | null> };
const challengeStore = () => redis() as unknown as ChallengeStore | null;

async function keepChallenge(challenge: string, c: Challenge) {
  const s = challengeStore();
  if (!s) {
    // Without Redis (tests, the click-through checks): in memory, dropping the old ones as new ones come.
    for (const [k, v] of memoryChallenges) if (c.created - v.created > CHALLENGE_MS) memoryChallenges.delete(k);
    memoryChallenges.set(challenge, c);
    return;
  }
  await s.set(CHALLENGE_KEY + challenge, JSON.stringify(c), { ex: Math.ceil(CHALLENGE_MS / 1000) + 5 });
}

/** The challenge, taken out as it's read: whatever happens next, it can't be used again. */
async function takeChallenge(challenge: string): Promise<Challenge | null> {
  const s = challengeStore();
  if (!s) {
    const c = memoryChallenges.get(challenge) ?? null;
    memoryChallenges.delete(challenge);
    return c;
  }
  const v = await s.getdel(CHALLENGE_KEY + challenge);
  if (!v) return null;
  try { return JSON.parse(v) as Challenge; } catch { return null; }
}

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
async function goodChallenge(req: Request, response: unknown, purpose: Purpose, now = Date.now()): Promise<{ challenge: string } | { why: string }> {
  const challenge = challengeOf(response as { response?: { clientDataJSON?: unknown } });
  if (!challenge) return { why: "That Face ID answer couldn't be read." };
  const c = await takeChallenge(challenge);
  if (!c) return { why: "That Face ID check was already used or ran out. Try again." };
  if (c.purpose !== purpose) return { why: "That Face ID check was for something else. Try again." };
  if (!(now - c.created <= CHALLENGE_MS)) return { why: "That Face ID check ran out. Try again." };
  if (c.rpID !== site(req).rpID) return { why: "That Face ID check came from somewhere else." };
  return { challenge };
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

// ---- setting up Face ID

export async function registrationOptions(req: Request): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID } = site(req);
  const have = await loadPasskeys();
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
  await keepChallenge(options.challenge, { purpose: "register", created: Date.now(), rpID });
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
  if ((await loadPasskeys()).some((p) => p.id === credential.id)) return { ok: false, credentialId: credential.id, why: "Face ID is already set up here." };
  const now = new Date();
  await addPasskey({
    id: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter,
    name: nameNow(now), created: now.toISOString(),
  });
  return { ok: true, credentialId: credential.id };
}

// ---- a Face ID check

export async function checkOptions(req: Request): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = site(req);
  const have = await loadPasskeys();
  if (!have.length) throw new AppError("Face ID isn't set up yet. Set it up in Settings.");
  const options = await generateAuthenticationOptions({
    rpID, allowCredentials: have.map((p) => ({ id: p.id })), userVerification: "required", timeout: CHALLENGE_MS,
  });
  await keepChallenge(options.challenge, { purpose: "check", created: Date.now(), rpID });
  return options;
}

export async function verifyCheck(req: Request, response: unknown): Promise<Checked> {
  const out = await checking(req, response);
  await record("face id check", { ok: out.ok, credentialId: out.credentialId ?? idOf(response), why: out.why ?? "", error: out.error ?? "" });
  return { ok: out.ok, credentialId: out.credentialId, why: out.why };
}

async function checking(req: Request, response: unknown): Promise<Inner> {
  // The challenge is taken before anything else, so a check for an unknown passkey uses it up too.
  const good = await goodChallenge(req, response, "check");
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
  return { ok: true, credentialId: key.id };
}

/** The passkey's id from an answer, for the record and the lookup; empty when it isn't one. */
function idOf(response: unknown): string {
  const id = (response as { id?: unknown } | null)?.id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,1024}$/.test(id) ? id : "";
}
/** What the library said went wrong, for the record only (never shown). */
const detail = (e: unknown) => ({ error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });

/** For tests. */
export const resetPasskeys = () => { memoryKeys = []; memoryChallenges.clear(); };
