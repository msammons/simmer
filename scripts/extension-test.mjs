// A check of the Safeway helper 1.0 (extension-working/) end to end, with a real Simmer and a stand-in Safeway: run on a Mac with
//   node scripts/extension-test.mjs
// It builds and starts Simmer locally (memory store, passcode test123, port 3205; or uses SIMMER_URL if one's running
// with a fresh memory store), loads the
// helper into a test browser, sends the helper's Simmer address (simmer-test.vercel.app) to that local Simmer, and
// answers safeway.com with a stand-in search page (Safeway's tiles, Add turning into − / quantity / +, a cart that
// remembers). It shows the flow works; it can't show that Safeway's real pages match the stand-in. Exits 1 on a failure.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ext = path.resolve("extension-working");
const ADDRESS = "https://simmer-test.vercel.app";
const LOCAL = process.env.SIMMER_URL || "http://localhost:3205";
const PASS = "test123";

const fails = [];
const expect = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails.push(what); };
const until = async (ok, ms = 30_000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 300))) if (await ok()) return true; return false; };

// ---- Simmer, started here unless one's given
// A production build: the dev server's page waits on its live-reload connection, which can't be reached through the
// stand-in address. SKIP_BUILD=1 uses the last build.
let server = null;
if (!process.env.SIMMER_URL) {
  const env = { ...process.env, HOUSEHOLD_PASSCODE: PASS, GOOGLE_SERVICE_ACCOUNT_JSON: "", GEMINI_API_KEY: "" };
  if (!process.env.SKIP_BUILD) await new Promise((ok, bad) => spawn("npx", ["next", "build"], { env, stdio: "ignore" }).on("exit", (c) => (c ? bad(new Error("build failed")) : ok())));
  server = spawn("npx", ["next", "start", "-p", "3205"], { env, stdio: "ignore", detached: true });
  const up = await until(() => fetch(`${LOCAL}/api/version`).then((r) => r.ok, () => false), 90_000);
  if (!up) { console.log("Simmer didn't start"); process.kill(-server.pid); process.exit(1); }
}
const api = (p, body) => fetch(`${LOCAL}${p}`, { method: body ? "POST" : "GET", headers: { "x-passcode": PASS, "content-type": "application/json" }, ...(body && { body: JSON.stringify(body) }) }).then((r) => r.json());
// The list: milk (two wanted), and bananas as a recipe might put them ("bag bananas"; Safeway's searched for "bananas").
await api("/api/list", { op: "add", text: "2 milk", by: "Sam" });
await api("/api/list", { op: "many", items: [{ item: "bag bananas", quantity: "1" }], by: "Sam" });
const list = await api("/api/list");
const milkId = list.items.find((i) => i.item === "milk")?.id;

