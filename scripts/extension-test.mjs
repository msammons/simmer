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
import { liveCheck } from "./live-check.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ext = path.resolve("extension-working");
const ADDRESS = "https://simmer-test.vercel.app";
const LOCAL = process.env.SIMMER_URL || "http://localhost:3205";
const PASS = "test123";

const fails = [];
const expect = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails.push(what); };
// A check that throws (a page navigating under it, Nov 23) counts as "not yet".
const until = async (ok, ms = 30_000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 300))) if (await Promise.resolve().then(ok).catch(() => false)) return true; return false; };

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

// ---- the stand-in Safeway
const BREAD = "Daves Killer Bread 21 Whole Grains & Seeds Thin-Sliced Whole Grain Organic Bread - 20.5 Oz";
const CATALOG = {
  milk: [["960001", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", "$3.49"], ["960002", "Lucerne Milk Reduced Fat 2% - 1 Gallon", "$5.29"]],
  // Safeway shortens long titles on screen; the whole name is in the buttons' labels.
  bananas: [["960010", "Bananas", "$0.29 each"], ["960011", "Organic Bananas", "$0.39 each"]],
  // As the real tile an Add didn't take on (Nov 23): a long name shortened on screen, "Add 1 unit of …", a clipped
  // coupon's button beside it, Schedule & Save words.
  bread: [["960050", BREAD, "$7.49 each"]],
  // For the misbehaving Safeway below: one product each, so each case starts from an empty cart.
  butter: [["960090", "Lucerne Butter Salted - 16 Oz", "$5.99 each"]],
  cheddar: [["960110", "Tillamook Medium Cheddar Cheese Block - 8 Oz", "$4.99 each"]],
  yogurt: [["960120", "Chobani Greek Yogurt Plain - 32 Oz", "$6.49 each"]],
  spaghetti: [["960130", "Barilla Spaghetti - 16 Oz", "$2.29 each"]],
  marinara: [["960140", "Raos Homemade Marinara Sauce - 24 Oz", "$8.99 each"]],
  // A name with "Plus" in it: its Decrease must never pass for +.
  gatorade: [["960080", "Gatorade Plus Thirst Quencher Fruit Punch - 20 Fl Oz", "$2.49 each"]],
  // A tile far down the page, whose buttons Safeway builds only once it's scrolled to (six such on a saved real page).
  eggs: [["960071", "O Organics Organic Eggs Large Brown - 12 Count", "$7.99 each"], ["960070", "Lucerne Farms Eggs Cage Free Large - 18 Count", "$5.99 each"]],
  slowpoke: [["960150", "Never Shown", "$1.00 each"]],
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const shown = (name) => (name.length > 36 ? `${name.slice(0, 24)}...${name.slice(-8)}` : name);
const queries = [];
/**
 * Safeway misbehaving, one way at a time (set just before a job, cleared after): `slow` ms before a page is served;
 * `flash` Sign In showing for 2.5 s while the page builds, then the account; `churn` the page changing every few ms
 * throughout; `nobody` the page without its body for 3 s (every check on it throws); `choice` an Add that opens a box to
 * choose from first and adds nothing; `toast` an Add answered by Safeway's toast; `away` an Add that takes and then
 * Safeway sends the tab to its home page. By the words searched: "slowpoke" never finishes building, "yogurt" sends the
 * tab to the home page while it builds (once), "eggs" has its tile far down the page.
 */
let chaos = {};
let yogurtAway = true;
/** The account bar: no <header> (Safeway's real pages have none, so the helper reads the whole page for Sign In). */
const top = (signedIn, cartLink) => `<div class="menu-nav" id="bar"><a href="/">Safeway</a> <span id="who">${chaos.flash || !signedIn ? "<button>Sign in</button>" : "<button>Account</button>"}</span> ${cartLink}</div>
  ${chaos.flash && signedIn ? '<script>setTimeout(() => { document.getElementById("who").innerHTML = "<button>Account</button>"; }, 2500)</script>' : ""}
  ${chaos.churn ? '<span id="tick"></span><script>setInterval(() => { document.getElementById("tick").textContent = String(performance.now()); }, 5)</script>' : ""}
  ${chaos.nobody ? '<script>{ const b = document.body; addEventListener("DOMContentLoaded", () => { document.documentElement.removeChild(b); setTimeout(() => document.documentElement.appendChild(b), 3000); }); }</script>' : ""}`;
function searchPage(q, signedIn) {
  queries.push(q);
  const hits = Object.entries(CATALOG).filter(([k]) => q.toLowerCase().includes(k) || CATALOG[k].some(([, n]) => n.toLowerCase() === q.toLowerCase())).flatMap(([, v]) => v);
  // Built like Safeway's real search tiles (from a saved copy of the real page, Oct 31): the title is a link with the
  // product number in its id; pictures load as they're scrolled to, so only the first has its picture yet (the rest
  // wait in data-src); the stepper's count is its middle button ("2 units of ... in cart. Click to update").
  const tiles = hits.map(([id, name, price], i) => `${id === "960070" ? '<div style="height:4000px">More products</div>' : ""}
    <product-item-al-v2 data-qa="prd-itm" class="pc-grid-prdItem" data-id="${id}" data-name="${name}"${id === "960070" ? " data-lazy" : ""}><div class="pc" id="pg${id}container">
      <a class="pc__tap-zone" aria-label="${name},price approximatly ${price}" href="/shop/pd/item/${id}"></a>
      <div id="pg${id}Img" data-bpn="${id}"><picture><img data-qa="prd-itm-img" class="ab-lazy" alt="${name}" data-src="//www.safeway.com/img/${id}.png"${i === 0 ? ` src="https://www.safeway.com/img/${id}.png"` : ""} width="40" height="40"></picture></div>
      <quantity-stepper-al-v2 class="cta" id="pg${id}-qty"></quantity-stepper-al-v2>
      <span data-qa="prd-itm-prc" id="pg${id}price"><span class="sr-only"> Your Price ${price}</span><span aria-hidden="true"> ${price.split(" ")[0]}</span></span>
      <a data-qa="prd-itm-pttl" tabindex="-1" id="pg${id}" aria-label="${name}" href="/shop/pd/item/${id}">${id === "960002" || id === "960050" ? shown(name) : name}</a>
      ${id === "960050" ? `<span>Schedule &amp; Save 5%</span><button class="border-0" aria-label="$1.00 off Bakery Item coupon clipped for ${name} clipped, view deals">$1.00 off</button>` : ""}
    </div></product-item-al-v2>`).join("");
  const never = q.toLowerCase().includes("slowpoke");
  const away = q.toLowerCase().includes("yogurt") && yogurtAway;
  if (away) yogurtAway = false;
  return `<!doctype html><html><body>
    ${top(signedIn, '<a href="/cart" id="cart" aria-label="Cart">Cart</a>')}
    <main id="grid"></main>
    <div id="sessionTimeoutModal" class="modal fade" role="dialog" style="display:none"><div class="modal-dialog"><h2>Session Expired</h2><p>Your session is expired. Please sign in to continue.</p><button>Sign In</button><button>Got It</button></div></div>
    <div id="errorModal" class="modal fade" role="dialog" style="display:none"><div class="modal-dialog"><h4>Sorry, we're having issues.</h4><p>We cannot complete your request at this time. Please try again later.</p><button>Close</button></div></div>
    <div id="toastMessage" role="status" style="display:none"></div>
    <script>
      // How an Add is answered, read as it's pressed (the test sets it on Safeway's storage), so a page shown before still follows it.
      const misbehaving = () => JSON.parse(localStorage.getItem("chaos") || "{}");
      // Every press of Add, + or − on this stand-in, counted (so a press made twice shows).
      const pressed = (id) => { const c = JSON.parse(localStorage.getItem("presses") || "{}"); c[id] = (c[id] || 0) + 1; localStorage.setItem("presses", JSON.stringify(c)); };
      const cart = () => JSON.parse(localStorage.getItem("cart") || "{}");
      const put = (id, n) => { const c = cart(); if (n > 0) c[id] = n; else delete c[id]; localStorage.setItem("cart", JSON.stringify(c)); };
      const draw = (tile) => {
        const id = tile.dataset.id, name = tile.dataset.name, n = cart()[id] || 0, cta = tile.querySelector(".cta");
        cta.innerHTML = n ? '<div role="group"><button data-qa="prdctdcrmntr" aria-label="' + (n === 1 ? "Remove" : "Decrease") + ' Quantity 1 unit of ' + name + '"><span aria-hidden="true"></span></button>'
            + '<button data-qa="qty-stppr-qtymsg" aria-label="' + n + ' units of ' + name + ' in cart. Click to update">' + n + '</button>'
            + '<button data-qa="prdctincrmntr" aria-label="Increase Quantity 1 unit of ' + name + '"><span aria-hidden="true"></span></button></div>'
          : '<button data-qa="addbutton" aria-label="Add 1 unit of ' + name + '"><span aria-hidden="true"></span><span>Add</span></button>';
        const total = Object.values(cart()).reduce((a, b) => a + b, 0);
        document.getElementById("cart").textContent = "Cart " + total;
        cta.querySelectorAll("button").forEach((b) => b.onclick = () => setTimeout(() => {
          const l = b.getAttribute("aria-label");
          if (/units of/.test(l)) return;
          pressed(id);
          const chaos = misbehaving();
          // As the real page holds ready for an Add Safeway won't take (Nov 23): its box shows, the tile stays.
          const fails = localStorage.getItem("fails");
          if (fails && /^Add/.test(l)) { document.querySelectorAll(".modal").forEach((m) => { m.style.display = "none"; }); document.getElementById(fails === "expired" ? "sessionTimeoutModal" : "errorModal").style.display = "block"; return; }
          // A box to choose from first (a size, say): nothing's added until a choice is made, and the helper makes none.
          if (chaos.choice && /^Add/.test(l)) { const box = document.createElement("div"); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.innerHTML = "<h2>Choose an option</h2><p>Pick a size before adding this item.</p><button>12 Oz</button><button>24 Oz</button>"; document.body.append(box); return; }
          if (chaos.toast && /^Add/.test(l)) { const t = document.getElementById("toastMessage"); t.textContent = "We couldn't add this item to your cart."; t.style.display = "block"; return; }
          put(id, /^Add|^Increase/.test(l) ? n + 1 : n - 1);
          // It took, and Safeway sends the tab to its home page before showing it.
          if (chaos.away) { location.href = "/"; return; }
          draw(tile);
        }, 250));
      };
      // A tile far down: its buttons built only once it's scrolled to, as Safeway's are.
      const show = (tile) => { if (!tile.hasAttribute("data-lazy")) return draw(tile); new IntersectionObserver((seen, o) => { if (seen.some((e) => e.isIntersecting)) { o.disconnect(); draw(tile); } }).observe(tile); };
      // Results arrive a moment after the page, like Safeway's, which says "No search results" for a moment first while
      // it's building (seen Oct 31).
      // Built after the body's back when it's taken away for a while; never, for a page that never finishes building.
      const at = ${chaos.nobody ? 3500 : 1500};
      ${never ? '' : `setTimeout(() => { const g = document.getElementById("grid"); if (g) g.innerHTML = '<h1>No search results for &quot;' + ${JSON.stringify(q)}.replace(/</g, "") + '&quot;</h1>'; }, 100);
      setTimeout(() => { document.getElementById("grid").innerHTML = ${JSON.stringify(tiles || "<h1>No search results for &quot;" + q + "&quot;</h1>")}; document.querySelectorAll("product-item-al-v2").forEach(show); }, at);`}
      ${never ? 'document.getElementById("grid").innerHTML = "<p>Loading…</p>";' : ""}
      ${away ? 'setTimeout(() => { location.href = "/"; }, 800);' : ""}
    </script></body></html>`;
}

// Safeway's cart page, as a stand-in: each product a row linking to its page, with − / quantity / + (not search tiles).
function cartPage(signedIn) {
  const names = Object.fromEntries(Object.values(CATALOG).flat().map(([id, name, price]) => [id, [name, price]]));
  // An empty cart lists past purchases under Safeway's words, each with Add (Nov 16); none of them is in the cart.
  const past = Object.values(CATALOG).flat().slice(0, 3).map(([id, name, price]) => `<product-item-al-v2 data-id="${id}"><div class="pc" id="pg${id}container"><a data-qa="prd-itm-pttl" id="pg${id}" href="/shop/pd/item/${id}">${name}</a><span data-qa="prd-itm-prc">${price}</span><button aria-label="Add 1 unit of ${name}">Add</button></div></product-item-al-v2>`).join("");
  return `<!doctype html><html><body>
    ${top(signedIn, '<a href="/erums/cart" id="cart" aria-label="Cart">Cart</a>')}
    <main id="rows"></main>
    <script>
      const names = ${JSON.stringify(names)};
      const cart = () => JSON.parse(localStorage.getItem("cart") || "{}");
      const put = (id, n) => { const c = cart(); if (n > 0) c[id] = n; else delete c[id]; localStorage.setItem("cart", JSON.stringify(c)); };
      const draw = () => {
        const c = cart(), ids = Object.keys(c);
        document.getElementById("rows").innerHTML = ids.length ? ids.map((id) => '<div class="row" data-id="' + id + '"><div><a href="/shop/product-details.' + id + '.html">' + names[id][0] + '</a><span>' + names[id][1] + '</span></div>'
          // As the real cart page (captured Oct 31): the count is words in a button-like box, with a hidden copy for
          // small screens, and no number box.
          + '<div class="qty"><button aria-label="Decrease quantity" class="stepper-decrease">-</button><div role="button" class="stepper-amount"><span>' + c[id] + ' </span><span class="sr-only">- click to specify a quantity</span></div>'
          + '<button aria-label="Increase quantity" class="stepper-increase">+</button><div style="display:none"><div role="button" class="stepper-qty-round"><span>' + c[id] + ' </span><span class="sr-only">- click to specify a quantity</span></div></div></div></div>').join("") : "<p>Your shopping cart is empty.</p><h2>Buy it again</h2>" + ${JSON.stringify(past)};
        document.querySelectorAll(".row").forEach((r) => r.querySelectorAll("button").forEach((b) => b.onclick = () => setTimeout(() => {
          const id = r.dataset.id, step = /Increase/.test(b.getAttribute("aria-label")) ? 1 : -1, c = cart();
          // As the real cart page (Oct 31): emptying the cart asks first, and only "Yes, remove" takes it out.
          if (step < 0 && c[id] === 1 && Object.keys(c).length === 1) {
            const box = document.createElement("div");
            box.innerHTML = '<p>Empty Safeway cart</p><p>Are you sure you want to remove all the items from your order?</p><button type="button">No, don\\'t remove</button><button type="button">Yes, remove</button>';
            document.body.append(box);
            const [no, yes] = box.querySelectorAll("button");
            no.onclick = () => box.remove();
            yes.onclick = () => { box.remove(); put(id, 0); draw(); };
            return;
          }
          put(id, (c[id] || 0) + step); draw();
        }, 250)));
      };
      setTimeout(draw, 400);
    </script></body></html>`;
}

// Safeway's Purchases page, as a stand-in (1.3): an In-store tab showing first, and an Online tab that shows either the
// words Safeway shows with no orders (seen Nov 3) or, once `ordered`, an order placed today (a guess at its shape).
let ordered = false;
const todayWords = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" });
function ordersPage(signedIn) {
  const online = ordered ? `<div class="order-card"><p>Order #5550123</p><p>Placed ${todayWords}</p><p>Delivery window tomorrow</p><p>$4.12</p></div>` : "<p>You have no orders placed within the last 90 days.</p>";
  return `<!doctype html><html><body>
    ${top(signedIn, "")}
    <main><h1>Purchases</h1><div role="tablist"><button role="tab" id="store" aria-selected="true">In-store</button><button role="tab" id="online" aria-selected="false">Online</button></div>
    <section id="list"><p>You have no orders placed within the last 90 days.</p></section></main>
    <script>
      document.getElementById("online").onclick = () => setTimeout(() => {
        document.getElementById("online").setAttribute("aria-selected", "true");
        document.getElementById("store").setAttribute("aria-selected", "false");
        document.getElementById("list").innerHTML = ${JSON.stringify(online)};
      }, 300);
    </script></body></html>`;
}

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "simmer-ext-")), {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let signedIn = true;
let sessionGone = false; // Safeway's session expired: its sign-in page stays (signed in, it sends the tab home)
await ctx.route("https://www.safeway.com/**", async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/img/")) return route.fulfill({ contentType: "image/png", body: PNG });
  if (chaos.slow && (u.pathname.startsWith("/shop/search-results") || u.pathname === "/erums/cart")) await new Promise((r) => setTimeout(r, chaos.slow));
  if (u.pathname.startsWith("/shop/search-results")) return route.fulfill({ contentType: "text/html", body: searchPage(u.searchParams.get("q") ?? "", signedIn) });
  if (u.pathname === "/erums/cart") return route.fulfill({ contentType: "text/html", body: cartPage(signedIn) });
  if (u.pathname === "/order-account/orders") return route.fulfill({ contentType: "text/html", body: ordersPage(signedIn) });
  // As Safeway's (seen Nov 23): signed in, its sign-in page sends the tab on to its home page by itself.
  if (u.pathname === "/account/sign-in.html") return route.fulfill({ contentType: "text/html", body: `<html><body><h1>Sign in</h1><input id="user"><button>Sign in</button>${signedIn && !sessionGone ? '<script>setTimeout(() => location.replace("/"), 300)</script>' : ""}</body></html>` });
  return route.fulfill({ contentType: "text/html", body: `<html><body><div class="menu-nav">${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"}</div><h1>Safeway</h1></body></html>` });
});
// The helper's Simmer address goes to the local Simmer (pages, the frame in the panel, and the background's calls).
// `dropReports`: the helper's reports don't get through (a dropped connection), so it keeps them to send again.
let dropReports = false, dropped = 0;
await ctx.route(`${ADDRESS}/**`, async (route) => {
  const req = route.request();
  const { origin: _o, referer: _r, host: _h, ...headers } = req.headers();
  void _o; void _r; void _h;
  if (dropReports && req.method() === "POST" && /"op":"(done|failed)"/.test(req.postData() ?? "")) { dropped++; return route.abort(); }
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
// Once the background has been stopped (below), the test browser's handle on it is gone for good, so the helper's own
// page wakes it instead, as its panel does.
let waker = null;
const nudge = async () => {
  if (waker) return waker.evaluate(() => chrome.runtime.sendMessage({ type: "simmer:check" }).catch(() => {})).catch(() => {});
  const w = ctx.serviceWorkers().find((x) => x.url().includes(id)) ?? await ctx.waitForEvent("serviceworker").catch(() => null);
  await w?.evaluate(() => self.simmerCheck()).catch(() => {});
};
// The stand-in's storage, read or written from the Safeway tab; tried again when the helper is moving that tab between
// pages at that moment.
const onSafeway = async (fn, arg) => { for (let i = 0; ; i++) { try { return await safeway.evaluate(fn, arg); } catch (e) { if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 250)); } } };
const safewayQty = async (pid) => JSON.parse(await onSafeway(() => localStorage.getItem("cart") || "{}"))[pid] ?? 0;
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
// Before the helper's set up, Shop still lists the Safeway things (whether the computer answers is known per job now,
// Nov 11: no check-ins), each with Find.
expect(await phone.getByRole("button", { name: /^Find .* at Safeway$/ }).first().waitFor({ timeout: 10_000 }).then(() => true, () => false), "Shop lists the Safeway things with Find before the helper's set up");

// Setup in the panel: a wrong address and a wrong passcode say so; then the panel is Simmer, open on Lists at Safeway.
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
expect(await sim.getByRole("radio", { name: "Safeway" }).waitFor({ timeout: 30_000 }).then(() => true, () => false), "the panel shows Simmer (passcode passed by message)");
expect(await sim.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Shop" }).getAttribute("aria-current").then((v) => v === "page", () => false) || await sim.getByText("Milk", { exact: true }).isVisible(), "the panel opens on Shop");
expect(!(await panel.locator("#simmer").getAttribute("src")).includes(PASS), "the passcode isn't in the frame's address");

const t0 = Date.now();
const heard = await until(async () => (await api("/api/safeway/jobs")).answering, 30_000);
console.log(`(the helper checked in ${heard ? `after ${Date.now() - t0} ms` : "not at all"})`);
// Find: Safeway's choices for an item, searched by the helper on the stand-in Safeway, with pictures.
const findBtn = sim.getByRole("button", { name: /^Find .* at Safeway$/ }).first();
if (!(await findBtn.waitFor({ timeout: 30_000 }).then(() => true, () => false))) { console.log("Shop showed:", (await sim.locator("main").innerText()).slice(0, 600)); console.log("phone showed:", (await phone.locator("main").innerText()).slice(0, 300)); }
await findBtn.click();
const add = sim.getByRole("dialog").getByRole("button", { name: "Add", exact: true });
const found = await add.first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
expect(found, "Find: a search comes back with products");
if (!found) console.log("Find showed:", (await sim.locator("main").innerText()).slice(0, 400), "| tabs:", ctx.pages().map((p) => p.url()).join(" "));
const imgs = await sim.locator("img[src^='https://www.safeway.com/img/']").count();
expect(imgs >= 2, "Find: products show Safeway's pictures");
expect(await sim.getByText("Lucerne Milk Reduced Fat 2% - 1 Gallon", { exact: true }).count() === 1, "Find: a name Safeway shortened on screen shows whole");
// Add milk: two wanted, but Add puts one in, on Safeway and in Simmer's cart; + adds the next. Both happen on the search
// page the Safeway tab is already showing, without loading it again.
const firstName = await sim.locator("p.line-clamp-2").first().innerText();
const pid = firstName.includes("1/2") ? "960001" : "960002";
const searchesAtAdd = queries.length;
await add.first().click();
expect(await until(async () => (await safewayQty(pid)) === 1 && (await cartQty(pid)) === 1), "Add puts one in the Safeway cart and in Simmer's cart");
expect((await api("/api/safeway/cart")).cart.find((l) => l.productId === pid)?.itemId === milkId, "Simmer's cart knows which list item it's for");
expect(await sim.getByRole("button", { name: /^Next: Bag bananas/ }).waitFor({ timeout: 10_000 }).then(() => true, () => false), "after an Add, Next (naming the next item) shows at the top");
const choices = sim.getByRole("dialog");
await choices.getByRole("button", { name: /^One more/ }).first().click();
expect(await choices.getByLabel("2 in the cart").first().isVisible(), "+ shows the new count at once, while the change goes to Safeway");
expect(await until(async () => (await safewayQty(pid)) === 2 && (await cartQty(pid)) === 2), "+ adds one on Safeway, and Simmer reads Safeway's count right");
expect(!(await sim.getByText(/didn't take all/).count()), "no \"didn't take all\" when it did");
expect(queries.length === searchesAtAdd, `Add and + happen on the search page showing, without loading it again (${queries.length - searchesAtAdd} more)`);
expect((await api("/api/safeway")).picks.some((p) => p.item === "milk" && p.id === pid && /^https:/.test(p.image ?? "")), "the pick is kept, with its picture");

// In the cart (the Safeway list's own rows): − takes one off, and the trash at one takes it out.
await sim.locator("body").press("Escape");
expect(await sim.getByLabel("2 in the cart").first().waitFor({ timeout: 10_000 }).then(() => true, () => false), "Shop's Safeway row shows what's in the cart");
const searchesBefore = queries.length;
await sim.getByRole("button", { name: /^One less/ }).click();
const minusOk = await until(async () => (await safewayQty(pid)) === 1 && (await cartQty(pid)) === 1);
expect(minusOk, "− takes one off on Safeway");
if (!minusOk) console.log("after −: safeway", await safewayQty(pid), "simmer", await cartQty(pid), "dialogs", await sim.getByRole("dialog").count(), "| tab", safeway.url(), "| jobs", JSON.stringify((await api("/api/safeway/jobs")).jobs?.slice?.(-2) ?? "").slice(0, 600));
expect(queries.length === searchesBefore && await until(() => new URL(safeway.url()).pathname === "/erums/cart", 20_000), "cart changes are made on Safeway's cart page, which stays showing");
await sim.getByRole("button", { name: /^Take .* out of the cart/ }).click();
expect(await until(async () => (await safewayQty(pid)) === 0 && (await cartQty(pid)) === 0), "the trash takes it out of the Safeway cart");

// The phone path: with the panel closed, a search and an add from a plain page are done by the background.
await panel.close();
await phone.reload();
await phone.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Shop" }).click();
await phone.getByRole("radio", { name: "Safeway" }).click();
await phone.getByRole("button", { name: /^Find .* at Safeway$/ }).first().click();
void nudge();
const padd = phone.getByRole("dialog").getByRole("button", { name: "Add", exact: true });
expect(await padd.first().waitFor({ timeout: 45_000 }).then(() => true, () => false), "phone: a search is done by the background, panel closed");
await padd.first().click();
expect(await until(async () => (await safewayQty("960010")) + (await safewayQty("960011")) === 1, 45_000), "phone: Add goes into the Safeway cart from the background");
expect(await until(async () => (await api("/api/safeway/cart")).cart.reduce((n, l) => n + l.qty, 0) === 1, 10_000), "phone: Simmer's cart shows it");
expect(queries.includes("bananas") && !queries.some((q) => /bag|\.\.\./.test(q)), `searches use the item's name only (searched: ${[...new Set(queries)].join(", ")})`);

// Signed out of Safeway: an add says so in plain words.
signedIn = false;
await safeway.reload(); // Safeway shows it's signed out once its page loads again
await phone.getByRole("dialog").getByRole("button", { name: /^One more/ }).first().click();
expect(await phone.getByRole("dialog").getByText(/isn't signed in/).waitFor({ timeout: 45_000 }).then(() => true, () => false), "signed out: says so, adds nothing");
signedIn = true;
// Signing in takes Safeway off its sign-in page, where the helper parks its tab while signed out.
for (const p of ctx.pages()) if (p.url().includes("/account/sign-in")) await p.goto("https://www.safeway.com/");

// The cart emptied on Safeway (1.3): with no online orders only Simmer's copy empties and the list stays; with an order
// placed today, the cart's things come off the list too.
const bananasOnList = async () => (await api("/api/list")).items.some((i) => i.item === "bag bananas");
let lastCartJob = null;
const cartJob = async () => { const r = await api("/api/safeway/jobs", { op: "queue", kind: "cart" }); lastCartJob = r?.job?.id ?? JSON.stringify(r); void nudge(); };
const bananaInCart = async () => (await api("/api/safeway/cart")).cart.find((l) => l.qty > 0);
const inCartNow = await bananaInCart();
await onSafeway(() => localStorage.removeItem("cart"));
await cartJob();
const emptied = await until(async () => !(await bananaInCart()), 60_000);
expect(emptied && await bananasOnList(), "an emptied Safeway cart with no online orders empties Simmer's cart and leaves the list");
if (!emptied) console.log("cart job", lastCartJob, JSON.stringify(await api(`/api/safeway/jobs?id=${lastCartJob}`)).slice(0, 700), "| simmer cart", JSON.stringify((await api("/api/safeway/cart")).cart), "| last jobs", JSON.stringify((await api("/api/safeway/jobs?recent=1")).jobs?.slice?.(0, 4)).slice(0, 900));
const bananaItem = (await api("/api/list")).items.find((i) => i.item === "bag bananas");
await api("/api/safeway/jobs", { op: "queue", kind: "setQty", productId: inCartNow?.productId ?? "960010", qty: 1, query: "bananas", name: inCartNow?.name ?? "Bananas", itemId: bananaItem?.id, item: "bag bananas" });
void nudge();
await until(async () => Boolean(await bananaInCart()), 60_000);
await onSafeway(() => localStorage.removeItem("cart"));
ordered = true;
await cartJob();
expect(await until(async () => !(await bananasOnList()), 60_000) && !(await bananaInCart()), "an emptied Safeway cart with an order placed today takes the cart's things off the list");

// An Add Safeway won't take (Nov 23, a real tile): the job says why, in Safeway's words, instead of a silent 0.
const queueBread = async (qty = 1) => { const r = await api("/api/safeway/jobs", { op: "queue", kind: "setQty", productId: "960050", qty, query: "bread", name: BREAD }); void nudge(); return r?.job?.id; };
const finished = async (jid) => { let j = null; await until(async () => { j = (await api(`/api/safeway/jobs?id=${jid}`)).job; return j && (j.status === "done" || j.status === "failed"); }, 90_000); return j; };
const refuseAdd = (v) => onSafeway((x) => (x ? localStorage.setItem("fails", x) : localStorage.removeItem("fails")), v);
const onSignIn = () => ctx.pages().some((p) => p.url().includes("/account/sign-in"));
await refuseAdd("error");
let bj = await finished(await queueBread());
expect(bj?.status === "done" && bj.result?.reached === false && bj.result?.why === "said" && /having issues\. We cannot/.test(bj.result?.said ?? "") && !/Close/.test(bj.result?.said ?? ""), `an Add Safeway answers with its error box says so in Safeway's words (${JSON.stringify(bj?.result)})`);
expect(await safewayQty("960050") === 0 && await cartQty("960050") === 0, "and nothing went into either cart");
await refuseAdd("expired");
sessionGone = true;
bj = await finished(await queueBread());
expect(bj?.status === "failed" && bj.result?.error === "signed-out" && (await api("/api/safeway/cart")).signedOut === true, `an Add answered with Safeway's Session Expired box says signed out (${JSON.stringify(bj?.result)})`);
expect(await until(onSignIn, 15_000), "and the Safeway tab waits on the sign-in page");
// The sign-out wasn't (Safeway was fine after all): the next Add looks at Safeway again instead of saying signed out.
await refuseAdd(null);
sessionGone = false;
bj = await finished(await queueBread());
expect(bj?.status === "done" && bj.result?.reached === true && await safewayQty("960050") === 1, `after a sign-out that wasn't, the next Add looks at Safeway once more and takes (${JSON.stringify(bj?.result ?? bj)})`);
// Really signed out: the first job after parking looks once, and the one after it leaves the sign-in page alone.
signedIn = false;
sessionGone = true;
await safeway.reload();
await finished(await queueBread(2));
expect(await until(onSignIn, 15_000), "signed out: the tab waits on the sign-in page");
bj = await finished(await queueBread(2));
expect(bj?.status === "failed" && bj.result?.error === "signed-out", "the first Add after it looks once more and says signed out");
const searchesNow = queries.length;
bj = await finished(await queueBread(2));
expect(bj?.status === "failed" && bj.result?.error === "signed-out" && queries.length === searchesNow && onSignIn(), "the next one says signed out without leaving the sign-in page");
signedIn = true;
sessionGone = false;

// ---- Safeway misbehaving (Nov 21–23: what the stand-in never did). Each case ends with the right result, and the
// next case's job is the next job working.
for (const p of ctx.pages()) if (p.url().includes("/account/sign-in")) await p.goto("https://www.safeway.com/");
await refuseAdd(null);
const queue = async (body) => { const r = await api("/api/safeway/jobs", { op: "queue", ...body }); void nudge(); return r?.job?.id; };
const run = async (body) => finished(await queue(body));
const presses = async (pid) => JSON.parse(await onSafeway(() => localStorage.getItem("presses") || "{}"))[pid] ?? 0;
const say = (j) => JSON.stringify(j?.result ?? j).slice(0, 300);
/** Safeway's misbehaviour from now on: in the pages served, and in how a page already showing answers an Add. */
const misbehave = async (c) => { chaos = c; await onSafeway((x) => localStorage.setItem("chaos", x), JSON.stringify(c)); };
const productsOk = (j, pid) => j?.status === "done" && j.result?.signedIn === true && j.result.products?.some((p) => p.id === pid);

await misbehave({ slow: 6000 });
let cj = await run({ kind: "search", query: "milk" });
expect(productsOk(cj, "960001"), `a slow Safeway page: the search waits for it and reads it (${say(cj)})`);
await misbehave({ flash: true });
cj = await run({ kind: "search", query: "milk" });
expect(productsOk(cj, "960001") && !onSignIn(), `Sign In showing a moment while the page builds isn't a sign-out (${say(cj)})`);
cj = await run({ kind: "cart" });
expect(cj?.status === "done" && cj.result?.signedIn === true && !onSignIn(), `…on the cart page too (${say(cj)})`);
await misbehave({ churn: true });
cj = await run({ kind: "search", query: "butter" });
expect(productsOk(cj, "960090"), `a page that never stops changing: read all the same (${say(cj)})`);
cj = await run({ kind: "setQty", productId: "960090", qty: 2, query: "butter", name: "Lucerne Butter Salted - 16 Oz" });
expect(cj?.status === "done" && cj.result?.reached === true && await safewayQty("960090") === 2, `…and Add then + on it go through (${say(cj)})`);
await misbehave({ nobody: true });
cj = await run({ kind: "search", query: "milk" });
expect(productsOk(cj, "960001"), `a page whose every check throws for a while: read once it can be (${say(cj)})`);
await misbehave({});
cj = await run({ kind: "search", query: "slowpoke" });
expect(cj?.status === "failed" && cj.result?.error === "not-loaded", `a page that never finishes building says it didn't load, not that nothing was found (${say(cj)})`);
cj = await run({ kind: "search", query: "yogurt" });
expect(productsOk(cj, "960120"), `Safeway sending the tab elsewhere while its page builds: opened once more and read (${say(cj)})`);
await misbehave({ away: true });
cj = await run({ kind: "setQty", productId: "960110", qty: 1, query: "cheddar", name: "Tillamook Medium Cheddar Cheese Block - 8 Oz" });
await misbehave({});
expect(cj?.status === "done" && cj.result?.qty === 1 && await safewayQty("960110") === 1 && await presses("960110") === 1, `Safeway sending the tab elsewhere right after an Add: found in the cart, not pressed again (${say(cj)}, presses ${await presses("960110")})`);
await misbehave({ choice: true });
cj = await run({ kind: "setQty", productId: "960130", qty: 1, query: "spaghetti", name: "Barilla Spaghetti - 16 Oz" });
await misbehave({});
expect(cj?.status === "done" && cj.result?.reached === false && cj.result.why === "said" && /Pick a size/.test(cj.result.said ?? "") && !/12 Oz/.test(cj.result.said ?? "") && await safewayQty("960130") === 0, `an Add that opens a box to choose from: nothing chosen, Safeway's words said (${say(cj)})`);
cj = await run({ kind: "setQty", productId: "960130", qty: 1, query: "spaghetti", name: "Barilla Spaghetti - 16 Oz" });
expect(cj?.status === "done" && cj.result?.reached === true && await safewayQty("960130") === 1, `…and the next Add goes through (${say(cj)})`);
await misbehave({ toast: true });
cj = await run({ kind: "setQty", productId: "960140", qty: 1, query: "marinara", name: "Raos Homemade Marinara Sauce - 24 Oz" });
await misbehave({});
expect(cj?.status === "done" && cj.result?.reached === false && cj.result.why === "said" && /couldn't add/.test(cj.result.said ?? ""), `an Add answered by Safeway's toast says so in its words (${say(cj)})`);
cj = await run({ kind: "setQty", productId: "960080", qty: 2, query: "gatorade", name: "Gatorade Plus Thirst Quencher Fruit Punch - 20 Fl Oz" });
expect(cj?.status === "done" && cj.result?.reached === true && await safewayQty("960080") === 2 && await presses("960080") === 2, `+ on a product named "… Plus" presses its Increase, never its Decrease (${say(cj)}, presses ${await presses("960080")})`);
cj = await run({ kind: "setQty", productId: "960070", qty: 1, query: "eggs", name: "Lucerne Farms Eggs Cage Free Large - 18 Count" });
expect(cj?.status === "done" && cj.result?.reached === true && await safewayQty("960070") === 1, `a tile far down the page, its buttons not built yet: scrolled to and added (${say(cj)})`);

// Several jobs at once, the first one slow (Nov 23: one queued behind a slow one was given up): all done, in order.
const t1 = Date.now();
const ids = [];
for (const body of [{ kind: "search", query: "slowpoke" }, { kind: "search", query: "milk" }, { kind: "setQty", productId: "960090", qty: 1, query: "butter", name: "Lucerne Butter Salted - 16 Oz" }, { kind: "search", query: "bananas" }, { kind: "cart" }]) ids.push(await queue(body));
const all = [];
for (const jid of ids) all.push(await finished(jid));
const ends = all.map((j) => Date.parse(j?.updated ?? "") || 0);
expect(all[0]?.result?.error === "not-loaded" && all.slice(1).every((j) => j?.status === "done") && ends.every((t, i) => i === 0 || t >= ends[i - 1]),
  `five jobs queued at once behind a slow one: none given up, all done in order in ${Math.round((Date.now() - t1) / 1000)} s (${all.map((j) => `${j?.kind} ${j?.status} ${j?.result?.error ?? ""}`).join(", ")})`);
expect(await safewayQty("960090") === 1, "…the quantity change among them made");

// The helper's background stopped by Chrome mid-job (as Chrome stops an extension's background; here through its
// debugging connection), which loses everything but what it keeps on the computer. The job it was doing is said at
// once, never done again; the next job works.
const stopHelper = async () => {
  const cdp = await ctx.browser().newBrowserCDPSession();
  const sw = (await cdp.send("Target.getTargets", { filter: [{}] })).targetInfos.filter((t) => t.type === "service_worker" && t.url.includes(id));
  for (const t of sw) await cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  await cdp.detach().catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));
  // Started again as Sam would start it: its panel opening (a push would do the same).
  waker ??= await ctx.newPage();
  await waker.goto(`chrome-extension://${id}/panel.html`).catch(() => {});
};
await misbehave({ slow: 8000 });
const lostId = await queue({ kind: "setQty", productId: "960110", qty: 2, query: "cheddar", name: "Tillamook Medium Cheddar Cheese Block - 8 Oz" });
await until(async () => (await api(`/api/safeway/jobs?id=${lostId}`)).job?.status === "working", 30_000);
await stopHelper();
await misbehave({});
let lost = null;
await until(async () => { lost = (await api(`/api/safeway/jobs?id=${lostId}`)).job; return lost?.status === "failed"; }, 60_000);
expect(lost?.result?.error === "lost", `a job dropped when the helper stopped mid-way is said at once, not left "working" for minutes (${say(lost)})`);
cj = await run({ kind: "search", query: "milk" });
expect(productsOk(cj, "960001") && await presses("960110") === 1, `…it's never done again, and the next job works (${say(cj)}, presses ${await presses("960110")})`);
// Stopped after a job's done but before its report got through: the report's sent when it starts again, once.
dropReports = true;
dropped = 0;
const keptId = await queue({ kind: "setQty", productId: "960120", qty: 1, query: "yogurt", name: "Chobani Greek Yogurt Plain - 32 Oz" });
await until(() => dropped > 0, 60_000);
await stopHelper();
dropReports = false;
let kept = null;
await until(async () => { kept = (await api(`/api/safeway/jobs?id=${keptId}`)).job; return kept?.status === "done" || kept?.status === "failed"; }, 60_000);
expect(kept?.status === "done" && kept.result?.reached === true && await safewayQty("960120") === 1 && await presses("960120") === 1, `a report kept when Simmer couldn't be reached is sent once the helper starts again, and the Add isn't made twice (${say(kept)}, presses ${await presses("960120")})`);

// Really signed out: Sign In stays, so it is; the tab waits on the sign-in page; signing in, the next search works.
signedIn = false;
sessionGone = true;
cj = await run({ kind: "search", query: "milk" });
expect(cj?.status === "done" && cj.result?.signedIn === false && await until(onSignIn, 15_000), `Sign In that stays: signed out, and the tab waits on the sign-in page (${say(cj)})`);
signedIn = true;
sessionGone = false;
for (const p of ctx.pages()) if (p.url().includes("/account/sign-in")) await p.goto("https://www.safeway.com/");
cj = await run({ kind: "search", query: "milk" });
expect(productsOk(cj, "960001"), `…signed in again, the next search works (${say(cj)})`);

// An empty cart that lists past purchases with Add: empty, none of them counted.
await onSafeway(() => localStorage.removeItem("cart"));
ordered = false;
cj = await run({ kind: "cart" });
expect(cj?.status === "done" && cj.result?.signedIn === true && !(cj.result.products ?? []).some((p) => p.inCart) && (await api("/api/safeway/cart")).cart.length === 0, `an empty cart listing past purchases with Add reads empty (${say(cj)})`);

// The read-only live check (scripts/live-check.mjs), run here against the stand-in as Sam runs it against Safeway: in
// the helper's own page, with the helper's page reading, pressing nothing.
const checkPage = await ctx.newPage();
await checkPage.goto(`chrome-extension://${id}/panel.html`);
await onSafeway(() => localStorage.setItem("cart", JSON.stringify({ "960001": 2 })));
const pressesBefore = await onSafeway(() => localStorage.getItem("presses"));
const live = await checkPage.evaluate(liveCheck("milk"));
expect(live?.ok === true && live.search?.products >= 2 && live.cart?.inCart === 1, `the live check reads a search and the cart right (${JSON.stringify(live).slice(0, 300)})`);
expect(await onSafeway(() => localStorage.getItem("presses")) === pressesBefore && await safewayQty("960001") === 2, "…and presses nothing");
await checkPage.close();

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
