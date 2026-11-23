// The helper's page reading (extension-working/page.js) against saved copies of Safeway's real pages, offline:
//   NODE_PATH=$HOME/Projects/mazer/node_modules node scripts/real-pages-test.mjs
// The copies live in safeway/ on Sam's Mac only (pages saved from Chrome with "Save Page As…, complete"). That folder is
// never committed or sent anywhere, and may hold the household's details, so this prints only counts, product numbers and
// product names, never a page's words. Without the folder (CI, any other computer) it says so and passes.
//
// Each saved page is served from this computer with its scripts taken out (what Chrome saved is the page as Safeway had
// built it), every other address is blocked, and page.js's own reading runs on it: the products a search shows, the
// cart page's products and counts, signed in, "no results", an empty cart that lists past purchases, the cart count,
// which button Add / + / − would press, and Safeway's own boxes after an Add. Presses go nowhere: the page's click is
// replaced by a note of what would have been pressed. Exits 1 on a failure.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const dir = path.resolve("safeway");
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.log("No saved Safeway pages here (safeway/): skipped.");
  process.exit(0);
}
const { chromium } = createRequire(import.meta.url)("playwright");
const { PAGE } = await import("../src/lib/safeway-helper.mjs");
// page.js as the helper runs it, without its `export` (it's a function Chrome copies into the page).
const PAGE_JS = readFileSync(path.resolve("extension-working/page.js"), "utf8").replace(/^export async function safewayPage/m, "async function safewayPage");
// The cart page is read with the search page's details and these over them, as safeway.js does (`cartPage`).
const CART = { ...PAGE, ...(PAGE.cartItems ?? {}), noResults: PAGE.emptyCart || PAGE.noResults, onlyInCart: true };

const fails = [];
const expect = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails.push(what); };

