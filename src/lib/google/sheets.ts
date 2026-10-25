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

export async function readTab(tab: string): Promise<string[][]> {
  const r = await fetch(`${base()}/${encodeURIComponent(tab)}`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Couldn't read the "${tab}" tab (${r.status})`);
  return ((await r.json()).values ?? []) as string[][];
}

export const appendRow = (tab: string, row: string[]) => appendRows(tab, [row]);

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
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}:batchUpdate`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok && !(await r.text()).includes("already exists")) throw new Error(`Couldn't create the "${title}" tab (${r.status})`);
}

/** Replaces a tab's contents. */
export async function replaceTab(title: string, rows: string[][]): Promise<void> {
  await ensureTab(title);
  const auth = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
  const clear = await fetch(`${base()}/${encodeURIComponent(title)}:clear`, { method: "POST", headers: auth, signal: AbortSignal.timeout(10_000) });
  if (!clear.ok) throw new Error(`Couldn't clear the "${title}" tab (${clear.status})`);
  const put = await fetch(`${base()}/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ values: rows }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!put.ok) throw new Error(`Couldn't write the "${title}" tab (${put.status})`);
}
