// The Safeway helper (extension-working/) end to end, with a real Simmer, a real Chrome and a stand-in Safeway: run on a Mac with
//   NODE_PATH=…/node_modules node scripts/extension-test.mjs      (or as the last step of node scripts/helper-check.mjs)
// It builds and starts Simmer locally (memory store, passcode test123, port 3205; SKIP_BUILD=1 uses the last build, or
// SIMMER_URL one that's running with a fresh memory store), loads the helper into a test browser, sends the helper's
// Simmer address (simmer-test.vercel.app) to that local Simmer, and answers safeway.com with stand-in pages.
//
// Only what needs the real thing is here (Nov 23, Sam: "be efficient with tests. And intelligent."): the wiring end to
// end (setup, check-in, a search, an Add, −, a cart read, the background with the panel closed), what was seen go wrong
// live (signed out by Safeway's redirect, Pickup not chosen on Shop), and checkout's protections (to "ready" and no
// further, a delivery stop with nothing pressed, the live check pressing nothing, no framing). How the helper decides
// (holds, limits, Safeway's boxes, awkward names, being sent away, lost jobs, queue order) is src/helper/helper.test.mjs,
// in milliseconds. Run once: a case that passes only on a second try is a bug. Exits 1 on a failure.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import { liveCheck } from "./live-check.mjs";
import { PAGE, SETTINGS } from "../src/lib/safeway-helper.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ext = path.resolve("extension-working");
const ADDRESS = "https://simmer-test.vercel.app";
const LOCAL = process.env.SIMMER_URL || "http://localhost:3205";
const PASS = "test123";

const fails = [];
const expect = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails.push(what); };
// A check that throws (a page navigating under it, Nov 23) counts as "not yet".
const until = async (ok, ms = 30_000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await Promise.resolve().then(ok).catch(() => false)) return true; return false; };

// ---- Simmer, started here unless one's given
// A production build: the dev server's page waits on its live-reload connection, which can't be reached through the
// stand-in address. SKIP_BUILD=1 uses the last build.
let server = null;
if (!process.env.SIMMER_URL) {
  const env = { ...process.env, HOUSEHOLD_PASSCODE: PASS, GOOGLE_SERVICE_ACCOUNT_JSON: "", GEMINI_API_KEY: "" };
  if (!process.env.SKIP_BUILD) await new Promise((ok, bad) => spawn("npx", ["next", "build"], { env, stdio: "ignore" }).on("exit", (c) => (c ? bad(new Error("build failed")) : ok())));
  server = spawn("npx", ["next", "start", "-p", "3205"], { env, stdio: "ignore", detached: true });
  // Never leave it running (Nov 19: a run that crashed left its server up, and the next run's list doubled up).
  process.on("exit", () => { try { process.kill(-server.pid); } catch { /* already gone */ } });
  const up = await until(() => fetch(`${LOCAL}/api/version`).then((r) => r.ok, () => false), 90_000);
  if (!up) { console.log("Simmer didn't start"); process.kill(-server.pid); process.exit(1); }
}
const api = (p, body) => fetch(`${LOCAL}${p}`, { method: body ? "POST" : "GET", headers: { "x-passcode": PASS, "content-type": "application/json" }, ...(body && { body: JSON.stringify(body) }) }).then((r) => r.json());
// The list: milk (two wanted), and bananas as a recipe might put them ("bag bananas"; Safeway's searched for "bananas").
await api("/api/list", { op: "add", text: "2 milk", by: "Sam" });
await api("/api/list", { op: "many", items: [{ item: "bag bananas", quantity: "1" }], by: "Sam" });
const list = await api("/api/list");
const milkId = list.items.find((i) => i.item === "milk")?.id;