// ---- the saved pages, served from here with their scripts out (they'd rebuild the page and reach for Safeway)
const TYPES = { ".html": "text/html", ".htm": "text/html", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2" };
const quiet = (html) => html
  .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
  .replace(/<meta[^>]+http-equiv=["']?(?:refresh|content-security-policy)[^>]*>/gi, "")
  .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
const server = createServer((req, res) => {
  const file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(dir + path.sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] ?? (/^[^.]+$/.test(path.basename(file)) ? "image/jpeg" : "");
  // Scripts never run; a file with no extension is a picture Chrome saved under the product's number.
  if (!type) { res.writeHead(404).end(); return; }
  const body = type === "text/html" ? quiet(readFileSync(file, "utf8")) : readFileSync(file);
  res.writeHead(200, { "content-type": type }).end(body);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, bypassCSP: true });
// Nothing leaves this computer.
await ctx.route("**/*", (route) => (route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort()));

/**
 * Runs page.js on the page: `action` with `arg` and page details `P`. Every press is noted instead of made (`clicked`:
 * each pressed button's words), and `after` (a function's source, given the pressed element) can change the page as
 * Safeway would answer it.
 */
async function run(page, action, arg, P, after = "") {
  return page.evaluate(`(async () => {
    window.__clicked = [];
    const after = ${after || "null"};
    HTMLElement.prototype.click = function () {
      window.__clicked.push(((this.getAttribute("aria-label") ?? "") + " " + (this.innerText ?? "")).replace(/\\s+/g, " ").trim());
      if (after) after(this);
    };
    ${PAGE_JS}
    const result = await safewayPage(${JSON.stringify(action)}, ${JSON.stringify(arg)}, ${JSON.stringify(P)});
    return { result, clicked: window.__clicked };
  })()`);
}

/** What kind of page Chrome saved: Safeway's search results, its cart page with things in it, or its empty cart. */
const kindOf = (page) => page.evaluate(() => {
  const text = document.body?.innerText ?? "";
  if (document.querySelector("product-item-al-v2, product-item-al-v1")) return "search";
  if (/your (shopping )?cart is empty/i.test(text)) return "empty cart";
  if (document.querySelector(".stepper-amount, [aria-label$=' Cart' i][role=region]")) return "cart";
  return "other";
});

const pages = readdirSync(dir).filter((f) => /\.html?$/i.test(f)).sort();
expect(pages.length > 0, `saved pages found (${pages.length})`);
const seen = new Set();
for (const f of pages) {
  const page = await ctx.newPage();
  await page.goto(`${origin}/${encodeURIComponent(f)}`, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
  const kind = await kindOf(page);
  seen.add(kind);
  const P = kind === "search" ? PAGE : CART;
  const tag = `${kind} (${f})`;
  const read = (await run(page, "read", null, P)).result;
  const products = read?.products ?? [];
  const inCart = products.filter((p) => p.inCart);
  console.log(`\n${tag}: ${products.length} products, ${inCart.length} in the cart, cart count ${read?.cartCount}`);
  expect(read && read.signedIn === true, `${tag}: reads signed in`);
  // The cart count at the top: a number of things, never a figure from elsewhere on the page (an address, a price).
  const sum = inCart.reduce((n, p) => n + (p.qty || 1), 0);
  expect(read && (read.cartCount === null || (read.cartCount >= sum && read.cartCount < 150)), `${tag}: the cart count is the cart's (${read?.cartCount}, ${sum} shown in the cart)`);
  // Every product read whole: a number, a name Safeway didn't shorten, a price, a picture, and in the cart with a count.
  const bad = products.filter((p) => !/^\d{6,}$/.test(p.id) || !p.name || /\.{3}|…/.test(p.name) || p.name.length < 4 || !/^\$\d+\.\d\d/.test(p.price) || !p.image || (p.inCart && !(p.qty >= 1)) || (!p.inCart && p.qty !== 0));
  expect(!bad.length, `${tag}: every product has its number, whole name, price and picture${bad.length ? ` (not: ${bad.map((p) => `${p.id} ${p.name}`).join("; ")})` : ""}`);
  expect(new Set(products.map((p) => p.id)).size === products.length, `${tag}: no product twice`);
  // A watch for the page's products answers as the helper's would.
  const hold = 400, outHold = 400;
  const w = (await run(page, "waitFor", { until: "products", onlyInCart: P.onlyInCart === true, hold, outHold, ms: 3000 }, P)).result;

  if (kind === "search") {
    expect(products.length >= 5 && !read.noResults && !read.loading, `${tag}: products read (${products.length}), not "no results"`);
    expect(Object.keys(read.tiles).length >= products.length, `${tag}: every product's tile is listed (${Object.keys(read.tiles).length})`);
    expect(w?.ok === true && !w.held, `${tag}: watching for products answers at once with products`);
    // Add: the product's own Add, once; nothing else. Safeway's boxes are on the page, hidden, and don't count.
    const out = products.find((p) => !p.inCart);
    if (out) {
      const a = await run(page, "setQty", { id: out.id, qty: 1, wait: 300 }, P);
      expect(a.clicked.length === 1 && /^add\b/i.test(a.clicked[0]) && a.clicked[0].includes(out.name.slice(0, 20)), `${tag}: Add presses that product's Add, once (${a.clicked.join(" | ")})`);
      expect(a.result?.ok === false && a.result.why === "not-added" && !a.result.said, `${tag}: an Add with nothing changing says nothing changed, not one of Safeway's hidden boxes (${JSON.stringify(a.result?.why)})`);
      // Safeway answering the Add with its own boxes (Nov 23), shown as its page shows them.
      const show = (id) => `(el) => { if (/^add/i.test(el.getAttribute("aria-label") ?? "")) { const m = document.getElementById(${JSON.stringify(id)}); m.classList.add("show"); m.style.display = "block"; m.style.opacity = "1"; } }`;
      const issues = await run(page, "setQty", { id: out.id, qty: 1, wait: 1500 }, P, show("errorModal"));
      // Its words as shown: none of its buttons' words, nothing it keeps hidden in it.
      const shownWords = (await page.evaluate(() => document.getElementById("errorModal")?.innerText ?? "")).toLowerCase();
      const unshown = (issues.result?.said ?? "").toLowerCase().split(/\s+/).filter((w) => w && !shownWords.includes(w));
      expect(issues.result?.why === "said" && /having issues/i.test(issues.result.said ?? "") && !/\bClose\b/.test(issues.result.said ?? "") && !unshown.length, `${tag}: Safeway's "having issues" box after an Add is read in its words as shown (${JSON.stringify(issues.result?.said)})`);
      await page.reload({ waitUntil: "load" });
      const expired = await run(page, "setQty", { id: out.id, qty: 1, wait: 1500 }, P, show("sessionTimeoutModal"));
      expect(expired.result?.why === "signed-out", `${tag}: Safeway's "Session Expired" box after an Add counts as signed out (${JSON.stringify(expired.result?.why)})`);
      await page.reload({ waitUntil: "load" });
    }
    // + and − on a product in the cart: its own Increase and Decrease, never the other one.
    const one = products.find((p) => p.inCart);
    if (one) {
      const up = await run(page, "setQty", { id: one.id, qty: one.qty + 1, wait: 300 }, P);
      expect(up.clicked.length === 1 && /^increase\b/i.test(up.clicked[0]), `${tag}: + presses Increase (${up.clicked.join(" | ")})`);
      const down = await run(page, "setQty", { id: one.id, qty: one.qty - 1, wait: 300 }, P);
      expect(down.clicked.length === 1 && /^(decrease|remove)\b/i.test(down.clicked[0]), `${tag}: − presses Decrease (${down.clicked.join(" | ")})`);
    }
  } else if (kind === "cart") {
    expect(inCart.length >= 1 && !read.noResults, `${tag}: the cart's products read, in the cart (${inCart.length})`);
    expect(w?.ok === true && !w.held, `${tag}: watching for the cart's products answers at once`);
    const one = inCart[0];
    if (one) {
      const up = await run(page, "setQty", { id: one.id, qty: one.qty + 1, wait: 300 }, P);
      expect(up.clicked.length === 1 && /^increase\b/i.test(up.clicked[0]), `${tag}: + presses Increase (${up.clicked.join(" | ")})`);
      const down = await run(page, "setQty", { id: one.id, qty: Math.max(0, one.qty - 1), wait: 300 }, P);
      expect(down.clicked.length >= 1 && /^(decrease|remove)\b/i.test(down.clicked[0]) && !down.clicked.some((c) => /^yes/i.test(c)), `${tag}: − presses Decrease, and never Safeway's "Yes, remove" unasked (${down.clicked.join(" | ")})`);
    }
  } else if (kind === "empty cart") {
    // An empty cart: nothing in it, whatever past purchases it lists with Add (Nov 16), and Safeway saying so.
    expect(!inCart.length && read.noResults === true, `${tag}: reads empty, with nothing counted in the cart (${products.length} past purchases listed)`);
    expect(w?.ok === true && w.held === true, `${tag}: watching it ends with "empty" once that has held`);
  } else {
    // Any other page (a checkout page, the Purchases page): reading it never throws, and it reads as signed in.
    const look = (await run(page, "look", null, PAGE)).result;
    expect(Boolean(look?.url), `${tag}: the read-only look reads it`);
  }
  // A sample (what the helper sends to learn a page) never throws either.
  expect(typeof (await run(page, "sample", null, P)).result === "string", `${tag}: a sample reads it`);
  await page.close();
}
for (const k of ["search", "cart", "empty cart"]) if (!seen.has(k)) console.log(`(no saved ${k} page)`);

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nAll passed");
process.exit(fails.length ? 1 : 0);
