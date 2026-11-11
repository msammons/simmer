// Google Sheets via a service account (no SDK). The Sheet must be shared with the service account's email.
import { createSign } from "node:crypto";

type ServiceAccount = { client_email: string; private_key: string };
let token: { value: string; expires: number } | null = null;

// This app's Sheet. Not a secret (it grants no access without the service account key); SHEET_ID in Vercel overrides it.
const SHEET = "1FOQPuSPWntp6VURMw97-olFmd-xFs3LbuK104Eo6uEM";
const sheetId = () => process.env.SHEET_ID || SHEET;

/** With the service account key the app uses its Sheet; without it (local dev, tests) it reads data/*.csv. */
export function sheetsConfigured() {
  return Boolean(sheetId() && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function serviceAccount(): ServiceAccount {
  // The whole key file's JSON, pasted into one env var (works locally and on Vercel).
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  return { client_email: sa.client_email, private_key: String(sa.private_key).replace(/\\n/g, "\n") };
}

async function accessToken(): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const sa = serviceAccount();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Google sign-in for Sheets failed (${r.status})`);
  const j = await r.json();
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

const base = () => `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values`;

export class ReadFailed extends Error { constructor(tab: string, public status: number) { super(`Couldn't read the "${tab}" tab (${status})`); } }

// Tabs known to be there (read or created by this server), so ensureTab needn't spend a write asking again (an
// addSheet counts against the same writes-a-minute limit as a change).
const known = new Set<string>();

export async function readTab(tab: string): Promise<string[][]> {
  const get = async () => fetch(`${base()}/${encodeURIComponent(tab)}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(10_000),
  });
  let r = await get();
  // Over the Sheet's reads-a-minute limit: one more try a moment later.
  if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); r = await get(); }
  if (!r.ok) { if (r.status === 400) known.delete(tab); throw new ReadFailed(tab, r.status); }
  known.add(tab);
  return ((await r.json()).values ?? []) as string[][];
}

/** A tab's rows, or none when the tab doesn't exist yet. Any other failure throws (it isn't an empty tab). */
export const readTabIfAny = (tab: string) => readTab(tab).catch((e) => { if (e instanceof ReadFailed && e.status === 400) return [] as string[][]; throw e; });

export async function appendRows(tab: string, rows: string[][]): Promise<void> {
  if (!rows.length) return;
  const r = await fetch(`${base()}/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ values: rows }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Couldn't write to the "${tab}" tab (${r.status})`);
}

/** Creates the tab if it doesn't exist yet. */
export async function ensureTab(title: string): Promise<void> {
  if (known.has(title)) return;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}:batchUpdate`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok && !(await r.text()).includes("already exists")) throw new Error(`Couldn't create the "${title}" tab (${r.status})`);
  known.add(title);
}

/**
 * Replaces a tab's contents. `before`: the tab as it was just read, so the new rows go in one request, with blanks over
 * whatever is left of the old rows and columns (without it: create if missing, clear, then write).
 */
export async function replaceTab(title: string, rows: string[][], before?: string[][]): Promise<void> {
  const auth = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
  let values = rows;
  if (before?.length) {
    const width = Math.max(0, ...before.map((r) => r.length), ...rows.map((r) => r.length));
    values = Array.from({ length: Math.max(before.length, rows.length) }, (_, i) => { const r = rows[i] ?? []; return [...r, ...Array<string>(width - r.length).fill("")]; });
  } else {
    await ensureTab(title);
    const clear = await fetch(`${base()}/${encodeURIComponent(title)}:clear`, { method: "POST", headers: auth, signal: AbortSignal.timeout(10_000) });
    if (!clear.ok) throw new Error(`Couldn't clear the "${title}" tab (${clear.status})`);
  }
  const put = await fetch(`${base()}/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ values }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!put.ok) throw new Error(`Couldn't write the "${title}" tab (${put.status})`);
}

/**
 * Many A1 ranges written in one request (Nov 10: one write per cell ran into Google's limit of about 60 writes a
 * minute, "It's busy right now", after a few quick taps).
 */
export async function updateRanges(data: { range: string; values: string[][] }[]): Promise<void> {
  if (!data.length) return;
  const r = await fetch(`${base()}:batchUpdate`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ valueInputOption: "RAW", data }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Couldn't update ${data[0].range.split("!")[0]} (${r.status})`);
}

/** Writes rows at an A1 range ("List!I5:J5"): how one row's cells change without touching anyone else's rows. */
export async function updateRange(range: string, rows: string[][]): Promise<void> {
  const r = await fetch(`${base()}/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ values: rows }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Couldn't update ${range.split("!")[0]} (${r.status})`);
}
