// Where Simmer keeps its data (Nov 11): Upstash Redis, each tab as its rows (redis-tabs.ts). Without Redis (local dev,
// tests) the app reads data/*.csv instead. The Google Sheet is only the target of Settings → Copy to Google Sheet: it's
// written there through a service account (no SDK), and never read.
import { createSign } from "node:crypto";
import * as R from "./redis-tabs";
import { redis } from "./redis-tabs";

type ServiceAccount = { client_email: string; private_key: string };
let token: { value: string; expires: number } | null = null;

// The Sheet the copy goes to. Not a secret (it grants no access without the service account key); SHEET_ID overrides it.
const SHEET = "1FOQPuSPWntp6VURMw97-olFmd-xFs3LbuK104Eo6uEM";
const sheetId = () => process.env.SHEET_ID || SHEET;
const googleConfigured = () => Boolean(sheetId() && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

/** The app keeps its data in Redis (true on Vercel); without it, it reads data/*.csv. */
export function sheetsConfigured() {
  return Boolean(redis());
}
const store = () => {
  const r = redis();
  if (!r) throw new Error("There's nowhere to keep the data.");
  return r;
};
const none: R.Importer = async () => null;

// ---- the app's storage (callers check sheetsConfigured() first)

export const readTab = (tab: string) => R.readTab(store(), tab, none);
/** A tab's rows, or none when it doesn't exist yet. */
export const readTabIfAny = readTab;
export const readTabsIfAny = (tabs: string[]) => R.readTabs(store(), tabs, none);
export const appendRows = (tab: string, rows: string[][]) => R.appendRows(store(), tab, rows, none);
/** Nothing to create in Redis: a tab is there once it's written. */
export async function ensureTab(title: string) { void title; }
/** Replaces a tab's contents (`before` is accepted for older callers and not needed). */
export const replaceTab = (title: string, rows: string[][], before?: string[][]) => { void before; return R.writeTab(store(), title, rows); };
export const updateRanges = (data: { range: string; values: string[][] }[]) => R.updateRanges(store(), data, none);
export const updateRange = (range: string, rows: string[][]) => R.updateRanges(store(), [{ range, values: rows }], none);

// ---- Settings → Copy to Google Sheet

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

/** A request to Google, waited out and tried again while it says "too many" (429; nothing was changed). */
async function sheetsFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const waits = [1_500, 4_000, 8_000];
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (r.status !== 429 || i >= waits.length) return r;
    await new Promise((ok) => setTimeout(ok, waits[i] + Math.random() * 500));
  }
}

/** One tab written over the Sheet's tab of the same name (created if missing): clear, then write. */
async function writeSheetTab(title: string, rows: string[][], auth: Record<string, string>) {
  const add = await sheetsFetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}:batchUpdate`, {
    method: "POST", headers: auth, body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
  });
  if (!add.ok && !(await add.text()).includes("already exists")) throw new Error(`Couldn't create the "${title}" tab (${add.status})`);
  const clear = await sheetsFetch(`${base()}/${encodeURIComponent(title)}:clear`, { method: "POST", headers: auth });
  if (!clear.ok) throw new Error(`Couldn't clear the "${title}" tab (${clear.status})`);
  const put = await sheetsFetch(`${base()}/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, { method: "PUT", headers: auth, body: JSON.stringify({ values: rows }) });
  if (!put.ok) throw new Error(`Couldn't write the "${title}" tab (${put.status})`);
}

/** Every tab, as the app keeps it, written over the Sheet's. Answers how many tabs were copied. */
export async function exportToSheet(): Promise<number> {
  if (!googleConfigured()) throw new Error("There's no Google Sheet to copy to.");
  const tabs = await R.allTabs(store());
  const auth = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
  for (const [tab, rows] of tabs) await writeSheetTab(tab, rows, auth);
  return tabs.length;
}