// ---- the stand-in Safeway (src/helper/world.mjs builds the same shapes for the fast checks)
const CATALOG = {
  milk: [["960001", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", "$3.49"], ["960002", "Lucerne Milk Reduced Fat 2% - 1 Gallon", "$5.29"]],
  bananas: [["960010", "Bananas", "$0.29 each"], ["960011", "Organic Bananas", "$0.39 each"]],
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const shown = (name) => (name.length > 36 ? `${name.slice(0, 24)}...${name.slice(-8)}` : name);
const queries = [];
/** A press counted on the stand-in's storage under `key` (inline, for an onclick). */
const counted = (key) => `{ const c = JSON.parse(localStorage.getItem('presses') || '{}'); c['${key}'] = (c['${key}'] || 0) + 1; localStorage.setItem('presses', JSON.stringify(c)); }`;
/** The account bar: no <header> (Safeway's real pages have none, so the helper reads the whole page for Sign In). */
const top = (signedIn, cartLink) => `<div class="menu-nav"><a href="/">Safeway</a> ${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"} ${cartLink}</div>`;
function searchPage(q, signedIn) {
  queries.push(q);
  const hits = Object.entries(CATALOG).filter(([k]) => q.toLowerCase().includes(k)).flatMap(([, v]) => v);
  // Built like Safeway's real search tiles (a saved copy of the real page, Oct 31): the title has the product number in
  // its id; only the first picture has loaded (the rest wait in data-src); the stepper's count is its middle button.
  const tiles = hits.map(([id, name, price], i) => `<product-item-al-v2 data-qa="prd-itm" data-id="${id}" data-name="${name}"><div class="pc" id="pg${id}container">
      <div id="pg${id}Img"><picture><img alt="${name}" data-src="//www.safeway.com/img/${id}.png"${i === 0 ? ` src="https://www.safeway.com/img/${id}.png"` : ""} width="40" height="40"></picture></div>
      <quantity-stepper-al-v2 class="cta" id="pg${id}-qty"></quantity-stepper-al-v2>
      <span data-qa="prd-itm-prc" id="pg${id}price"><span class="sr-only"> Your Price ${price}</span></span>
      <a data-qa="prd-itm-pttl" id="pg${id}" aria-label="${name}" href="/shop/pd/item/${id}">${id === "960002" ? shown(name) : name}</a>
    </div></product-item-al-v2>`).join("");
  return `<!doctype html><html><body>
    ${top(signedIn, '<a href="/cart" id="cart" aria-label="Cart">Cart</a>')}
    <main id="grid"></main>
    <script>
      const pressed = (id) => { const c = JSON.parse(localStorage.getItem("presses") || "{}"); c[id] = (c[id] || 0) + 1; localStorage.setItem("presses", JSON.stringify(c)); };
      const cart = () => JSON.parse(localStorage.getItem("cart") || "{}");
      const put = (id, n) => { const c = cart(); if (n > 0) c[id] = n; else delete c[id]; localStorage.setItem("cart", JSON.stringify(c)); };
      const draw = (tile) => {
        const id = tile.dataset.id, name = tile.dataset.name, n = cart()[id] || 0, cta = tile.querySelector(".cta");
        cta.innerHTML = n ? '<div role="group"><button aria-label="' + (n === 1 ? "Remove" : "Decrease") + ' Quantity 1 unit of ' + name + '"></button>'
            + '<button data-qa="qty-stppr-qtymsg" aria-label="' + n + ' units of ' + name + ' in cart. Click to update">' + n + '</button>'
            + '<button aria-label="Increase Quantity 1 unit of ' + name + '"></button></div>'
          : '<button data-qa="addbutton" aria-label="Add 1 unit of ' + name + '"><span>Add</span></button>';
        document.getElementById("cart").textContent = "Cart " + Object.values(cart()).reduce((a, b) => a + b, 0);
        cta.querySelectorAll("button").forEach((b) => b.onclick = () => setTimeout(() => {
          const l = b.getAttribute("aria-label");
          if (/units of/.test(l)) return;
          pressed(id);
          put(id, /^Add|^Increase/.test(l) ? n + 1 : n - 1);
          draw(tile);
        }, 250));
      };
      // "No search results" for a moment while the page builds (seen Oct 31), then the results.
      setTimeout(() => { document.getElementById("grid").innerHTML = '<h1>No search results</h1>'; }, 100);
      setTimeout(() => { document.getElementById("grid").innerHTML = ${JSON.stringify(tiles || "<h1>No search results for &quot;" + q + "&quot;</h1>")}; document.querySelectorAll("product-item-al-v2").forEach(draw); }, 1000);
    </script></body></html>`;
}

// Safeway's cart page: each product a row linking to its page, with − / quantity / +; empty, it lists past purchases.
let checkoutButton = false; // the cart page shows Safeway's Checkout (for checkout), counted when pressed
function cartPage(signedIn) {
  const names = Object.fromEntries(Object.values(CATALOG).flat().map(([id, name, price]) => [id, [name, price]]));
  const past = Object.values(CATALOG).flat().slice(0, 3).map(([id, name, price]) => `<product-item-al-v2 data-id="${id}"><div class="pc"><a data-qa="prd-itm-pttl" id="pg${id}" href="/shop/pd/item/${id}">${name}</a><span data-qa="prd-itm-prc">${price}</span><button aria-label="Add 1 unit of ${name}">Add</button></div></product-item-al-v2>`).join("");
  return `<!doctype html><html><body>
    ${top(signedIn, '<a href="/erums/cart" id="cart" aria-label="Cart">Cart</a>')}
    <main id="rows"></main>
    ${checkoutButton ? `<button id="checkout" onclick="${counted("checkout")}location.href='/erums/checkout'">Checkout</button>` : ""}
    <script>
      const names = ${JSON.stringify(names)};
      const cart = () => JSON.parse(localStorage.getItem("cart") || "{}");
      const put = (id, n) => { const c = cart(); if (n > 0) c[id] = n; else delete c[id]; localStorage.setItem("cart", JSON.stringify(c)); };
      const draw = () => {
        const c = cart(), ids = Object.keys(c);
        document.getElementById("rows").innerHTML = ids.length ? ids.map((id) => '<div class="row" data-id="' + id + '"><div><a href="/shop/product-details.' + id + '.html">' + names[id][0] + '</a><span>' + names[id][1] + '</span></div>'
          + '<div class="qty"><button aria-label="Decrease quantity">-</button><div role="button" class="stepper-amount"><span>' + c[id] + ' </span><span class="sr-only">- click to specify a quantity</span></div>'
          + '<button aria-label="Increase quantity">+</button></div></div>').join("") : "<p>Your shopping cart is empty.</p><h2>Buy it again</h2>" + ${JSON.stringify(past)};
        document.querySelectorAll(".row").forEach((r) => r.querySelectorAll("button").forEach((b) => b.onclick = () => setTimeout(() => {
          const id = r.dataset.id, c = cart();
          put(id, (c[id] || 0) + (/Increase/.test(b.getAttribute("aria-label")) ? 1 : -1)); draw();
        }, 250)));
      };
      setTimeout(draw, 400);
    </script></body></html>`;
}

/** Safeway's checkout page set for delivery (Nov 23): Order info's Continue, a delivery step's Edit, Place Order off. */
const deliveryCheckout = () => `<!doctype html><html><body>${top(true, '<a href="/erums/cart" id="cart" aria-label="Cart">Cart</a>')}
  <main><h1>Checkout</h1><section><h2>Order info</h2><button onclick="${counted("continue")}">Continue</button></section>
  <section><h2>Delivery date &amp; time</h2><button onclick="${counted("edit")}">Delivery date &amp; time Edit</button><p>Delivery to your address</p></section>
  <button disabled onclick="${counted("place")}">Place Order</button></main></body></html>`;
/**
 * Safeway's checkout page for pickup, as a stand-in: one day, its free time, the pickup step's Continue (on once a
 * time is chosen; then the step folds into its Edit), and Place Order, turned on, every press counted.
 */
const WINDOW = "slot-2026-11-24-1000";
const pickupCheckout = () => `<!doctype html><html><body>${top(true, '<a href="/erums/cart" id="cart" aria-label="Cart">Cart</a>')}
  <main><h1>Checkout</h1><section><h2>Pickup date &amp; time</h2><div id="slots">
    <div class="date-tile date-is-active" role="button" aria-label="select slots for TUESDAY Nov, 24 Tue Nov 24">Tue 24</div>
    <div><label><input type="radio" name="slot" id="${WINDOW}" onclick="${counted("time")}document.getElementById('go').disabled = false"> 10:00 AM - 11:00 AM</label><span> price Free</span></div>
  </div><button id="go" disabled onclick="${counted("pickupContinue")}document.getElementById('slots').innerHTML = '<p>Tue, Nov 24, 10:00 AM - 11:00 AM</p><button>Pickup date &amp; time Edit</button>'; this.remove()">Continue</button></section>
  <p>Estimated total $3.49</p><button onclick="${counted("place")}">Place Order</button></main></body></html>`;
let checkoutFor = "delivery";

// Safeway's Purchases page (1.3): In-store showing first, and an Online tab with Safeway's words for no orders.
const ordersPage = (signedIn) => `<!doctype html><html><body>${top(signedIn, "")}
  <main><h1>Purchases</h1><div role="tablist"><button role="tab" id="store" aria-selected="true">In-store</button><button role="tab" id="online" aria-selected="false">Online</button></div>
  <section id="list"><p>You have no orders placed within the last 90 days.</p></section></main>
  <script>document.getElementById("online").onclick = () => setTimeout(() => { document.getElementById("online").setAttribute("aria-selected", "true"); document.getElementById("store").setAttribute("aria-selected", "false"); }, 300);</script></body></html>`;

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "simmer-ext-")), {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let signedIn = true;
let sessionGone = false; // Safeway's session expired: its sign-in page stays (signed in, it sends the tab home)
// Safeway's sign-in ran out as on Nov 23 (or Pickup isn't chosen): its cart address sends the tab to its home page,
// which shows the name it remembers and no Sign In (its Sign In link is there, hidden).
let cartGone = false;
await ctx.route("https://www.safeway.com/**", async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/img/")) return route.fulfill({ contentType: "image/png", body: PNG });
  if (u.pathname.startsWith("/shop/search-results")) return route.fulfill({ contentType: "text/html", body: searchPage(u.searchParams.get("q") ?? "", signedIn) });
  if ((u.pathname === "/erums/cart" || u.pathname === "/erums/checkout") && cartGone) return route.fulfill({ contentType: "text/html", body: '<html><body><p>Loading…</p><script>setTimeout(() => location.replace("/"), 150)</script></body></html>' });
  if (u.pathname === "/erums/cart") return route.fulfill({ contentType: "text/html", body: cartPage(signedIn) });
  if (u.pathname === "/erums/checkout") return route.fulfill({ contentType: "text/html", body: checkoutFor === "pickup" ? pickupCheckout() : deliveryCheckout() });
  if (u.pathname === "/order-account/orders") return route.fulfill({ contentType: "text/html", body: ordersPage(signedIn) });
  // As Safeway's (seen Nov 23): signed in, its sign-in page sends the tab on to its home page by itself.
  if (u.pathname === "/account/sign-in.html") return route.fulfill({ contentType: "text/html", body: `<html><body><h1>Sign in</h1><input id="user"><button>Sign in</button>${signedIn && !sessionGone ? '<script>setTimeout(() => location.replace("/"), 300)</script>' : ""}</body></html>` });
  if (cartGone) return route.fulfill({ contentType: "text/html", body: '<html><body><div class="menu-nav"><a href="/erums/cart" aria-label="Cart">Cart</a> <button aria-label="Account menu">Hi, Sam</button><div class="menu" style="display:none"><a href="/account/sign-in.html">Sign In</a></div></div><h1>Safeway</h1></body></html>' });
  return route.fulfill({ contentType: "text/html", body: `<html><body><div class="menu-nav">${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"}</div><h1>Safeway</h1></body></html>` });
});
// The helper's Simmer address goes to the local Simmer (pages, the frame in the panel, and the background's calls).
// A job handed to the helper by this test instead of Simmer (`inject`: checkout's steps can only be asked for by
// Simmer's own checkout, behind Face ID), and its report, kept here (`injected`), never sent to Simmer.
let inject = null, injected = null;
await ctx.route(`${ADDRESS}/**`, async (route) => {
  const req = route.request();
  if (req.method() === "POST") {
    const b = (() => { try { return JSON.parse(req.postData() ?? "{}"); } catch { return {}; } })();
    if (inject && b.op === "next") { const job = inject; inject = null; return route.fulfill({ json: { job: { ...job, page: PAGE, settings: SETTINGS }, settings: SETTINGS } }); }
    if ((b.op === "done" || b.op === "failed") && String(b.id).startsWith("test-")) { injected = b; return route.fulfill({ json: { job: null } }); }
  }
  const { origin: _o, referer: _r, host: _h, ...headers } = req.headers();
  void _o; void _r; void _h;
  try {
    const res = await route.fetch({ url: req.url().replace(ADDRESS, LOCAL), headers });
    return route.fulfill({ response: res });
  } catch { return route.abort(); }
});
// Another site trying to show Simmer in a frame.
await ctx.route("https://elsewhere.test/**", (route) => route.fulfill({ contentType: "text/html", body: `<html><body><iframe id="f" src="${ADDRESS}/"></iframe></body></html>` }));

let [worker] = ctx.serviceWorkers();
worker ??= await ctx.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;
// Wakes the helper as Simmer's push would (no push in this test). Chrome swaps the background worker out when it's idle,
// so the current one is looked up each time (Nov 19: a kept handle had gone stale and the nudge did nothing).
const nudge = async () => {
  const w = ctx.serviceWorkers().find((x) => x.url().includes(id)) ?? await ctx.waitForEvent("serviceworker").catch(() => null);
  await w?.evaluate(() => self.simmerCheck()).catch(() => {});
};
// The stand-in's storage, read or written from the Safeway tab; tried again when the helper is moving that tab.
const safeway = await ctx.newPage();
await safeway.goto("https://www.safeway.com/");
const onSafeway = async (fn, arg) => { for (let i = 0; ; i++) { try { return await safeway.evaluate(fn, arg); } catch (e) { if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 250)); } } };
const safewayQty = async (pid) => JSON.parse(await onSafeway(() => localStorage.getItem("cart") || "{}"))[pid] ?? 0;
const allPresses = async () => JSON.parse(await onSafeway(() => localStorage.getItem("presses") || "{}"));
const cartQty = async (pid) => (await api("/api/safeway/cart")).cart.find((l) => l.productId === pid)?.qty ?? 0;
const onSignIn = () => ctx.pages().some((p) => p.url().includes("/account/sign-in"));
const offSignIn = async () => { for (const p of ctx.pages()) if (p.url().includes("/account/sign-in")) await p.goto("https://www.safeway.com/"); };
const queue = async (body) => { const r = await api("/api/safeway/jobs", { op: "queue", ...body }); void nudge(); return r?.job?.id; };
const finished = async (jid) => { let j = null; await until(async () => { j = (await api(`/api/safeway/jobs?id=${jid}`)).job; return j && (j.status === "done" || j.status === "failed"); }, 90_000); return j; };
const run = async (body) => finished(await queue(body));
const say = (j) => JSON.stringify(j?.result ?? j).slice(0, 300);

