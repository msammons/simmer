// Settings → Copy to Google Sheet (now /api/export): every tab, as the app keeps it, written over the Google Sheet's. The
// Sheet is only this copy's target (the data has lived in Redis since Nov 11): it's written through a service account
// (no SDK), and never read.
import { createSign } from "node:crypto";
import { checkoutRecordRows } from "../checkout";
import { allTabs } from "../store";

type ServiceAccount = { client_email: string; private_key: string };
let token: { value: string; expires: number } | null = null;

// The Sheet the copy goes to. Not a secret (it grants no access without the service account key); SHEET_ID overrides it.
const SHEET = "1FOQPuSPWntp6VURMw97-olFmd-xFs3LbuK104Eo6uEM";
const sheetId = () => process.env.SHEET_ID || SHEET;
const googleConfigured = () => Boolean(sheetId() && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

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

/** A tab's name as an A1 range ('Safeway jobs'!A1). */
const a1 = (title: string, cell = "") => `'${title.replace(/'/g, "''")}'${cell && `!${cell}`}`;

/**
 * Every tab, as the app keeps it, written over the Sheet's (a missing one is created). Four requests however many tabs
 * (Nov 19: it was three per tab): which tabs the Sheet has, the missing ones added, all cleared, all written. Answers
 * how many tabs were copied.
 */
export async function exportToSheet(): Promise<number> {
  if (!googleConfigured()) throw new Error("There's no Google Sheet to copy to.");
  // The checkout record is a list of its own now (Nov 19), sent as its old tab.
  const tabs = [...(await allTabs()).filter(([t]) => t !== "Checkout record"), ["Checkout record", await checkoutRecordRows()] as [string, string[][]]];
  if (!tabs.length) return 0;
  const auth = { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" };
  const sheet = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}`;
  const got = await sheetsFetch(`${sheet}?fields=sheets.properties.title`, { headers: auth });
  if (!got.ok) throw new Error(`Couldn't read the Sheet's tabs (${got.status})`);
  const have = new Set(((await got.json()).sheets ?? []).map((x: { properties: { title: string } }) => x.properties.title));
  const missing = tabs.map(([t]) => t).filter((t) => !have.has(t));
  if (missing.length) {
    const add = await sheetsFetch(`${sheet}:batchUpdate`, { method: "POST", headers: auth, body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }) });
    if (!add.ok) throw new Error(`Couldn't create the Sheet's missing tabs (${add.status})`);
  }
  const clear = await sheetsFetch(`${base()}:batchClear`, { method: "POST", headers: auth, body: JSON.stringify({ ranges: tabs.map(([t]) => a1(t)) }) });
  if (!clear.ok) throw new Error(`Couldn't clear the Sheet's tabs (${clear.status})`);
  const put = await sheetsFetch(`${base()}:batchUpdate`, {
    method: "POST", headers: auth, body: JSON.stringify({ valueInputOption: "RAW", data: tabs.map(([t, rows]) => ({ range: a1(t, "A1"), values: rows })) }),
  });
  if (!put.ok) throw new Error(`Couldn't write the Sheet's tabs (${put.status})`);
  return tabs.length;
}