// ---- the stand-in Safeway
const CATALOG = {
  milk: [["960001", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", "$3.49"], ["960002", "Lucerne Milk Reduced Fat 2% - 1 Gallon", "$5.29"]],
  // Safeway shortens long titles on screen; the whole name is in the buttons' labels.
  bananas: [["960010", "Bananas", "$0.29 each"], ["960011", "Organic Bananas", "$0.39 each"]],
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const shown = (name) => (name.length > 36 ? `${name.slice(0, 24)}...${name.slice(-8)}` : name);
const queries = [];
function searchPage(q, signedIn) {
  queries.push(q);
  const hits = Object.entries(CATALOG).filter(([k]) => q.toLowerCase().includes(k) || CATALOG[k].some(([, n]) => n.toLowerCase() === q.toLowerCase())).flatMap(([, v]) => v);
  // Built like Safeway's real search tiles (read from its page code, Oct 2026).
  const tiles = hits.map(([id, name, price]) => `
    <product-item-al-v2 class="product-card" data-id="${id}" data-name="${name}"><div class="pc"><img id="pg${id}Img" src="https://www.safeway.com/img/${id}.png" alt="" width="40" height="40">
      <span data-qa="prd-itm-pttl" id="pg${id}" tabindex="-1">${id === "960002" ? shown(name) : name}</span><div data-qa="prd-itm-prc">${price}</div>
      <quantity-stepper-al-v2 class="cta"></quantity-stepper-al-v2></div></product-item-al-v2>`).join("");
  return `<!doctype html><html><body>
    <header><a href="/">Safeway</a> ${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"} <a href="/cart" id="cart" aria-label="Cart">Cart</a></header>
    <main id="grid"></main>
    <script>
      const cart = () => JSON.parse(localStorage.getItem("cart") || "{}");
      const put = (id, n) => { const c = cart(); if (n > 0) c[id] = n; else delete c[id]; localStorage.setItem("cart", JSON.stringify(c)); };
      const draw = (tile) => {
        const id = tile.dataset.id, name = tile.dataset.name, n = cart()[id] || 0, cta = tile.querySelector(".cta");
        cta.innerHTML = n ? '<button aria-label="' + (n === 1 ? "Remove" : "Decrease") + ' Quantity of ' + name + '">-</button><div data-qa="prd-qty-stppr-qtybox">' + n + '</div><button aria-label="Increase Quantity 1 unit of ' + name + '">+</button>'
          : '<button aria-label="Add ' + name + '">Add</button>';
        const total = Object.values(cart()).reduce((a, b) => a + b, 0);
        document.getElementById("cart").textContent = "Cart " + total;
        cta.querySelectorAll("button").forEach((b) => b.onclick = () => setTimeout(() => {
          const l = b.getAttribute("aria-label");
          put(id, /^Add|^Increase/.test(l) ? n + 1 : n - 1); draw(tile);
        }, 250));
      };
      // Results arrive a moment after the page, like Safeway's.
      setTimeout(() => { document.getElementById("grid").innerHTML = ${JSON.stringify(tiles || "<h1>No search results for &quot;" + q + "&quot;</h1>")}; document.querySelectorAll("product-item-al-v2").forEach(draw); }, 400);
    </script></body></html>`;
}

// Safeway's cart page, as a stand-in: each product a row linking to its page, with − / quantity / + (not search tiles).
function cartPage(signedIn) {
  const names = Object.fromEntries(Object.values(CATALOG).flat().map(([id, name, price]) => [id, [name, price]]));
  return `<!doctype html><html><body>
    <header><a href="/">Safeway</a> ${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"} <a href="/erums/cart" id="cart" aria-label="Cart">Cart</a></header>
    <main id="rows"></main>
    <script>
      const names = ${JSON.stringify(names)};
      const cart = () => JSON.parse(localStorage.getItem("cart") || "{}");
      const put = (id, n) => { const c = cart(); if (n > 0) c[id] = n; else delete c[id]; localStorage.setItem("cart", JSON.stringify(c)); };
      const draw = () => {
        const c = cart(), ids = Object.keys(c);
        document.getElementById("rows").innerHTML = ids.length ? ids.map((id) => '<div class="row" data-id="' + id + '"><div><a href="/shop/product-details.' + id + '.html">' + names[id][0] + '</a><span>' + names[id][1] + '</span></div>'
          + '<div class="qty"><button aria-label="Decrease quantity">-</button><input type="number" value="' + c[id] + '" aria-label="Quantity"><button aria-label="Increase quantity">+</button></div></div>').join("") : "<p>Your cart is empty</p>";
        document.querySelectorAll(".row").forEach((r) => r.querySelectorAll("button").forEach((b) => b.onclick = () => setTimeout(() => {
          const id = r.dataset.id; put(id, (cart()[id] || 0) + (/Increase/.test(b.getAttribute("aria-label")) ? 1 : -1)); draw();
        }, 250)));
      };
      setTimeout(draw, 400);
    </script></body></html>`;
}

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "simmer-ext-")), {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let signedIn = true;
await ctx.route("https://www.safeway.com/**", (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/img/")) return route.fulfill({ contentType: "image/png", body: PNG });
  if (u.pathname.startsWith("/shop/search-results")) return route.fulfill({ contentType: "text/html", body: searchPage(u.searchParams.get("q") ?? "", signedIn) });
  if (u.pathname === "/erums/cart") return route.fulfill({ contentType: "text/html", body: cartPage(signedIn) });
  return route.fulfill({ contentType: "text/html", body: `<html><body><header>${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"}</header><h1>Safeway</h1></body></html>` });
});
// The helper's Simmer address goes to the local Simmer (pages, the frame in the panel, and the background's calls).
await ctx.route(`${ADDRESS}/**`, async (route) => {
  const req = route.request();
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
const safewayQty = async (pid) => (await safeway.evaluate(() => localStorage.getItem("cart") || "{}").then(JSON.parse))[pid] ?? 0;
const cartQty = async (pid) => (await api("/api/safeway/cart")).cart.find((l) => l.productId === pid)?.qty ?? 0;

const safeway = await ctx.newPage();
await safeway.goto("https://www.safeway.com/");

// Before the helper's set up, Simmer on the phone says plainly that the computer isn't answering.
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
await phone.goto(`${ADDRESS}/`);
await phone.getByLabel("Household passcode").fill(PASS);
await phone.getByRole("button", { name: "Get started" }).click();
await phone.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Shop" }).click();
await phone.getByRole("radio", { name: "Find" }).click();
expect(await phone.getByText(/It's not answering right now/).waitFor({ timeout: 10_000 }).then(() => true, () => false), "the computer not answering is said plainly, and quickly");

// Setup in the panel: a wrong address and a wrong passcode say so; then the panel is Simmer, open on Shop.
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 400, height: 900 });
await panel.goto(`chrome-extension://${id}/panel.html`);
await panel.fill("#address", "example.com");
await panel.fill("#code", PASS);
await panel.click("text=Continue");
expect(await panel.getByText("That address doesn't look right.").waitFor({ timeout: 5000 }).then(() => true, () => false), "setup: an address that isn't one of the apps' says so");
await panel.fill("#address", "simmer-test.vercel.app/");
await panel.fill("#code", "nope");
await panel.click("text=Continue");
expect(await panel.getByText("Wrong passcode.").waitFor({ timeout: 10_000 }).then(() => true, () => false), "setup: a wrong passcode says so");
await panel.fill("#code", PASS);
await panel.click("text=Continue");
const sim = panel.frameLocator("#simmer");
expect(await sim.getByRole("radio", { name: "Find" }).waitFor({ timeout: 30_000 }).then(() => true, () => false), "the panel shows Simmer, open on Shop's Find (passcode passed by message)");
expect(!(await panel.locator("#simmer").getAttribute("src")).includes(PASS), "the passcode isn't in the frame's address");

const t0 = Date.now();
const heard = await until(async () => (await api("/api/safeway/jobs")).answering, 30_000);
console.log(`(the helper checked in ${heard ? `after ${Date.now() - t0} ms` : "not at all"})`);
// Find: Simmer's search, done by the helper on the stand-in Safeway, with pictures.
await sim.getByRole("radio", { name: "Find" }).click();
const add = sim.getByRole("button", { name: "Add", exact: true });
const found = await add.first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
expect(found, "Find: a search comes back with products");
if (!found) console.log("Find showed:", (await sim.locator("main").innerText()).slice(0, 400), "| tabs:", ctx.pages().map((p) => p.url()).join(" "));
const imgs = await sim.locator("img[src^='https://www.safeway.com/img/']").count();
expect(imgs >= 2, "Find: products show Safeway's pictures");
expect(await sim.getByText("Lucerne Milk Reduced Fat 2% - 1 Gallon", { exact: true }).count() === 1, "Find: a name Safeway shortened on screen shows whole");
// Add milk: two wanted, so two go in, on Safeway and in Simmer's cart.
const firstName = await sim.locator("p.line-clamp-2").first().innerText();
const pid = firstName.includes("1/2") ? "960001" : "960002";
await add.first().click();
expect(await until(async () => (await safewayQty(pid)) === 2 && (await cartQty(pid)) === 2), "Add puts the wanted number in the Safeway cart and in Simmer's cart");
expect((await api("/api/safeway/cart")).cart.find((l) => l.productId === pid)?.itemId === milkId, "Simmer's cart knows which list item it's for");
await sim.getByRole("button", { name: /^One more/ }).first().click();
expect(await until(async () => (await safewayQty(pid)) === 3 && (await cartQty(pid)) === 3), "+ adds one on Safeway");
expect((await api("/api/safeway")).picks.some((p) => p.item === "milk" && p.id === pid && /^https:/.test(p.image ?? "")), "the pick is kept, with its picture");

// Cart: shows it, − takes one off, and the trash at one takes it out. (Find moves on once there are enough, so − is
// tried here.)
await sim.getByRole("radio", { name: /^Cart · 1/ }).click();
expect(await sim.getByText("Check out on Safeway").waitFor({ timeout: 10_000 }).then(() => true, () => false), "Cart shows what's in it, with checkout on Safeway");
expect(await until(() => new URL(safeway.url()).pathname === "/erums/cart", 20_000), "Cart in the panel: the Safeway tab shows Safeway's cart");
const searchesBefore = queries.length;
await sim.getByRole("button", { name: /^One less/ }).click();
expect(await until(async () => (await safewayQty(pid)) === 2 && (await cartQty(pid)) === 2), "− takes one off on Safeway");
expect(queries.length === searchesBefore && new URL(safeway.url()).pathname === "/erums/cart", "Cart changes are made on Safeway's cart page, which stays showing");
await sim.getByRole("button", { name: /^One less/ }).click();
await until(async () => (await safewayQty(pid)) === 1);
await sim.getByRole("button", { name: /^Take .* out of the cart/ }).click();
expect(await until(async () => (await safewayQty(pid)) === 0 && (await cartQty(pid)) === 0), "the trash takes it out of the Safeway cart");

// The phone path: with the panel closed, a search and an add from a plain page are done by the background.
await panel.close();
await phone.reload();
await phone.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "List" }).click();
await phone.getByRole("button", { name: /^Bag bananas/ }).click();
// The background stays quick for a few minutes after activity; nudge it as the half-minute alarm would.
worker.evaluate(() => self.simmerCheck()).catch(() => {});
const padd = phone.getByRole("button", { name: "Add", exact: true });
expect(await padd.first().waitFor({ timeout: 45_000 }).then(() => true, () => false), "phone: a search is done by the background, panel closed");
await padd.first().click();
expect(await until(async () => (await safewayQty("960010")) + (await safewayQty("960011")) === 1, 45_000), "phone: Add goes into the Safeway cart from the background");
expect(await phone.getByRole("radio", { name: "Cart · 1" }).waitFor({ timeout: 10_000 }).then(() => true, () => false), "phone: Simmer's cart shows it");
expect(queries.includes("bananas") && !queries.some((q) => /bag|\.\.\./.test(q)), `searches use the item's name only (searched: ${[...new Set(queries)].join(", ")})`);

// Signed out of Safeway: an add says so in plain words.
signedIn = false;
await phone.getByRole("button", { name: /^One more/ }).first().click();
expect(await phone.getByText(/isn't signed in on the computer/).waitFor({ timeout: 45_000 }).then(() => true, () => false), "signed out: says so, adds nothing");
signedIn = true;

// Framing: another site can't show Simmer.
const other = await ctx.newPage();
await other.goto("https://elsewhere.test/");
await other.waitForTimeout(2500);
const framedOk = await other.frames().find((f) => f !== other.mainFrame())?.evaluate(() => !!document.querySelector("main, #scroller")).catch(() => false);
expect(!framedOk, "another site can't frame Simmer");

await ctx.close();
if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }
console.log(fails.length ? `\n${fails.length} failed` : "\nAll passed");
process.exit(fails.length ? 1 : 0);