// ---- setup in the panel, then the panel is Simmer and the helper checks in
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 400, height: 900 });
await panel.goto(`chrome-extension://${id}/panel.html`);
await panel.fill("#address", "simmer-test.vercel.app/");
await panel.fill("#code", PASS);
await panel.click("text=Continue");
const sim = panel.frameLocator("#simmer");
expect(await sim.getByRole("radio", { name: "Safeway" }).waitFor({ timeout: 30_000 }).then(() => true, () => false), "the panel shows Simmer (passcode passed by message)");
expect(!(await panel.locator("#simmer").getAttribute("src")).includes(PASS), "the passcode isn't in the frame's address");
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
await phone.goto(`${ADDRESS}/`);
await phone.getByLabel("Household passcode").fill(PASS);
await phone.getByRole("button", { name: "Get started" }).click();

// ---- Find, Add and − from the panel: a search comes back, an Add goes into both carts, − takes one off on the cart page
const findBtn = sim.getByRole("button", { name: /^Find .* at Safeway$/ }).first();
await findBtn.waitFor({ timeout: 30_000 }).catch(() => {});
await findBtn.click();
const add = sim.getByRole("dialog").getByRole("button", { name: "Add", exact: true });
const found = await add.first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
expect(found && await sim.locator("img[src^='https://www.safeway.com/img/']").count() >= 2, "Find: a search comes back with products and Safeway's pictures");
const pid = (await sim.locator("p.line-clamp-2").first().innerText()).includes("1/2") ? "960001" : "960002";
await add.first().click();
expect(await until(async () => (await safewayQty(pid)) === 1 && (await cartQty(pid)) === 1) && (await api("/api/safeway/cart")).cart.find((l) => l.productId === pid)?.itemId === milkId,
  "Add puts one in the Safeway cart and in Simmer's cart, for the right list item");
