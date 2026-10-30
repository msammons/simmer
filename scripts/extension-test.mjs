// A check of the Safeway helper (extension/) end to end, without Safeway or Simmer: run on a Mac with
//   node scripts/extension-test.mjs
// It loads the helper into a test browser, answers safeway.com with a stand-in search page (product links, Add
// buttons that turn into a quantity) and Simmer's list with a stand-in list, then fills the cart and checks what
// happened. It shows the flow works; it can't show that Safeway's real pages match the stand-in. Exits 1 on a failure.
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

import { choose, helperStart, PAGE } from "../src/lib/safeway-helper.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const ext = path.resolve("extension");

const LIST = {
  items: [
    { id: "m", item: "milk", quantity: "2", store: "safeway", section: "fresh", checked: false, check: false },
    { id: "b", item: "bananas", quantity: "", store: "safeway", section: "fresh", checked: false, check: false },
    { id: "u", item: "unobtainium", quantity: "", store: "safeway", section: "pantry", checked: false, check: false },
    { id: "s", item: "salt", quantity: "", store: "safeway", section: "pantry", checked: false, check: true },
    { id: "t", item: "dressing", quantity: "", store: "trader-joes", section: "pantry", checked: false, check: false },
  ],
  staples: [{ item: "milk", store: "safeway", section: "fresh", quantity: "1", product: "Lucerne 2% milk half gallon" }],
};
const CATALOG = {
  milk: [["960001", "Lucerne Milk Reduced Fat 2% - 1/2 Gallon", "$3.49"], ["960002", "Lucerne Milk Reduced Fat 2% - 1 Gallon", "$5.29"], ["960003", "Oatly Oat Milk - 64 Fl. Oz.", "$5.99"]],
  bananas: [["960010", "Bananas", "$0.29 each"], ["960011", "Organic Bananas", "$0.39 each"]],
};

function searchPage(q, signedIn) {
  const hits = Object.entries(CATALOG).filter(([k]) => q.toLowerCase().includes(k) || CATALOG[k].some(([, n]) => n.toLowerCase() === q.toLowerCase())).flatMap(([, v]) => v);
  // Built like Safeway's real search tiles (read from its page code, Oct 2026): a <product-item-al-v2> with the title
  // in [data-qa="prd-itm-pttl"] (id "pg<number>"), no link to the product's page, and an "Add <name>" button. Oatly is
  // built the older way, with a link to its page, to keep that working too.
  const cards = hits.map(([id, name, price]) => /Oatly/.test(name) ? `
    <div class="product-card"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="${name}" width="40" height="40">
      <a href="/shop/product-details.${id}.html">${name}</a><span class="price">${price}</span>
      <div class="cta"><button class="add" aria-label="Add ${name}">Add</button></div></div>` : `
    <product-item-al-v2 class="product-card"><div class="pc"><img id="pg${id}Img" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="" width="40" height="40">
      <span class="title-xxs product-fname" data-qa="prd-itm-pttl" id="pg${id}" tabindex="-1">${name}</span>
      <div data-qa="prd-itm-prc">${price}</div>
      <quantity-stepper-al-v2 data-qa="qty-stppr"><div class="cta"><button class="add" aria-label="Add ${name}">Add</button></div></quantity-stepper-al-v2></div></product-item-al-v2>`).join("");
  return `<!doctype html><html><body>
    <header><a href="/">Safeway</a> ${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"} <a href="/cart" id="cart" aria-label="Cart">Cart</a></header>
    <main id="grid"></main>
    <script>
      // Results arrive a moment after the page, like Safeway's.
      setTimeout(() => {
        // Bananas come inside a component with its own hidden layer (a shadow root), as parts of Safeway's pages do.
        const grid = document.getElementById("grid");
        const into = ${/banana/i.test(q)} ? grid.attachShadow({ mode: "open" }) : grid;
        into.innerHTML = ${JSON.stringify(cards || "<h1>No search results for &quot;" + q + "&quot;</h1>")};
        // The cart count at the top, kept across pages like Safeway's.
        const count = () => Number(localStorage.getItem("cart") || 0);
        const showCount = () => { const c = document.getElementById("cart"); c.setAttribute("aria-label", "Cart, " + count() + " items"); c.textContent = "Cart " + count(); };
        showCount();
        into.querySelectorAll("button.add").forEach((b) => b.onclick = () => setTimeout(() => {
          localStorage.setItem("cart", String(count() + 1)); showCount();
          // Most products turn Add into a quantity; organic bananas show a sign the helper doesn't know, like a
          // Safeway redesign would, so only the cart count says it went in.
          b.parentElement.innerHTML = /Organic/.test(b.getAttribute("aria-label"))
            ? '<span class="added">Added</span>'
            : '<button data-qa="prdctdcrmntr" aria-label="Remove Quantity of ' + b.getAttribute("aria-label").slice(4) + '">-</button><div data-qa="prd-qty-stppr-qtybox" aria-label="Cart quantity">1</div><button data-qa="prdctincrmntr" aria-label="Increase Quantity 1 unit of ' + b.getAttribute("aria-label").slice(4) + '">+</button>';
        }, 300));
        document.addEventListener("click", (e) => {
          const t = e.composedPath().find((x) => x.tagName === "BUTTON"); if (!t || !/^Increase/.test(t.getAttribute("aria-label") || "")) return;
          const box = t.parentElement.querySelector('[data-qa="prd-qty-stppr-qtybox"]'); box.textContent = String(Number(box.textContent) + 1);
        });
      }, 500);
    </script></body></html>`;
}

