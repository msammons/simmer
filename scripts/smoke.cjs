/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test: passcode, planning by number (one shop at a time: New plan in the top bar, no lunches, no Made it),
// the tabs, Settings on every screen, Stock (nothing comes back by itself), Shop (one page by store), Add a meal and a
// recipe's Add to the plan, the Recipes tab, a recipe and back, adding recipes, saves that fail (the sheet keeps what was
// entered), every tap answering at once (within ~150 ms, with the server slowed to prove it), and a passcode turned down
// mid-use. Saves screenshots to .data/shots.
//
// How the checks are split (Nov 11): behaviour (a tap does X, a list changes, an alert or confirm appears, no busy words,
// answers within ~150 ms) runs ONCE, at phone size in light mode. Look and layout (Settings and the tab bar placed, row
// heights, the ⋯ column, text on one line, no sideways scroll, no console errors) runs in every setup: phone light, phone
// dark, and one desktop-width run (1000 px) standing in for the Safeway helper's panel, which can be dragged wide. What
// only guards a replaced design is one "none of the old things are back" check per screen.
//
// Works on any day of the week, with the sample data (no .env.local), whether or not a week is already planned. Needs
// Playwright (NODE_PATH if it isn't installed here). Run against a server started with HOUSEHOLD_PASSCODE=test123 and
// blank Redis and Google settings, e.g. HOUSEHOLD_PASSCODE=test123 npx next start -p 3202, then
// URL=http://localhost:3202/ node scripts/smoke.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const dir = ".data/shots";
fs.mkdirSync(dir, { recursive: true });
const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + String(x).replace(/\s+/g, " ") : ""}`);
const seen = (loc, timeout = 5000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
// [tag, colour scheme, width, height, phone, behaviour]
const SETUPS = [["phone-light", "light", 390, 844, true, true], ["phone-dark", "dark", 390, 844, true, false], ["wide", "light", 1000, 800, false, false]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** True once `fn` is, checked over and over for 150 ms from now (a tap's result must show that fast, Nov 11). */
const within150 = async (fn) => { const end = Date.now() + 150; do { if (await fn().catch(() => false)) return true; } while (Date.now() < end); return false; };

(async () => {
  const b = await chromium.launch();
  for (const [tag, scheme, width, height, phone, behaviour] of SETUPS) {
    // A fresh context each run: a registered service worker would otherwise serve the last bundle.
    const ctx = await b.newContext({ viewport: { width, height }, hasTouch: true, isMobile: phone, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    // Busy words (Nov 11: none): watched on every screen the run passes through.
    const busySeen = [];
    const BUSY = /\b(Saving|Adding|Reading it|Reading the page|Checking|Copying|Loading|Getting|Finding)…/;
    const lookForBusy = async (where) => { const t = await page.locator("body").innerText().catch(() => ""); const m = t.match(BUSY); if (m) busySeen.push(`${m[0]} on ${where}`); };
    // The server slowed by 1.5 s for changes (POSTs) to a path, so a result that shows within 150 ms didn't wait for it.
    const slow = (pattern) => page.route(pattern, async (r) => { if (r.request().method() === "POST") await wait(1500); await r.fallback().catch(() => {}); });
    const postList = (body) => page.evaluate((b) => fetch("/api/list", { method: "POST", headers: { "content-type": "application/json", "x-passcode": JSON.parse(localStorage.getItem("sm.passcode") ?? "\"\"") }, body: JSON.stringify(b) }).then(() => {}), body);
    /**
     * Safeway stood in for (no helper runs here): its cart (one thing added on Safeway's own site), the usual products
     * for Milk, Eggs and a long-named thing, and the helper doing each cart change (1.5 s later with `helperSlow`).
     * `away`: a job went unanswered, so Shop is a plain checklist.
     */
    const fakeSafeway = async ({ helperSlow = false, away = false } = {}) => {
      const cart = [{ cart: "safeway", productId: "p-loose", name: "Safeway Kitchens Sparkling Water Lime Flavored 12 Pack 12 Fl Oz Cans", price: "$5.99", image: "", qty: 1, itemId: "", item: "", updated: "" }];
      const picks = [
        { item: "Milk", id: "p-milk", name: "Lucerne 2% Reduced Fat Milk - 1 Gallon" },
        { item: "Eggs", id: "p-eggs", name: "Lucerne Large Eggs - 12 Count" },
        { item: "Extra large organic heirloom tomatoes for the big salad", id: "p-tom", name: "O Organics Heirloom Tomatoes Extra Large Family Size Value Pack - 2 Lb" },
      ];
      const onCart = (r) => r.fulfill({ json: { cart, picks, answering: !away, away, outdated: false } });
      const onJobs = async (r) => {
        const req = r.request();
        if (req.method() !== "POST") return r.fulfill({ json: { job: { id: "fake", kind: "setQty", status: "done", result: {} }, answering: true } });
        const b = req.postDataJSON() ?? {};
        if (b.op !== "queue") return r.fulfill({ json: { ok: true } });
        if (helperSlow) await wait(1500);
        if (b.kind === "setQty") {
          const at = cart.findIndex((l) => l.productId === b.productId);
          if (!b.qty) { if (at >= 0) cart.splice(at, 1); }
          else if (at >= 0) cart[at].qty = b.qty;
          else cart.push({ cart: "safeway", productId: b.productId, name: b.name, price: "$4.29", image: "", qty: b.qty, itemId: b.itemId ?? "", item: b.item ?? "", updated: "" });
        }
        return r.fulfill({ json: { job: { id: "fake", kind: b.kind, status: "waiting", result: null }, answering: true } }).catch(() => {});
      };
      await page.route("**/api/safeway/cart", onCart);
      await page.route("**/api/safeway/jobs**", onJobs);
      return { cart, stop: async () => { await page.unroute("**/api/safeway/cart", onCart); await page.unroute("**/api/safeway/jobs**", onJobs); } };
    };
    const settingsHere = async (where) => {
      await lookForBusy(where);
      const btn = page.getByRole("button", { name: "Settings" });
      ok(`${tag}: Settings at the top of ${where}`, (await btn.count()) === 1 && (await btn.boundingBox()).y < 80);
      ok(`${tag}: tab bar on ${where}`, await page.getByRole("navigation", { name: "Main" }).isVisible());
    };
    await page.goto(process.env.URL || "http://localhost:3000/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // a dev server's corner badge sits over the tab bar
    // The one passcode screen (Nov 11): the button waits for a passcode; a wrong one is the shared alert.
    if (behaviour) {
    ok(`${tag}: passcode: Get started waits for a passcode, and says it's once`, (await page.getByRole("button", { name: "Get started" }).isDisabled()) && await seen(page.getByText("You only need to do this once.")));
    await page.getByLabel("Household passcode").fill("nope"); await page.getByRole("button", { name: "Get started" }).tap();
    const wrong = page.getByRole("dialog", { name: "That passcode didn't work" });
    ok(`${tag}: wrong passcode is an alert over the page`, await seen(wrong.getByText("That passcode didn't work")) && (await page.getByText("Checking…").count()) === 0);
    await wrong.getByRole("button", { name: "OK" }).tap(); await page.waitForTimeout(300);
    }
    await page.getByLabel("Household passcode").fill("test123"); await page.getByRole("button", { name: "Get started" }).tap();
    ok(`${tag}: opens on Meals`, await seen(page.getByRole("heading", { name: "Meals" }), 8000));
    if (behaviour) ok(`${tag}: Meals lit`, (await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
    await page.waitForTimeout(800);
    await settingsHere("Meals");
    await page.screenshot({ path: `${dir}/1-week-${tag}.png` });

    // ======== Behaviour: once, at phone size in light mode ========
    if (behaviour) {
      ok("brand: says Alpha by the logo", await page.getByText("Alpha", { exact: true }).first().isVisible());
      // One Meals page (Nov 10): every kind the same way, each with Add one / Add another, which opens her recipes of that
      // kind to pick from. Simmer picks nothing itself: no Plan, Start over or Something else.
      const groupOf = (name) => page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });
      ok("meals: every kind shows, each with its Add row or No recipes", ((await groupOf("Dessert").getByRole("button", { name: /^Add$/ }).count()) + (await groupOf("Dessert").getByText(/^No recipes$/).count())) === 1 && (await groupOf("Quick").getByRole("button", { name: /^Add$/ }).count()) === 1);
      ok("meals: New plan sits in the top bar", (await page.locator(".fixed.max-w-md").getByRole("button", { name: "New plan" }).count()) === 1 || (await page.getByRole("button", { name: /^One less |^Take / }).count()) === 0);
      // None of the old things are back on Meals: a heading, Simmer's own picks (Plan, Start over, Something else, Also
      // add), lunches, Made it, arrows on the dinners, the word week, a note bar.
      {
        const old = [];
        if (await page.getByRole("heading", { name: "The plan" }).count()) old.push("The plan heading");
        if (await page.getByRole("button", { name: /^(Plan|Start over)$|^Something else/ }).count()) old.push("Simmer's own picks");
        if (await page.getByText("Also add").count()) old.push("Also add");
        if (await page.getByText(/lunch|Made it/i).count()) old.push("lunches or Made it");
        if (await page.locator("section").filter({ has: page.getByRole("heading", { name: /^(Quick|Regular)$/ }) }).getByRole("button").filter({ hasText: /\S/ }).filter({ hasNotText: /^Add$/ }).locator("svg").count()) old.push("arrows on the dinners");
        if (/\bweek\b/i.test(await page.locator("main").innerText())) old.push("week");
        ok("meals: none of the old things are back", !old.length, old.join(", "));
      }
      await groupOf("Quick").getByRole("button", { name: /^Add$/ }).tap(); await page.waitForTimeout(500);
      const kindSheet = page.getByRole("dialog", { name: "Add a meal" });
      ok("meals: Add opens that kind's recipes", await kindSheet.getByRole("heading", { name: "Add a quick dinner" }).isVisible());
      // A pick closes the sheet at once and shows on Meals straight away, with no "Saving…" (Nov 10). One that fails (the
      // connection drops) comes back off and says so on Meals; picking again works.
      const quickRowsNow = () => groupOf("Quick").getByRole("button", { name: /^One more / }).count();
      const before = await quickRowsNow();
      await page.route("**/api/plan", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      const firstName = (await kindSheet.locator("section button:not([disabled])").first().innerText()).trim();
      await kindSheet.locator("section button:not([disabled])").first().tap();
      ok("meals: a pick closes the sheet and shows on Meals within 150 ms, with no Saving", await within150(async () => (await kindSheet.count()) === 0 && (await quickRowsNow()) === before + 1) && (await page.getByText("Saving…").count()) === 0);
      const didnt = page.getByRole("dialog", { name: "That didn't go through" });
      ok("meals: a failed save takes it back off and says why, over the page", await seen(didnt.getByText("No connection. Check your signal and try again."), 8000) && (await quickRowsNow()) === before);
      ok("meals: and no problem bar on the page", (await page.locator("main > div > [role=alert], main div.space-y-6 > [role=alert]").count()) === 0);
      await didnt.getByRole("button", { name: "OK" }).tap(); await page.waitForTimeout(300);
      ok("meals: after the alert, the page scrolls again", (await page.evaluate(() => document.getElementById("scroller").style.overflow)) === "");
      if (process.env.FAILED_SHOT) await page.screenshot({ path: process.env.FAILED_SHOT });
      await page.unroute("**/api/plan");
      await groupOf("Quick").getByRole("button", { name: /^Add$/ }).tap(); await page.waitForTimeout(500);
      await kindSheet.getByRole("button", { name: firstName, exact: true }).tap();
      await page.waitForResponse((r) => r.url().includes("/api/plan") && r.request().method() === "POST", { timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(300);
      const noNote = async () => !/went on the list|came off|× \d+\.|^Added |Started a new plan/m.test(await page.locator("main").innerText());
      await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Add a meal"]'), null, { timeout: 8000 }).catch(() => {});
      ok("meals: picking one adds it, with no note bar", (await kindSheet.count()) === 0 && (await groupOf("Quick").getByRole("button", { name: /^One more / }).count()) >= 1 && await noNote());
      // How many of one dinner (Nov 10): taps show at once and go as one change once they stop; no busy errors.
      const quickPlus = groupOf("Quick").getByRole("button", { name: /^One more / }).first();
      const quickCount = () => groupOf("Quick").getByLabel(/: \d+$/).first().innerText();
      const c0 = Number(await quickCount());
      // Never more than one change on its way at a time (they used to pile up into "It's busy right now").
      let planPosts = 0, inFlight = 0, mostAtOnce = 0;
      const isPlanPost = (r) => r.url().includes("/api/plan") && r.method() === "POST";
      const countPosts = (r) => { if (isPlanPost(r)) { planPosts++; mostAtOnce = Math.max(mostAtOnce, ++inFlight); } };
      const donePost = (r) => { if (isPlanPost(r)) inFlight--; };
      page.on("request", countPosts); page.on("requestfinished", donePost); page.on("requestfailed", donePost);
      const planSaved = () => page.waitForResponse((r) => r.url().includes("/api/plan") && r.request().method() === "POST", { timeout: 8000 }).catch(() => null);
      let saved = planSaved();
      await slow("**/api/plan");
      await quickPlus.tap();
      ok("meals: + shows the new number within 150 ms", await within150(async () => Number(await quickCount()) === c0 + 1));
      await quickPlus.tap(); await quickPlus.tap();
      ok("meals: quick taps show at once", Number(await quickCount()) === c0 + 3);
      await page.unroute("**/api/plan");
      // Sent at once, and the taps made while it's on its way go as one more change (Nov 11: no timer waits for them).
      await saved; await page.waitForTimeout(1500);
      ok("meals: and go one at a time, never piling up, with no note bar", mostAtOnce === 1 && planPosts <= 3 && Number(await quickCount()) === c0 + 3 && await noNote(), `${planPosts} sent, ${mostAtOnce} at once`);
      const afterPlus = planPosts;
      saved = planSaved();
      await groupOf("Quick").getByRole("button", { name: /^One less / }).first().tap(); await groupOf("Quick").getByRole("button", { name: /^One less / }).first().tap(); await groupOf("Quick").getByRole("button", { name: /^One less / }).first().tap();
      await saved; await page.waitForTimeout(1500);
      ok("meals: − takes them back without asking, one change at a time", Number(await quickCount()) === c0 && (await page.getByRole("dialog").count()) === 0 && mostAtOnce === 1 && planPosts - afterPlus <= 3, `${planPosts - afterPlus} sent, ${mostAtOnce} at once`);
      page.off("request", countPosts); page.off("requestfinished", donePost); page.off("requestfailed", donePost);
      ok("meals: no busy message", (await page.getByText(/busy right now/i).count()) === 0);
      // A change's note doesn't follow you around: switching tabs clears it.
      await page.locator("nav button", { hasText: "Shop" }).tap(); await page.waitForTimeout(300);
      await page.locator("nav button", { hasText: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("meals: still no note bar after switching tabs", await noNote());
      await page.screenshot({ path: `${dir}/2-week-planned.png`, fullPage: true });
      // A dinner: tapping it opens the recipe on top of Meals; its quiet × takes it off after a confirm (no sheet of
      // choices, no Undo; Nov 9). Back says where it goes and goes there.
      const kindSections = page.locator("section").filter({ has: page.getByRole("heading", { name: /^(Quick|Regular)$/ }) });
      const dinners = kindSections.getByRole("button").filter({ hasText: /\S/ }).filter({ hasNotText: /^Add$/ });
      const offs = kindSections.getByRole("button", { name: /^Take .* off the plan$/ });
      let cooked = false;
      if (await dinners.count()) {
        const count = await dinners.count();
        ok("meals: each dinner has its own take-it-off button, and nothing says Made it", (await offs.count()) === count && (await page.getByText("Made it").count()) === 0);
        await offs.first().tap(); await page.waitForTimeout(300);
        const confirm = page.getByRole("dialog", { name: /^Take .* off the plan\?$/ });
        ok("meals: taking one off asks first", await confirm.isVisible());
        await confirm.getByRole("button", { name: "Cancel" }).tap(); await page.waitForTimeout(300);
        ok("meals: Cancel keeps it", (await dinners.count()) === count);
        await offs.first().tap(); await page.waitForTimeout(300);
        await slow("**/api/plan");
        await page.getByRole("dialog", { name: /^Take .* off the plan\?$/ }).getByRole("button", { name: "Take it off" }).tap();
        ok("meals: Take it off takes just that dinner off within 150 ms, with no Undo", await within150(async () => (await dinners.count()) === count - 1 || (await dinners.count()) === 0) && (await page.getByText("Undo").count()) === 0);
        await page.waitForTimeout(1800); await page.unroute("**/api/plan");
        await page.waitForTimeout(400);
        if (await dinners.count()) { await dinners.first().tap(); await page.waitForTimeout(400); cooked = await page.locator("header").getByRole("button", { name: "Edit" }).isVisible(); }
      }
      await page.waitForTimeout(400);
      if (!cooked) ok("meals: a dinner's recipe opens (skipped: no dinner with a recipe)", true);
      else {
      ok("meals: a dinner's recipe opens, and says it's on the plan", await page.getByText("On the plan.", { exact: false }).isVisible());
      await lookForBusy("a recipe from Meals");
      const nav = page.getByRole("navigation", { name: "Main" });
      ok("meals: Meals stays lit under the recipe", (await nav.getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
      await page.screenshot({ path: `${dir}/3-recipe-from-week.png` });
      ok("meals: back is named for Meals", (await page.locator("header").getByRole("button", { name: "Back to Meals" }).count()) === 1);
      await page.locator("header").getByRole("button", { name: "Back to Meals" }).tap(); await page.waitForTimeout(400);
      ok("meals: back goes to Meals", await page.getByRole("heading", { name: "Meals" }).isVisible());
      await nav.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("meals: the tab starts fresh", await page.getByRole("heading", { name: "Meals" }).isVisible());
      }

      // Add a meal (Nov 9, "Search and pick"), and a recipe's "Add to the plan". Turkey chili is the sample's only regular
      // dinner: take it off first, so it can be added back from its page and then from Add a meal.
      const tabs = page.getByRole("navigation", { name: "Main" });
      const takeChiliOff = async () => {
        await tabs.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(800);
        const off = page.getByRole("button", { name: "Take Turkey chili off the plan" });
        if (await off.count()) {
          await off.first().tap(); await page.waitForTimeout(300);
          await page.getByRole("dialog", { name: /^Take .* off the plan\?$/ }).getByRole("button", { name: "Take it off" }).tap(); await page.waitForTimeout(1000);
        }
      };
      const chiliPlanned = () => page.locator("section").filter({ has: page.getByRole("heading", { name: "Regular", exact: true }) }).getByRole("button", { name: /^Turkey chili/ });
      await takeChiliOff();
      // The recipe's page: not planned, so it offers "Add to the plan", and nothing else adds groceries (Nov 14).
      await tabs.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(600);
      await page.getByRole("button", { name: /^Turkey chili/ }).first().tap(); await page.waitForTimeout(500);
      const toWeek = page.getByRole("button", { name: "Add to the plan" });
      ok("recipe: not planned, it offers Add to the plan only", (await toWeek.isVisible()) && (await page.getByRole("button", { name: /add to the list/i }).count()) === 0);
      await page.screenshot({ path: `${dir}/8a-recipe-add-to-week.png` });
      await slow("**/api/plan");
      await toWeek.tap();
      // At once, saved behind it (Nov 11: no "Adding…", no note bar).
      ok("recipe: Add to the plan shows it planned within 150 ms, with no Adding", await within150(async () => (await page.getByText("On the plan.").isVisible()) && (await page.getByRole("button", { name: /add to the list/i }).count()) === 0 && (await toWeek.count()) === 0) && (await page.getByText("Adding…").count()) === 0);
      await page.unroute("**/api/plan");
      await page.waitForResponse((r) => r.url().includes("/api/plan") && r.request().method() === "POST", { timeout: 8000 }).catch(() => null);
      await page.waitForTimeout(300);
      ok("recipe: and no note bar after it saves", (await page.getByText(/^Added Turkey chili/).count()) === 0);
      await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap(); await page.waitForTimeout(300);
      await tabs.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(800);
      ok("recipe: it's on Meals under Regular", (await chiliPlanned().count()) === 1);
      // Add from Regular: her regular dinners A–Z, a planned one shown as Planned and not addable.
      await takeChiliOff();
      const addRegular = () => page.locator("section").filter({ has: page.getByRole("heading", { name: "Regular", exact: true }) }).getByRole("button", { name: /^Add$/ }).tap();
      await addRegular(); await page.waitForTimeout(500);
      const addSheet = page.getByRole("dialog", { name: "Add a meal" });
      const box = addSheet.getByLabel("Find a recipe");
      ok("add a meal: one sheet with a search box, not focused", (await addSheet.isVisible()) && (await box.isVisible()) && !(await box.evaluate((el) => el === document.activeElement)));
      ok("add a meal: that kind's recipes, names only", (await addSheet.getByRole("heading", { name: "Add a regular dinner" }).isVisible()) && (await addSheet.getByRole("button", { name: /^Turkey chili$/ }).count()) === 1);
      ok("add a meal: none of the old things are back (Suggested)", (await addSheet.getByText("Suggested").count()) === 0 && (await kindSheet.getByText("Suggested").count()) === 0);
      await page.screenshot({ path: `${dir}/8b-add-a-meal.png` });
      await page.setViewportSize({ width: 320, height: 640 }); await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/8c-add-a-meal-320.png` });
      ok("add a meal: fits 320 wide", (await addSheet.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 0);
      await box.fill("chili"); await page.waitForTimeout(300);
      ok("add a meal: typing finds recipes, and offers no words-only meal (an old thing)", (await addSheet.getByRole("button", { name: /^Turkey chili/ }).count()) === 1 && (await addSheet.getByText(/^Add “/).count()) === 0);
      await page.screenshot({ path: `${dir}/8d-add-a-meal-search-320.png` });
      await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
      await addSheet.getByRole("button", { name: /^Turkey chili/ }).tap();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Add a meal"]'), null, { timeout: 8000 }).catch(() => {});
      ok("add a meal: picking one closes the sheet", (await addSheet.count()) === 0);
      ok("add a meal: it's under its own kind (Regular)", (await chiliPlanned().count()) === 1);
      // Nothing of a kind left to pick (Turkey chili is the sample's only regular dinner): the row goes to adding a recipe.
      const regularGroup = page.locator("section").filter({ has: page.getByRole("heading", { name: "Regular", exact: true }) });
      ok("meals: with all of a kind planned, no Add row and no line about it", (await regularGroup.getByText(/^No (more )?recipes$/).count()) === 0 && (await regularGroup.getByRole("button", { name: /^(Add|New recipe)$/ }).count()) === 0);
      // A search with no match, from any kind that still has recipes to pick.
      const anyAdd = page.getByRole("button", { name: /^Add$/ }).first();
      if (await anyAdd.count()) {
        await anyAdd.tap(); await page.waitForTimeout(500);
        await addSheet.getByLabel("Find a recipe").fill("Dinner at Grandma's"); await page.waitForTimeout(200);
        ok("add a meal: no match says so, and nothing to tap", (await addSheet.getByText("No recipe called “Dinner at Grandma's”").isVisible()) && (await addSheet.getByRole("button", { name: /New recipe|Add a recipe/ }).count()) === 0);
        await addSheet.getByRole("button", { name: "Close" }).last().tap(); await page.waitForTimeout(300);
      } else ok("add a meal: no match (skipped: nothing left to pick anywhere)", true);
      await page.screenshot({ path: `${dir}/8e-meals-after-add.png`, fullPage: true });
      // New plan (Nov 10): asks first; every dinner comes off; the grocery list stays.
      const listNow = () => page.evaluate(() => fetch("/api/list", { headers: { "x-passcode": JSON.parse(localStorage.getItem("sm.passcode") ?? "\"\"") } }).then((r) => r.ok ? r.json() : null).then((l) => (l?.items ?? []).filter((x) => !x.checked).map((x) => ({ item: x.item, for: x.for }))).catch(() => []));
      await page.evaluate(() => fetch("/api/list", { method: "POST", headers: { "content-type": "application/json", "x-passcode": JSON.parse(localStorage.getItem("sm.passcode") ?? "\"\"") }, body: JSON.stringify({ op: "add", text: "new-plan hand-added bread", by: "Sam" }) }));
      const listBefore = await listNow();
      await page.getByRole("button", { name: "New plan", exact: true }).tap(); await page.waitForTimeout(300);
      const fresh = page.getByRole("dialog", { name: "Start a new plan?" });
      ok("new plan: asks first, saying everything starts fresh and the cart stays", (await fresh.isVisible()) && (await fresh.getByText(/Everything starts fresh/).isVisible()) && (await fresh.getByText(/Safeway cart stays/).isVisible()) && (await fresh.getByText(/week/i).count()) === 0);
      await slow("**/api/plan");
      await fresh.getByRole("button", { name: "New plan" }).tap();
      ok("new plan: the dinners come off within 150 ms", await within150(async () => (await page.getByRole("button", { name: /^Take .* off the plan$|^One less / }).count()) === 0));
      await page.waitForTimeout(1800); await page.unroute("**/api/plan");
      await page.waitForFunction(() => !document.querySelector('button[aria-label^="Take "]'), null, { timeout: 8000 }).catch(() => {});
      ok("new plan: every dinner comes off", (await page.getByRole("button", { name: /^Take .* off the plan$/ }).count()) === 0 && (await page.getByRole("button", { name: /^One less / }).count()) === 0);
      const listAfter = await listNow();
      ok("new plan: every list is emptied, hand-added things too", listAfter.length === 0 && listBefore.length > 0, `${listBefore.length} → ${listAfter.length}`);

      // A request budget (Nov 11: bursts of reloads went over Google's limits). Going round the tabs twice in a row: the
      // second round asks the server for (almost) nothing, since what was just loaded is still fresh.
      {
        let gets = 0;
        const countGets = (r) => { if (r.url().includes("/api/") && r.method() === "GET") gets++; };
        page.on("request", countGets);
        const round = async () => { for (const t of ["Meals", "Stock", "Shop", "Recipes", "Meals"]) { await page.locator("nav button", { hasText: t }).tap(); await page.waitForTimeout(250); } };
        await round(); await page.waitForTimeout(600);
        const first = gets;
        await round(); await page.waitForTimeout(600);
        page.off("request", countGets);
        ok("tabs: a second round of the tabs asks for almost nothing", gets - first <= 2, `first round ${first}, second ${gets - first}`);
      }

      // Settings: the look only (adding recipes lives on the Recipes tab, Nov 9).
      await page.getByRole("button", { name: "Settings" }).tap(); await page.waitForTimeout(400);
      const settings = page.getByRole("dialog", { name: "Settings" });
      ok("settings: offers Copy to Google Sheet", await page.getByRole("button", { name: /^Copy to Google Sheet/ }).isVisible());
      {
        // The release as YY.M.D, the last line of Settings (Nov 11).
        const last = (await settings.locator("p").last().innerText()).trim();
        ok("settings: ends with the version", /^\d{2}\.\d{1,2}\.\d{1,2}(\.\d+)?$/.test(last), last);
      }
      // Copy says Copied at once and copies behind it; here (no Google) it doesn't go through: back, and the alert says why.
      await page.getByRole("button", { name: /^Copy to Google Sheet/ }).tap();
      ok("settings: Copy says Copied within 150 ms", await within150(() => page.getByRole("button", { name: /^Copy to Google Sheet.*Copied/ }).isVisible()));
      const copyAlert = page.getByRole("dialog", { name: "That didn't go through" });
      ok("settings: a copy that doesn't go through says why, and the row goes back", await seen(copyAlert, 10000) && await copyAlert.getByRole("button", { name: "OK" }).tap().then(async () => { await page.waitForTimeout(300); return !(await page.getByRole("button", { name: /Copied/ }).count()); }));
      // Ordering (docs/CHECKOUT.md): off until changed. Settings keeps the switch and Face ID (Nov 13); the limit, store
      // and card are in Shop → Check out. Turning on needs Face ID, so with none set up it says so at once.
      ok("settings: ordering starts off, with the limit, store and card under Check out", await settings.getByRole("button", { name: /^Order from Simmer.*Off$/ }).isVisible()
        && (await settings.getByRole("button", { name: /^(Limit per order|Pickup store|Card)/ }).count()) === 0);
      await settings.getByRole("button", { name: /^Order from Simmer/ }).tap();
      const firstFaceId = page.getByRole("dialog", { name: "Set up Face ID first" });
      ok("settings: turning ordering on with no Face ID says to set it up first, within 150 ms", await within150(() => firstFaceId.isVisible()));
      await firstFaceId.getByRole("button", { name: "OK" }).tap(); await page.waitForTimeout(300);
      ok("settings: and ordering stays off", await settings.getByRole("button", { name: /^Order from Simmer.*Off$/ }).isVisible());
      // Face ID (Nov 12): none set up on a fresh server, so the row offers Set up (Face ID itself can't be driven here).
      ok("settings: Face ID starts at Set up", await settings.getByRole("button", { name: /^Face ID.*Set up$/ }).isVisible());
      // Adding a phone (Nov 12) only comes up once one has Face ID: nothing to approve or wait for yet.
      ok("settings: no phone to approve or set up after approving", (await settings.getByRole("button", { name: /^(Approve a new phone|Set up after approving)/ }).count()) === 0);
      await page.getByRole("radio", { name: /^Apricot/ }).tap();
      ok("settings: theme switches within 150 ms", await within150(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "apricot"));
      await page.getByRole("radio", { name: /^Simmer$/ }).tap();
      ok("settings: none of the old things are back (Add recipes)", (await settings.getByRole("button", { name: /^Add recipes/ }).count()) === 0);
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);

      const tabBar = page.getByRole("navigation", { name: "Main" });
      const needOf = (n) => page.getByRole("button", { name: `Need: ${n}`, exact: true });
      const haveOf = (n) => page.getByRole("button", { name: `Have: ${n}`, exact: true });
      const answerOf = async (n) => ((await haveOf(n).getAttribute("aria-pressed")) === "true" ? "have" : (await needOf(n).getAttribute("aria-pressed")) === "true" ? "need" : "check");
      const clear = async (n) => { const a = await answerOf(n); if (a !== "check") { await (a === "have" ? haveOf(n) : needOf(n)).tap(); await page.waitForTimeout(1200); } };
      // Stock (Nov 11): every row answered with one switch, Have | Need (never both); the lit side tapped again clears it.
      // Need puts it on its store's list. A dinner's things are highlighted in their own sections.
      await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
      await lookForBusy("Stock");
      ok("stock: has the add field", await page.getByLabel("Add something to Stock").isVisible());
      // None of the old things are back on Stock: the legend, the For this plan group, Every week.
      {
        const old = [];
        if (await page.getByText(/Need puts it on the list|In meals|to check/).count()) old.push("legend");
        if (await page.getByText("For this plan").count()) old.push("For this plan");
        if ((await page.getByText(/every week/i).count()) || (await page.getByLabel("More for Eggs").locator("option", { hasText: /week/i }).count())) old.push("Every week");
        ok("stock: none of the old things are back", !old.length, old.join(", "));
      }
      const meal = page.locator(".bg-accent\\/15").filter({ has: page.getByRole("group", { name: /^Have or need / }) });
      if (await meal.count()) {
        const name = (await meal.first().getByRole("group").getAttribute("aria-label")).replace(/^Have or need /, "");
        await clear(name);
        await haveOf(name).tap(); await page.waitForTimeout(1200);
        ok("stock: a meal thing: Have lights", (await answerOf(name)) === "have");
        await needOf(name).tap(); await page.waitForTimeout(1200);
        ok("stock: Need switches it (never both), still highlighted", (await answerOf(name)) === "need" && (await meal.filter({ hasText: new RegExp(name, "i") }).count()) === 1);
        await needOf(name).tap(); await page.waitForTimeout(1200);
        ok("stock: tapping the lit side again makes it to check", (await answerOf(name)) === "check");
      } else ok("stock: meal things (none need anything from the house in the sample)", true);
      // A kept thing works the same way.
      await clear("Milk");
      await needOf("Milk").tap();
      ok("stock: Need lights within 150 ms, before the save comes back", await within150(async () => (await answerOf("Milk")) === "need"));
      await page.waitForTimeout(1500);
      ok("stock: Need puts a kept thing on the list", (await answerOf("Milk")) === "need");
      await slow("**/api/list");
      await haveOf("Milk").tap();
      ok("stock: Have switches it within 150 ms", await within150(async () => (await answerOf("Milk")) === "have"));
      await page.waitForTimeout(1800); await page.unroute("**/api/list");
      ok("stock: Have switches it off the list, marked checked", (await answerOf("Milk")) === "have");
      await haveOf("Milk").tap(); await page.waitForTimeout(1500);
      ok("stock: and the lit side again clears it", (await answerOf("Milk")) === "check");
      await needOf("Milk").tap(); await page.waitForTimeout(1500);
      if ((await answerOf("Eggs")) !== "need") { await needOf("Eggs").tap(); await page.waitForTimeout(1500); }
      // Remove from Stock asks first (the shared confirm); Cancel keeps it.
      await page.getByLabel("More for Eggs").selectOption("remove"); await page.waitForTimeout(300);
      const removeAsk = page.getByRole("dialog", { name: "Remove Eggs from Stock?" });
      ok("stock: Remove from Stock asks first", (await removeAsk.isVisible()) && (await removeAsk.getByRole("button", { name: "Remove from Stock" }).isVisible()));
      await removeAsk.getByRole("button", { name: "Cancel" }).tap(); await page.waitForTimeout(300);
      ok("stock: Cancel keeps it in Stock", (await removeAsk.count()) === 0 && (await needOf("Eggs").count()) === 1);
      // Something new shows at once, as a stand-in row the server's answer replaces (Nov 11: always responsive).
      await slow("**/api/list");
      await page.getByLabel("Add something to Stock").fill("frozen waffles"); await page.keyboard.press("Enter");
      ok("stock: something added shows within 150 ms", await within150(() => page.getByRole("group", { name: /Have or need frozen waffles/i }).first().isVisible()));
      await page.waitForTimeout(1800); await page.unroute("**/api/list");
      ok("stock: and is still there once it's saved", (await page.getByRole("group", { name: /Have or need frozen waffles/i }).count()) === 1);
      await page.screenshot({ path: `${dir}/5-stock-behaviour.png`, fullPage: true });

      // Shop (Nov 12): one page grouped by store, with a store filter at the top. What's out in Stock is on the list. Safeway's side is
      // stood in for (its cart, the usual products, and the helper doing cart changes a moment later).
      await postList({ op: "add", text: "Coffee", by: "Sam", store: "costco" });
      await postList({ op: "add", text: "Salad dressing", by: "Sam", store: "trader-joes" });
      const fake = await fakeSafeway({ helperSlow: true });
      await tabBar.getByRole("button", { name: "Shop" }).tap(); await page.waitForTimeout(1000);
      await lookForBusy("Shop");
      const tick = (n) => page.getByRole("checkbox", { name: new RegExp(`^${n}`) }).first();
      ok("shop: the tab is named Shop, lit, with the add field", (await page.getByRole("heading", { name: "Shop" }).count()) === 1 && (await tabBar.getByRole("button", { name: "Shop" }).getAttribute("aria-current")) === "page" && (await page.getByLabel("Add something").isVisible()));
      ok("shop: grouped by store, Safeway first, then Trader Joe's, Costco", (await page.locator("main section h2").allInnerTexts()).join() === "Safeway,Trader Joe's,Costco", (await page.locator("main section h2").allInnerTexts()).join());
      ok("shop: what's out in Stock is on the list", await seen(tick("Milk")));
      ok("shop: every list row has a checkbox (only a cart thing added on Safeway has none)", (await page.locator("[data-shop-row]").count()) === (await page.locator("[data-shop-row] [role=checkbox]").count()) + 1);
      const swGroup = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Safeway", exact: true }) });
      ok("shop: the Safeway header has the cart, Auto-fill and Check out", /^1 in the cart · \$5\.99\s*Auto-fill 2\s*Check out$/.test((await swGroup.locator("h2 + *").innerText().catch(() => "")).trim()), await swGroup.locator("h2 + *").innerText().catch(() => ""));
      // Check out (Nov 13): the first time, the set-up is right there, Face ID first; Turn on waits until it's all set.
      {
        await swGroup.getByRole("button", { name: "Check out" }).tap();
        const co = page.getByRole("dialog", { name: "Check out" });
        ok("shop: Check out opens its sheet within 150 ms", await within150(() => co.isVisible()));
        await page.waitForTimeout(800);
        const setupRows = (await co.getByRole("button", { name: /^(Face ID|Limit per order|Pickup store|Card)/ }).allInnerTexts()).map((t) => t.split("\n")[0].trim());
        ok("shop: the first time, it sets up Face ID and the limit (the store and card come from Safeway, Nov 14)", setupRows.join() === "Face ID,Limit per order", setupRows.join());
        ok("shop: Face ID offers Set up, the limit is $0, and Turn on waits", await co.getByRole("button", { name: /^Face ID.*Set up$/ }).isVisible()
          && await co.getByRole("button", { name: /^Limit per order.*\$0$/ }).isVisible() && await co.getByRole("button", { name: "Turn on ordering" }).isDisabled());
        ok("shop: nothing there places an order", (await co.getByRole("button", { name: /place|order now/i }).count()) === 0);
        // Test runs (Nov 13) come only once ordering is set up and on.
        ok("shop: no test run before ordering is set up", (await co.getByRole("button", { name: /^(Test run|Get ready)/ }).count()) === 0);
        ok("shop: no button anywhere on the page says Place order", (await page.getByRole("button", { name: /place order/i }).count()) === 0);
        await co.getByRole("button", { name: /^Limit per order/ }).tap();
        const needFace = page.getByRole("dialog", { name: "Set up Face ID first" });
        ok("shop: changing the limit with no Face ID says to set it up first", await seen(needFace, 2000));
        await needFace.getByRole("button", { name: "OK" }).tap(); await page.waitForTimeout(300);
        await page.keyboard.press("Escape"); await page.waitForTimeout(400);
        // The store and card (Nov 14): picked from what Safeway's checkout shows, in place of Check out's rows (no second
        // sheet). With Face ID pretended on, Pickup store reads Safeway and offers its store; Back returns to the rows.
        await page.route("**/api/checkout", async (r) => {
          if (r.request().method() === "GET") return r.fulfill({ json: { settings: { on: false, limitCents: 2000, store: "", card: "" }, server: false, faceId: 1, adding: null } });
          const b = r.request().postDataJSON() ?? {};
          if (b.op === "look") { await new Promise((w) => setTimeout(w, 400)); return r.fulfill({ json: { store: "100 Main St, Springfield, CA 90000", card: "4242" } }); }
          if (b.op === "check-options") return r.fallback();
          return r.fallback();
        });
        await swGroup.getByRole("button", { name: "Check out" }).tap(); await page.waitForTimeout(800);
        ok("shop: once set up, the store and card say they come from Safeway", await seen(co.getByRole("button", { name: /^Pickup store.*From Safeway$/ }), 2000) && await co.getByRole("button", { name: /^Card.*From Safeway$/ }).isVisible());
        await co.getByRole("button", { name: /^Pickup store/ }).tap();
        ok("shop: Pickup store shows in place, reading Safeway, with no second sheet", await seen(co.getByRole("status", { name: "Reading Safeway's checkout" }), 1000) && (await page.getByRole("dialog").count()) === 1);
        const pick = co.getByRole("radio", { name: /100 Main St, Springfield, CA 90000/ });
        ok("shop: then offers the store Safeway shows, to pick", await seen(pick, 3000) && (await pick.innerText()).includes("What Safeway shows"));
        await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/pick-store.png` : "/tmp/pick-store.png" });
        await co.getByRole("button", { name: "Back" }).tap(); await page.waitForTimeout(300);
        await co.getByRole("button", { name: /^Card/ }).tap();
        ok("shop: Card offers Safeway's card from the same reading, at once", await seen(co.getByRole("radio", { name: /•••• 4242/ }), 300));
        await co.getByRole("button", { name: "Back" }).tap(); await page.waitForTimeout(300);
        await page.keyboard.press("Escape"); await page.waitForTimeout(400);
        await page.unroute("**/api/checkout");
      }
      ok("shop: a Safeway row says its product and what's needed", await seen(tick("Milk").getByText(/Lucerne 2% Reduced Fat Milk.* · Need 1 gallon/)));
      ok("shop: a cart thing added on Safeway ends the Safeway group, with its price", (await swGroup.locator("[data-shop-row]").last().innerText()).includes("Sparkling Water"));
      ok("shop: no Done shopping; Show got is there, on (Nov 14)", (await page.getByRole("button", { name: "Done shopping" }).count()) === 0 && (await page.getByRole("button", { name: "Show got" }).getAttribute("aria-pressed")) === "true");
      // Add puts the usual in the cart: − n + at once, the helper's answer behind it.
      await page.getByRole("button", { name: "Add Milk to the cart" }).tap();
      ok("shop: Add shows − 1 + within 150 ms", await within150(async () => (await page.getByLabel("1 in the cart").count()) >= 2 && (await page.getByRole("button", { name: "One more Milk" }).isVisible())));
      await page.getByRole("button", { name: "One more Milk" }).tap();
      ok("shop: + shows within 150 ms", await within150(() => page.getByLabel("2 in the cart").first().isVisible()));
      await page.waitForTimeout(4500);
      ok("shop: and Safeway has them: the header counts them, Auto-fill gone with one usual left", (await swGroup.locator("h2 + *").innerText().catch(() => "")).startsWith("3 in the cart") && (await page.getByRole("button", { name: /^Auto-fill/ }).count()) === 0 && fake.cart.some((l) => l.productId === "p-milk" && l.qty === 2), JSON.stringify(fake.cart.map((l) => [l.productId, l.qty])));
      ok("shop: Find on a row with no usual", (await page.getByRole("button", { name: /^Find .* at Safeway$/ }).count()) + (await page.getByRole("button", { name: /^Add .* to the cart$/ }).count()) >= 1);
      await slow("**/api/list");
      await tick("Milk").tap();
      ok("shop: a tick shows within 150 ms, struck through", await within150(async () => (await tick("Milk").getAttribute("aria-checked")) === "true" && (await tick("Milk").locator(".line-through").count()) === 1));
      ok("shop: with Show got on, a ticked row stays", (await tick("Milk").count()) === 1);
      // Added by hand: on the list at once, as a stand-in row until the server's list comes back.
      await page.getByLabel("Add something").fill("smoke basil"); await page.keyboard.press("Enter");
      ok("shop: something added shows within 150 ms", await within150(() => page.getByRole("checkbox", { name: /smoke basil/i }).first().isVisible()));
      await page.waitForTimeout(1800); await page.unroute("**/api/list");
      ok("shop: and is there once, once it's saved", (await page.getByRole("checkbox", { name: /smoke basil/i }).count()) === 1);
      // Ordered? asks first; Cancel leaves the list alone.
      await page.getByRole("button", { name: "Ordered? Take the cart off the list" }).tap(); await page.waitForTimeout(300);
      const ordered = page.getByRole("dialog", { name: "Take the cart off the list?" });
      ok("shop: Ordered? asks first", await ordered.isVisible());
      await ordered.getByRole("button", { name: "Cancel" }).tap(); await page.waitForTimeout(300);
      // The store filter (Nov 12): All shows every store; a store shows only its rows, and Done shopping goes by it.
      {
        await page.getByRole("radio", { name: "Trader Joe's" }).tap();
        const only = await within150(async () => (await page.locator("main section h2").allInnerTexts()).join() === "Trader Joe's");
        ok("shop: the filter shows one store's rows, within 150 ms", only, (await page.locator("main section h2").allInnerTexts()).join());
        ok("shop: the same rows, checkbox and all", (await page.getByRole("checkbox", { name: /^Salad dressing/ }).count()) === 1 && (await page.getByRole("checkbox", { name: /^Milk/ }).count()) === 0);
        await page.getByRole("radio", { name: "All" }).tap(); await page.waitForTimeout(300);
        ok("shop: All shows every store again", (await page.locator("main section h2").allInnerTexts()).join() === "Safeway,Trader Joe's,Costco");
      }
      // None of the old things are back on Shop: the Safeway groups, thumbnails on rows, Clear, a
      // "connected" status (no timer keeps one fresh, Nov 11).
      {
        const old = [];
        if (await page.getByRole("heading", { name: /^(Same as last time|To find|In the cart)$/ }).count()) old.push("the Safeway groups");
        if (await page.locator("main img").count()) old.push("thumbnails");
        if (await page.getByRole("button", { name: "Clear", exact: true }).count()) old.push("Clear");
        if (await page.getByText(/Can't reach Safeway right now|isn't connected/).count()) old.push("a guess whether the helper's there");
        ok("shop: none of the old things are back", !old.length, old.join(", "));
      }
      // Show got (Nov 14, in place of Done shopping): only the toggle decides. Off hides what's ticked; on brings it back.
      await tick("Milk").tap(); await page.waitForTimeout(600); // untick Milk
      await tick("Eggs").tap(); await page.waitForTimeout(400);
      await tick("Coffee").tap(); await page.waitForTimeout(1500);
      ok("shop: ticked rows stay, struck through, with Show got on", (await tick("Eggs").getAttribute("aria-checked")) === "true" && (await tick("Coffee").count()) === 1);
      await page.getByRole("button", { name: "Show got" }).tap();
      ok("shop: Show got off hides them within 150 ms, still counted", await within150(async () => (await page.getByRole("checkbox", { name: /^(Eggs|Coffee)/ }).count()) === 0) && (await tick("Milk").count()) === 1 && /2 of \d+ got/.test(await page.getByText(/ of \d+ got$/).first().innerText()));
      await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(500);
      await tabBar.getByRole("button", { name: "Shop" }).tap(); await page.waitForTimeout(800);
      ok("shop: and it stays off on coming back", (await page.getByRole("button", { name: "Show got" }).getAttribute("aria-pressed")) === "false" && (await page.getByRole("checkbox", { name: /^(Eggs|Coffee)/ }).count()) === 0);
      await page.getByRole("button", { name: "Show got" }).tap();
      ok("shop: Show got on brings them back within 150 ms", await within150(async () => (await tick("Eggs").getAttribute("aria-checked")) === "true" && (await tick("Coffee").count()) === 1));
      // An empty cart: no Check out.
      {
        const kept = fake.cart.splice(0);
        await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(400);
        await tabBar.getByRole("button", { name: "Shop" }).tap(); await page.waitForTimeout(1000);
        ok("shop: Check out shows only with something in the cart", (await page.getByRole("button", { name: "Check out" }).count()) === 0);
        fake.cart.push(...kept);
      }
      // Safeway out of reach: no Safeway controls, nothing extra in its header; its rows are a plain checklist.
      await fake.stop();
      const awayFake = await fakeSafeway({ away: true });
      await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(400);
      await tabBar.getByRole("button", { name: "Shop" }).tap(); await page.waitForTimeout(1000);
      ok("shop: with Safeway out of reach, its rows are a plain checklist", (await page.getByRole("button", { name: /^(Add .* to the cart|Find .* at Safeway|One more .*)$/ }).count()) === 0 && (await swGroup.locator("h2 + *").count()) === 0 && (await tick("Milk").count()) === 1);
      await page.screenshot({ path: `${dir}/5c-shop-away.png`, fullPage: true });
      await awayFake.stop();
      await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
      await needOf("Milk").tap(); await page.waitForTimeout(1500);
      ok("stock: tapping Need again takes it back off", (await answerOf("Milk")) === "check");
      ok("stock: after the shop, Eggs isn't on the list any more", (await answerOf("Eggs")) === "check");

      // The Recipes tab, a recipe, and back.
      ok("tabs: four tabs (Recipes, Meals, Stock, Shop)", (await tabBar.getByRole("button").allInnerTexts()).join() === "Recipes,Meals,Stock,Shop");
      await tabBar.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(500);
      await lookForBusy("Recipes");
      ok("recipes: Recipes lit", (await tabBar.getByRole("button", { name: "Recipes" }).getAttribute("aria-current")) === "page");
      // None of the old things are back on Recipes: a search tab, a plus button at the top, add-to-list buttons on rows.
      {
        const old = [];
        if (await page.getByRole("search").count()) old.push("search");
        if (await page.locator("header, .fixed.max-w-md").getByRole("button", { name: "Add recipes" }).count()) old.push("plus button at the top");
        if (await page.getByRole("button", { name: /^Add .+ to the list$/ }).count()) old.push("add-to-list buttons on rows");
        ok("recipes: none of the old things are back", !old.length, old.join(", "));
      }
      // Rows only open the recipe; a recipe has no Add to the list (Nov 14): groceries come only through the plan.
      const chiliRow = page.getByRole("button", { name: /^Turkey chili/ }).first();
      for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await chiliRow.isVisible()) break; await all.tap(); await page.waitForTimeout(200); }
      await chiliRow.tap(); await page.waitForTimeout(400);
      ok("recipe: no Add to the list on a recipe (Nov 14)", (await page.getByRole("button", { name: /add to the list/i }).count()) === 0);
      await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap(); await page.waitForTimeout(400);
      const tacos = page.getByRole("button", { name: /^Tacos/ }).first();
      for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await tacos.isVisible()) break; await all.tap(); await page.waitForTimeout(200); }
      await tacos.tap(); await page.waitForTimeout(300);
      ok("recipe: the recipe screen; none of the old things are back (Quick/Regular outside Edit)", (await page.getByRole("heading", { name: "Tacos" }).isVisible()) && (await page.getByRole("radio", { name: "Quick" }).count()) === 0);
      await lookForBusy("a recipe");
      // Editing a recipe when the save fails: the sheet stays with what was typed.
      await page.getByRole("button", { name: "Edit", exact: true }).tap(); await page.waitForTimeout(400);
      const edit = page.getByRole("dialog", { name: "Edit Tacos" });
      ok("edit: Quick/Regular is chosen here", await edit.getByRole("radio", { name: "Quick" }).isVisible());
      await edit.getByPlaceholder("Double the spice for Sam").fill("A note that must survive");
      await page.route("**/api/recipes", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      // Save closes at once (Nov 11: no "Saving…"); one that fails opens Edit again with what was typed, under the alert.
      await edit.getByRole("button", { name: "Save", exact: true }).tap();
      ok("edit: Save closes at once, with no Saving", (await page.getByText("Saving…").count()) === 0);
      const editAlert = page.getByRole("dialog", { name: "That didn't go through" });
      ok("edit: a failed save says why, over the page", await seen(editAlert.getByText("No connection"), 8000));
      ok("edit: and opens Edit again with what was typed", (await edit.isVisible()) && (await edit.getByPlaceholder("Double the spice for Sam").inputValue()) === "A note that must survive");
      await editAlert.getByRole("button", { name: "OK" }).tap(); await page.waitForTimeout(300);
      ok("edit: and the save button works again", await edit.getByRole("button", { name: "Save", exact: true }).isEnabled());
      await page.unroute("**/api/recipes");
      // A save that goes through: the recipe shows the change within 150 ms, ingredients too, before the server answers.
      await slow("**/api/recipes");
      await edit.getByPlaceholder("Double the spice for Sam").fill("Smoke note");
      const ingredients = edit.locator("textarea").first(); // Ingredients, one per line
      await ingredients.fill(`${await ingredients.inputValue()}\n2 smoke limes`);
      await edit.getByRole("button", { name: "Save", exact: true }).tap();
      ok("edit: a save shows on the recipe within 150 ms, new ingredient too", await within150(async () => (await edit.count()) === 0 && (await page.getByText("Smoke note").isVisible()) && (await page.getByText(/2 smoke limes/).first().isVisible())));
      await page.waitForTimeout(1800); await page.unroute("**/api/recipes");
      ok("edit: and it's still there once it's saved", (await page.getByText("Smoke note").isVisible()) && (await page.getByText(/2 smoke limes/).first().isVisible()));
      // Stop suggesting this: flips at once.
      await slow("**/api/recipes");
      await page.getByRole("button", { name: "Stop suggesting this" }).tap();
      ok("recipe: Stop suggesting flips within 150 ms", await within150(() => page.getByRole("button", { name: "Suggest this again" }).isVisible()));
      await page.waitForTimeout(1800); await page.unroute("**/api/recipes");
      await page.getByRole("button", { name: "Suggest this again" }).tap(); await page.waitForTimeout(1200);

      // Adding recipes: Save closes the sheet and the recipe shows at once (one: its page; several: the collection),
      // before the server answers; then it's the saved recipe.
      await tabBar.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(500);
      const addRecipes = page.getByRole("dialog", { name: "Add recipes" });
      const typeIn = async (text) => {
        await page.getByRole("button", { name: "Add recipes" }).first().tap(); await page.waitForTimeout(300);
        await addRecipes.getByRole("button", { name: "Type it in" }).tap();
        await addRecipes.locator("textarea").fill(text);
        await page.getByRole("button", { name: "Read it" }).tap();
      };
      await typeIn("Smoke soup");
      ok("add recipes: reading shows its review", await seen(addRecipes.getByLabel("Name"), 15000) || await seen(addRecipes.getByPlaceholder("Turkey chili"), 1000));
      await slow("**/api/recipes");
      await page.getByRole("button", { name: "Save", exact: true }).tap();
      ok("add recipes: Save opens the new recipe within 150 ms", await within150(async () => (await addRecipes.count()) === 0 && (await page.getByRole("heading", { name: "Smoke soup" }).isVisible())));
      await page.waitForTimeout(1800); await page.unroute("**/api/recipes");
      ok("add recipes: and it's still open once it's saved", await page.getByRole("heading", { name: "Smoke soup" }).isVisible());
      await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap(); await page.waitForTimeout(400);
      await typeIn("Smoke salad\nSmoke stew");
      ok("add recipes: a list of ideas offers each", await seen(page.getByRole("button", { name: "Save 2" }), 15000));
      await slow("**/api/recipes");
      await page.getByRole("button", { name: "Save 2" }).tap();
      ok("add recipes: several show in the collection within 150 ms", await within150(async () => (await addRecipes.count()) === 0 && (await page.getByText("Smoke salad").count()) > 0 && (await page.getByText("Smoke stew").count()) > 0));
      await page.waitForTimeout(1800); await page.unroute("**/api/recipes");
      ok("add recipes: and they're there once saved", (await page.getByText("Smoke salad").count()) > 0);
    }

    // ======== Look and layout: every setup ========
    const tabs = page.getByRole("navigation", { name: "Main" });
    await tabs.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(600);
    await settingsHere("Meals");
    await page.getByRole("button", { name: "Settings" }).tap(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/4-settings-${tag}.png` });
    ok(`${tag}: sheets have a close button`, await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).last().isVisible());
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await tabs.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
    await settingsHere("Stock");
    {
      // A meal thing's amount under its name, and every row one height with or without it (Nov 11: uneven heights are annoying).
      const meal = page.locator(".bg-accent\\/15").filter({ has: page.getByRole("group", { name: /^Have or need / }) });
      ok(`${tag}: a meal thing shows at most one line under its name`, (await meal.count()) === 0 || (await meal.first().locator("span.t-foot").count()) <= 1);
    }
    ok(`${tag}: every Stock row is the same height`, await page.getByRole("group", { name: /^Have or need / }).evaluateAll((gs) => new Set(gs.map((g) => Math.round(g.parentElement.getBoundingClientRect().height))).size === 1));
    // Every row has ⋯ or its space, so the switches line up (Nov 11).
    ok(`${tag}: every Stock row keeps the ⋯ column`, await page.getByRole("group", { name: /^Have or need / }).evaluateAll((gs) => gs.length > 3 && gs.every((g) => { const n = g.nextElementSibling; return Boolean(n) && Math.round(n.getBoundingClientRect().width) === 36; })));
    await page.screenshot({ path: `${dir}/5-stock-${tag}.png`, fullPage: true });
    await postList({ op: "add", text: "Extra large organic heirloom tomatoes for the big salad", by: "Sam", store: "safeway" });
    await page.reload(); await seen(page.getByRole("heading", { name: "Meals" }), 8000); // what was just loaded would otherwise be kept
    const layoutFake = await fakeSafeway();
    await tabs.getByRole("button", { name: "Shop" }).tap(); await page.waitForTimeout(1200);
    await settingsHere("Shop");
    {
      const rows = page.locator("[data-shop-row]");
      ok(`${tag}: every Shop row is one height`, (await rows.count()) > 3 && await rows.evaluateAll((rs) => new Set(rs.map((r) => Math.round(r.getBoundingClientRect().height))).size === 1));
      ok(`${tag}: no thumbnails on Shop rows`, (await page.locator("[data-shop-row] img").count()) === 0);
      // A long name is cut short, never pushing the control or ⋯ off the row.
      ok(`${tag}: long names truncate and every row's controls stay on it`, await rows.evaluateAll((rs) => rs.every((r) => { const b = r.getBoundingClientRect(); return r.scrollWidth <= r.clientWidth && [...r.children].every((c) => c.getBoundingClientRect().right <= b.right + 0.5); })));
      ok(`${tag}: a long-named Safeway row keeps its control`, await page.getByRole("button", { name: /^(Add|Find) Extra large organic/ }).isVisible());
      const top = await page.getByText(/ of \d+ got$/).first().boundingBox();
      ok(`${tag}: the got line on one line`, Boolean(top) && top.height < 44, JSON.stringify(top));
    }
    await page.screenshot({ path: `${dir}/5a-shop-${tag}.png`, fullPage: true });
    await page.evaluate(() => { const el = document.getElementById("scroller"); if (el) el.scrollTop = el.scrollHeight; }); await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/5b-shop-end-${tag}.png` });
    await page.evaluate(() => { const el = document.getElementById("scroller"); if (el) el.scrollTop = 0; });
    await layoutFake.stop();
    await tabs.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(500);
    await settingsHere("Recipes");
    await page.screenshot({ path: `${dir}/6a-recipes-${tag}.png` });
    {
      const tacos = page.getByRole("button", { name: /^Tacos/ }).first();
      for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await tacos.isVisible()) break; await all.tap(); await page.waitForTimeout(200); }
      await tacos.tap(); await page.waitForTimeout(400);
      await settingsHere("a recipe");
      await page.screenshot({ path: `${dir}/6-recipe-${tag}.png`, fullPage: true });
    }
    ok(`${tag}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);

    if (behaviour) {
      // Old addresses land on Shop too (the helper's panel opens ?open=shop).
      for (const open of ["shop", "lists"]) {
        await page.goto(`${process.env.URL || "http://localhost:3000/"}?open=${open}`);
        ok(`shop: ?open=${open} opens Shop`, await seen(page.getByRole("heading", { name: "Shop" }), 8000));
      }
      // The passcode changes while the app is open, with a sheet up: back to the passcode screen, nothing left open.
      await tabs.getByRole("button", { name: "Shop" }).tap(); await page.waitForTimeout(500);
      await page.evaluate(() => localStorage.setItem("sm.passcode", JSON.stringify("changed")));
      await page.getByLabel("Add something").fill("paper towels"); await page.keyboard.press("Enter");
      ok("passcode: a turned-down passcode asks again", await seen(page.getByLabel("Household passcode"), 8000));
      ok("passcode: and closes what was open (only the wrong-passcode alert shows)", (await page.getByRole("dialog").count()) === (await page.getByRole("dialog", { name: "That passcode didn't work" }).count()));
      await page.screenshot({ path: `${dir}/7-signed-out.png` });
      ok("no busy words or problem bars anywhere seen", !busySeen.length, busySeen.join(", "));
    }
    ok(`${tag}: no console errors`, !errors.length, errors.join(" | "));
    await ctx.close();
  }
  await b.close();
  console.log(results.join("\n"));
  console.log(`${results.length} checks, ${results.filter((r) => r.startsWith("FAIL")).length} failed`);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
})().catch((e) => { console.error(e); console.log(results.join("\n")); process.exit(1); });