await sim.getByRole("dialog").getByRole("button", { name: /^One more/ }).first().click();
await until(async () => (await safewayQty(pid)) === 2 && (await cartQty(pid)) === 2);
await sim.locator("body").press("Escape");
await sim.getByLabel("2 in the cart").first().waitFor({ timeout: 10_000 }).catch(() => {});
const searchesBefore = queries.length;
await sim.getByRole("button", { name: /^One less/ }).click();
expect(await until(async () => (await safewayQty(pid)) === 1 && (await cartQty(pid)) === 1) && queries.length === searchesBefore && new URL(safeway.url()).pathname === "/erums/cart",
  "− takes one off on Safeway's cart page");

// ---- the phone path: with the panel closed, a search is done by the background
await panel.close();
await phone.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Shop" }).click();
await phone.getByRole("radio", { name: "Safeway" }).click();
await phone.getByRole("button", { name: /^Find .*banana.* at Safeway$/i }).first().click();
void nudge();
expect(await phone.getByRole("dialog").getByRole("button", { name: "Add", exact: true }).first().waitFor({ timeout: 45_000 }).then(() => true, () => false) && queries.includes("bananas"),
  "phone: a search is done by the background with the panel closed, by the item's name");
await phone.getByRole("dialog").press("Escape").catch(() => {});