const fails = [];
const expect = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails.push(what); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "simmer-ext-")), {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const posts = [];
let signedIn = false;
await ctx.route("https://www.safeway.com/**", (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/shop/search-results")) return route.fulfill({ contentType: "text/html", body: searchPage(u.searchParams.get("q") ?? "", signedIn) });
  return route.fulfill({ contentType: "text/html", body: `<html><body><header>${signedIn ? "<button>Account</button>" : "<button>Sign in</button>"}</header><h1>Safeway</h1></body></html>` });
});
await ctx.route("https://simmer-test.vercel.app/api/list", async (route) => {
  const req = route.request();
  if (req.headers()["x-passcode"] !== "test123") return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Wrong passcode."}' });
  if (req.method() === "POST") posts.push(JSON.parse(req.postData() ?? "{}"));
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(LIST) });
});

const picks = [];
await ctx.route("https://simmer-test.vercel.app/api/safeway", async (route) => {
  const req = route.request();
  if (req.headers()["x-passcode"] !== "test123") return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Wrong passcode."}' });
  if (req.method() === "POST") {
    const p = JSON.parse(req.postData() ?? "{}");
    picks.splice(0, picks.length, ...picks.filter((x) => x.item !== p.item), p);
  }
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({ picks }) });
});

// What the helper asks Simmer: how to start a run, and which product to take. Answered with Simmer's own logic
// (src/lib/safeway-helper.mjs), from the stand-in list and the picks kept above.
const chosen = [];
await ctx.route("https://simmer-test.vercel.app/api/safeway/helper", async (route) => {
  const req = route.request();
  if (req.headers()["x-passcode"] !== "test123") return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Wrong passcode."}' });
  if (req.method() === "GET") return route.fulfill({ contentType: "application/json", body: JSON.stringify(helperStart(LIST, picks)) });
  const b = JSON.parse(req.postData() ?? "{}");
  chosen.push(b.query);
  return route.fulfill({ contentType: "application/json", body: JSON.stringify(choose(b.products, { picked: b.item.picked, usual: b.item.usual, item: b.query || b.item.item })) });
});

