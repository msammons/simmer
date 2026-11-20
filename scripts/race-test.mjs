// Several phones at once against the test copy (Nov 19): no change may be lost, whatever lands together, and how long
// each kind of answer takes. Runs only against a test deployment, whose data lives under its own prefix
// (SIMMER_DATA_PREFIX), never the household's. Run with the linked Vercel login, which lets it past the test
// deployment's protection without a stored secret:
//   vc env run -- node scripts/race-test.mjs https://<test deployment>.vercel.app
// or, with a CLI that has no `env run`: vc env pull <file> --environment=development, then
//   OIDC_FILE=<file> node scripts/race-test.mjs … (the file is read and deleted at once; the token is never printed)
// The test passcode is read from .env.test.local (TEST_PASSCODE=…, git-ignored). Prints timings; exits 1 on a failure.
import { readFileSync, unlinkSync } from "node:fs";

const base = process.argv[2];
if (!base || /simmer-morales\.vercel\.app/.test(base)) { console.error("Give a test deployment's address (never the live one)."); process.exit(2); }
const passcode = readFileSync(".env.test.local", "utf8").match(/^TEST_PASSCODE=(.+)$/m)?.[1];
let oidc = process.env.VERCEL_OIDC_TOKEN;
if (!oidc && process.env.OIDC_FILE) {
  oidc = readFileSync(process.env.OIDC_FILE, "utf8").match(/^VERCEL_OIDC_TOKEN="?([^"\n]+)"?$/m)?.[1];
  unlinkSync(process.env.OIDC_FILE);
}
if (!passcode || !oidc) { console.error("Needs .env.test.local and the Vercel login (run through `vc env run --`)."); process.exit(2); }

const fails = [];
const ok = (c, what) => { console.log(`${c ? "PASS" : "FAIL"} ${what}`); if (!c) fails.push(what); };
const times = {};
async function call(path, body) {
  const t = performance.now();
  const r = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-vercel-trusted-oidc-idp-token": oidc, "x-passcode": passcode, "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  const ms = performance.now() - t;
  const key = `${body ? "POST" : "GET"} ${path}${body?.op ? ` ${body.op}` : ""}`;
  (times[key] ??= []).push(ms);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(`${key}: ${r.status} ${text.slice(0, 200)}`);
  return json;
}
const list = () => call("/api/list");
const named = (l, n) => l.items.filter((i) => i.item.toLowerCase() === n.toLowerCase() && !i.checked);
const tag = `rt${Date.now().toString(36)}`;

// Warm up (the first answer pays for starting the function).
await call("/api/version");
await list();

// 1. Ten phones each add a different thing at the same moment: all ten are on the list.
const ten = Array.from({ length: 10 }, (_, i) => `${tag} thing ${i}`);
await Promise.all(ten.map((t) => call("/api/list", { op: "add", text: t, by: "Sam", store: "safeway" })));
let l = await list();
ok(ten.every((t) => named(l, t).length === 1), `ten adds at once: all ten kept, none doubled (${ten.filter((t) => named(l, t).length === 1).length}/10)`);

// 2. One phone ticks a thing while another adds a new one: both stick.
const tickMe = named(l, ten[0])[0];
await Promise.all([call("/api/list", { op: "check", id: tickMe.id, checked: true }), call("/api/list", { op: "add", text: `${tag} late`, by: "Robin", store: "safeway" })]);
l = await list();
ok(l.items.find((i) => i.id === tickMe.id)?.checked === true && named(l, `${tag} late`).length === 1, "a tick and an add at the same moment: both kept");

// 3. The same thing ticked and unticked quickly, in order, from one phone: it ends as the last tap said.
const flip = named(l, ten[1])[0];
for (const checked of [true, false, true, false, true]) await call("/api/list", { op: "check", id: flip.id, checked });
l = await list();
ok(l.items.find((i) => i.id === flip.id)?.checked === true, "five quick ticks in order end as the last one");

// 4. Five removes at once: all gone, nothing else touched.
const gone = ten.slice(2, 7).map((t) => named(l, t)[0].id);
await Promise.all(gone.map((id) => call("/api/list", { op: "remove", id })));
l = await list();
ok(gone.every((id) => !l.items.some((i) => i.id === id)) && ten.slice(7).every((t) => named(l, t).length === 1), "five removes at once: those gone, the rest untouched");

// 5. Plan: two dinners added at once, then both removed at once.
let recipes = (await call("/api/recipes"))?.recipes ?? [];
// The test copy starts empty: two plain recipes to plan with (kept for later runs).
if (recipes.length < 2) {
  const drafts = ["Race test soup", "Race test pasta"].map((name) => ({ name, effort: "quick", minutes: 30, serves: 4, protein: "", ingredients: ["1 onion", "2 carrots"], steps: ["Cook it."], store: "", season: [], for: "everyone", kidOk: "", makeAhead: false, tags: [], source: "", rating: null, notes: "" }));
  recipes = (await call("/api/recipes", { op: "save", recipes: drafts, duplicates: "skip" }))?.recipes ?? [];
}
if (recipes.length >= 2) {
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const before = (await call("/api/plan")).dishes.length;
  await Promise.all(recipes.slice(0, 2).map((r) => call("/api/plan", { op: "plan", dishes: [{ kind: "regular", recipe: r.id, pinned: true, day }], lunches: [], counts: null, by: "Sam" })));
  let p = await call("/api/plan");
  const mine = p.dishes.filter((d) => d.day === day && recipes.slice(0, 2).some((r) => r.id === d.recipe));
  ok(p.dishes.length === before + 2 && mine.length >= 2, `two dinners added at once: both planned (${p.dishes.length - before} added)`);
  await Promise.all(mine.slice(0, 2).map((d) => call("/api/plan", { op: "remove", id: d.id })));
  p = await call("/api/plan");
  ok(p.dishes.length === before, "both removed at once: neither comes back");
} else console.log("(no recipes on the test copy: plan checks skipped)");

// Clean up what this run added.
l = await list();
await Promise.all(l.items.filter((i) => i.item.toLowerCase().startsWith(tag)).map((i) => call("/api/list", { op: "remove", id: i.id })));

console.log("\nTimings (ms, median / slowest):");
for (const [k, v] of Object.entries(times).sort()) { const s = [...v].sort((a, b) => a - b); console.log(`  ${k.padEnd(28)} ${String(Math.round(s[Math.floor(s.length / 2)])).padStart(5)} / ${Math.round(s[s.length - 1])}  (${s.length})`); }
console.log(fails.length ? `\n${fails.length} failed` : "\nAll passed");
process.exit(fails.length ? 1 : 0);