// ---- a cart read: Safeway's cart emptied, no online orders: Simmer's cart empties and the list stays
await onSafeway(() => localStorage.removeItem("cart"));
let cj = await run({ kind: "cart" });
expect(cj?.status === "done" && await until(async () => (await api("/api/safeway/cart")).cart.length === 0, 10_000) && (await api("/api/list")).items.some((i) => i.item === "milk"),
  `a cart read: an emptied Safeway cart empties Simmer's cart and leaves the list (${say(cj)})`);

// ---- signed out, as Safeway did it on Nov 23: the cart address sent home twice; said promptly, the tab on sign-in
cartGone = true;
sessionGone = true;
// Off the cart page first: a cart read where the tab already shows it reads it there without loading it again.
await safeway.goto("https://www.safeway.com/");
let t = Date.now();
cj = await run({ kind: "cart" });
let took = Math.round((Date.now() - t) / 1000);
expect(cj?.status === "done" && cj.result?.signedIn === false && took < 30 && await until(onSignIn, 15_000) && (await api("/api/safeway/cart")).signedOut === true,
  `signed out by Safeway's redirect: said in ${took} s, the tab waits on the sign-in page, and Simmer says so (${say(cj)})`);
sessionGone = false;

// ---- signed in with Pickup not chosen (Nov 23): not signed out; Shop says Choose Pickup, then Looking…, then Still…
const note = (common) => ctx.addCookies([{ name: PAGE.session.cookie, value: encodeURIComponent(JSON.stringify({ COMMON: common })), domain: "www.safeway.com", path: "/" }]);
await note({ userType: "C", preference: "" });
await offSignIn();
cj = await run({ kind: "cart" });
const state = async () => { const c = await api("/api/safeway/cart"); return JSON.stringify([c.signedOut, c.noPickup]); };
expect(cj?.status === "done" && cj.result?.noPickup === true && !onSignIn() && await state() === "[false,true]", `Pickup not chosen: said so, not signed out, the tab not sent to sign in (${say(cj)})`);
await phone.reload();
await phone.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Shop" }).click();
const pickBtn = phone.getByRole("button", { name: "Pickup isn't chosen on Safeway. Check again" });
expect(await pickBtn.waitFor({ timeout: 30_000 }).then(() => true, () => false) && (await pickBtn.innerText()).includes("Choose Pickup on Safeway"), "…Shop's button says Choose Pickup on Safeway");
await pickBtn.click().catch(() => {});
expect(await phone.getByRole("button", { name: "Looking at Safeway" }).waitFor({ timeout: 2000 }).then(() => true, () => false), "…pressed, it says Looking… at once");
const stillBtn = phone.getByRole("button", { name: "Pickup still not chosen. Check again" });
expect(await stillBtn.waitFor({ timeout: 60_000 }).then(() => true, () => false), "…and when the reading ends the same, says it's still not chosen");
await ctx.clearCookies({ name: PAGE.session.cookie });
cartGone = false;

