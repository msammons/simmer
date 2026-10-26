// The Safeway test, part two (docs/PLAN.md, section 5). Part one (safeway-test.mjs) showed that signing in works but
// guessing at Safeway's pages doesn't, so this one watches instead: Marcela does each step by hand in a real browser
// window, and the script writes down which of Safeway's own addresses each step used. Run on Matt's Mac, in this repo:
//   node scripts/safeway-watch.mjs
// What's recorded, per address: the method, the path, the names of the query fields, the status, the names of the
// headers sent (never their values), and the names of the fields sent and returned (never their values). No password,
// cookie, token, order or product detail is written anywhere. The report goes to .data/safeway/watch.md.
// She adds one item to her cart while it watches: take it out before checking out.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import readline from "node:readline/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const out = ".data/safeway";
mkdirSync(out, { recursive: true });

/** The shape of some JSON, as field names only, two levels deep: { a, b: { c, d }, list: [ { e } ] }. */
function shape(v, depth = 0) {
  if (Array.isArray(v)) return v.length ? `[ ${shape(v[0], depth)} ]` : "[]";
  if (v && typeof v === "object") {
    const keys = Object.keys(v).slice(0, 25);
    if (depth >= 2) return `{ ${keys.join(", ")}${Object.keys(v).length > 25 ? ", …" : ""} }`;
    return `{ ${keys.map((k) => (v[k] && typeof v[k] === "object" ? `${k}: ${shape(v[k], depth + 1)}` : k)).join(", ")} }`;
  }
  return typeof v;
}
const SKIP = /\.(js|css|png|jpe?g|gif|svg|webp|woff2?|ico)(\?|$)|analytics|tracking|telemetry|beacon|adobe|launchdarkly|newrelic|qualtrics|doubleclick|google|facebook|clarity|optimizely|datadog|akamai|quantum/i;

let phase = "signing in";
const seen = new Map(); // phase → lines
const note = (line) => { const l = seen.get(phase) ?? []; if (!l.includes(line)) l.push(line); seen.set(phase, l); };

const ctx = await chromium.launchPersistentContext(".data/safeway-profile", { headless: false, viewport: { width: 1200, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
ctx.on("response", async (res) => {
  const req = res.request();
  if (!["xhr", "fetch"].includes(req.resourceType())) return;
  const u = new URL(req.url());
  if (!/safeway|albertsons/.test(u.hostname) || SKIP.test(u.href)) return;
  const query = [...new Set([...u.searchParams.keys()])].join(", ");
  const headers = Object.keys(req.headers()).filter((h) => !/^(accept|accept-language|accept-encoding|user-agent|referer|origin|sec-|priority|content-length|connection|cookie)/i.test(h)).sort().join(", ");
  let sent = "";
  try { const b = req.postData(); if (b) sent = shape(JSON.parse(b)); } catch { sent = req.postData() ? "(not JSON)" : ""; }
  let got = "";
  try { if (/json/.test(res.headers()["content-type"] ?? "")) got = shape(await res.json()); } catch { /* not readable */ }
  note([
    `- **${req.method()} ${u.hostname}${u.pathname}** → ${res.status()}`,
    query && `  - query fields: ${query}`,
    headers && `  - headers sent: ${headers}`,
    sent && `  - sent: ${sent}`,
    got && `  - returned: ${got}`,
  ].filter(Boolean).join("\n"));
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const step = async (name, ask) => { phase = name; await rl.question(`\n${ask}\nPress Enter here when done… `); };
await page.goto("https://www.safeway.com/");
await step("signing in", "1. In the browser window: sign in to Safeway (if it isn't already).");
await step("searching", "2. Search for bananas, the way you normally would.");
await step("adding to the cart", "3. Add one bananas item to the cart (the + or Add button).");
await step("the cart", "4. Open the cart.");
await step("past orders", "5. Open your past orders (Account → Orders, or wherever they are), and open one order.");
rl.close();

const lines = [`# Safeway watch, ${new Date().toLocaleString()}`, "", "Field names only, never values.", ""];
for (const [p, ls] of seen) lines.push(`## ${p}`, "", ...ls, "");
writeFileSync(`${out}/watch.md`, lines.join("\n"));
console.log(`\nDone. Send ${out}/watch.md back (it has field names only). Take the bananas out of the cart before checking out.`);
await ctx.close();
