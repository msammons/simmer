/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test: passcode, planning by number (one shop at a time: New plan in the top bar keeps old meals dimmed,
// switching one back on, no lunches, no Made it),
// the tabs, Settings on every screen, Stock (nothing comes back by itself), Shop (one page by store), Add a meal and a
// recipe's Add to the plan, the Recipes tab, a recipe and back, adding recipes, saves that fail (the sheet keeps what was
// entered), every tap answering at once (within ~150 ms, with the server slowed to prove it), and a passcode turned down
// mid-use, and Feedback (a long press on Settings, on a tab and over a sheet). Saves screenshots to .data/shots.
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
//
// Quick (Nov 23, Sam: "be efficient with tests. And intelligent."): no fixed pauses. Every step waits for what it stands
// for (a sheet open or closed, a list's count, the server's answers in, `idle()`), with a limit. The only timed waits left
// measure something on purpose, each marked: the 150 ms answer budget, the server slowed by 0.6 s, and "nothing shows".
// With one address per setup (URL=a,b,c, one server each, as in CI) the three setups run side by side; each server keeps
// its own data in memory, so they can't get in each other's way. With one address they run one after another.
// SMOKE_LOG=1 prints each check as it happens, with the time since the start.
const { chromium } = require("playwright");
const fs = require("fs");
const dir = ".data/shots";
fs.mkdirSync(dir, { recursive: true });
const seen = (loc, timeout = 5000) => loc.first().waitFor({ timeout }).then(() => true, () => false);
// [tag, colour scheme, width, height, phone, behaviour]
const SETUPS = [["phone-light", "light", 390, 844, true, true], ["phone-dark", "dark", 390, 844, true, false], ["wide", "light", 1000, 800, false, false]];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** True once `fn` is, looked at every 25 ms up to `ms`: how every step waits for its result. */
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; for (;;) { if (await fn().catch(() => false)) return true; if (Date.now() > end) return false; await wait(25); } };
/** True once `fn` is, checked over and over for 150 ms from now (a tap's result must show that fast, Nov 11). */
const within150 = async (fn) => { const end = Date.now() + 150; do { if (await fn().catch(() => false)) return true; } while (Date.now() < end); return false; };

const URLS = (process.env.URL || "http://localhost:3000/").split(",").map((u) => u.trim()).filter(Boolean);
const PARALLEL = URLS.length >= SETUPS.length;
const began = Date.now();

