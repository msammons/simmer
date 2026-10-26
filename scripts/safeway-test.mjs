// The Safeway test (docs/PLAN.md, section 5): can a program do what "Fill my Safeway cart" needs? Run on Sam's Mac:
//   node scripts/safeway-test.mjs
// A real browser window opens on safeway.com. Robin signs in herself (so no password is stored anywhere; the sign-in
// is kept in .data/safeway-profile on this Mac for next time). Press Enter in the terminal once she's signed in. The
// script then tries each step, one test item at a time, and writes what happened to .data/safeway/report.md with a
// screenshot per step. It also lists which of Safeway's own addresses the site called for search and the cart (without
// any sign-in details), which tells whether Simmer's server could make the same calls directly.
// It adds one item ("bananas" by default, or TEST_ITEM=...) to the cart and leaves it there: remove it before checkout.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import readline from "node:readline/promises";

const { chromium } = createRequire(import.meta.url)("playwright");
const out = ".data/safeway";
mkdirSync(out, { recursive: true });
const item = process.env.TEST_ITEM || "bananas";
const steps = [];
const calls = new Set();
const step = async (name, page, run) => {
  try { const note = await run(); steps.push(`- PASS ${name}${note ? `: ${note}` : ""}`); }
  catch (e) { steps.push(`- FAIL ${name}: ${String(e.message ?? e).split("\n")[0]}`); }
  await page.screenshot({ path: `${out}/${steps.length}-${name.replace(/\W+/g, "-")}.png` }).catch(() => {});
};

const ctx = await chromium.launchPersistentContext(".data/safeway-profile", { headless: false, viewport: { width: 1200, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on("request", (r) => {
  const u = new URL(r.url());
  if (/safeway|albertsons/.test(u.hostname) && /cart|search|product|order|purchase/i.test(u.pathname) && ["xhr", "fetch"].includes(r.resourceType())) calls.add(`${r.method()} ${u.hostname}${u.pathname}`);
});
await page.goto("https://www.safeway.com/");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Sign in to Safeway in the browser window (if it isn't already), then press Enter here… ");
rl.close();

await step("signed in", page, async () => {
  await page.goto("https://www.safeway.com/account/dashboard.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  if (/sign[- ]?in/i.test(await page.title()) || /signin|login/i.test(page.url())) throw new Error("not signed in");
});
await step("past orders", page, async () => {
  await page.goto("https://www.safeway.com/order-account/orders", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const text = await page.locator("body").innerText();
  const orders = (text.match(/order/gi) ?? []).length;
  if (!orders) throw new Error("no orders page found");
  return "the orders page opened (see the screenshot for what it lists)";
});
await step(`search for ${item}`, page, async () => {
  await page.goto(`https://www.safeway.com/shop/search-results.html?q=${encodeURIComponent(item)}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const adds = page.getByRole("button", { name: /^add/i });
  const n = await adds.count();
  if (!n) throw new Error("no products with an Add button");
  return `${n} products with an Add button`;
});
await step(`add ${item} to the cart`, page, async () => {
  await page.getByRole("button", { name: /^add/i }).first().click();
  await page.waitForTimeout(2500);
});
await step("the cart has it", page, async () => {
  await page.goto("https://www.safeway.com/erums/cart", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const text = (await page.locator("body").innerText()).toLowerCase();
  if (!text.includes(item.toLowerCase().replace(/s$/, ""))) throw new Error(`couldn't see ${item} in the cart`);
  return `${item} is in the cart (remove it before checking out)`;
});

writeFileSync(`${out}/report.md`, [
  `# Safeway test, ${new Date().toLocaleString()}`, "", ...steps, "",
  "## Safeway's own addresses the site called (search, products, cart, orders)", "",
  ...[...calls].sort().map((c) => `- ${c}`), "",
].join("\n"));
console.log(steps.join("\n"));
console.log(`\nThe report and screenshots are in ${out}/. Send report.md back to finish the plan for "Fill my Safeway cart".`);
await ctx.close();
