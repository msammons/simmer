/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test at iPhone size (light and dark) and iPad size: passcode, planning by number (one shop at a time: Plan replaces
// Meals (New plan in the top bar), no lunches, no Made it), the tabs, Settings on every screen, Stock (nothing comes back by itself), Lists (All, and Safeway's in-store
// checklist after a job goes unanswered), Add a meal and a recipe's Add to the plan, the Recipes tab, a recipe and back, saves that fail (the sheet keeps what was entered), and a passcode turned down mid-use. Saves screenshots to .data/shots.
// Works on any day of the week, with the sample data (no .env.local), whether or not a week is already planned. Needs Playwright (NODE_PATH if it isn't installed here). Run against a server started with
// HOUSEHOLD_PASSCODE=test123, e.g. HOUSEHOLD_PASSCODE=test123 npx next dev -p 3202, then URL=http://localhost:3202/ node scripts/smoke.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const dir = ".data/shots";
fs.mkdirSync(dir, { recursive: true });
const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + x : ""}`);
const seen = (loc, timeout = 5000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
const SIZES = [["light", 390, 844, true], ["dark", 390, 844, true], ["light", 820, 1180, false]];

(async () => {
  const b = await chromium.launch();
  for (const [scheme, width, height, phone] of SIZES) {
    const tag = `${phone ? "phone" : "ipad"}-${scheme}`;
    // A fresh context each run: a registered service worker would otherwise serve the last bundle.
    const ctx = await b.newContext({ viewport: { width, height }, hasTouch: true, isMobile: phone, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    // Busy words (Nov 11: none): watched on every screen the run passes through.
    const busySeen = [];
    const BUSY = /\b(Saving|Adding|Reading it|Reading the page|Checking|Copying|Loading|Getting|Finding)…/;
    const lookForBusy = async (where) => { const t = await page.locator("body").innerText().catch(() => ""); const m = t.match(BUSY); if (m) busySeen.push(`${m[0]} on ${where}`); };
    const settingsHere = async (where) => {
      await lookForBusy(where);
      const btn = page.getByRole("button", { name: "Settings" });
      ok(`${tag}: Settings at the top of ${where}`, (await btn.count()) === 1 && (await btn.boundingBox()).y < 80);
      ok(`${tag}: tab bar on ${where}`, await page.getByRole("navigation", { name: "Main" }).isVisible());
    };
    await page.goto(process.env.URL || "http://localhost:3000/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // a dev server's corner badge sits over the tab bar
    // The one passcode screen (Nov 11): the button waits for a passcode; a wrong one is the shared alert.
    ok(`${tag}: passcode: Get started waits for a passcode, and says it's once`, (await page.getByRole("button", { name: "Get started" }).isDisabled()) && await seen(page.getByText("You only need to do this once.")));
    await page.getByLabel("Household passcode").fill("nope"); await page.getByRole("button", { name: "Get started" }).tap();
    const wrong = page.getByRole("dialog", { name: "That passcode didn't work" });
    ok(`${tag}: wrong passcode is an alert over the page`, await seen(wrong.getByText("That passcode didn't work")) && (await page.getByText("Checking…").count()) === 0);
    await wrong.getByRole("button", { name: "OK" }).tap(); await page.waitForTimeout(300);
    await page.getByLabel("Household passcode").fill("test123"); await page.getByRole("button", { name: "Get started" }).tap();
    ok(`${tag}: opens on Meals`, await seen(page.getByRole("heading", { name: "Meals" }), 8000));
    ok(`${tag}: Meals lit`, (await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
    await page.waitForTimeout(800);
    await settingsHere("Meals");
    await page.screenshot({ path: `${dir}/1-week-${tag}.png` });

    if (tag === "phone-light") {
      ok("brand: says Alpha by the logo", await page.getByText("Alpha", { exact: true }).first().isVisible());
      // One Meals page (Nov 10): every kind the same way, each with Add one / Add another, which opens her recipes of that
      // kind to pick from. Simmer picks nothing itself: no Plan, Start over or Something else.
      const groupOf = (name) => page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });
      ok("meals: every kind shows, each with its Add row or No recipes", ((await groupOf("Dessert").getByRole("button", { name: /^Add$/ }).count()) + (await groupOf("Dessert").getByText(/^No recipes$/).count())) === 1 && (await groupOf("Quick").getByRole("button", { name: /^Add$/ }).count()) === 1);
      ok("meals: no heading; New plan sits in the top bar", (await page.getByRole("heading", { name: "The plan" }).count()) === 0 && ((await page.locator(".fixed.max-w-md").getByRole("button", { name: "New plan" }).count()) === 1 || (await page.getByRole("button", { name: /^One less |^Take / }).count()) === 0));
      ok("meals: Simmer picks nothing itself", (await page.getByRole("button", { name: /^(Plan|Start over)$|^Something else/ }).count()) === 0 && (await page.getByText("Also add").count()) === 0);
      ok("meals: no lunches, no Made it", (await page.getByText(/lunch|Made it/i).count()) === 0);
      await groupOf("Quick").getByRole("button", { name: /^Add$/ }).tap(); await page.waitForTimeout(500);
      const kindSheet = page.getByRole("dialog", { name: "Add a meal" });
      ok("meals: Add opens that kind's recipes", (await kindSheet.getByRole("heading", { name: "Add a quick dinner" }).isVisible()) && (await kindSheet.getByText("Suggested").count()) === 0);
      // A pick closes the sheet at once and shows on Meals straight away, with no "Saving…" (Nov 10). One that fails (the
      // connection drops) comes back off and says so on Meals; picking again works.
      const quickRowsNow = () => groupOf("Quick").getByRole("button", { name: /^One more / }).count();
      const before = await quickRowsNow();
      await page.route("**/api/plan", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      const firstName = (await kindSheet.locator("section button:not([disabled])").first().innerText()).trim();
      await kindSheet.locator("section button:not([disabled])").first().tap();
      ok("meals: a pick closes the sheet at once, with no Saving", (await kindSheet.count()) === 0 && (await page.getByText("Saving…").count()) === 0 && (await quickRowsNow()) === before + 1);
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
      await quickPlus.tap(); await quickPlus.tap(); await quickPlus.tap();
      ok("meals: quick taps show at once", Number(await quickCount()) === c0 + 3);
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
      ok("meals: no arrows on the dinners", (await groupOf("Quick").getByRole("button").filter({ hasText: /\S/ }).filter({ hasNotText: /^Add$/ }).first().locator("svg").count()) === 0);
      // A change's note doesn't follow you around: switching tabs clears it.
      await page.locator("nav button", { hasText: "Lists" }).tap(); await page.waitForTimeout(300);
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
        await page.getByRole("dialog", { name: /^Take .* off the plan\?$/ }).getByRole("button", { name: "Take it off" }).tap(); await page.waitForTimeout(800);
        ok("meals: Take it off takes just that dinner off, with no Undo", ((await dinners.count()) === count - 1 || (await dinners.count()) === 0) && (await page.getByText("Undo").count()) === 0);
        await page.waitForTimeout(400);
        if (await dinners.count()) { await dinners.first().tap(); await page.waitForTimeout(400); cooked = await page.getByRole("button", { name: /^Add to the list/ }).isVisible(); }
      }
      await page.waitForTimeout(400);
      if (!cooked) ok("meals: a dinner's recipe opens (skipped: no dinner with a recipe)", true);
      else {
      ok("meals: a dinner's recipe opens, and says it's on the plan", await page.getByText("On the plan.", { exact: false }).isVisible());
      await settingsHere("a recipe from Meals");
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
      // The recipe's page: not planned, so "Add to the plan" leads and "Just add to the list" is the quieter one.
      await tabs.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(600);
      await page.getByRole("button", { name: /^Turkey chili/ }).first().tap(); await page.waitForTimeout(500);
      const toWeek = page.getByRole("button", { name: "Add to the plan" });
      ok("recipe: not planned, it offers Add to the plan and Just add to the list", (await toWeek.isVisible()) && (await page.getByRole("button", { name: "Just add to the list" }).isVisible()));
      await page.screenshot({ path: `${dir}/8a-recipe-add-to-week.png` });
      await toWeek.tap();
      // At once, saved behind it (Nov 11: no "Adding…", no note bar).
      ok("recipe: Add to the plan shows it planned at once, with no Adding", (await page.getByText("On the plan.").isVisible()) && (await page.getByRole("button", { name: "Add to the list again" }).isVisible()) && (await toWeek.count()) === 0 && (await page.getByText("Adding…").count()) === 0);
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
      ok("add a meal: that kind's recipes, names only, no suggestions", (await addSheet.getByRole("heading", { name: "Add a regular dinner" }).isVisible()) && (await addSheet.getByRole("button", { name: /^Turkey chili$/ }).count()) === 1 && (await addSheet.getByText("Suggested").count()) === 0);
      await page.screenshot({ path: `${dir}/8b-add-a-meal.png` });
      await page.setViewportSize({ width: 320, height: 640 }); await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/8c-add-a-meal-320.png` });
      ok("add a meal: fits 320 wide", (await addSheet.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 0);
      await box.fill("chili"); await page.waitForTimeout(300);
      ok("add a meal: typing finds recipes, and offers no words-only meal", (await addSheet.getByRole("button", { name: /^Turkey chili/ }).count()) === 1 && (await addSheet.getByText(/^Add “/).count()) === 0);
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
      await fresh.getByRole("button", { name: "New plan" }).tap();
      await page.waitForFunction(() => !document.querySelector('button[aria-label^="Take "]'), null, { timeout: 8000 }).catch(() => {});
      ok("new plan: every dinner comes off", (await page.getByRole("button", { name: /^Take .* off the plan$/ }).count()) === 0 && (await page.getByRole("button", { name: /^One less / }).count()) === 0);
      const listAfter = await listNow();
      ok("new plan: every list is emptied, hand-added things too", listAfter.length === 0 && listBefore.length > 0, `${listBefore.length} → ${listAfter.length}`);
      ok("meals: nothing on Meals says week", !/\bweek\b/i.test(await page.locator("main").innerText()));
    }

    // A request budget (Nov 11: bursts of reloads went over Google's limits). Going round the tabs twice in a row: the
    // second round asks the server for (almost) nothing, since what was just loaded is still fresh.
    {
      let gets = 0;
      const countGets = (r) => { if (r.url().includes("/api/") && r.method() === "GET") gets++; };
      page.on("request", countGets);
      const round = async () => { for (const t of ["Meals", "Stock", "Lists", "Recipes", "Meals"]) { await page.locator("nav button", { hasText: t }).tap(); await page.waitForTimeout(250); } };
      await round(); await page.waitForTimeout(600);
      const first = gets;
      await round(); await page.waitForTimeout(600);
      page.off("request", countGets);
      ok(`${tag}: a second round of the tabs asks for almost nothing`, gets - first <= 2, `first round ${first}, second ${gets - first}`);
    }

    // Settings: the look only (adding recipes lives on the Recipes tab, Nov 9).
    await page.getByRole("button", { name: "Settings" }).tap(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/4-settings-${tag}.png` });
    ok(`${tag}: Settings offers Copy to Google Sheet`, await page.getByRole("button", { name: /^Copy to Google Sheet/ }).isVisible());
    // The release as YY.M.D, the last line of Settings (Nov 11).
    {
      const last = (await page.getByRole("dialog", { name: "Settings" }).locator("p").last().innerText()).trim();
      ok(`${tag}: Settings ends with the version`, /^\d{2}\.\d{1,2}\.\d{1,2}(\.\d+)?$/.test(last), last);
    }
    await page.getByRole("radio", { name: /^Apricot/ }).tap(); await page.waitForTimeout(200);
    ok(`${tag}: theme switches`, (await page.evaluate(() => document.documentElement.dataset.theme)) === "apricot");
    await page.getByRole("radio", { name: /^Simmer$/ }).tap();
    ok(`${tag}: no Add recipes in Settings`, (await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: /^Add recipes/ }).count()) === 0);
    ok(`${tag}: sheets have a close button`, await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).last().isVisible());
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);

    // Stock (Nov 11): every row answered with one switch, Have | Need (never both); the lit side tapped again clears it.
    // Need puts it on its store's list. A dinner's things are highlighted in their own sections and counted.
    const tabBar = page.getByRole("navigation", { name: "Main" });
    await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
    await settingsHere("Stock");
    const needOf = (n) => page.getByRole("button", { name: `Need: ${n}`, exact: true });
    const haveOf = (n) => page.getByRole("button", { name: `Have: ${n}`, exact: true });
    const answerOf = async (n) => ((await haveOf(n).getAttribute("aria-pressed")) === "true" ? "have" : (await needOf(n).getAttribute("aria-pressed")) === "true" ? "need" : "check");
    const clear = async (n) => { const a = await answerOf(n); if (a !== "check") { await (a === "have" ? haveOf(n) : needOf(n)).tap(); await page.waitForTimeout(1200); } };
    ok(`${tag}: Stock has the add field and the line about Need`, (await page.getByLabel("Add something to Stock").isVisible()) && (await page.getByText("Need puts it on the list.").isVisible()));
    ok(`${tag}: no For this plan group; everything stays in its section`, (await page.getByText("For this plan").count()) === 0);
    const meal = page.locator(".bg-accent\\/15").filter({ has: page.getByRole("group", { name: /^Have or need / }) });
    if (await meal.count()) {
      const name = (await meal.first().getByRole("group").getAttribute("aria-label")).replace(/^Have or need /, "");
      await clear(name);
      const count = async () => page.getByText(/In meals · (\d+ to check|all checked)/).innerText();
      const before = await count();
      await haveOf(name).tap(); await page.waitForTimeout(1200);
      ok(`${tag}: a meal thing: Have lights, and one fewer to check`, (await answerOf(name)) === "have" && (await count()) !== before, `${before} → ${await count()}`);
      await needOf(name).tap(); await page.waitForTimeout(1200);
      ok(`${tag}: Need switches it (never both), still highlighted`, (await answerOf(name)) === "need" && (await meal.filter({ hasText: new RegExp(name, "i") }).count()) === 1);
      await needOf(name).tap(); await page.waitForTimeout(1200);
      ok(`${tag}: tapping the lit side again makes it to check`, (await answerOf(name)) === "check" && (await count()) === before);
    } else ok(`${tag}: meal things (none need anything from the house in the sample)`, true);
    await page.screenshot({ path: `${dir}/5-stock-${tag}.png`, fullPage: true });
    // A kept thing works the same way.
    await clear("Milk");
    const milkHeight = (await page.getByRole("group", { name: "Have or need Milk" }).boundingBox())?.height;
    await needOf("Milk").tap(); await page.waitForTimeout(1500);
    ok(`${tag}: Need puts a kept thing on the list`, (await answerOf("Milk")) === "need");
    await haveOf("Milk").tap(); await page.waitForTimeout(1500);
    ok(`${tag}: Have switches it off the list, marked checked`, (await answerOf("Milk")) === "have");
    await haveOf("Milk").tap(); await page.waitForTimeout(1500);
    ok(`${tag}: and the lit side again clears it`, (await answerOf("Milk")) === "check" && Math.abs(((await page.getByRole("group", { name: "Have or need Milk" }).boundingBox())?.height ?? 0) - (milkHeight ?? 0)) < 1);
    await needOf("Milk").tap(); await page.waitForTimeout(1500);
    // Every row has ⋯ or its space, so the switches line up (Nov 11).
    ok(`${tag}: every Stock row keeps the ⋯ column`, await page.getByRole("group", { name: /^Have or need / }).evaluateAll((gs) => gs.length > 3 && gs.every((g) => { const n = g.nextElementSibling; return Boolean(n) && Math.round(n.getBoundingClientRect().width) === 36; })));
    // No Every week (Nov 10): a thing goes on a list only when answered Need here, and nothing comes back by itself after a shop.
    ok(`${tag}: no Every week anywhere on Stock`, (await page.getByText(/every week/i).count()) === 0 && (await page.getByLabel("More for Eggs").locator("option", { hasText: /week/i }).count()) === 0);
    if ((await answerOf("Eggs")) !== "need") { await needOf("Eggs").tap(); await page.waitForTimeout(1500); }
    // Remove from Stock asks first (the shared confirm); Cancel keeps it.
    await page.getByLabel("More for Eggs").selectOption("remove"); await page.waitForTimeout(300);
    const removeAsk = page.getByRole("dialog", { name: "Remove Eggs from Stock?" });
    ok(`${tag}: Remove from Stock asks first`, (await removeAsk.isVisible()) && (await removeAsk.getByRole("button", { name: "Remove from Stock" }).isVisible()));
    await removeAsk.getByRole("button", { name: "Cancel" }).tap(); await page.waitForTimeout(300);
    ok(`${tag}: Cancel keeps it in Stock`, (await removeAsk.count()) === 0 && (await needOf("Eggs").count()) === 1);
    await page.getByLabel("Add something to Stock").fill(`frozen waffles ${tag}`); await page.keyboard.press("Enter");
    ok(`${tag}: Stock add`, await seen(page.getByRole("group", { name: new RegExp(`Have or need frozen waffles ${tag}`, "i") })));

    // Lists: All, Safeway, Trader Joe's, Costco. What's out in Stock is on its store's list.
    await tabBar.getByRole("button", { name: "Lists" }).tap(); await page.waitForTimeout(800);
    await settingsHere("Lists");
    ok(`${tag}: Lists has the store switch and the add field`, (await page.getByRole("radio", { name: "All" }).isVisible()) && (await page.getByLabel("Add something").isVisible()));
    ok(`${tag}: what's out in Stock is on the list`, await seen(page.getByRole("checkbox", { name: /Milk/ })));
    const tj = (await page.getByRole("radio", { name: "Trader Joe's" }).boundingBox());
    ok(`${tag}: the store names stay on one line`, Boolean(tj) && tj.height < 44, JSON.stringify(tj));
    await page.screenshot({ path: `${dir}/5a-lists-all-${tag}.png`, fullPage: true });
    ok(`${tag}: Done shopping is always there, greyed until something's ticked`, (await page.getByRole("button", { name: "Done shopping" }).count()) >= 1 && (await page.getByRole("button", { name: "Done shopping" }).first().isDisabled()));
    await page.getByRole("checkbox", { name: /Milk/ }).first().tap(); await page.waitForTimeout(800);
    ok(`${tag}: no Clear on Lists`, (await page.getByRole("button", { name: "Clear", exact: true }).count()) === 0);
    ok(`${tag}: ticking turns Done shopping on`, await page.getByRole("button", { name: "Done shopping" }).first().isEnabled());
    await page.getByRole("radio", { name: "Safeway" }).tap(); await page.waitForTimeout(800);
    // No "connected" status (Nov 11: no timer keeps one fresh): Safeway shows its cart until a job goes unanswered.
    ok(`${tag}: Safeway doesn't guess whether the helper's there`, (await page.getByText(/Can't reach Safeway right now|isn't connected/).count()) === 0);
    ok(`${tag}: Safeway shows the top line`, await seen(page.getByText(/in the cart| got$/)));
    await page.screenshot({ path: `${dir}/5b-lists-safeway-${tag}.png` });
    // In the store, on All: Done shopping asks first; Cancel leaves it; Eggs stays off.
    await page.getByRole("radio", { name: "All" }).tap(); await page.waitForTimeout(600);
    await page.getByRole("checkbox", { name: /Milk/ }).first().tap(); await page.waitForTimeout(600); // Milk was ticked: untick, so only Eggs is done
    await page.getByRole("checkbox", { name: /Eggs/ }).first().tap(); await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Done shopping" }).first().tap(); await page.waitForTimeout(400);
    ok(`${tag}: Done shopping asks first`, await seen(page.getByRole("dialog", { name: "Done shopping?" })));
    await page.getByRole("button", { name: "Cancel" }).tap(); await page.waitForTimeout(400);
    ok(`${tag}: Cancel leaves the ticks`, (await page.getByRole("checkbox", { name: /Eggs/ }).first().getAttribute("aria-checked")) === "true");
    await page.getByRole("button", { name: "Done shopping" }).first().tap(); await page.waitForTimeout(300);
    await page.getByRole("dialog", { name: "Done shopping?" }).getByRole("button", { name: "Done shopping" }).tap(); await page.waitForTimeout(1500);
    ok(`${tag}: bought things don't come back on the list by themselves`, (await page.getByRole("checkbox", { name: /Eggs/ }).count()) === 0);
    await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
    await needOf("Milk").tap(); await page.waitForTimeout(1500);
    ok(`${tag}: tapping Need again in Stock takes it back off`, (await answerOf("Milk")) === "check");
    ok(`${tag}: after the shop, Eggs isn't on the list any more`, (await answerOf("Eggs")) === "check");

    // The Recipes tab, a recipe, and back.
    const nav = page.getByRole("navigation", { name: "Main" });
    ok(`${tag}: four tabs (Recipes, Meals, Stock, Lists), no search`, (await nav.getByRole("button").allInnerTexts()).join() === "Recipes,Meals,Stock,Lists" && (await page.getByRole("search").count()) === 0);
    await nav.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(500);
    await settingsHere("Recipes");
    ok(`${tag}: Recipes lit`, (await nav.getByRole("button", { name: "Recipes" }).getAttribute("aria-current")) === "page");
    ok(`${tag}: no plus button at the top of Recipes`, (await page.locator("header, .fixed.max-w-md").getByRole("button", { name: "Add recipes" }).count()) === 0);
    // Rows only open the recipe (no button of their own, Nov 9); Add to the list is on the recipe: the sheet lists the
    // things to buy, and the pantry is only highlighted in Stock.
    ok(`${tag}: recipe rows have no add-to-list button of their own`, (await page.getByRole("button", { name: /^Add .+ to the list$/ }).count()) === 0);
    const chiliRow = page.getByRole("button", { name: /^Turkey chili/ }).first();
    for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await chiliRow.isVisible()) break; await all.tap(); await page.waitForTimeout(200); }
    if (tag.startsWith("phone")) await page.screenshot({ path: `${dir}/6a-recipes-overview-${tag}.png` });
    await chiliRow.tap(); await page.waitForTimeout(400);
    await page.getByRole("button", { name: /add to the list/i }).first().tap(); await page.waitForTimeout(400);
    const chiliSheet = page.getByRole("dialog", { name: "Add to the list" });
    ok(`${tag}: it opens the add-to-list sheet for that recipe`, (await chiliSheet.isVisible()) && (await chiliSheet.getByRole("heading", { name: "Turkey chili" }).isVisible()));
    const turkey = chiliSheet.getByRole("checkbox", { name: "1 lb ground turkey" });
    ok(`${tag}: the things to buy start ticked`, (await turkey.getAttribute("aria-checked")) === "true" && await chiliSheet.getByText("To buy", { exact: true }).isVisible());
    ok(`${tag}: spices and the pantry are only highlighted in Stock, not offered`, (await chiliSheet.getByText(/cumin|chili powder/i).count()) === 0);
    if (tag.startsWith("phone")) await page.screenshot({ path: `${dir}/6c-add-to-list-${tag}.png` });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap(); await page.waitForTimeout(400);
    const tacos = page.getByRole("button", { name: /^Tacos/ }).first();
    for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await tacos.isVisible()) break; await all.tap(); await page.waitForTimeout(200); }
    await tacos.tap(); await page.waitForTimeout(300);
    ok(`${tag}: recipe screen, with Quick/Regular only in Edit`, (await page.getByRole("heading", { name: "Tacos" }).isVisible()) && (await page.getByRole("radio", { name: "Quick" }).count()) === 0);
    const addBtn = await page.getByRole("button", { name: "Add to the list" }).boundingBox();
    ok(`${tag}: Add to the list at the top of the recipe, without scrolling`, Boolean(addBtn) && addBtn.y + addBtn.height < height - 100);
    await settingsHere("a recipe");
    await page.screenshot({ path: `${dir}/6-recipe-${tag}.png`, fullPage: true });
    if (tag === "phone-light") {
      // Editing a recipe, and adding it to the list, when the save fails: the sheet stays with what was typed or ticked.
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
      await edit.getByRole("button", { name: "Close" }).last().tap(); await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Add to the list" }).tap(); await page.waitForTimeout(400);
      const toList = page.getByRole("dialog", { name: "Add to the list" });
      await toList.getByRole("checkbox").first().tap(); // one unticked, so the ticks that come back are hers, not the defaults
      const ticked = await toList.getByRole("checkbox", { checked: true }).count();
      await page.route("**/api/list", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      await toList.getByRole("button", { name: /^Add \d+ to the list/ }).tap();
      ok("add to list: closes at once, with no Adding", (await page.getByText("Adding…").count()) === 0);
      const listAlert = page.getByRole("dialog", { name: "That didn't go through" });
      ok("add to list: a failed add says why, over the page", await seen(listAlert.getByText("No connection"), 8000));
      ok("add to list: and opens again with the same ticks", (await toList.isVisible()) && (await toList.getByRole("checkbox", { checked: true }).count()) === ticked);
      await listAlert.getByRole("button", { name: "OK" }).tap(); await page.waitForTimeout(300);
      await page.unroute("**/api/list");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: "Add to the list" }).tap(); await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^Add \d+ to the list/ }).tap(); await page.waitForTimeout(800);
    ok(`${tag}: Add to the list closes at once`, (await page.getByRole("dialog", { name: "Add to the list" }).count()) === 0);
    await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap(); await page.waitForTimeout(300);
    ok(`${tag}: back to Recipes`, await page.getByRole("heading", { name: "Recipes" }).isVisible());
    await page.screenshot({ path: `${dir}/6b-recipes-${tag}.png` });
    await nav.getByRole("button", { name: "Lists" }).tap(); await page.waitForTimeout(500);
    ok(`${tag}: the recipe's ingredients are on the list`, await seen(page.getByText(/ground beef/i)));

    // The passcode changes while the app is open, with a sheet up: back to the passcode screen, nothing left open.
    await page.evaluate(() => localStorage.setItem("sm.passcode", JSON.stringify("changed")));
    await page.getByRole("radio", { name: "Costco" }).tap(); await page.waitForTimeout(300);
    await page.getByLabel("Add something").fill("paper towels"); await page.keyboard.press("Enter");
    ok(`${tag}: a turned-down passcode asks again`, await seen(page.getByLabel("Household passcode"), 8000));
    ok(`${tag}: and closes what was open (only the wrong-passcode alert shows)`, (await page.getByRole("dialog").count()) === (await page.getByRole("dialog", { name: "That passcode didn't work" }).count()));
    await page.screenshot({ path: `${dir}/7-signed-out-${tag}.png` });

    ok(`${tag}: no busy words or problem bars anywhere seen`, !busySeen.length, busySeen.join(", "));
    ok(`${tag}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    ok(`${tag}: no console errors`, !errors.length, errors.join(" | "));
    await ctx.close();
  }
  await b.close();
  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
})().catch((e) => { console.error(e); console.log(results.join("\n")); process.exit(1); });