(async () => {
  const b = await chromium.launch();
  const outputs = SETUPS.map(() => []);
  const runSetup = async ([tag, scheme, width, height, phone, behaviour], at) => {
    const url = PARALLEL ? URLS[at] : URLS[0];
    const results = outputs[at];
    const ok = (n, c, x = "") => { results.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + String(x).replace(/\s+/g, " ") : ""}`); if (process.env.SMOKE_LOG) console.error(`${((Date.now() - began) / 1000).toFixed(1)}s ${results.at(-1)}`); };
    // A fresh context each run: a registered service worker would otherwise serve the last bundle.
    const ctx = await b.newContext({ viewport: { width, height }, hasTouch: true, isMobile: phone, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    // The app's requests still out, for idle(): a save done, a tab's data in.
    // A job's long wait for the helper (?wait=1, answered when the helper reports or after ~20 s) isn't counted.
    const out = new Set();
    const isApi = (r) => r.url().includes("/api/") && !/[?&]wait=1/.test(r.url());
    page.on("request", (r) => { if (isApi(r)) out.add(r); });
    for (const done of ["requestfinished", "requestfailed"]) page.on(done, (r) => out.delete(r));
    /** Two frames drawn: what a tap changed on the page is on screen. */
    const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
    /**
     * Nothing asked of the server for 100 ms (a save that follows a tap starts within that), then two frames, so what came
     * back is on the page. Stands in for "the save went through" and "the tab's data is in".
     */
    const idle = async (ms = 10000) => {
      const done = await until(async () => { if (out.size) return false; await wait(100); return out.size === 0; }, ms);
      if (!done) ok(`${tag}: the app's requests all came back within ${ms / 1000} s`, false, [...out].map((r) => `${r.method()} ${r.url()}`).join(", "));
      await frames();
    };
    /** A sheet or dialog open and done moving, so a screenshot or a position is of where it rests. */
    const resting = async (loc) => { await loc.waitFor(); let last = ""; await until(async () => { const box = JSON.stringify(await loc.boundingBox()); await frames(); const same = box === last; last = box; return same; }, 3000); };
    const gone = (loc) => loc.first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    // Busy words (Nov 11: none): watched on every screen the run passes through.
    const busySeen = [];
    const BUSY = /\b(Saving|Adding|Reading it|Reading the page|Checking|Copying|Loading|Getting|Finding)…/;
    const lookForBusy = async (where) => { const t = await page.locator("body").innerText().catch(() => ""); const m = t.match(BUSY); if (m) busySeen.push(`${m[0]} on ${where}`); };
    // On purpose: the server slowed by 0.6 s (four times the budget) for changes (POSTs) to a path, so a result that shows
    // within 150 ms didn't wait for it.
    const slow = (pattern) => page.route(pattern, async (r) => { if (r.request().method() === "POST") await wait(600); await r.fallback().catch(() => {}); });
    const postList = (body) => page.evaluate((b) => fetch("/api/list", { method: "POST", headers: { "content-type": "application/json", "x-passcode": JSON.parse(localStorage.getItem("sm.passcode") ?? "\"\"") }, body: JSON.stringify(b) }).then((r) => r.text()).then(() => {}), body); // read to the end, so idle() sees it done
    /**
     * Safeway stood in for (no helper runs here): its cart (one thing added on Safeway's own site), the usual products
     * for Milk, Eggs and a long-named thing, and the helper doing each cart change (0.6 s later with `helperSlow`, on purpose).
     * `away`: a job went unanswered, so Shop is a plain checklist.
     */
    const fakeSafeway = async ({ helperSlow = false, away = false, signedOut: startOut = false } = {}) => {
      let signedOut = startOut;
      const cart = [{ cart: "safeway", productId: "p-loose", name: "Safeway Kitchens Sparkling Water Lime Flavored Zero Calorie Variety Value 12 Pack 12 Fl Oz Cans", price: "$5.99", image: "", qty: 1, itemId: "", item: "", updated: "" }];
      const picks = [
        { item: "Milk", id: "p-milk", name: "Lucerne 2% Reduced Fat Milk - 1 Gallon" },
        { item: "Eggs", id: "p-eggs", name: "Lucerne Large Eggs - 12 Count" },
        { item: "Extra large organic heirloom tomatoes for the big salad", id: "p-tom", name: "O Organics Heirloom Tomatoes Extra Large Family Size Value Pack - 2 Lb" },
      ];
      const onCart = (r) => r.fulfill({ json: { cart, picks, answering: !away, away, outdated: false, signedOut } });
      const onJobs = async (r) => {
        const req = r.request();
        // A search (Find) answers with a dozen products, enough to scroll Find's sheet; anything else answers done.
        if (req.method() !== "POST") return r.fulfill({ json: req.url().includes("id=fake-search")
          ? { job: { id: "fake-search", kind: "search", status: "done", result: { signedIn: true, products: Array.from({ length: 12 }, (_, i) => ({ id: `p-found-${i}`, name: `Safeway Found Thing ${i + 1} - 16 Oz`, price: "$3.49", image: "" })) } }, answering: true }
          : { job: { id: "fake", kind: "setQty", status: "done", result: {} }, answering: true } });
        const b = req.postDataJSON() ?? {};
        if (b.op !== "queue") return r.fulfill({ json: { ok: true } });
        if (helperSlow) await wait(600);
        if (b.kind === "setQty") {
          const at = cart.findIndex((l) => l.productId === b.productId);
          if (!b.qty) { if (at >= 0) cart.splice(at, 1); }
          else if (at >= 0) cart[at].qty = b.qty;
          else cart.push({ cart: "safeway", productId: b.productId, name: b.name, price: "$4.29", image: "", qty: b.qty, itemId: b.itemId ?? "", item: b.item ?? "", updated: "" });
        }
        return r.fulfill({ json: { job: { id: b.kind === "search" ? "fake-search" : "fake", kind: b.kind, status: "waiting", result: null }, answering: true } }).catch(() => {});
      };
      await page.route("**/api/safeway/cart", onCart);
      await page.route("**/api/safeway/jobs**", onJobs);
      return { cart, signIn: () => { signedOut = false; }, back: () => { away = false; }, stop: async () => { await page.unroute("**/api/safeway/cart", onCart); await page.unroute("**/api/safeway/jobs**", onJobs); } };
    };
    const settingsHere = async (where) => {
      await lookForBusy(where);
      const btn = page.getByRole("button", { name: "Settings" });
      ok(`${tag}: Settings at the top of ${where}`, (await btn.count()) === 1 && (await btn.boundingBox()).y < 80);
      ok(`${tag}: tab bar on ${where}`, await page.getByRole("navigation", { name: "Main" }).isVisible());
    };
    /**
     * A finger held on Settings (the long press that opens Feedback, Nov 24), as real touches, wherever the button is,
     * whatever lies over it: held until Feedback shows (it must, before the finger lifts), then lifted. True when it
     * showed while still held. `quick`: a tap, lifted after 80 ms (on purpose a timed wait: a short press).
     */
    const holdSettings = async (quick = false) => {
      const bx = await page.locator("[data-settings]").first().boundingBox();
      const at = { x: bx.x + bx.width / 2, y: bx.y + bx.height / 2 };
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
      const shown = quick ? (await wait(80), false) : await until(() => page.getByRole("dialog", { name: "Feedback" }).isVisible(), 3000);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
      return shown;
    };
    // The behaviour run has Safeway stood in for from the start (Shop puts in its own below), so no cart read is left
    // waiting on this server, where no helper answers, to grey Check out or say Not connected partway through.
    const earlyFake = behaviour ? await fakeSafeway() : null;
    await page.goto(url);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // a dev server's corner badge sits over the tab bar
    // The one passcode screen (Nov 11): the button waits for a passcode; a wrong one is the shared alert.
    if (behaviour) {
    ok(`${tag}: passcode: Get started waits for a passcode, and says it's once`, (await page.getByRole("button", { name: "Get started" }).isDisabled()) && await seen(page.getByText("You only need to do this once.")));
    await page.getByLabel("Household passcode").fill("nope"); await page.getByRole("button", { name: "Get started" }).tap();
    const wrong = page.getByRole("dialog", { name: "That passcode didn't work" });
    ok(`${tag}: wrong passcode is an alert over the page`, await seen(wrong.getByText("That passcode didn't work")) && (await page.getByText("Checking…").count()) === 0);
    await wrong.getByRole("button", { name: "OK" }).tap(); await gone(wrong);
    }
    await page.getByLabel("Household passcode").fill("test123"); await page.getByRole("button", { name: "Get started" }).tap();
    ok(`${tag}: opens on Meals`, await seen(page.getByRole("heading", { name: "Meals" }), 8000));
    if (behaviour) ok(`${tag}: Meals lit`, (await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
    await idle();
    await settingsHere("Meals");
    await page.screenshot({ path: `${dir}/1-week-${tag}.png` });

    // ======== Behaviour: once, at phone size in light mode ========
    if (behaviour) {
      ok("brand: says Alpha by the logo", await page.getByText("Alpha", { exact: true }).first().isVisible());
      // Meals by day (Nov 16, from Robin's run): days from today, 7 with Show more for 14; each day's adds (in its first row's ⋯)
      // open her recipes of that kind for that day. Simmer picks nothing itself.
      const dayGroup = (name) => page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });
      // Days by their dates (Nov 16): "Mon, Nov 16", as the app writes them in the household's time.
      const dayOf = (n) => { const d = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); };
      const TODAY = dayOf(0), TOMORROW = dayOf(1);
      const todayGroup = dayGroup(TODAY);
      ok("meals: no day is called Today or Tomorrow", (await page.getByRole("heading", { name: /^(Today|Tomorrow)$/ }).count()) === 0);
      // A day's adds (Nov 17, calmer): its first row's ⋯, or one quiet Add on a day with nothing yet; two taps to the sheet.
      const days7 = page.locator("section").filter({ has: page.getByRole("heading", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), / }) });
      // One Add (Nov 18): a button on an empty day, or "Add meal to …" in the first dinner's ⋯; the sheet filters by kind.
      const addOn = async (name) => { await dayGroup(name).getByRole("button", { name: `Add meal to ${name}` }).tap(); };
      ok("meals: days by date from today, no Quick, Regular or Other buttons, no ⋯ by the date", (await days7.count()) === 7
        && (await page.getByRole("button", { name: /^(Quick|Regular) for / }).count()) === 0 && (await page.getByLabel(/^Other for /).count()) === 0
        && (await page.locator("section > div.px-4 label").count()) === 0);
      {
        ok("meals: a day with nothing has one Add, with no kinds to pick first", (await page.getByRole("button", { name: /^Add meal to / }).count()) > 0 && (await page.getByLabel(/^Add to /).count()) === 0);
      }
      await page.getByRole("button", { name: "Show more days" }).tap();
      const showedMore = await until(async () => (await days7.count()) === 14);
      await page.getByRole("button", { name: "Show fewer days" }).tap();
      ok("meals: Show more shows 14 days, and Show fewer goes back", showedMore && await until(async () => (await days7.count()) === 7));
      ok("meals: New plan sits in the top bar", (await page.locator(".fixed.max-w-md").getByRole("button", { name: "New plan" }).count()) === 1 || (await page.getByRole("button", { name: /^Take / }).count()) === 0);
      {
        const old = [];
        if (await page.getByRole("button", { name: /^(Plan|Start over)$|^Something else/ }).count()) old.push("Simmer's own picks");
        if (await page.getByText("Made it").count()) old.push("Made it");
        if (await page.getByRole("button", { name: /^One more |^One less / }).count()) old.push("counts");
        if (/\bweek\b/i.test(await page.locator("main").innerText())) old.push("week");
        ok("meals: none of the old things are back", !old.length, old.join(", "));
      }
      const kindSheet = page.getByRole("dialog", { name: "Add a meal" });
      await addOn(TODAY); await kindSheet.waitFor();
      const pills = kindSheet.getByRole("radiogroup", { name: "Kind" }).getByRole("radio");
      ok("meals: Add opens her recipes for that day, with every kind as a pill, All first and picked", await kindSheet.getByRole("heading", { name: TODAY }).isVisible()
        && (await pills.allInnerTexts()).join() === "All,Quick,Regular,Kids' dinners,Breakfast,Lunch,Desserts,Sides" && (await pills.first().getAttribute("aria-checked")) === "true");
      await pills.filter({ hasText: /^Quick$/ }).tap();
      ok("meals: a pill shows one kind, without headings", await until(async () => (await pills.filter({ hasText: /^Quick$/ }).getAttribute("aria-checked")) === "true" && (await kindSheet.getByRole("heading", { name: "Regular" }).count()) === 0));
      await pills.first().tap(); await until(async () => (await pills.first().getAttribute("aria-checked")) === "true");
      const mealMenus = (where) => where.getByLabel(/^More for /);
      const todayMeals = () => mealMenus(todayGroup).count();
      const before = await todayMeals();
      // The save fails after a moment, as a dropped connection does (an instant failure takes it back off before a look).
      await page.route("**/api/plan", async (r) => { if (r.request().method() === "POST") { await wait(600); await r.abort().catch(() => {}); } else await r.fallback(); });
      const firstName = (await kindSheet.locator("section button:not([disabled])").first().innerText()).trim();
      await kindSheet.locator("section button:not([disabled])").first().tap();
      ok("meals: a pick closes the sheet and shows on its day within 150 ms, with no Saving", await within150(async () => (await kindSheet.count()) === 0 && (await todayMeals()) === before + 1) && (await page.getByText("Saving…").count()) === 0);
      const didnt = page.getByRole("dialog", { name: "That didn't go through" });
      ok("meals: a failed save takes it back off and says why, over the page", await seen(didnt.getByText("No connection. Check your signal and try again."), 8000) && (await todayMeals()) === before);
      await didnt.getByRole("button", { name: "OK" }).tap(); await gone(didnt);
      ok("meals: after the alert, the page scrolls again", await until(async () => (await page.evaluate(() => document.getElementById("scroller").style.overflow)) === "", 2000));
      await page.unroute("**/api/plan");
      await addOn(TODAY);
      await kindSheet.getByRole("button", { name: firstName, exact: true }).tap();
      await page.waitForResponse((r) => r.url().includes("/api/plan") && r.request().method() === "POST", { timeout: 8000 }).catch(() => null);
      await idle();
      ok("meals: picking one puts it on that day", (await todayMeals()) === before + 1);
      // A day with a dinner (Nov 18): its Add row comes after its dinners, and no dinner's ⋯ adds.
      const addRow = todayGroup.getByRole("button", { name: `Add meal to ${TODAY}` });
      ok("meals: a day with a dinner ends with its Add row, and no ⋯ adds", (await addRow.count()) === 1
        && (await todayGroup.evaluate((g, name) => { const bs = [...g.querySelectorAll("button")]; return bs[bs.length - 1]?.getAttribute("aria-label") === name; }, `Add meal to ${TODAY}`))
        && (await todayGroup.locator('option[value="add"]').count()) === 0);
      await addRow.tap(); await kindSheet.waitFor();
      ok("meals: one already on that day shows Planned", await until(() => kindSheet.getByRole("button", { name: new RegExp(`^${firstName}.*Planned`) }).isDisabled(), 2000));
      await kindSheet.getByRole("button", { name: "Close" }).last().tap(); await gone(kindSheet);
      // A meal: tap for its recipe; its ⋯ (Nov 17) takes it off after asking, or moves it to another day.
      const offs = mealMenus(page);
      ok("meals: each dinner has a ⋯ with Move to another day and Take off the plan", (await offs.count()) === 0 || (await offs.first().locator("option").allInnerTexts()).slice(1, 3).join() === "Move to another day,Take off the plan");
      let cooked = false;
      if (await offs.count()) {
        const count = await offs.count();
        await offs.first().selectOption("take");
        const confirm = page.getByRole("dialog", { name: /^Take .* off the plan\?$/ });
        ok("meals: taking one off asks first", await seen(confirm, 2000));
        await confirm.getByRole("button", { name: "Cancel" }).tap(); await gone(confirm);
        ok("meals: Cancel keeps it", (await offs.count()) === count);
        const meal = todayGroup.getByRole("button", { name: firstName, exact: true });
        if (await meal.count()) { await meal.first().tap(); cooked = await seen(page.getByText("On the plan.", { exact: false }), 3000); }
      }
      if (!cooked) ok("meals: a meal's recipe opens (skipped: no meal with a recipe)", true);
      else {
        ok("meals: a meal's recipe opens, and says it's on the plan", await page.getByText("On the plan.", { exact: false }).isVisible());
        const nav = page.getByRole("navigation", { name: "Main" });
        ok("meals: Meals stays lit under the recipe", (await nav.getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
        await page.locator("header").getByRole("button", { name: "Back to Meals" }).tap();
        ok("meals: back goes to Meals", await seen(page.getByRole("heading", { name: "Meals" }), 3000));
      }
      const tabs = page.getByRole("navigation", { name: "Main" });
      // Move to another day: the day picker, and the dinner shows on that day.
      if (await offs.count()) {
        const moving = await offs.first().getAttribute("aria-label");
        await offs.first().selectOption("move");
        await page.getByRole("dialog", { name: "Which day" }).getByRole("button", { name: dayOf(5), exact: true }).tap(); await idle();
        ok("meals: Move to another day puts the dinner on the day picked", (await dayGroup(dayOf(5)).getByLabel(moving).count()) === 1);
      }
      await offs.first().selectOption("take");
      await slow("**/api/plan");
      const countBefore = await offs.count();
      await page.getByRole("dialog", { name: /^Take .* off the plan\?$/ }).getByRole("button", { name: "Take it off" }).tap();
      ok("meals: Take it off takes it off within 150 ms, with no Undo", await within150(async () => (await offs.count()) === countBefore - 1) && (await page.getByText("Undo").count()) === 0);
      await idle(); await page.unroute("**/api/plan");
      // A recipe's own Add to the plan asks which day (Nov 16).
      await tabs.getByRole("button", { name: "Recipes" }).tap();
      await page.getByRole("button", { name: /^Turkey chili/ }).first().tap();
      const toWeek = page.getByRole("button", { name: "Add to the plan" });
      await toWeek.waitFor(); await idle();
      {
        const more = page.getByLabel(/^More for /).first();
        ok("recipe: each ingredient has a ⋯ to move it to Fresh, Freezer or Pantry, as on List", (await more.count()) === 1
          && (await more.locator("option", { hasText: "Move to Fresh" }).count()) === 1 && (await more.locator("option", { hasText: "Move to Freezer" }).count()) === 1 && (await more.locator("option", { hasText: "Move to Pantry" }).count()) === 1);
      }
      ok("recipe: not planned, it offers Add to the plan only", (await toWeek.isVisible()) && (await page.getByRole("button", { name: /add to the list/i }).count()) === 0);
      await toWeek.tap();
      const which = page.getByRole("dialog", { name: "Which day" });
      ok("recipe: Add to the plan asks which day", await seen(which, 2000) && (await which.getByRole("button").filter({ hasText: new RegExp(`^(${TODAY}|${TOMORROW})$`) }).count()) === 2);
      await slow("**/api/plan");
      await which.getByRole("button", { name: TOMORROW, exact: true }).tap();
      ok("recipe: picking a day shows it planned within 150 ms, with no Adding", await within150(() => page.getByText("On the plan.").isVisible()) && (await page.getByText("Adding…").count()) === 0);
      await idle(); await page.unroute("**/api/plan");
      await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap();
      await tabs.getByRole("button", { name: "Meals" }).tap(); await idle();
      ok("recipe: it's on Meals, on tomorrow's date", await until(async () => (await dayGroup(TOMORROW).getByRole("button", { name: /^Turkey chili/ }).count()) === 1));
      // A search with no match.
      const addSheet = page.getByRole("dialog", { name: "Add a meal" });
      await addOn(TODAY); await resting(addSheet);
      const box = addSheet.getByLabel("Find a recipe");
      ok("add a meal: one sheet with a search box, not focused", (await addSheet.isVisible()) && (await box.isVisible()) && !(await box.evaluate((el) => el === document.activeElement)));
      await page.setViewportSize({ width: 320, height: 640 }); await frames();
      ok("add a meal: fits 320 wide", (await addSheet.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 0);
      await box.fill("Dinner at Grandma's");
      ok("add a meal: no match says so, and nothing to tap", await seen(addSheet.getByText("No recipe called “Dinner at Grandma's”"), 2000) && (await addSheet.getByRole("button", { name: /New recipe|Add a recipe/ }).count()) === 0);
      await page.setViewportSize({ width, height }); await frames();
      await addSheet.getByRole("button", { name: "Close" }).last().tap(); await gone(addSheet);
      await page.screenshot({ path: `${dir}/2-week-planned.png`, fullPage: true });
      await page.screenshot({ path: `${dir}/8e-meals-after-add.png`, fullPage: true });
      // New plan (Nov 24: old meal plans are kept): asks first, naming what wasn't bought, Keep them first or Clear them;
      // every dinner stays on Meals, dimmed; Keep leaves the unbought things on the list, and a dinner's waiting things go.
      const listNow = () => page.evaluate(() => fetch("/api/list", { headers: { "x-passcode": JSON.parse(localStorage.getItem("sm.passcode") ?? "\"\"") } }).then((r) => r.ok ? r.json() : null).then((l) => (l?.items ?? []).filter((x) => !x.checked).map((x) => ({ item: x.item, for: x.for, check: x.check }))).catch(() => []));
      await page.evaluate(() => fetch("/api/list", { method: "POST", headers: { "content-type": "application/json", "x-passcode": JSON.parse(localStorage.getItem("sm.passcode") ?? "\"\"") }, body: JSON.stringify({ op: "add", text: "new-plan hand-added bread", by: "Sam" }) }).then((r) => r.text()));
      const dimmed = () => page.locator('[data-old="yes"]');
      const onMeals = async () => (await mealMenus(page).count()) - (await dimmed().count());
      const mealsBefore = await onMeals();
      await page.getByRole("button", { name: "New plan", exact: true }).tap();
      const fresh = page.getByRole("dialog", { name: "Start a new plan?" });
      // The bread was added behind the phone's back: New plan reads the list again as it asks.
      await seen(fresh.getByText(/new-plan hand-added bread/), 5000);
      ok("new plan: asks first: the dinners stay, dimmed; the cart stays; what wasn't bought is named, Keep them first", (await seen(fresh, 2000)) && mealsBefore > 0
        && (await fresh.getByText(/stays? on Meals, dimmed/).isVisible()) && (await fresh.getByText(/Safeway cart stays/).isVisible()) && (await fresh.getByText(/new-plan hand-added bread/).isVisible())
        && (await fresh.getByRole("button").allInnerTexts()).join() === "Keep them,Clear them,Cancel", `${mealsBefore} on`);
      await page.screenshot({ path: `${dir}/8f-new-plan-ask.png` });
      await slow("**/api/plan");
      await fresh.getByRole("button", { name: "Keep them" }).tap();
      ok("new plan: the meals dim within 150 ms, and none come off", await within150(async () => (await onMeals()) === 0 && (await dimmed().count()) === mealsBefore));
      await idle(); await page.unroute("**/api/plan");
      ok("new plan: every dinner stays on Meals, dimmed", mealsBefore > 0 && (await onMeals()) === 0 && (await dimmed().count()) === mealsBefore);
      const kept = await listNow();
      ok("new plan: Keep leaves what wasn't bought on the list; a dinner's things waiting on Stock go", kept.some((x) => x.item === "new-plan hand-added bread") && kept.every((x) => !x.check), kept.map((x) => x.item).join(", "));
      ok("old meal: its ⋯ switches it back on, and nothing else", (await dimmed().first().getByLabel(/^More for /).locator("option").allInnerTexts()).slice(1).join() === "Switch back on");
      await page.screenshot({ path: `${dir}/8g-meals-dimmed.png`, fullPage: true });
      // Switching one back on (Nov 24): it shows on at once, and its things go on the list again.
      const switched = ((await dimmed().first().getByLabel(/^More for /).getAttribute("aria-label")) ?? "").replace(/^More for /, "");
      await slow("**/api/plan");
      await dimmed().first().getByLabel(/^More for /).selectOption("on");
      ok("old meal: switched back on shows on within 150 ms", await within150(async () => (await dimmed().count()) === mealsBefore - 1 && (await onMeals()) === 1));
      await idle(); await page.unroute("**/api/plan");
      const again = await listNow();
      ok("old meal: switched back on puts its things on the list again", again.some((x) => x.for.toLowerCase().split(",").map((f) => f.trim()).includes(switched.toLowerCase())), switched);
      // New plan again, Clear them: what wasn't bought comes off too; the meals stay, dimmed.
      await page.getByRole("button", { name: "New plan", exact: true }).tap();
      await seen(fresh, 2000);
      await fresh.getByRole("button", { name: "Clear them" }).tap(); await gone(fresh);
      await idle();
      const listAfter = await listNow();
      ok("new plan: Clear empties every list, hand-added things too; the meals stay, dimmed", listAfter.length === 0 && (await dimmed().count()) === mealsBefore && (await onMeals()) === 0, `${listAfter.length} left`);

      // A request budget (Nov 11: bursts of reloads went over Google's limits). Going round the tabs twice in a row: the
      // second round asks the server for (almost) nothing, since what was just loaded is still fresh.
      {
        let gets = 0;
        const countGets = (r) => { if (r.url().includes("/api/") && r.method() === "GET") gets++; };
        page.on("request", countGets);
        const round = async () => { for (const t of ["Meals", "List", "Shop", "Recipes", "Meals"]) { await page.locator("nav button", { hasText: t }).tap(); await idle(); } };
        await round();
        const first = gets;
        await round();
        page.off("request", countGets);
        ok("tabs: a second round of the tabs asks for almost nothing", gets - first <= 2, `first round ${first}, second ${gets - first}`);
      }

      {
        // Feedback (Sam, Nov 24): a long press on Settings opens it, on a tab and with a sheet open; what was showing goes
        // with the text; closing it leaves everything as it was; a short tap is still Settings.
        const fb = page.getByRole("dialog", { name: "Feedback" });
        const sent = () => page.waitForRequest((r) => r.url().endsWith("/api/feedback") && r.method() === "POST", { timeout: 5000 });
        await tabs.getByRole("button", { name: "Meals" }).tap(); await page.getByRole("heading", { name: "Meals" }).waitFor(); await idle();
        const whileHeld = await holdSettings(); await resting(fb);
        ok("feedback: appears while the finger is still on Settings, as a pop-up in the middle", whileHeld && await fb.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return Math.abs(r.left + r.width / 2 - innerWidth / 2) < 2 && Math.abs(r.top + r.height / 2 - innerHeight / 2) < 4;
        }));
        ok("feedback: says how it opened, under the title", await fb.getByText("You held the Settings button, which opens this on any screen.").isVisible());
        const field = fb.getByLabel("Feedback");
        ok("feedback: a long press on Settings opens Feedback, not Settings, the box focused and Send waiting for words",
          (await page.getByRole("dialog", { name: "Settings" }).count()) === 0 && await field.evaluate((el) => el === document.activeElement)
          && await fb.getByRole("button", { name: "Send" }).isDisabled() && (await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16);
        // Nothing behind it fades (Sam, Nov 24), and a tap outside does nothing: it stays, and the page under it doesn't react.
        ok("feedback: the page behind isn't dimmed or blurred", await fb.evaluate((el) => { const st = getComputedStyle(el.parentElement); return st.backgroundColor === "rgba(0, 0, 0, 0)" && (st.backdropFilter === "none" || !st.backdropFilter); }));
        await page.touchscreen.tap(10, height - 140); await frames();
        ok("feedback: a tap outside leaves it open and reaches nothing underneath", (await fb.isVisible()) && (await page.getByRole("dialog").count()) === 1);
        await field.fill("Smoke: from Meals");
        let req = sent();
        await fb.getByRole("button", { name: "Send" }).tap();
        ok("feedback: Send closes it at once", await within150(async () => (await fb.count()) === 0));
        let body = (await req).postDataJSON(); const answer = await (await req).response();
        ok("feedback: sent with the tab, the release and the state, and kept", body.text === "Smoke: from Meals" && body.tab === "Meals" && body.sheets.length === 0
          && /^\d{2}\.\d/.test(body.release) && typeof body.state.Safeway === "string" && /x/.test(body.viewport) && answer?.status() === 200, JSON.stringify(body).slice(0, 300));
        // With a sheet open: Feedback over it, and the sheet still there after.
        const addSheet = page.getByRole("dialog", { name: "Add a meal" });
        await addOn(TODAY); await resting(addSheet);
        const overSheet = await holdSettings(); await resting(fb);
        ok("feedback: opens over an open sheet before the finger lifts, and the sheet stays open", overSheet && (await addSheet.isVisible()) && (await fb.isVisible())
          && await fb.evaluate((el) => document.activeElement === el.querySelector("textarea")));
        await fb.getByRole("button", { name: "Cancel" }).tap(); await gone(fb);
        ok("feedback: Cancel goes back to the sheet as it was", await addSheet.isVisible());
        await holdSettings(); await resting(fb);
        await fb.getByLabel("Feedback").fill("Smoke: with Add a meal open");
        req = sent();
        await fb.getByRole("button", { name: "Send" }).tap(); await gone(fb);
        body = (await req).postDataJSON();
        ok("feedback: names the open sheet and what it shows", body.tab === "Meals" && body.sheets.some((x) => x.name === "Add a meal" && x.detail === TODAY), JSON.stringify(body.sheets));
        ok("feedback: and the sheet under it is still open", await addSheet.isVisible());
        await addSheet.getByRole("button", { name: "Close" }).last().tap(); await gone(addSheet);
        // A short press is still a tap.
        await holdSettings(true);
        ok("feedback: a short press on Settings opens Settings", await seen(page.getByRole("dialog", { name: "Settings" })) && (await fb.count()) === 0);
        await page.keyboard.press("Escape"); await gone(page.getByRole("dialog", { name: "Settings" }));
      }

      // Settings: the look only (adding recipes lives on the Recipes tab, Nov 9).
      await page.getByRole("button", { name: "Settings" }).tap();
      const settings = page.getByRole("dialog", { name: "Settings" });
      await settings.waitFor(); await idle();
      ok("settings: no Copy to Google Sheet (Nov 17)", (await page.getByRole("button", { name: /Google Sheet/ }).count()) === 0);
      {
        // The release as YY.M.D, the last line of Settings (Nov 11).
        const last = (await settings.locator("p").last().innerText()).trim();
        ok("settings: ends with the version", /^\d{2}\.\d{1,2}\.\d{1,2}(\.\d+)?$/.test(last), last);
      }
      // Ordering (docs/CHECKOUT.md): off until changed. Settings keeps the switch and Face ID (Nov 13); the limit, store
      // and card are in Shop → Check out. Turning on needs Face ID, so with none set up it says so at once.
      // Ordering's set-once things live here (Nov 14): Face ID, the limit, the store and card, and the switch.
      const orderRows = (await settings.getByRole("button", { name: /^(Face ID|Limit per order|Pickup store|Card|Order from Simmer)/ }).allInnerTexts()).map((t) => t.split("\n")[0].trim());
      ok("settings: ordering starts off, with Face ID, the limit, the store and card here", await settings.getByRole("button", { name: /^Order from Simmer.*Off$/ }).isVisible()
        && orderRows.join() === "Face ID,Limit per order,Pickup store,Card,Order from Simmer", orderRows.join());
      await settings.getByRole("button", { name: /^Limit per order/ }).tap();
      const needFace0 = page.getByRole("dialog", { name: "Set up Face ID first" });
      ok("settings: changing the limit with no Face ID says to set it up first", await seen(needFace0, 2000));
      await needFace0.getByRole("button", { name: "OK" }).tap(); await gone(needFace0);
      await settings.getByRole("button", { name: /^Order from Simmer/ }).tap();
      const firstFaceId = page.getByRole("dialog", { name: "Set up Face ID first" });
      ok("settings: turning ordering on with no Face ID says to set it up first, within 150 ms", await within150(() => firstFaceId.isVisible()));
      await firstFaceId.getByRole("button", { name: "OK" }).tap(); await gone(firstFaceId);
      ok("settings: and ordering stays off", await settings.getByRole("button", { name: /^Order from Simmer.*Off$/ }).isVisible());
      // Face ID (Nov 12): none set up on a fresh server, so the row offers Set up (Face ID itself can't be driven here).
      ok("settings: Face ID starts at Set up", await settings.getByRole("button", { name: /^Face ID.*Set up$/ }).isVisible());
      // Adding a phone (Nov 12) only comes up once one has Face ID: nothing to approve or wait for yet.
      ok("settings: no phone to approve or set up after approving", (await settings.getByRole("button", { name: /^(Approve a new phone|Waiting for approval|Set up Face ID now)/ }).count()) === 0);
      // How Feedback opens, first (Sam, Nov 24); the look last, as one Theme row with the phone's own list.
      ok("settings: starts with how to send feedback", (await settings.locator("p").first().innerText()).trim() === "Hold the Settings button on any screen to send feedback.");
      const themePick = settings.getByLabel("Theme");
      ok("settings: one Theme row, the themes in order, the look last before the release", (await page.getByRole("radio").count()) === 0
        && (await themePick.locator("option").allInnerTexts()).join() === "Simmer,Apricot,Blue,Indigo,Pink,Orange,Teal,Green"
        && await settings.evaluate((el) => { const looks = [...el.querySelectorAll("section")].filter((x) => x.querySelector("select[aria-label=Theme]")); const all = [...el.querySelectorAll("section")]; return looks.length === 1 && all.at(-1) === looks[0]; }));
      await themePick.selectOption("apricot");
      ok("settings: theme switches within 150 ms", await within150(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === "apricot")
        && /Theme\s*Apricot/.test(await themePick.evaluate((el) => el.previousElementSibling.textContent)));
      await themePick.selectOption("simmer");
      ok("settings: none of the old things are back (Add recipe)", (await settings.getByRole("button", { name: /^Add recipe/ }).count()) === 0);
      await page.keyboard.press("Escape"); await gone(settings);

      const tabBar = page.getByRole("navigation", { name: "Main" });
      const needOf = (n) => page.getByRole("button", { name: `Need: ${n}`, exact: true });
      const haveOf = (n) => page.getByRole("button", { name: `Have: ${n}`, exact: true });
      const answerOf = async (n) => ((await haveOf(n).getAttribute("aria-pressed")) === "true" ? "have" : (await needOf(n).getAttribute("aria-pressed")) === "true" ? "need" : "check");
      const clear = async (n) => { const a = await answerOf(n); if (a !== "check") { await (a === "have" ? haveOf(n) : needOf(n)).tap(); await idle(); } };
      // Stock (Nov 11): every row answered with one switch, Have | Need (never both); the lit side tapped again clears it.
      // Need puts it on its store's list. A dinner's things are highlighted in their own sections.
      await tabBar.getByRole("button", { name: "List" }).tap(); await page.getByLabel("Add item to the list").waitFor(); await idle();
      await lookForBusy("Stock");
      {
        const add = await page.getByLabel("Add item to the list").boundingBox(), menu = await page.getByLabel("More for the list").boundingBox();
        ok("stock: the list's ⋯ sits above the list on the right, not beside Add", Boolean(add && menu) && menu.y > add.y + add.height - 2 && menu.x > 300);
      }
      ok("stock: has a plain add field at the top", await page.getByLabel("Add item to the list").isVisible() && (await page.getByRole("button", { name: "Add item" }).count()) === 0);
      // None of the old things are back on Stock: the legend, the For this plan group, Every week.
      {
        const old = [];
        if (await page.getByText(/Need puts it on the list|In meals|to check/).count()) old.push("legend");
        if (await page.getByText("For this plan").count()) old.push("For this plan");
        if ((await page.getByText(/every week/i).count()) || (await page.getByLabel("More for Eggs").locator("option", { hasText: /week/i }).count())) old.push("Every week");
        ok("stock: none of the old things are back", !old.length, old.join(", "));
      }
      const meal = page.locator("[data-meal]").filter({ has: page.getByRole("group", { name: /^Have or need / }) });
      if (await meal.count()) {
        const name = (await meal.first().getByRole("group").getAttribute("aria-label")).replace(/^Have or need /, "");
        await clear(name);
        await haveOf(name).tap(); await idle();
        ok("stock: a meal thing: Have lights", (await answerOf(name)) === "have");
        const color = async (loc) => loc.evaluate((el) => getComputedStyle(el.querySelector("span span")).color);
        const kept = page.locator("div:not([data-meal])").filter({ has: page.getByRole("group", { name: /^Have or need / }) }).filter({ hasNot: page.locator("[data-group]") });
        ok("stock: a dinner's thing's name is in the highlight colour, a kept thing's isn't", !(await kept.count()) || (await color(meal.first())) !== (await color(kept.last())));
        await needOf(name).tap(); await idle();
        ok("stock: Need switches it (never both), still marked", (await answerOf(name)) === "need" && (await meal.filter({ hasText: new RegExp(name, "i") }).count()) === 1);
        await needOf(name).tap(); await idle();
        ok("stock: tapping the lit side again makes it to check", (await answerOf(name)) === "check");
      } else ok("stock: meal things (none need anything from the house in the sample)", true);
      // A kept thing works the same way.
      await clear("Milk");
      await needOf("Milk").tap();
      ok("stock: Need lights within 150 ms, before the save comes back", await within150(async () => (await answerOf("Milk")) === "need"));
      await idle();
      ok("stock: Need puts a kept thing on the list", (await answerOf("Milk")) === "need");
      await slow("**/api/list");
      await haveOf("Milk").tap();
      ok("stock: Have switches it within 150 ms", await within150(async () => (await answerOf("Milk")) === "have"));
      await idle(); await page.unroute("**/api/list");
      ok("stock: Have switches it off the list, marked checked", (await answerOf("Milk")) === "have");
      await haveOf("Milk").tap(); await idle();
      ok("stock: and the lit side again clears it", (await answerOf("Milk")) === "check");
      await needOf("Milk").tap(); await idle();
      if ((await answerOf("Eggs")) !== "need") { await needOf("Eggs").tap(); await idle(); }
      // Remove from Stock asks first (the shared confirm); Cancel keeps it.
      await page.getByLabel("More for Eggs").selectOption("remove");
      const removeAsk = page.getByRole("dialog", { name: "Remove Eggs from the list?" });
      ok("stock: Remove from Stock asks first", (await seen(removeAsk, 2000)) && (await removeAsk.getByRole("button", { name: "Remove from the list" }).isVisible()));
      await removeAsk.getByRole("button", { name: "Cancel" }).tap(); await gone(removeAsk);
      ok("stock: Cancel keeps it in Stock", (await removeAsk.count()) === 0 && (await needOf("Eggs").count()) === 1);
      // Something new shows at once, as a stand-in row the server's answer replaces (Nov 11: always responsive).
      await slow("**/api/list");
      // Stock's own field (Nov 16, Sam): a name, and it's in as Need; new things are specialty.
      await page.getByLabel("Add item to the list").fill("frozen waffles"); await page.keyboard.press("Enter");
      await page.waitForTimeout(300); // on purpose: nothing may show for 300 ms (an add shows within 150 ms)
      ok("stock: the keyboard's Done doesn't add; only Add does", (await page.getByRole("group", { name: /Have or need frozen waffles/i }).count()) === 0 && (await page.getByLabel("Add item to the list").inputValue()) === "frozen waffles");
      await page.getByRole("button", { name: "Add", exact: true }).first().tap();
      ok("stock: something added is brought into view and lit where it landed", (await page.locator("[data-fresh]").count()) === 1);
      ok("stock: something added shows within 150 ms, marked Need", await within150(async () => (await page.getByRole("group", { name: /Have or need frozen waffles/i }).first().isVisible()) && (await answerOf("frozen waffles")) === "need"));
      await idle(); await page.unroute("**/api/list");
      ok("stock: and is still there once it's saved, still Need", (await page.getByRole("group", { name: /Have or need frozen waffles/i }).count()) === 1 && (await answerOf("frozen waffles")) === "need");
      await needOf("frozen waffles").tap(); await idle();
      ok("stock: a specialty thing no longer needed leaves Stock", (await page.getByRole("group", { name: /Have or need frozen waffles/i }).count()) === 0);
      // Something kept shows as she types in the field; tapping it marks it Need.
      await page.getByLabel("Add item to the list").tap();
      await page.waitForTimeout(200); // on purpose: nothing new may show for 200 ms after a tap in the field
      ok("stock: Specialty and Group wait until she types something new", (await page.getByLabel("How often").count()) === 0 && (await page.getByLabel("Group", { exact: true }).count()) === 0);
      await page.getByLabel("Add item to the list").fill("smoke oat bars");
      ok("stock: a new name shows one small row, Specialty and No group", (await page.getByLabel("How often").inputValue()) === "specialty" && (await page.getByLabel("Group", { exact: true }).inputValue()) === "");
      await page.getByLabel("Add item to the list").fill("mil");
      await page.waitForTimeout(200); // on purpose: no suggestion for Milk may show for 200 ms
      ok("stock: typing doesn't suggest what's already showing on the list", (await page.getByRole("button", { name: /^Milk\s*Need$/ }).count()) === 0);
      await page.getByLabel("Add item to the list").fill("waffles");
      await page.getByRole("button", { name: /^Frozen waffles/ }).tap(); await idle();
      ok("stock: something kept, picked as she types, comes back as Need", (await answerOf("frozen waffles")) === "need");
      // Groups, picked or made as she adds (Nov 16): Common, and a new group for the first, the same group for the second.
      const stockField = page.getByLabel("Add item to the list");
      await stockField.fill("smoke cheddar");
      await page.getByLabel("How often").selectOption("common");
      await page.getByLabel("Group", { exact: true }).selectOption({ label: "New group…" });
      await page.getByLabel("New group").fill("Smoke cheese");
      await page.getByLabel("New group").press("Enter");
      const groupPick = page.getByLabel("Group", { exact: true });
      ok("stock: a new group's name, once done, shows in the Group pill, and she can change her mind", await until(async () => (await groupPick.inputValue()) === "Smoke cheese", 2000)
        && (await groupPick.selectOption("").then(() => groupPick.inputValue())) === "" && (await groupPick.selectOption("Smoke cheese").then(() => groupPick.inputValue())) === "Smoke cheese");
      await page.getByRole("button", { name: "Add", exact: true }).first().tap(); await idle();
      const groupMenu = () => page.getByLabel("More for the Smoke cheese group");
      const startsOpen = async () => (await page.getByRole("button", { name: "Smoke cheese" }).getAttribute("aria-expanded")) === "true";
      if (process.env.SHOT) { await page.locator('[data-group="Smoke cheese"]').scrollIntoViewIfNeeded(); await frames(); await page.screenshot({ path: `${process.env.SHOT}/${tag}-group.png` }); }
      ok("stock: a group's header row is tinted", !/rgba\(0, 0, 0, 0\)|transparent/.test(await page.locator('[data-group="Smoke cheese"]').evaluate((g) => getComputedStyle(g.firstElementChild).backgroundColor)));
      ok("stock: a group shows from its first thing, open while everything in it is Need", (await page.locator('[data-group="Smoke cheese"]').count()) === 1 && (await page.getByRole("button", { name: "Smoke cheese" }).count()) === 1 && (await startsOpen()));
      await stockField.fill("smoke swiss");
      await page.getByLabel("More for smoke cheddar").selectOption("household"); await idle();
      await page.getByLabel("Group", { exact: true }).selectOption({ label: "Smoke cheese" });
      await page.getByRole("button", { name: "Add", exact: true }).first().tap(); await idle();
      // And from ⋯ for something already kept.
      ok("stock: a new thing put in a group lands in the group's section", (await page.locator("section").filter({ has: page.getByRole("heading", { name: "Household", exact: true }) }).getByRole("group", { name: "Have or need smoke swiss" }).count()) === 1);
      ok("stock: ⋯ can still put a kept thing in a group", (await page.getByLabel("More for smoke swiss").locator("option[value=group]").count()) === 1);
      const cheese = page.getByRole("button", { name: "Smoke cheese" });
      ok("stock: a group of two, both Need, shows both, open", (await cheese.count()) === 1 && (await startsOpen()) && (await answerOf("smoke cheddar")) === "need" && (await answerOf("smoke swiss")) === "need");
      await cheese.tap();
      ok("stock: and still closes, to its name alone", await until(async () => (await cheese.getAttribute("aria-expanded")) === "false" && (await page.locator('[data-group="Smoke cheese"] [role=group]').count()) === 0, 2000));
      await cheese.tap();
      ok("stock: and opens again", await until(async () => (await startsOpen()) && (await page.locator('[data-group="Smoke cheese"] [role=group]').count()) === 2, 2000));
      // A group keeps the state she left it in when a thing in it changes (Nov 19: it used to pop shut).
      await haveOf("smoke swiss").tap(); await idle();
      ok("stock: a group stays open when a thing in it changes (one answered Have stays in view)", (await cheese.getAttribute("aria-expanded")) === "true"
        && (await answerOf("smoke swiss")) === "have");
      ok("stock: the group's ⋯ only renames or removes it", JSON.stringify(await groupMenu().locator("option:not([disabled])").evaluateAll((os) => os.map((o) => o.value))) === '["rename","remove"]');
      const outline = await page.locator('[data-group="Smoke cheese"] > span[aria-hidden]').last().evaluate((el) => getComputedStyle(el).borderTopWidth);
      ok("stock: a group has its faint line around it", outline !== "0px", outline);
      await cheese.tap();
      ok("stock: tapping the group's name goes back to cart items only", await until(async () => (await cheese.getAttribute("aria-expanded")) === "false" && (await page.getByRole("group", { name: "Have or need smoke swiss" }).count()) === 0
        && (await page.getByRole("group", { name: "Have or need smoke cheddar" }).count()) === 1, 2000));
      await cheese.tap();
      ok("stock: and again shows all its items", await until(async () => (await cheese.getAttribute("aria-expanded")) === "true" && (await answerOf("smoke swiss")) === "have", 2000));
      await cheese.tap(); await until(async () => (await cheese.getAttribute("aria-expanded")) === "false", 2000);
      // The list's own ⋯ by Add: Show all shows every kept thing and opens every group; checked while on.
      const listMenu = page.getByLabel("More for the list");
      await listMenu.selectOption("all");
      ok("stock: the list's ⋯ Show all groups opens every group, checked", await until(async () => (await listMenu.locator("option[value=all]").innerText()).trim() === "✓ Show all groups" && (await cheese.getAttribute("aria-expanded")) === "true", 2000));
      await listMenu.selectOption("all");
      ok("stock: and off again, unchecked", await until(async () => (await listMenu.locator("option[value=all]").innerText()).trim() === "Show all groups" && (await cheese.getAttribute("aria-expanded")) === "false", 2000));
      await cheese.tap(); await until(async () => (await cheese.getAttribute("aria-expanded")) === "true", 2000);
      // A group renamed, then removed (Nov 16, Sam: "remove or rename a category"): its things go with it, and stay.
      await page.getByLabel("More for the Smoke cheese group").selectOption("rename");
      const rename = page.getByRole("dialog", { name: "Rename group" });
      await rename.getByLabel("Group name").fill("Smoke dairy"); await rename.getByRole("button", { name: "Save" }).tap(); await gone(rename); await idle();
      ok("stock: a group can be renamed, its things with it", (await page.getByRole("button", { name: "Smoke dairy" }).count()) === 1 && (await page.getByRole("button", { name: "Smoke cheese" }).count()) === 0
        && (await page.getByRole("group", { name: "Have or need smoke cheddar" }).count()) === 1);
      await page.getByLabel("More for the Smoke dairy group").selectOption("remove");
      await page.getByRole("dialog", { name: "Remove the Smoke dairy group?" }).getByRole("button", { name: "Remove group" }).tap(); await idle();
      ok("stock: removing a group asks first and keeps its things on their own", (await page.getByRole("button", { name: "Smoke dairy" }).count()) === 0
        && (await page.getByRole("group", { name: "Have or need smoke cheddar" }).count()) === 1 && (await page.getByRole("group", { name: "Have or need smoke swiss" }).count()) === 1);
      await page.getByLabel("More for smoke swiss").selectOption("remove");
      await page.getByRole("dialog", { name: "Remove Smoke swiss from the list?" }).getByRole("button", { name: "Remove from the list" }).tap(); await idle();
      ok("stock: with its group removed, a thing is on its own", (await page.getByRole("button", { name: "Smoke cheese" }).count()) === 0 && (await page.getByRole("group", { name: "Have or need smoke cheddar" }).count()) === 1);
      // A group with no things left stays until Remove group (Sam, Nov 24): Show all groups shows it, its header alone,
      // and Add's group picker lists it.
      await stockField.fill("smoke brie");
      await page.getByLabel("Group", { exact: true }).selectOption({ label: "New group…" });
      await page.getByLabel("New group").fill("Smoke empty"); await page.getByLabel("New group").press("Enter");
      await until(async () => (await page.getByLabel("Group", { exact: true }).inputValue()) === "Smoke empty", 2000);
      await page.getByRole("button", { name: "Add", exact: true }).first().tap(); await idle();
      await page.getByLabel("More for smoke brie").selectOption("remove");
      await page.getByRole("dialog", { name: "Remove Smoke brie from the list?" }).getByRole("button", { name: "Remove from the list" }).tap(); await idle();
      const emptyGroup = page.locator('[data-group="Smoke empty"]');
      ok("stock: a group whose last thing is removed doesn't show until Show all groups", (await emptyGroup.count()) === 0 && (await page.getByRole("group", { name: "Have or need smoke brie" }).count()) === 0);
      await listMenu.selectOption("all");
      ok("stock: Show all groups shows an emptied group, its header alone", await until(async () => (await emptyGroup.count()) === 1 && (await emptyGroup.locator("[role=group]").count()) === 0, 2000));
      if (process.env.SHOT) { await emptyGroup.scrollIntoViewIfNeeded(); await frames(); await page.screenshot({ path: `${process.env.SHOT}/${tag}-empty-group.png` }); }
      await stockField.fill("smoke camembert");
      const pickerHas = async (name) => (await page.getByLabel("Group", { exact: true }).locator("option").allInnerTexts()).includes(name);
      ok("stock: Add's group picker lists the emptied group", await until(() => pickerHas("Smoke empty"), 2000));
      await stockField.fill("");
      await page.getByLabel("More for the Smoke empty group").selectOption("remove");
      await page.getByRole("dialog", { name: "Remove the Smoke empty group?" }).getByRole("button", { name: "Remove group" }).tap(); await idle();
      await stockField.fill("smoke camembert");
      ok("stock: Remove group takes an empty group off the list and out of the picker", (await emptyGroup.count()) === 0 && !(await pickerHas("Smoke empty")));
      await stockField.fill("");
      await listMenu.selectOption("all");
      await page.screenshot({ path: `${dir}/5-stock-behaviour.png`, fullPage: true });

      // Shop (Nov 12): one page grouped by store, with a store filter at the top. What's out in Stock is on the list. Safeway's side is
      // stood in for (its cart, the usual products, and the helper doing cart changes a moment later).
      await postList({ op: "add", text: "Coffee", by: "Sam", store: "costco" });
      await postList({ op: "add", text: "Salad dressing", by: "Sam", store: "trader-joes" });
      await earlyFake.stop();
      const fake = await fakeSafeway({ helperSlow: true });
      await tabBar.getByRole("button", { name: "Shop" }).tap(); await page.getByLabel("Add item", { exact: true }).waitFor(); await idle();
      await lookForBusy("Shop");
      const tick = (n) => page.getByRole("checkbox", { name: new RegExp(`^${n}`) }).first();
      ok("shop: the tab is named Shop, lit, with the add field", (await page.getByRole("heading", { name: "Shop" }).count()) === 1 && (await tabBar.getByRole("button", { name: "Shop" }).getAttribute("aria-current")) === "page" && (await page.getByLabel("Add item").isVisible()));
      ok("shop: grouped by store, Safeway first, then Trader Joe's, Costco", (await page.locator("main section h2").allInnerTexts()).join() === "Safeway,Trader Joe's,Costco", (await page.locator("main section h2").allInnerTexts()).join());
      ok("shop: what's out in Stock is on the list", await seen(tick("Milk")));
      ok("shop: every list row has a checkbox (only a cart thing added on Safeway has none)", (await page.locator("[data-shop-row]").count()) === (await page.locator("[data-shop-row] [role=checkbox]").count()) + 1);
      const swGroup = page.locator("main section").filter({ has: page.getByRole("heading", { name: "Safeway", exact: true }) });
      // One line above the list (Nov 14): Show checked, and the cart's price with a Check out button; Add favorites stays by Safeway.
      const checkOut = page.getByRole("button", { name: "Check out" });
      const shopMenu = page.getByLabel("More for Shop");
      {
        const add = await page.getByLabel("Add item", { exact: true }).boundingBox(), menu = await shopMenu.boundingBox(), co = await page.getByRole("button", { name: "Check out" }).boundingBox();
        ok("shop: Shop's ⋯ sits above the list, after Check out", Boolean(add && menu && co) && menu.y > add.y + add.height - 2 && menu.x > co.x);
        ok("shop: Check out sits on the left, away from the ⋯ (Nov 17)", Boolean(add && menu && co) && co.x - add.x < 24 && menu.x - (co.x + co.width) > 80);
      }
      const showCheckedText = async () => (await shopMenu.locator("option[value=checked]").innerText()).trim();
      ok("shop: Show checked in the ⋯ by Add; the cart's price and Check out above the list; Add favorites by Safeway, a button with no number", (await page.getByRole("checkbox", { name: "Show checked" }).count()) === 0 && (await showCheckedText()).endsWith("Show checked") && await page.getByText("$5.99", { exact: true }).first().isVisible() && await checkOut.isVisible()
        && /^Add favorites$/.test((await swGroup.locator("h2 + *").innerText().catch(() => "")).trim()) && (await page.getByText(/in the cart/).count()) === 0, await swGroup.locator("h2 + *").innerText().catch(() => ""));
      {
        // Add favorites (Sam, Nov 24): a real button, button-sized, with the row +'s own fill and text colour.
        const fav = swGroup.getByRole("button", { name: "Add favorites" }), plus = page.getByRole("button", { name: /^Add .* to the cart$/ }).first();
        const look = (l) => l.evaluate((el) => { const c = getComputedStyle(el); return [c.backgroundColor, c.color, c.backdropFilter].join("|"); });
        const box = await fav.boundingBox();
        ok("shop: Add favorites is a button with the row +'s fill and text, button-sized", (await fav.count()) === 1 && (await look(fav)) === (await look(plus)) && Boolean(box) && box.height >= 32, `${await look(fav).catch(() => "")} vs ${await look(plus).catch(() => "")}`);
      }
      // Check out (Nov 14): the order only; set-up is in Settings, and until it's done Check out says so in one line.
      {
        await checkOut.tap();
        const co = page.getByRole("dialog", { name: "Check out" });
        ok("shop: Check out opens its sheet within 150 ms", await within150(() => co.isVisible()));
        await idle();
        ok("shop: Check out shows the cart and points to Settings for set-up", await co.getByText(/Set up ordering in Settings/).isVisible()
          && (await co.getByRole("button", { name: /^(Face ID|Limit per order|Pickup store|Card)/ }).count()) === 0);
        ok("shop: nothing there places an order", (await co.getByRole("button", { name: /place|order now/i }).count()) === 0);
        ok("shop: no test run before ordering is set up", (await co.getByRole("button", { name: /^(Test run|Get ready)/ }).count()) === 0);
        ok("shop: no button anywhere on the page says Place order", (await page.getByRole("button", { name: /place order/i }).count()) === 0);
        await page.keyboard.press("Escape"); await gone(co);
        // A cart change on its way to Safeway (Nov 16, Sam): Check out is greyed until it's done.
        await page.getByRole("button", { name: "Add Milk to the cart" }).tap();
        ok("shop: while a cart change is on its way, Check out is greyed", await within150(() => checkOut.isDisabled()));
        await idle();
        ok("shop: and once it's done, Check out can be tapped again", await until(() => checkOut.isEnabled(), 3000));
        fake.cart.splice(fake.cart.findIndex((l) => l.productId === "p-milk"), 1);
        await tabBar.getByRole("button", { name: "List" }).tap(); await idle();
        await tabBar.getByRole("button", { name: "Shop" }).tap(); await idle();
        // The store and card in Settings (Nov 14): picked from what Safeway's checkout shows, in place of the rows. With
        // Face ID pretended on, Pickup store reads Safeway and offers its store; Back returns to the rows.
        await page.route("**/api/checkout", async (r) => {
          if (r.request().method() === "GET") return r.fulfill({ json: { settings: { on: false, limitCents: 2000, store: "", card: "" }, server: false, faceId: 1, adding: null } });
          const b = r.request().postDataJSON() ?? {};
          // The helper's step comes first (Nov 23), then the reading.
          if (b.op === "look" && !b.jobId) return r.fulfill({ json: { waiting: "look1", step: "cart", stepAt: "2026-11-23T18:00:01.000Z" } });
          if (b.op === "look") { await new Promise((w) => setTimeout(w, 800)); return r.fulfill({ json: { store: "100 Main St, Springfield, CA 90000", card: "4242" } }); }
          return r.fallback();
        });
        await page.getByRole("button", { name: "Settings" }).tap();
        const st = page.getByRole("dialog", { name: "Settings" });
        await st.waitFor(); await idle();
        ok("settings: the store and card say they come from Safeway", await seen(st.getByRole("button", { name: /^Pickup store.*From Safeway$/ }), 2000) && await st.getByRole("button", { name: /^Card.*From Safeway$/ }).isVisible());
        await st.getByRole("button", { name: /^Pickup store/ }).tap();
        ok("settings: Pickup store shows in place, saying the helper's step as it reads Safeway", await seen(st.getByRole("status", { name: "Opening your Safeway cart…" }), 1000)
          && await st.getByText("Opening your Safeway cart…", { exact: true }).isVisible());
        const pick = st.getByRole("radio", { name: /100 Main St, Springfield, CA 90000/ });
        ok("settings: then offers the store Safeway shows, to pick", await seen(pick, 3000) && (await pick.innerText()).includes("What Safeway shows"));
        await st.getByRole("button", { name: "Back" }).tap();
        await st.getByRole("button", { name: /^Card/ }).tap();
        ok("settings: Card offers Safeway's card from the same reading, at once", await seen(st.getByRole("radio", { name: /•••• 4242/ }), 300));
        await st.getByRole("button", { name: "Back" }).tap(); await st.getByRole("button", { name: /^Card/ }).waitFor();
        await page.keyboard.press("Escape"); await gone(st);
        await page.unroute("**/api/checkout");
        // The checkout sheet says the helper's step in place while it gets ready (Nov 23, Sam: "some sort of status
        // message saying what the app is doing as it goes"): in the reading's own heading, never a new bar.
        await page.route("**/api/checkout", async (r) => {
          if (r.request().method() === "GET") return r.fulfill({ json: { settings: { on: true, limitCents: 2000, store: "", card: "" }, server: false, faceId: 1, adding: null } });
          const b = r.request().postDataJSON() ?? {};
          if (b.op !== "times") return r.fallback();
          if (!b.jobId) return r.fulfill({ json: { waiting: "times1", step: "cart", stepAt: "2026-11-23T18:00:01.000Z" } });
          if (b.since === "2026-11-23T18:00:01.000Z") { await new Promise((w) => setTimeout(w, 300)); return r.fulfill({ json: { waiting: "times1", step: "times", stepAt: "2026-11-23T18:00:04.000Z" } }); }
          await new Promise((w) => setTimeout(w, 1200));
          return r.fulfill({ json: { days: [{ key: "select slots for TUESDAY Nov, 24", label: "Tue, Nov 24" }], day: "select slots for TUESDAY Nov, 24", times: [] } });
        });
        await checkOut.tap();
        const sheet = page.getByRole("dialog", { name: "Check out" });
        // No Get ready button (Sam, Nov 24: "skip get ready button"): opening the sheet reads the pickup times at once.
        ok("checkout: no Get ready button, and no explanatory lines", (await sheet.getByRole("button", { name: /^Get ready/ }).count()) === 0
          && (await sheet.getByText(/stops one step short|Nothing is ordered|Remembered once you approve/).count()) === 0);
        const words = sheet.getByText("Reading pickup times…", { exact: true });
        ok("checkout: opening it reads the times, saying each step in place (Opening your Safeway cart…, then Reading pickup times…)", await seen(sheet.getByText("Opening your Safeway cart…", { exact: true }), 2000)
          && await seen(words, 2000) && (await sheet.getByRole("status", { name: "Reading pickup times…" }).count()) === 1);
        ok("checkout: the step's words sit in the reading's heading, inside it", await words.evaluate((el) => Boolean(el.closest("[role=status]")) && el.getBoundingClientRect().height <= 21));
        ok("checkout: and the times replace them once read", await seen(sheet.getByRole("radio", { name: "Tue, Nov 24" }), 4000));
        await page.keyboard.press("Escape"); await gone(sheet);
        await page.unroute("**/api/checkout");
        // Test run only when one is required (Sam, Nov 24), and after one passes, Safeway read again with the same time and
        // bags, landing on Place order with no time picked again. Face ID stood in for (the page's own credentials call).
        {
          let passed = true, reads = 0, closed = false;
          const bodies = [];
          const DAY = "select slots for TUESDAY Nov, 24";
          await page.route("**/api/checkout", async (r) => {
            if (r.request().method() === "GET") return r.fulfill({ json: { settings: { on: true, limitCents: 5000, store: "100 Main St", card: "4242" }, server: true, faceId: 1, adding: null } });
            const b = r.request().postDataJSON() ?? {};
            bodies.push(b);
            if (b.op === "times") return r.fulfill({ json: { days: [{ key: DAY, label: "Tue, Nov 24" }], day: DAY, times: [{ id: "w1", time: "6–7 PM", price: "Free", flash: false }] } });
            if (b.op === "prepare") {
              reads++;
              return r.fulfill({ json: { store: "100 Main St, Springfield, CA 90000", window: "Tue 6–7 PM", card: "4242", items: 3, totalCents: 694, stops: [], highlights: [], remember: false, bagsOwn: b.bagsOwn !== false, feesCents: null,
                canOrder: passed && !closed, orderWhy: closed ? "The helper on the computer needs updating first." : passed ? "" : "Do a test run first: the helper's checkout steps changed.", needsTest: !passed, preparedId: `reading${reads}` } });
            }
            if (b.op === "approve") return r.fulfill({ json: { ok: true, approvalId: `ok-${b.preparedId}`, totalCents: 694, window: "Tue 6–7 PM" } });
            if (b.op === "test-run") { passed = true; return r.fulfill({ json: { ok: true, would: "Would place $6.94 · Tue 6–7 PM" } }); }
            return r.fallback();
          });
          await page.route("**/api/checkout/passkey", (r) => r.fulfill({ json: { options: { challenge: "c21va2U", rpId: "localhost", allowCredentials: [], userVerification: "preferred" } } }));
          await page.evaluate(() => {
            const buf = (s) => new TextEncoder().encode(s).buffer;
            navigator.credentials.get = async () => ({ id: "smoke", rawId: buf("smoke"), type: "public-key", authenticatorAttachment: "platform", getClientExtensionResults: () => ({}),
              response: { authenticatorData: buf("a"), clientDataJSON: buf("{}"), signature: buf("s"), userHandle: null } });
          });
          const pickTime = async (co) => {
            await co.getByRole("radio", { name: "Tue, Nov 24" }).tap();
            await co.getByRole("button", { name: /6–7 PM/ }).tap();
          };
          await checkOut.tap();
          let co = page.getByRole("dialog", { name: "Check out" });
          await seen(co.getByRole("radio", { name: "Tue, Nov 24" }), 4000);
          await pickTime(co);
          const place = co.getByRole("button", { name: "Place order · $6.94" });
          ok("checkout: with the test run passed, the reading offers only Place order · $X, no Test run", await seen(place, 3000) && (await co.getByRole("button", { name: /^Test run/ }).count()) === 0);
          await page.keyboard.press("Escape"); await gone(co);
          passed = false; reads = 0; bodies.length = 0;
          await checkOut.tap();
          co = page.getByRole("dialog", { name: "Check out" });
          await seen(co.getByRole("radio", { name: "Tue, Nov 24" }), 4000);
          await pickTime(co);
          const test = co.getByRole("button", { name: "Test run · $6.94" });
          ok("checkout: while a test run is required, Test run · $X, and no Place order", await seen(test, 3000) && (await co.getByRole("button", { name: /^Place order/ }).count()) === 0);
          await test.tap();
          ok("checkout: after a test run passes, Place order · $X shows without picking a time, and no Pick another time", await seen(place, 4000) && (await co.getByRole("button", { name: /^Test run/ }).count()) === 0
            && (await co.getByRole("radio", { name: "Tue, Nov 24" }).count()) === 0 && (await co.getByRole("button", { name: "Pick another time" }).count()) === 0);
          const preps = bodies.filter((x) => x.op === "prepare" && !x.jobId);
          ok("checkout: Safeway read again with the same time and bags, as a new reading approved on its own", preps.length === 2 && preps[1].windowId === "w1" && preps[1].bagsOwn === preps[0].bagsOwn
            && bodies.filter((x) => x.op === "approve").map((x) => x.preparedId).join() === "reading1" && bodies.filter((x) => x.op === "times").length === 1, JSON.stringify(bodies));
          ok("checkout: with a button showing, no line saying why", (await co.getByText("The helper on the computer needs updating first.").count()) === 0);
          await page.keyboard.press("Escape"); await gone(co);
          // Test run passed but placing closed (the helper out of date): neither button, one muted line saying why (Sam, Nov 24).
          closed = true;
          await checkOut.tap();
          co = page.getByRole("dialog", { name: "Check out" });
          await seen(co.getByRole("radio", { name: "Tue, Nov 24" }), 4000);
          await pickTime(co);
          ok("checkout: with neither Test run nor Place order, one line says why", await seen(co.getByText("The helper on the computer needs updating first.", { exact: true }), 3000)
            && (await co.getByRole("button", { name: /^(Test run|Place order)/ }).count()) === 0);
          await page.keyboard.press("Escape"); await gone(co);
          await page.unroute("**/api/checkout"); await page.unroute("**/api/checkout/passkey");
        }
      }
      ok("shop: a Safeway row says its Safeway product and how many under its name", await seen(tick("Milk").getByText(/Lucerne 2% Reduced Fat Milk.* · Need 1 gallon/)));
      ok("shop: a cart thing added on Safeway ends the Safeway group, with its price", (await swGroup.locator("[data-shop-row]").last().innerText()).includes("Sparkling Water"));
      ok("shop: no Done shopping; Show checked starts on (Nov 14)", (await page.getByRole("button", { name: "Done shopping" }).count()) === 0 && (await showCheckedText()) === "✓ Show checked");
      // Add puts the usual in the cart: − n + at once, the helper's answer behind it.
      await page.getByRole("button", { name: "Add Milk to the cart" }).tap();
      ok("shop: Add shows − 1 + within 150 ms", await within150(async () => (await page.getByLabel("1 in the cart").count()) >= 2 && (await page.getByRole("button", { name: "One more Milk" }).isVisible())));
      await page.getByRole("button", { name: "One more Milk" }).tap();
      ok("shop: + shows within 150 ms", await within150(() => page.getByLabel("2 in the cart").first().isVisible()));
      await idle();
      ok("shop: and Safeway has them: Add favorites gone with one favorite left", await until(async () => (await page.getByRole("button", { name: "Add favorites" }).count()) === 0 && fake.cart.some((l) => l.productId === "p-milk" && l.qty === 2)), JSON.stringify(fake.cart.map((l) => [l.productId, l.qty])));
      ok("shop: Find on a row with no favorite", (await page.getByRole("button", { name: /^Find .* at Safeway$/ }).count()) + (await page.getByRole("button", { name: /^Add .* to the cart$/ }).count()) >= 1);
      // Find's Back, place and Skip or Next float at the bottom of its sheet (Sam, Nov 24: "It needs to float somehow"):
      // in view however far the results are scrolled, and after the last product once at the end, never over it.
      {
        const findBtn = page.getByRole("button", { name: /^Find .* at Safeway$/ }).first();
        if (await findBtn.count()) {
          await findBtn.tap();
          const fs = page.getByRole("dialog", { name: "Safeway's choices" });
          await seen(fs.getByText("Safeway Found Thing 12 - 16 Oz"), 5000);
          const list = fs.locator("[data-sheet-body]"), bar = fs.locator("[data-find-bar]");
          await list.evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
          const inView = async () => { const l = await list.boundingBox(), b = await bar.boundingBox(); return Boolean(l && b) && b.y >= l.y && b.y + b.height <= l.y + l.height + 1; };
          ok("find: Skip and where it is float at the bottom of the sheet while the results scroll", (await list.evaluate((el) => el.scrollHeight > el.clientHeight + 40)) && await inView()
            && await bar.getByRole("button", { name: "Skip" }).isVisible() && /^\d+ of \d+$/.test((await bar.locator("p").innerText()).trim()));
          await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
          const last = await fs.getByText("Safeway Found Thing 12 - 16 Oz").boundingBox(), b = await bar.boundingBox();
          ok("find: scrolled to the end, the bar is still there and the last product sits above it", await inView() && last.y + last.height <= b.y + 1, JSON.stringify([last, b]));
          ok("find: no copy of Next or Skip at the top any more", (await fs.getByRole("button", { name: /^(Skip|Next)/ }).count()) === 1);
          await bar.getByRole("button", { name: "Skip" }).tap();
          ok("find: the next item starts at the top", await until(async () => (await list.evaluate((el) => el.scrollTop)) === 0, 2000));
          await page.keyboard.press("Escape"); await gone(fs);
        } else ok("find: a Find button to open", false);
      }
      await slow("**/api/list");
      await tick("Milk").tap();
      ok("shop: a tick shows within 150 ms, struck through", await within150(async () => (await tick("Milk").getAttribute("aria-checked")) === "true" && (await tick("Milk").locator(".line-through").count()) === 1));
      ok("shop: with Show got on, a ticked row stays", (await tick("Milk").count()) === 1);
      // Added by hand: on the list at once, as a stand-in row until the server's list comes back.
      await page.getByLabel("Add item").fill("smoke basil"); await page.keyboard.press("Enter");
      ok("shop: something added shows within 150 ms", await within150(() => page.getByRole("checkbox", { name: /smoke basil/i }).first().isVisible()));
      await idle(); await page.unroute("**/api/list");
      ok("shop: and is there once, once it's saved", (await page.getByRole("checkbox", { name: /smoke basil/i }).count()) === 1);
      // Ordered? asks first; Cancel leaves the list alone.
      await page.getByLabel("More for Shop").selectOption("bought");
      const ordered = page.getByRole("dialog", { name: "Mark the cart bought?" });
      ok("shop: Ordered? asks first", await seen(ordered, 2000));
      await ordered.getByRole("button", { name: "Cancel" }).tap(); await gone(ordered);
      // The store filter (Nov 12): All shows every store; a store shows only its rows, and Done shopping goes by it.
      {
        await page.getByRole("radio", { name: "Trader Joe's" }).tap();
        const only = await within150(async () => (await page.locator("main section h2").allInnerTexts()).join() === "Trader Joe's");
        ok("shop: the filter shows one store's rows, within 150 ms", only, (await page.locator("main section h2").allInnerTexts()).join());
        ok("shop: the same rows, checkbox and all", (await page.getByRole("checkbox", { name: /^Salad dressing/ }).count()) === 1 && (await page.getByRole("checkbox", { name: /^Milk/ }).count()) === 0);
        await page.getByRole("radio", { name: "All" }).tap();
        ok("shop: All shows every store again", await until(async () => (await page.locator("main section h2").allInnerTexts()).join() === "Safeway,Trader Joe's,Costco", 2000));
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
      await tick("Milk").tap(); await idle(); // untick Milk
      await tick("Eggs").tap(); await idle();
      await tick("Coffee").tap(); await idle();
      ok("shop: ticked rows stay, struck through, with Show got on", (await tick("Eggs").getAttribute("aria-checked")) === "true" && (await tick("Coffee").count()) === 1);
      await shopMenu.selectOption("checked");
      ok("shop: Show checked off hides them within 150 ms", await within150(async () => (await page.getByRole("checkbox", { name: /^(Eggs|Coffee)/ }).count()) === 0) && (await tick("Milk").count()) === 1);
      await tabBar.getByRole("button", { name: "List" }).tap(); await idle();
      await tabBar.getByRole("button", { name: "Shop" }).tap(); await idle();
      ok("shop: and it stays off on coming back", (await showCheckedText()) === "Show checked" && (await page.getByRole("checkbox", { name: /^(Eggs|Coffee)/ }).count()) === 0);
      await shopMenu.selectOption("checked");
      ok("shop: Show brings them back within 150 ms", await within150(async () => (await tick("Eggs").getAttribute("aria-checked")) === "true" && (await tick("Coffee").count()) === 1));
      // An empty cart: Check out shows greyed, and can't be pressed (Sam, Nov 21).
      {
        const kept = fake.cart.splice(0);
        await tabBar.getByRole("button", { name: "List" }).tap(); await idle();
        await tabBar.getByRole("button", { name: "Shop" }).tap(); await idle();
        const greyCo = page.getByRole("button", { name: "Check out" });
        ok("shop: with an empty cart, Check out shows greyed and can't be pressed", (await greyCo.count()) === 1 && (await greyCo.isDisabled()));
        fake.cart.push(...kept);
      }
      // Safeway out of reach: no Safeway controls, nothing extra in its header; its rows are a plain checklist.
      await fake.stop();
      const awayFake = await fakeSafeway({ away: true });
      await tabBar.getByRole("button", { name: "List" }).tap(); await idle();
      await tabBar.getByRole("button", { name: "Shop" }).tap(); await idle();
      ok("shop: with Safeway out of reach, its rows are a plain checklist", (await page.getByRole("button", { name: /^(Add .* to the cart|Find .* at Safeway|One more .*)$/ }).count()) === 0 && (await swGroup.locator("h2 + *").count()) === 0 && (await tick("Milk").count()) === 1);
      // Not answering (Sam, Nov 23): greyed but pressable, no price. The button always reads Check out (Sam, Nov 24); "Not
      // connected" is the small status line beside it, in place, no taller than the button.
      const cartStatus = page.locator("[data-cart-status]");
      const awayButton = page.getByRole("button", { name: /^Check out\. Safeway not connected/ });
      ok("shop: with Safeway out of reach, the button still reads Check out, greyed but pressable, and the status line says Not connected", (await awayButton.count()) === 1 && (await awayButton.innerText()).trim() === "Check out"
        && !(await awayButton.isDisabled()) && (await cartStatus.innerText()).trim() === "Not connected"
        && (await cartStatus.boundingBox()).height <= (await awayButton.boundingBox()).height);
      await page.screenshot({ path: `${dir}/5c-shop-away.png`, fullPage: true });
      // Answering again: tapping Not connected looks again, and Check out comes back.
      awayFake.back();
      await awayButton.tap(); await idle();
      ok("shop: tapping it looks again and Check out comes back, the status line empty", await until(async () => (await awayButton.count()) === 0 && (await page.getByRole("button", { name: "Check out", exact: true }).count()) === 1 && (await cartStatus.innerText()).trim() === "", 3000));
      await awayFake.stop();
      // Safeway signed out on the computer (Nov 16): the cart is greyed, says so, and shows nothing that's in it.
      const outFake = await fakeSafeway({ signedOut: true });
      await tabBar.getByRole("button", { name: "List" }).tap(); await idle();
      await tabBar.getByRole("button", { name: "Shop" }).tap(); await idle();
      const signedOutButton = page.getByRole("button", { name: /^Check out\. Signed out/ });
      ok("shop: with Safeway signed out, the cart is greyed and empty, Check out's words unchanged and Signed out in the status line", (await signedOutButton.count()) === 1
        && (await signedOutButton.innerText()).trim() === "Check out" && (await cartStatus.innerText()).trim() === "Signed out"
        && (await page.getByRole("button", { name: "Check out", exact: true }).count()) === 0
        && (await page.getByText(/Sparkling Water/).count()) === 0
        && (await page.getByRole("button", { name: /^(Add .* to the cart|Find .* at Safeway)$/ }).count()) === 0
        && (await page.getByRole("button", { name: /Ordered\?/ }).count()) === 0);
      await page.screenshot({ path: `${dir}/5d-shop-signed-out.png`, fullPage: true });
      // Signed in on the computer meanwhile (Nov 21, Sam): tapping Signed out looks again, and the cart comes back.
      outFake.signIn();
      await signedOutButton.tap(); await idle();
      ok("shop: tapping Signed out after signing in looks again and shows the cart", await until(async () => (await signedOutButton.count()) === 0 && (await page.getByText(/Sparkling Water/).count()) > 0, 3000));
      await outFake.stop();
      await tabBar.getByRole("button", { name: "List" }).tap(); await idle();
      await needOf("Milk").tap(); await idle();
      ok("stock: tapping Need again takes it back off", (await answerOf("Milk")) === "check");
      ok("stock: after the shop, Eggs isn't on the list any more", (await answerOf("Eggs")) === "check");

      // The Recipes tab, a recipe, and back.
      ok("tabs: four tabs (Recipes, Meals, List, Shop), no Quick add", (await tabBar.getByRole("button").allInnerTexts()).join() === "Recipes,Meals,List,Shop" && (await tabBar.getByRole("button", { name: "Quick add" }).count()) === 0);
      await tabBar.getByRole("button", { name: "Recipes" }).tap(); await page.getByRole("button", { name: "Add recipe" }).first().waitFor(); await idle();
      await lookForBusy("Recipes");
      ok("recipes: Recipes lit", (await tabBar.getByRole("button", { name: "Recipes" }).getAttribute("aria-current")) === "page");
      // None of the old things are back on Recipes: a search tab, add-to-list buttons on rows. (Add recipe at the top is
      // back on purpose, Nov 19: pinned with the brand bar, as Add on Shop and List.)
      {
        const old = [];
        if (await page.getByRole("search").count()) old.push("search");
        if (await page.getByRole("button", { name: /^Add .+ to the list$/ }).count()) old.push("add-to-list buttons on rows");
        ok("recipes: none of the old things are back", !old.length, old.join(", "));
      }
      ok("recipes: Add recipe stays at the top while the list scrolls", await page.getByRole("button", { name: "Add recipe" }).first().evaluate((el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") return true; } return false; }));
      // Rows only open the recipe; a recipe has no Add to the list (Nov 14): groceries come only through the plan.
      const chiliRow = page.getByRole("button", { name: /^Turkey chili/ }).first();
      for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await chiliRow.isVisible()) break; await all.tap(); await frames(); }
      await chiliRow.tap(); await page.getByRole("button", { name: "Edit", exact: true }).waitFor(); await idle();
      ok("recipe: no Add to the list on a recipe (Nov 14)", (await page.getByRole("button", { name: /add to the list/i }).count()) === 0);
      await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap(); await page.getByRole("button", { name: "Add recipe" }).first().waitFor();
      const tacos = page.getByRole("button", { name: /^Tacos/ }).first();
      for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await tacos.isVisible()) break; await all.tap(); await frames(); }
      await tacos.tap();
      ok("recipe: the recipe screen; none of the old things are back (Quick/Regular outside Edit)", (await seen(page.getByRole("heading", { name: "Tacos" }), 3000)) && (await page.getByRole("radio", { name: "Quick" }).count()) === 0);
      await lookForBusy("a recipe");
      // Editing a recipe when the save fails: the sheet stays with what was typed.
      await page.getByRole("button", { name: "Edit", exact: true }).tap();
      const edit = page.getByRole("dialog", { name: "Edit Tacos" });
      ok("edit: Quick/Regular is chosen here", await seen(edit.getByRole("radio", { name: "Quick" }), 2000));
      await edit.getByPlaceholder("Double the spice for Sam").fill("A note that must survive");
      await page.route("**/api/recipes", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      // Save closes at once (Nov 11: no "Saving…"); one that fails opens Edit again with what was typed, under the alert.
      await edit.getByRole("button", { name: "Save", exact: true }).tap();
      ok("edit: Save closes at once, with no Saving", (await page.getByText("Saving…").count()) === 0);
      const editAlert = page.getByRole("dialog", { name: "That didn't go through" });
      ok("edit: a failed save says why, over the page", await seen(editAlert.getByText("No connection"), 8000));
      ok("edit: and opens Edit again with what was typed", (await edit.isVisible()) && (await edit.getByPlaceholder("Double the spice for Sam").inputValue()) === "A note that must survive");
      await editAlert.getByRole("button", { name: "OK" }).tap(); await gone(editAlert);
      ok("edit: and the save button works again", await edit.getByRole("button", { name: "Save", exact: true }).isEnabled());
      await page.unroute("**/api/recipes");
      // A save that goes through: the recipe shows the change within 150 ms, ingredients too, before the server answers.
      await slow("**/api/recipes");
      await edit.getByPlaceholder("Double the spice for Sam").fill("Smoke note");
      const ingredients = edit.locator("textarea").first(); // Ingredients, one per line
      await ingredients.fill(`${await ingredients.inputValue()}\n2 smoke limes`);
      await edit.getByRole("button", { name: "Save", exact: true }).tap();
      ok("edit: a save shows on the recipe within 150 ms, new ingredient too", await within150(async () => (await edit.count()) === 0 && (await page.getByText("Smoke note").isVisible()) && (await page.getByText(/2 smoke limes/).first().isVisible())));
      await idle(); await page.unroute("**/api/recipes");
      ok("edit: and it's still there once it's saved", (await page.getByText("Smoke note").isVisible()) && (await page.getByText(/2 smoke limes/).first().isVisible()));
      // Delete (Nov 14): on the Edit sheet, asking first; Cancel keeps the recipe. No Stop suggesting any more.
      ok("recipe: no Stop suggesting", (await page.getByRole("button", { name: /Stop suggesting|Suggest this again/ }).count()) === 0);
      await page.getByRole("button", { name: "Edit", exact: true }).tap();
      await page.getByRole("dialog", { name: "Edit Tacos" }).getByRole("button", { name: "Delete recipe" }).tap();
      const del = page.getByRole("dialog", { name: "Delete Tacos?" });
      ok("recipe: Delete on the Edit sheet asks first", await seen(del, 1000));
      // Escape on a confirm over a sheet closes the confirm only (Nov 19: it closed both).
      await page.keyboard.press("Escape"); await gone(del);
      ok("recipe: Escape on the confirm closes it and leaves the Edit sheet open", (await del.count()) === 0 && (await page.getByRole("dialog", { name: "Edit Tacos" }).isVisible()));
      await page.getByRole("dialog", { name: "Edit Tacos" }).getByRole("button", { name: "Delete recipe" }).tap();
      await seen(del, 1000);
      await del.getByRole("button", { name: "Cancel" }).tap(); await gone(del);
      await page.keyboard.press("Escape"); await gone(page.getByRole("dialog", { name: "Edit Tacos" }));
      ok("recipe: Cancel keeps it", await page.getByRole("heading", { name: "Tacos" }).isVisible());

      // Adding recipes: Save closes the sheet and the recipe shows at once (one: its page; several: the collection),
      // before the server answers; then it's the saved recipe.
      await tabBar.getByRole("button", { name: "Recipes" }).tap();
      const addRecipes = page.getByRole("dialog", { name: "Add recipe" });
      const typeIn = async (text) => {
        await page.getByRole("button", { name: "Add recipe" }).first().tap();
        await addRecipes.getByRole("button", { name: "Type it in" }).tap();
        await addRecipes.locator("textarea").fill(text);
        await page.getByRole("button", { name: "Next" }).tap();
      };
      await typeIn("Smoke soup");
      ok("add recipes: reading shows its review", await seen(addRecipes.getByLabel("Name"), 15000) || await seen(addRecipes.getByPlaceholder("Turkey chili"), 1000));
      await slow("**/api/recipes");
      await page.getByRole("button", { name: "Save", exact: true }).tap();
      ok("add recipes: Save opens the new recipe within 150 ms", await within150(async () => (await addRecipes.count()) === 0 && (await page.getByRole("heading", { name: "Smoke soup" }).isVisible())));
      await idle(); await page.unroute("**/api/recipes");
      ok("add recipes: and it's still open once it's saved", await page.getByRole("heading", { name: "Smoke soup" }).isVisible());
      await page.locator("header").getByRole("button", { name: "Back to Recipes" }).tap();
      await typeIn("Smoke salad\nSmoke stew");
      ok("add recipes: a list of ideas offers each", await seen(page.getByRole("button", { name: "Save 2" }), 15000));
      await slow("**/api/recipes");
      await page.getByRole("button", { name: "Save 2" }).tap();
      ok("add recipes: several show in the collection within 150 ms", await within150(async () => (await addRecipes.count()) === 0 && (await page.getByText("Smoke salad").count()) > 0 && (await page.getByText("Smoke stew").count()) > 0));
      await idle(); await page.unroute("**/api/recipes");
      ok("add recipes: and they're there once saved", (await page.getByText("Smoke salad").count()) > 0);
    }

    // ======== Look and layout: every setup ========
    const tabs = page.getByRole("navigation", { name: "Main" });
    await tabs.getByRole("button", { name: "Meals" }).tap(); await page.getByRole("heading", { name: "Meals" }).waitFor(); await idle();
    await settingsHere("Meals");
    await page.getByRole("button", { name: "Settings" }).tap();
    const settingsSheet = page.getByRole("dialog", { name: "Settings" });
    await resting(settingsSheet); await idle();
    await page.screenshot({ path: `${dir}/4-settings-${tag}.png` });
    ok(`${tag}: sheets have a close button`, await settingsSheet.getByRole("button", { name: "Close" }).last().isVisible());
    await page.keyboard.press("Escape"); await gone(settingsSheet);
    if (phone) {
      // Feedback's look (Nov 24), opened over the Settings sheet's place on Meals.
      const fb = page.getByRole("dialog", { name: "Feedback" });
      await holdSettings(); await resting(fb);
      await fb.getByLabel("Feedback").fill("The Add meal sheet showed yesterday's day.");
      await page.screenshot({ path: `${dir}/4b-feedback-${tag}.png` });
      // Short enough to sit above the keyboard (about 380 of 844 left at 390 wide, about 330 of 667 at 375), with Cancel
      // and Send side by side.
      ok(`${tag}: Feedback is short enough for the space above the keyboard, Cancel and Send side by side`, await fb.evaluate((el) => {
        const [c, s] = [...el.querySelectorAll("button")].filter((b) => /^(Cancel|Send)$/.test(b.textContent.trim())).map((b) => b.getBoundingClientRect());
        return el.getBoundingClientRect().height <= 320 && Boolean(c && s) && Math.abs(c.top - s.top) < 1 && c.right <= s.left && s.right <= innerWidth;
      }), String(await fb.evaluate((el) => Math.round(el.getBoundingClientRect().height))));
      await page.keyboard.press("Escape"); await gone(fb);
    }
    await tabs.getByRole("button", { name: "List" }).tap(); await page.getByLabel("Add item to the list").waitFor(); await idle();
    await settingsHere("Stock");
    {
      // A planned dinner's thing (Sam, Nov 18): what the dinners need under its name, no asterisk, no tint. A dinner is
      // planned first (Nov 23: with none, in every setup, this checked nothing).
      await page.evaluate((day) => fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json", "x-passcode": JSON.parse(localStorage.getItem("sm.passcode") ?? "\"\"") }, body: JSON.stringify({ op: "plan", dishes: [{ kind: "regular", recipe: "turkey-chili-1", pinned: true, day }], lunches: [], counts: null, by: "Sam" }) }).then((r) => r.text()),
        new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }));
      await page.reload(); await seen(page.getByRole("heading", { name: "Meals" }), 8000);
      await tabs.getByRole("button", { name: "List" }).tap(); await page.getByLabel("Add item to the list").waitFor(); await idle();
      const meal = page.locator("[data-meal]").filter({ has: page.getByRole("group", { name: /^Have or need / }) });
      const amounts = await meal.evaluateAll((ms) => ms.map((m) => m.querySelector("span > span + span")?.textContent?.trim() ?? ""));
      ok(`${tag}: a dinner's thing shows its amount, without an asterisk`, amounts.some(Boolean) && (await meal.first().getByText("*", { exact: true }).count()) === 0
        && (await meal.first().evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgba(0, 0, 0, 0)", amounts.slice(0, 3).join(" | "));
    }
    ok(`${tag}: every Stock row is the same height`, await page.getByRole("group", { name: /^Have or need / }).evaluateAll((gs) => new Set(gs.map((g) => Math.round(g.parentElement.getBoundingClientRect().height))).size === 1));
    // Every row has ⋯ or its space, so the switches line up (Nov 11).
    ok(`${tag}: every Stock row keeps the ⋯ column`, await page.getByRole("group", { name: /^Have or need / }).evaluateAll((gs) => gs.length > 3 && gs.every((g) => { const n = g.nextElementSibling; return Boolean(n) && Math.round(n.getBoundingClientRect().width) === 36; })));
    await page.screenshot({ path: `${dir}/5-stock-${tag}.png`, fullPage: true });
    // Enough rows on Shop for its layout checks, in every setup (each may start from the samples, with an empty list).
    for (const [text, store] of [["Extra large organic heirloom tomatoes for the big salad", "safeway"], ["Milk", "safeway"], ["Eggs", "safeway"], ["Coffee", "costco"], ["Salad dressing", "trader-joes"],
      ["Organic unsweetened vanilla almond beverage, the big shelf-stable cartons for the week", "trader-joes"], ["Kirkland Signature extra virgin olive oil two liter twin pack for the pantry", "costco"]]) await postList({ op: "add", text, by: "Sam", store });
    await page.reload(); await seen(page.getByRole("heading", { name: "Meals" }), 8000); // what was just loaded would otherwise be kept
    const layoutFake = await fakeSafeway();
    await tabs.getByRole("button", { name: "Shop" }).tap(); await page.getByLabel("Add item", { exact: true }).waitFor(); await idle();
    await settingsHere("Shop");
    {
      const rows = page.locator("[data-shop-row]");
      ok(`${tag}: every Shop row is one height`, (await rows.count()) > 3 && await rows.evaluateAll((rs) => new Set(rs.map((r) => Math.round(r.getBoundingClientRect().height))).size === 1));
      ok(`${tag}: no thumbnails on Shop rows`, (await page.locator("[data-shop-row] img").count()) === 0);
      // A long name is cut short, never pushing the control or ⋯ off the row.
      ok(`${tag}: long names truncate and every row's controls stay on it`, await rows.evaluateAll((rs) => rs.every((r) => { const b = r.getBoundingClientRect(); return r.scrollWidth <= r.clientWidth && [...r.children].every((c) => c.getBoundingClientRect().right <= b.right + 0.5); })));
      // Every row's words fit inside it (Nov 24: a long Safeway-site cart name wrapped to three lines and hid its price):
      // the name on one line, cut short, and the line under it (product, amount or price) wholly inside the row.
      ok(`${tag}: every Shop row's name is one line and the line under it shows whole`, await rows.evaluateAll((rs) => rs.every((r) => {
        const b = r.getBoundingClientRect(), name = r.querySelector("[data-row-name]"), under = r.querySelector("[data-row-sub]");
        const n = name.getBoundingClientRect(), u = under?.getBoundingClientRect();
        return n.height <= parseFloat(getComputedStyle(name).lineHeight) + 1 && n.top >= b.top - 0.5 && (!u || (u.top >= n.bottom - 0.5 && u.bottom <= b.bottom + 0.5));
      })), await rows.evaluateAll((rs) => rs.map((r) => `${Math.round(r.getBoundingClientRect().height)}:${r.innerText.replace(/\s+/g, " ").slice(0, 40)}`).join(" | ")));
      const loose = rows.filter({ hasText: "Sparkling Water" });
      ok(`${tag}: a long-named cart thing from Safeway's site keeps the row's height and shows its price`, (await loose.count()) === 1 && await loose.getByText("$5.99", { exact: true }).isVisible()
        && Math.round((await loose.boundingBox()).height) === Math.round((await rows.first().boundingBox()).height));
      ok(`${tag}: a long-named Safeway row keeps its control`, await page.getByRole("button", { name: /^(Add|Find) Extra large organic/ }).isVisible());
      const co = await page.getByRole("button", { name: "Check out" }).boundingBox();
      ok(`${tag}: Check out sits above the list`, Boolean(co) && co.y < (await rows.first().boundingBox()).y, JSON.stringify(co));
    }
    await page.screenshot({ path: `${dir}/5a-shop-${tag}.png`, fullPage: true });
    await page.evaluate(() => { const el = document.getElementById("scroller"); if (el) el.scrollTop = el.scrollHeight; }); await frames();
    await page.screenshot({ path: `${dir}/5b-shop-end-${tag}.png` });
    await page.evaluate(() => { const el = document.getElementById("scroller"); if (el) el.scrollTop = 0; });
    await layoutFake.stop();
    await tabs.getByRole("button", { name: "Recipes" }).tap(); await page.getByRole("button", { name: "Add recipe" }).first().waitFor(); await idle();
    await settingsHere("Recipes");
    await page.screenshot({ path: `${dir}/6a-recipes-${tag}.png` });
    {
      const tacos = page.getByRole("button", { name: /^Tacos/ }).first();
      for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await tacos.isVisible()) break; await all.tap(); await frames(); }
      await tacos.tap(); await page.getByRole("heading", { name: "Tacos" }).waitFor(); await idle();
      await settingsHere("a recipe");
      await page.screenshot({ path: `${dir}/6-recipe-${tag}.png`, fullPage: true });
    }
    ok(`${tag}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);

    if (behaviour) {
      // Old addresses land on Shop too (the helper's panel opens ?open=shop).
      for (const open of ["shop", "lists"]) {
        await page.goto(`${url}?open=${open}`);
        ok(`shop: ?open=${open} opens Shop`, await seen(page.getByRole("heading", { name: "Shop" }), 8000));
      }
      // The passcode changes while the app is open, with a sheet up: back to the passcode screen, nothing left open.
      await tabs.getByRole("button", { name: "Shop" }).tap(); await page.getByLabel("Add item", { exact: true }).waitFor();
      await page.evaluate(() => localStorage.setItem("sm.passcode", JSON.stringify("changed")));
      await page.getByLabel("Add item").fill("paper towels"); await page.keyboard.press("Enter");
      ok("passcode: a turned-down passcode asks again", await seen(page.getByLabel("Household passcode"), 8000));
      ok("passcode: and closes what was open (only the wrong-passcode alert shows)", (await page.getByRole("dialog").count()) === (await page.getByRole("dialog", { name: "That passcode didn't work" }).count()));
      await page.screenshot({ path: `${dir}/7-signed-out.png` });
      ok("no busy words or problem bars anywhere seen", !busySeen.length, busySeen.join(", "));
    }
    ok(`${tag}: no console errors`, !errors.length, errors.join(" | "));
    await ctx.close();
  };
  const report = () => outputs.flat();
  try {
    if (PARALLEL) await Promise.all(SETUPS.map(runSetup));
    else for (const [at, setup] of SETUPS.entries()) await runSetup(setup, at);
  } catch (e) { console.error(e); console.log(report().join("\n")); process.exit(1); }
  await b.close();
  const results = report();
  console.log(results.join("\n"));
  console.log(`${results.length} checks, ${results.filter((r) => r.startsWith("FAIL")).length} failed`);
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
})();
