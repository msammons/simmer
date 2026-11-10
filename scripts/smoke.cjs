/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test at iPhone size (light and dark) and iPad size: passcode, planning by number (one shop at a time: Plan replaces
// This week, no lunches, no Made it), the tabs, Settings on every screen, Stock (Every week things), Lists (All, and Safeway's in-store
// checklist when the helper can't be reached), Add a meal and a recipe's Add to this week, the Recipes tab, a recipe and back, saves that fail (the sheet keeps what was entered), and a passcode turned down mid-use. Saves screenshots to .data/shots.
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
    const settingsHere = async (where) => {
      const btn = page.getByRole("button", { name: "Settings" });
      ok(`${tag}: Settings at the top of ${where}`, (await btn.count()) === 1 && (await btn.boundingBox()).y < 80);
      ok(`${tag}: tab bar on ${where}`, await page.getByRole("navigation", { name: "Main" }).isVisible());
    };
    await page.goto(process.env.URL || "http://localhost:3000/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // a dev server's corner badge sits over the tab bar
    await page.getByLabel("Household passcode").fill("nope"); await page.getByRole("button", { name: "Get started" }).tap();
    ok(`${tag}: wrong passcode message`, await seen(page.getByText("That passcode didn't work")));
    await page.getByLabel("Household passcode").fill("test123"); await page.getByRole("button", { name: "Get started" }).tap();
    ok(`${tag}: opens on Meals`, await seen(page.getByRole("heading", { name: "Meals" }), 8000));
    ok(`${tag}: Meals lit`, (await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
    await page.waitForTimeout(800);
    await settingsHere("Meals");
    await page.screenshot({ path: `${dir}/1-week-${tag}.png` });

    if (tag === "phone-light") {
      ok("brand: says Alpha by the logo", await page.getByText("Alpha", { exact: true }).first().isVisible());
      // Plan the next shop on the Meals page itself (Nov 10): Simmer's picks for last time's numbers, changed in place, saved once.
      await page.getByRole("button", { name: /^Plan/ }).first().tap(); await page.waitForTimeout(500);
      const planPage = page.locator("main");
      ok("plan: on the Meals page, no sheet", (await page.getByRole("heading", { name: "Next shop", exact: true }).isVisible()) && (await page.getByRole("dialog").count()) === 0);
      ok("plan: the tabs still show", await page.locator("nav").getByRole("button", { name: /Meals/ }).isVisible());
      ok("plan: no lunches to plan", (await planPage.innerText()).search(/lunch/i) < 0);
      const quickGroup = page.locator("section").filter({ has: page.getByRole("heading", { name: "Quick", exact: true }) });
      if (!(await quickGroup.count())) { await page.getByRole("button", { name: "Quick", exact: true }).tap(); await page.waitForTimeout(200); }
      ok("plan: dinners picked", (await quickGroup.getByRole("button", { name: /^Something else instead of/ }).count()) >= 1);
      await page.screenshot({ path: `${dir}/2-dinners.png`, fullPage: true });
      // Out of ideas (Nov 10): "Add another" until Simmer runs out; the rest is a place to pick one, never a count that "fits".
      for (let i = 0; i < 12 && !(await page.getByRole("button", { name: /^Pick a quick dinner/ }).count()); i++) { await quickGroup.getByRole("button", { name: "Add another" }).tap(); await page.waitForTimeout(150); }
      ok("plan: out of ideas shows a place to pick one", (await page.getByRole("button", { name: /^Pick a quick dinner/ }).count()) >= 1);
      ok("plan: and no count of what fits", !/\bfits?\b/.test(await planPage.innerText()));
      await page.getByRole("button", { name: /^Pick a quick dinner/ }).first().tap(); await page.waitForTimeout(500);
      const pick = page.getByRole("dialog", { name: "Pick one" });
      ok("pick: opens as its own sheet", (await pick.count()) === 1);
      const pickBox = await pick.getByRole("textbox").boundingBox();
      ok("pick: the search box sits at the top of its sheet", pickBox && pickBox.y > 0 && pickBox.y < 400 && pickBox.width > 300, JSON.stringify(pickBox));
      await page.screenshot({ path: `${dir}/2-pick.png` });
      await pick.locator("section button").first().tap(); await page.waitForTimeout(400);
      ok("pick: the place is filled", (await page.getByRole("dialog", { name: "Pick one" }).count()) === 0 && (await page.getByRole("button", { name: /^Pick a quick dinner/ }).count()) === 0);
      // The plan waits while another tab is visited.
      const before = await planPage.innerText();
      await page.locator("nav button", { hasText: "Lists" }).tap(); await page.waitForTimeout(400);
      await page.locator("nav button", { hasText: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("plan: kept while another tab is visited", (await page.getByRole("heading", { name: "Next shop", exact: true }).isVisible()) && (await planPage.innerText()) === before);
      // A save that fails (the connection drops): the page keeps everything planned, says so, and saves on a retry.
      const planned = before;
      await page.route("**/api/plan", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      await page.getByRole("button", { name: "Save", exact: true }).tap(); await page.waitForTimeout(800);
      ok("plan: a failed save keeps the plan", await page.getByRole("heading", { name: "Next shop", exact: true }).isVisible());
      ok("plan: and says what went wrong", await seen(page.getByRole("alert").filter({ hasText: "No connection. Check your signal and try again." })));
      ok("plan: and keeps what was planned", (await planPage.innerText()).includes(planned.split("\n").slice(0, 12).join("\n")));
      ok("plan: and the save button works again", await page.getByRole("button", { name: "Save", exact: true }).isEnabled());
      ok("plan: and says it once", (await page.getByText("No connection. Check your signal and try again.").count()) === 1);
      await page.screenshot({ path: `${dir}/2-plan-failed-save.png`, fullPage: true });
      if (process.env.FAILED_SHOT) await page.screenshot({ path: process.env.FAILED_SHOT });
      await page.unroute("**/api/plan");
      await page.getByRole("button", { name: "Save", exact: true }).tap();
      ok("plan: saved, and This week shows", await seen(page.getByRole("heading", { name: "This week" }), 10000));
      ok("plan: and says what went on the list", await seen(page.getByText(/Added \d+ things? to the grocery list/), 3000));
      ok("meals: no lunches, no Made it", (await page.getByText(/lunch|Made it/i).count()) === 0);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/2-week-planned.png`, fullPage: true });
      // A dinner: tapping it opens the recipe on top of Meals; its quiet × takes it off after a confirm (no sheet of
      // choices, no Undo; Nov 9). Back says where it goes and goes there.
      const kindSections = page.locator("section").filter({ has: page.getByRole("heading", { name: /^(Quick|Regular)$/ }) });
      const dinners = kindSections.getByRole("button").filter({ hasText: /\S/ });
      const offs = kindSections.getByRole("button", { name: /^Take .* off this week$/ });
      let cooked = false;
      if (await dinners.count()) {
        const count = await dinners.count();
        ok("meals: each dinner has its own take-it-off button, and nothing says Made it", (await offs.count()) === count && (await page.getByText("Made it").count()) === 0);
        await offs.first().tap(); await page.waitForTimeout(300);
        const confirm = page.getByRole("dialog", { name: "Take it off" });
        ok("meals: taking one off asks first", await confirm.isVisible());
        await confirm.getByRole("button", { name: "Cancel" }).tap(); await page.waitForTimeout(300);
        ok("meals: Cancel keeps it", (await dinners.count()) === count);
        await offs.first().tap(); await page.waitForTimeout(300);
        await page.getByRole("dialog", { name: "Take it off" }).getByRole("button", { name: "Take it off" }).tap(); await page.waitForTimeout(800);
        ok("meals: Take it off takes just that dinner off, with no Undo", ((await dinners.count()) === count - 1 || (await page.getByText("No dinners this week").isVisible())) && (await page.getByText("Undo").count()) === 0);
        const weekBefore = await dinners.count();
        await page.getByRole("button", { name: /^Plan/ }).first().tap(); await page.waitForTimeout(500);
        ok("plan: planning again says it replaces this week", await seen(page.getByText(/Saving replaces this week's/), 3000) || (await page.getByText("No dinners this week").count()) > 0);
        await page.getByRole("button", { name: "Cancel", exact: true }).tap(); await page.waitForTimeout(400);
        ok("plan: Cancel goes back to this week, unchanged", (await page.getByRole("heading", { name: "This week" }).isVisible() || (await page.getByText("No dinners this week").count()) > 0) && (await dinners.count()) === weekBefore);
        await page.getByRole("button", { name: /^Plan/ }).first().tap(); await page.waitForTimeout(500);
        await page.getByRole("button", { name: "Save", exact: true }).tap();
        ok("plan: a second plan replaces the week", await seen(page.getByRole("heading", { name: "This week" }), 10000));
        await page.waitForTimeout(400);
        if (await dinners.count()) { await dinners.first().tap(); await page.waitForTimeout(400); cooked = await page.getByRole("button", { name: /^Add to the list/ }).isVisible(); }
      }
      await page.waitForTimeout(400);
      if (!cooked) ok("meals: a dinner's recipe opens (skipped: no dinner with a recipe)", true);
      else {
      ok("meals: a dinner's recipe opens, and says it's this week's", await page.getByText("One of this week's dinners.", { exact: false }).isVisible());
      await settingsHere("a recipe from Meals");
      const nav = page.getByRole("navigation", { name: "Main" });
      ok("meals: Meals stays lit under the recipe", (await nav.getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
      await page.screenshot({ path: `${dir}/3-recipe-from-week.png` });
      await page.locator("header").getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("meals: back goes to Meals", await page.getByRole("heading", { name: "Meals" }).isVisible());
      await nav.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("meals: the tab starts fresh", await page.getByRole("heading", { name: "Meals" }).isVisible());
      }

      // Add a meal (Nov 9, "Search and pick"), and a recipe's "Add to this week". Turkey chili is the sample's only regular
      // dinner: take it off first, so it can be added back from its page and then from Add a meal.
      const tabs = page.getByRole("navigation", { name: "Main" });
      const takeChiliOff = async () => {
        await tabs.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(800);
        const off = page.getByRole("button", { name: "Take Turkey chili off this week" });
        if (await off.count()) {
          await off.first().tap(); await page.waitForTimeout(300);
          await page.getByRole("dialog", { name: "Take it off" }).getByRole("button", { name: "Take it off" }).tap(); await page.waitForTimeout(1000);
        }
      };
      const chiliPlanned = () => page.locator("section").filter({ has: page.getByRole("heading", { name: "Regular", exact: true }) }).getByRole("button", { name: /^Turkey chili/ });
      await takeChiliOff();
      // The recipe's page: not planned, so "Add to this week" leads and "Just add to the list" is the quieter one.
      await tabs.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(600);
      await page.getByRole("button", { name: /^Turkey chili/ }).first().tap(); await page.waitForTimeout(500);
      const toWeek = page.getByRole("button", { name: "Add to this week" });
      ok("recipe: not planned, it offers Add to this week and Just add to the list", (await toWeek.isVisible()) && (await page.getByRole("button", { name: "Just add to the list" }).isVisible()));
      await page.screenshot({ path: `${dir}/8a-recipe-add-to-week.png` });
      await toWeek.tap();
      ok("recipe: Add to this week says so, naming it", await seen(page.getByText(/^Added Turkey chili\./), 8000));
      ok("recipe: and then it's planned (Add to the list again)", await seen(page.getByRole("button", { name: "Add to the list again" }), 3000) && (await toWeek.count()) === 0);
      await page.locator("header").getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(300);
      await tabs.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(800);
      ok("recipe: it's on Meals under Regular", (await chiliPlanned().count()) === 1);
      // Add a meal: suggestions first, every recipe with its kind, a planned one shown as This week and not addable.
      await takeChiliOff();
      await page.getByRole("button", { name: /^Add a meal/ }).tap(); await page.waitForTimeout(500);
      const addSheet = page.getByRole("dialog", { name: "Add a meal" });
      const box = addSheet.getByLabel("Find a recipe");
      ok("add a meal: one sheet with a search box, not focused", (await addSheet.isVisible()) && (await box.isVisible()) && !(await box.evaluate((el) => el === document.activeElement)));
      ok("add a meal: Suggested first, with the regular dinner, name only", (await addSheet.getByText("Suggested", { exact: true }).isVisible()) && (await addSheet.locator("section").first().getByRole("button", { name: /^Turkey chili$/ }).count()) === 1);
      ok("add a meal: then the recipes under their kinds, names only", (await addSheet.getByRole("heading", { name: "Quick", exact: true }).isVisible()) && (await addSheet.locator("section").filter({ has: page.getByRole("heading", { name: "Quick", exact: true }) }).getByRole("button", { name: /^Tacos/ }).count()) >= 1);
      const thisWeek = addSheet.getByRole("button", { name: /This week$/ });
      ok("add a meal: a planned recipe shows This week and can't be added", (await thisWeek.count()) > 0 && (await thisWeek.first().isDisabled()));
      await page.screenshot({ path: `${dir}/8b-add-a-meal.png` });
      await page.setViewportSize({ width: 320, height: 640 }); await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/8c-add-a-meal-320.png` });
      ok("add a meal: fits 320 wide", (await addSheet.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 0);
      await box.fill("chili"); await page.waitForTimeout(300);
      ok("add a meal: typing finds recipes, and offers no words-only meal", (await addSheet.getByRole("button", { name: /^Turkey chili/ }).count()) === 1 && (await addSheet.getByText(/^Add “/).count()) === 0);
      await page.screenshot({ path: `${dir}/8d-add-a-meal-search-320.png` });
      await page.setViewportSize({ width, height }); await page.waitForTimeout(300);
      await addSheet.getByRole("button", { name: /^Turkey chili/ }).tap();
      ok("add a meal: picking one closes the sheet and the note names it", await seen(page.getByText(/^Added Turkey chili\. (\d+ things? went on the list|Its groceries were already on the list)\./), 8000) && (await addSheet.count()) === 0);
      ok("add a meal: it's under its own kind (Regular)", (await chiliPlanned().count()) === 1);
      await page.getByRole("button", { name: /^Add a meal/ }).tap(); await page.waitForTimeout(500);
      ok("add a meal: now it shows This week", await addSheet.getByRole("button", { name: /^Turkey chili.*This week$/ }).first().isDisabled());
      await addSheet.getByLabel("Find a recipe").fill("Dinner at Grandma's"); await page.waitForTimeout(200);
      ok("add a meal: no match offers Add a recipe, and adds nothing", await addSheet.getByText("No recipe called “Dinner at Grandma's” yet").isVisible());
      await addSheet.getByRole("button", { name: /^Add a recipe/ }).tap(); await page.waitForTimeout(500);
      ok("add a meal: Add a recipe goes to Recipes with Add recipes open", (await page.getByRole("dialog", { name: "Add recipes" }).count()) === 1 && (await addSheet.count()) === 0);
      await page.getByRole("dialog", { name: "Add recipes" }).getByRole("button", { name: "Close" }).last().tap(); await page.waitForTimeout(300);
      await page.locator("nav button", { hasText: "Meals" }).tap(); await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/8e-meals-after-add.png`, fullPage: true });
    }

    // Settings: the look only (adding recipes lives on the Recipes tab, Nov 9).
    await page.getByRole("button", { name: "Settings" }).tap(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/4-settings-${tag}.png` });
    await page.getByRole("radio", { name: /^Apricot/ }).tap(); await page.waitForTimeout(200);
    ok(`${tag}: theme switches`, (await page.evaluate(() => document.documentElement.dataset.theme)) === "apricot");
    await page.getByRole("radio", { name: /^Simmer$/ }).tap();
    ok(`${tag}: no Add recipes in Settings`, (await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: /^Add recipes/ }).count()) === 0);
    ok(`${tag}: sheets have a close button`, await page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Close" }).last().isVisible());
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);

    // Stock: what the house keeps, assumed in. A tap means out: it goes on its store's list; a second tap takes it back off.
    const tabBar = page.getByRole("navigation", { name: "Main" });
    await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
    await settingsHere("Stock");
    ok(`${tag}: Stock has the add field and the legend`, (await page.getByLabel("Add something to Stock").isVisible()) && (await page.getByText("In meals").isVisible()));
    await page.screenshot({ path: `${dir}/5-stock-${tag}.png`, fullPage: true });
    const milk = page.getByRole("checkbox", { name: "Have Milk" });
    if ((await milk.getAttribute("aria-checked")) === "false") { await milk.tap(); await page.waitForTimeout(1200); }
    await milk.tap(); await page.waitForTimeout(1500);
    ok(`${tag}: a tap marks it out`, (await milk.getAttribute("aria-checked")) === "false");
    // Every week: a thing that comes back on its list after each shop. Eggs: out, ticked off on the Safeway checklist, Done shopping, and it is back.
    const eggs = page.getByRole("checkbox", { name: "Have Eggs" });
    if ((await eggs.getAttribute("aria-checked")) === "false") { await eggs.tap(); await page.waitForTimeout(1200); }
    if (!(await eggs.getByText("Every week", { exact: true }).count())) { await page.getByLabel("More for Eggs").selectOption("weekly"); await page.waitForTimeout(1200); }
    ok(`${tag}: ⋯ → Every week shows under the name`, await seen(eggs.getByText("Every week", { exact: true }), 3000));
    await eggs.tap(); await page.waitForTimeout(1500);
    await page.getByLabel("Add something to Stock").fill(`frozen waffles ${tag}`); await page.keyboard.press("Enter");
    ok(`${tag}: Stock add`, await seen(page.getByRole("checkbox", { name: new RegExp(`Have frozen waffles ${tag}`, "i") })));

    // Lists: All, Safeway, Trader Joe's, Costco. What's out in Stock is on its store's list.
    await tabBar.getByRole("button", { name: "Lists" }).tap(); await page.waitForTimeout(800);
    await settingsHere("Lists");
    ok(`${tag}: Lists has the store switch and the add field`, (await page.getByRole("radio", { name: "All" }).isVisible()) && (await page.getByLabel("Add something").isVisible()));
    ok(`${tag}: what's out in Stock is on the list`, await seen(page.getByRole("checkbox", { name: /Milk/ })));
    const tj = (await page.getByRole("radio", { name: "Trader Joe's" }).boundingBox());
    ok(`${tag}: the store names stay on one line`, Boolean(tj) && tj.height < 44, JSON.stringify(tj));
    await page.screenshot({ path: `${dir}/5a-lists-all-${tag}.png`, fullPage: true });
    await page.getByRole("checkbox", { name: /Milk/ }).first().tap(); await page.waitForTimeout(800);
    ok(`${tag}: ticking shows Done shopping`, await seen(page.getByRole("button", { name: "Done shopping" })));
    await page.getByRole("radio", { name: "Safeway" }).tap(); await page.waitForTimeout(800);
    ok(`${tag}: Safeway says when it isn't connected`, await seen(page.getByText(/Can't reach Safeway right now/), 10000));
    ok(`${tag}: Safeway shows the top line (a checklist while it can't be reached)`, await seen(page.getByText(/in the cart| got$/)));
    await page.screenshot({ path: `${dir}/5b-lists-safeway-${tag}.png` });
    // In the store: no helper, so Safeway is a checklist like the others. Done shopping asks first; Cancel leaves it; Eggs (Every week) comes straight back.
    await page.getByRole("checkbox", { name: /Milk/ }).first().tap(); await page.waitForTimeout(600); // Milk was ticked in All: untick, so only Eggs is done
    await page.getByRole("checkbox", { name: /Eggs/ }).first().tap(); await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Done shopping" }).tap(); await page.waitForTimeout(400);
    ok(`${tag}: Done shopping asks first`, await seen(page.getByRole("dialog", { name: "Done shopping" }).getByText(/Done at Safeway/)));
    await page.getByRole("button", { name: "Cancel" }).tap(); await page.waitForTimeout(400);
    ok(`${tag}: Cancel leaves the ticks`, (await page.getByRole("checkbox", { name: /Eggs/ }).first().getAttribute("aria-checked")) === "true");
    await page.getByRole("button", { name: "Done shopping" }).tap(); await page.waitForTimeout(300);
    await page.getByRole("dialog", { name: "Done shopping" }).getByRole("button", { name: "Done shopping" }).tap(); await page.waitForTimeout(1500);
    ok(`${tag}: an Every week thing is back on the list, not ticked, as one row`, (await page.getByRole("checkbox", { name: /Eggs/ }).count()) === 1 && (await page.getByRole("checkbox", { name: /Eggs/ }).first().getAttribute("aria-checked")) === "false");
    await page.getByRole("radio", { name: "All" }).tap(); await page.waitForTimeout(500);
    await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
    await page.getByRole("checkbox", { name: "Have Milk" }).tap(); await page.waitForTimeout(1500);
    ok(`${tag}: a second tap in Stock takes it back off`, (await page.getByRole("checkbox", { name: "Have Milk" }).getAttribute("aria-checked")) === "true");
    if ((await eggs.getAttribute("aria-checked")) === "false") { await eggs.tap(); await page.waitForTimeout(1200); } // tidy up: Eggs in, and not every week
    await page.getByLabel("More for Eggs").selectOption("weekly"); await page.waitForTimeout(1200);
    ok(`${tag}: ⋯ → Not every week stops it`, (await eggs.getByText("Every week", { exact: true }).count()) === 0);

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
    ok(`${tag}: spices and the pantry are only highlighted in Stock, not offered`, (await chiliSheet.getByText(/cumin|chili powder/i).count()) === 0 && await chiliSheet.getByText("The pantry things are highlighted in Stock.").isVisible());
    if (tag.startsWith("phone")) await page.screenshot({ path: `${dir}/6c-add-to-list-${tag}.png` });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await page.locator("header").getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(400);
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
      await edit.getByRole("button", { name: "Save", exact: true }).tap(); await page.waitForTimeout(800);
      ok("edit: a failed save keeps the sheet and what was typed", (await edit.isVisible()) && (await edit.getByPlaceholder("Double the spice for Sam").inputValue()) === "A note that must survive");
      ok("edit: and says what went wrong inside it", await seen(edit.getByRole("alert").filter({ hasText: "No connection" })));
      ok("edit: and the save button works again", await edit.getByRole("button", { name: "Save", exact: true }).isEnabled());
      await page.unroute("**/api/recipes");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Add to the list" }).tap(); await page.waitForTimeout(400);
      const toList = page.getByRole("dialog", { name: "Add to the list" });
      const ticked = await toList.getByRole("checkbox", { checked: true }).count();
      await page.route("**/api/list", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      await toList.getByRole("button", { name: /^Add \d+ to the list/ }).tap(); await page.waitForTimeout(800);
      ok("add to list: a failed add keeps the sheet and its ticks", (await toList.isVisible()) && (await toList.getByRole("checkbox", { checked: true }).count()) === ticked);
      ok("add to list: and says what went wrong inside it", await seen(toList.getByRole("alert").filter({ hasText: "No connection" })));
      await page.unroute("**/api/list");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    }
    await page.getByRole("button", { name: "Add to the list" }).tap(); await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^Add \d+ to the list/ }).tap(); await page.waitForTimeout(800);
    if (await page.getByRole("button", { name: "Done", exact: true }).isVisible()) { await page.getByRole("button", { name: "Done", exact: true }).tap(); await page.waitForTimeout(400); } // a note about the pantry things may keep the sheet up
    await page.locator("header").getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(300);
    ok(`${tag}: back to Recipes`, await page.getByRole("heading", { name: "Recipes" }).isVisible());
    await page.screenshot({ path: `${dir}/6b-recipes-${tag}.png` });
    await nav.getByRole("button", { name: "Lists" }).tap(); await page.waitForTimeout(500);
    ok(`${tag}: the recipe's ingredients are on the list`, await seen(page.getByText(/ground beef/i)));

    // The passcode changes while the app is open, with a sheet up: back to the passcode screen, nothing left open.
    await page.evaluate(() => localStorage.setItem("sm.passcode", JSON.stringify("changed")));
    await page.getByRole("radio", { name: "Costco" }).tap(); await page.waitForTimeout(300);
    await page.getByLabel("Add something").fill("paper towels"); await page.keyboard.press("Enter");
    ok(`${tag}: a turned-down passcode asks again`, await seen(page.getByLabel("Household passcode"), 8000));
    ok(`${tag}: and closes what was open`, (await page.getByRole("dialog").count()) === 0);
    await page.screenshot({ path: `${dir}/7-signed-out-${tag}.png` });

    ok(`${tag}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    ok(`${tag}: no console errors`, !errors.length, errors.join(" | "));
    await ctx.close();
  }
  await b.close();
  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
})().catch((e) => { console.error(e); console.log(results.join("\n")); process.exit(1); });