// ---- checkout's protections: a delivery stop with nothing pressed past the cart's Checkout; to "ready" and no further
const checkoutRun = async (jid, args) => {
  injected = null;
  inject = { id: jid, kind: "checkoutPrepare", args, created: new Date().toISOString() };
  await nudge();
  await until(() => injected, 90_000);
  return injected;
};
await onSafeway(() => localStorage.setItem("cart", JSON.stringify({ "960001": 1 })));
await onSafeway(() => localStorage.removeItem("presses"));
checkoutButton = true;
let co = await checkoutRun("test-delivery-page", { list: true });
let after = await allPresses();
expect(co?.op === "done" && co.result?.stopped === "delivery" && JSON.stringify(after) === '{"checkout":1}',
  `checkout with Safeway set to delivery: stopped "delivery", only the cart's Checkout pressed (${JSON.stringify(co?.result ?? co).slice(0, 200)}, presses ${JSON.stringify(after)})`);
await onSafeway(() => localStorage.removeItem("presses"));
checkoutFor = "pickup";
// The tab is on Safeway's checkout page already (the delivery stop left it there): it's read again where it is.
co = await checkoutRun("test-ready", { windowId: WINDOW });
after = await allPresses();
expect(co?.op === "done" && co.result?.stopped === "ready" && co.result.chosen?.id === WINDOW && /Place Order/.test(co.result.final?.buttons?.join(" ") ?? "") && JSON.stringify(after) === '{"time":1,"pickupContinue":1}',
  `checkout to "ready": the time chosen, its Continue pressed, and Place Order never (${JSON.stringify(co?.result ?? co).slice(0, 200)}, presses ${JSON.stringify(after)})`);