// Simmer's order, as /api/safeway/order keeps it, for an order started on the phone.
let order = null;
await ctx.route("https://simmer-test.vercel.app/api/safeway/order", async (route) => {
  const req = route.request();
  if (req.method() === "POST") {
    const b = JSON.parse(req.postData() ?? "{}");
    const open = order && ["waiting", "filling", "asking"].includes(order.status);
    if (b.op === "claim" && order?.status === "waiting") order = { ...order, status: "filling", lines: b.lines };
    if (b.op === "report" && open) order = { ...order, lines: b.lines, note: b.note, status: order.status === "asking" ? "asking" : "filling" };
    if (b.op === "ask" && open) order = { ...order, status: "asking", question: b.question, answer: null };
    if (b.op === "end" && open) order = { ...order, status: b.status, note: b.note, question: null };
  }
  return route.fulfill({ contentType: "application/json", body: JSON.stringify({ order }) });
});

let [worker] = ctx.serviceWorkers();
worker ??= await ctx.waitForEvent("serviceworker");
const id = new URL(worker.url()).host;

const safeway = await ctx.newPage();
await safeway.goto("https://www.safeway.com/");
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${id}/panel.html`);

// The passcode: a wrong one says so, the right one shows the list.
await panel.fill("#address", "example.com");
await panel.fill("#code", "test123");
await panel.click("text=Continue");
await panel.waitForSelector("text=That address doesn't look right.");
expect(true, "an address that isn't one of the apps' says so");
await panel.fill("#address", "simmer-test.vercel.app/");
await panel.fill("#code", "nope");
await panel.click("text=Continue");
await panel.waitForSelector("text=Wrong passcode.");
expect(true, "a wrong passcode says so");
await panel.fill("#code", "test123");
await panel.click("text=Continue");
await panel.waitForSelector("text=Fill my Safeway cart");
const listText = await panel.locator("main").innerText();
expect(/3 things/.test(listText) && /Milk/.test(listText) && !/Salt/.test(listText) && !/Dressing/.test(listText), "the list shows only what's needed from Safeway");

// Signed out: it stops and asks for a sign-in instead of adding anything.
await panel.click("text=Fill my Safeway cart");
await panel.waitForSelector("text=Sign in to Safeway", { timeout: 30_000 });
expect(posts.length === 0, "signed out: stops, adds nothing");
await panel.click("text=Back to the list");

// A pick this computer made before picks were kept in Simmer goes to Simmer on the next fill.
await panel.evaluate(() => chrome.storage.local.set({ picks: { bread: { id: "960099", name: "Sourdough Bread" } } }));

// Signed in: milk is asked about (the half gallon and the gallon match the usual equally), then 2 go in.
signedIn = true;
await panel.waitForSelector("text=Fill my Safeway cart");
await panel.click("text=Fill my Safeway cart");
await panel.waitForSelector("text=Which milk?", { timeout: 30_000 });
const options = await panel.locator("[data-pick]").allInnerTexts();
expect(options.length === 3 && /Gallon/.test(options[0]), "asks about milk, listing every product found");
await panel.locator("[data-pick]", { hasText: "1/2 Gallon" }).click();
await panel.waitForSelector("text=Which bananas?", { timeout: 30_000 });
// Bananas: look for something else, then pick from what comes up.
await panel.fill("#q", "organic bananas");
await panel.press("#q", "Enter");
await panel.waitForSelector("[data-pick] >> text=Organic Bananas", { timeout: 30_000 });
// This time press Add on the Safeway page itself: the panel notices and moves on.
await safeway.locator(".product-card", { hasText: "Organic Bananas" }).getByRole("button", { name: /^Add/ }).click();
// Nothing comes up for the last one: it asks, with a box to look for something else, and she skips it.
await panel.waitForSelector("text=Which unobtainium?", { timeout: 30_000 });
expect(/Nothing came up/.test(await panel.locator("main").innerText()), "says when nothing came up");
await panel.click("text=Skip this one");
await panel.waitForSelector("text=Your cart is ready", { timeout: 30_000 });
const done = await panel.locator("main").innerText();
expect(/In the cart, 2 · Lucerne Milk Reduced Fat 2% - 1\/2 Gallon/.test(done), "milk went in, two of them");
expect(/In the cart · Organic Bananas/.test(done), "the other bananas went in");
expect(/Unobtainium\nSkipped/.test(done), "the skipped item says so");
expect(JSON.stringify(posts) === JSON.stringify([{ op: "check", id: "m", checked: true }, { op: "check", id: "b", checked: true }]), "only what went in is ticked off in Simmer");

expect(JSON.stringify(picks.map((p) => [p.item, p.id])) === JSON.stringify([["bread", "960099"], ["milk", "960001"], ["bananas", "960011"]]), "the picks are kept in Simmer, this computer's old ones too");
expect(chosen.length >= 3 && chosen[0] === "Lucerne 2% milk half gallon", "Simmer decides what to search for and which product to take");

expect(/Copy what Safeway showed/.test(done), "offers to copy what Safeway showed when its sign wasn't recognized");
await panel.click("text=Copy what Safeway showed").catch(() => {});

// The short account of the page, for when nothing can be read, works on a page like Safeway's.
const { readFileSync } = await import("node:fs");
const sampleFn = readFileSync(path.join(ext, "page.js"), "utf8").replace(/^export /m, "");
await safeway.goto("https://www.safeway.com/shop/search-results.html?q=bananas");
await safeway.waitForTimeout(1200);
const sample = await safeway.evaluate(`(async () => { ${sampleFn}; return safewayPage("sample", null, ${JSON.stringify(PAGE)}); })()`);
expect(/add buttons \(\d+\)/.test(sample) && /cart count: \d+/.test(sample) && /around the first add: </.test(sample), "the page summary reads Add buttons inside a hidden layer, the cart count and the area around them");

// Second time, with this computer's copy of the picks wiped: they come from Simmer, so only the unfindable one is
// asked about. Stop there.
await panel.evaluate(() => chrome.storage.local.remove("picks"));
posts.length = 0;
await panel.click("text=Back to the list");
await panel.click("text=Fill my Safeway cart");
await panel.waitForSelector("text=Which unobtainium?", { timeout: 60_000 });
const again = await panel.locator("main").innerText();
expect(!/Which (milk|bananas)/.test(again) && /In the cart · Organic Bananas/.test(again) && posts.length === 2, "the second time, remembered picks go in without asking");
await panel.click("text=Stop");
await panel.waitForSelector("text=Stopped before the end", { timeout: 30_000 });
expect(true, "Stop ends the run and says what's left");

// An order started on the phone: the background picks it up, adds the remembered items without anyone at the
// computer, asks Simmer about the one it can't find, and goes on when the phone answers.
await panel.close();
posts.length = 0;
order = { id: "o1", status: "waiting", started: new Date().toISOString(), updated: "", note: "", lines: [], question: null, answer: null };
const running = worker.evaluate(() => self.simmerCheckOrder());
const until = async (ok, what, ms = 60_000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 300))) if (ok()) return true; console.log("timed out:", what, JSON.stringify(order).slice(0, 400)); return false; };
expect(await until(() => order.status === "asking" && order.question?.item === "unobtainium"), "a phone order: asks Simmer about what it can't pick");
expect(order.lines.filter((l) => l.state === "in cart").map((l) => l.item).join() === "milk,bananas", "a phone order: the remembered items went in by themselves");
order = { ...order, status: "filling", question: null, answer: { itemId: "u", skip: true } };
await running;
expect(order.status === "done" && order.lines.find((l) => l.itemId === "u")?.state === "skipped", "a phone order: the answer from the phone is followed, and it finishes");
expect(order.lines.find((l) => l.item === "milk")?.qty === 2 && /^\d+$/.test(order.lines.find((l) => l.item === "milk")?.productId ?? ""), "a phone order: says how many went in, and which product");
expect(posts.filter((p) => p.op === "check").length === 2, "a phone order: ticks off in Simmer what went in");

await ctx.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nAll passed");
process.exit(fails.length ? 1 : 0);