checkoutButton = false;

// ---- the read-only live check (scripts/live-check.mjs), as Sam runs it against Safeway: reads right, presses nothing
await offSignIn();
const checkPage = await ctx.newPage();
await checkPage.goto(`chrome-extension://${id}/panel.html`);
await onSafeway(() => localStorage.setItem("cart", JSON.stringify({ "960001": 2 })));
const pressesBefore = await onSafeway(() => localStorage.getItem("presses"));
const live = await checkPage.evaluate(liveCheck("milk"));
expect(live?.ok === true && live.search?.products >= 2 && live.cart?.inCart === 1 && await onSafeway(() => localStorage.getItem("presses")) === pressesBefore && await safewayQty("960001") === 2,
  `the live check reads a search and the cart right, and presses nothing (${JSON.stringify(live).slice(0, 300)})`);
await checkPage.close();

// ---- framing: another site can't show Simmer
const other = await ctx.newPage();
await other.goto("https://elsewhere.test/");
await other.waitForTimeout(1500);
const framedOk = await other.frames().find((f) => f !== other.mainFrame())?.evaluate(() => !!document.querySelector("main, #scroller")).catch(() => false);
expect(!framedOk, "another site can't frame Simmer");

await ctx.close();
if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }
console.log(fails.length ? `\n${fails.length} failed` : "\nAll passed");
process.exit(fails.length ? 1 : 0);
