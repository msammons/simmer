/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test at iPhone size (light and dark) and iPad size: passcode, planning by number, the tabs, Settings on every
// screen, Stock, Lists (All and Safeway), the Recipes tab, a recipe and back, the freezer, saves that fail (the sheet keeps what was entered), and a passcode turned down mid-use. Saves screenshots to .data/shots.
// Works on any day of the week, with the sample data (no .env.local). Run against a server started with
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
      // Plan by number (Nov 3): the counts, then the picks, then the lunches, and save.
      await page.getByRole("button", { name: "Plan", exact: true }).first().tap(); await page.waitForTimeout(500);
      ok("plan: asks how many", await page.getByRole("heading", { name: "How many" }).isVisible());
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(400);
      ok("plan: dinners picked", await page.getByRole("heading", { name: "Dinners" }).isVisible());
      await page.screenshot({ path: `${dir}/2-dinners.png` });
      if (await page.getByRole("button", { name: "Next", exact: true }).isVisible()) { await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300); }
      // A save that fails (the connection drops): the sheet stays with everything planned, says so inside it, and saves on a retry.
      const planSheet = page.getByRole("dialog").last();
      const planned = await planSheet.innerText();
      await page.route("**/api/plan", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      await page.getByRole("button", { name: "Save", exact: true }).tap(); await page.waitForTimeout(800);
      ok("plan: a failed save keeps the sheet open", await planSheet.isVisible());
      ok("plan: and says what went wrong inside it", await seen(planSheet.getByRole("alert").filter({ hasText: "No connection. Check your signal and try again." })));
      ok("plan: and keeps what was planned", (await planSheet.innerText()).includes(planned.split("\n").slice(0, 12).join("\n")));
      ok("plan: and the save button works again", await page.getByRole("button", { name: "Save", exact: true }).isEnabled());
      ok("plan: and nothing shows on the screen behind", (await page.getByText("No connection. Check your signal and try again.").count()) === 1);
      await page.screenshot({ path: `${dir}/2-plan-failed-save.png` });
      if (process.env.FAILED_SHOT) await page.screenshot({ path: process.env.FAILED_SHOT });
      await page.unroute("**/api/plan");
      await page.getByRole("button", { name: "Save", exact: true }).tap();
      ok("plan: saved, and the dinners show", await seen(page.getByRole("heading", { name: "Dinners to make" }), 10000));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/2-week-planned.png`, fullPage: true });
      // A dinner: Cook opens it on top of Meals; Back says where it goes and goes there.
      const dinners = page.locator("section").filter({ has: page.getByRole("heading", { name: /^(Quick|Regular)$/ }) }).getByRole("button");
      let cooked = false;
      if (await dinners.count()) {
        await dinners.first().tap(); await page.waitForTimeout(300);
        if (await page.getByRole("button", { name: /^Cook/ }).isVisible()) { await page.getByRole("button", { name: /^Cook/ }).tap(); cooked = true; }
        else { await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
      }
      await page.waitForTimeout(400);
      if (!cooked) ok("meals: a dinner's recipe opens (skipped: no dinner with a recipe)", true);
      else {
      ok("meals: a dinner's recipe opens", await page.getByRole("radio", { name: "Quick" }).isVisible());
      await settingsHere("a recipe from Meals");
      const nav = page.getByRole("navigation", { name: "Main" });
      ok("meals: Meals stays lit under the recipe", (await nav.getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
      await page.screenshot({ path: `${dir}/3-recipe-from-week.png` });
      await page.locator("header").getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("meals: back goes to Meals", await page.getByRole("heading", { name: "Meals" }).isVisible());
      await nav.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("meals: the tab starts fresh", await page.getByRole("heading", { name: "Meals" }).isVisible());
      }
    }

    // Settings: the look, and adding recipes from there.
    await page.getByRole("button", { name: "Settings" }).tap(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/4-settings-${tag}.png` });
    await page.getByRole("radio", { name: /^Apricot/ }).tap(); await page.waitForTimeout(200);
    ok(`${tag}: theme switches`, (await page.evaluate(() => document.documentElement.dataset.theme)) === "apricot");
    await page.getByRole("radio", { name: /^Simmer$/ }).tap();
    await page.getByRole("button", { name: /^Add recipes/ }).tap(); await page.waitForTimeout(400);
    ok(`${tag}: Add recipes from Settings`, await page.getByRole("dialog", { name: "Add recipes" }).isVisible());
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
    ok(`${tag}: Safeway says when it isn't connected`, await seen(page.getByText(/isn't connected right now/), 10000));
    ok(`${tag}: Safeway shows the cart line`, await seen(page.getByText(/in the cart/)));
    await page.screenshot({ path: `${dir}/5b-lists-safeway-${tag}.png` });
    await page.getByRole("radio", { name: "All" }).tap(); await page.waitForTimeout(500);
    await page.getByRole("checkbox", { name: /Milk/ }).first().tap(); await page.waitForTimeout(800);
    await tabBar.getByRole("button", { name: "Stock" }).tap(); await page.waitForTimeout(800);
    await page.getByRole("checkbox", { name: "Have Milk" }).tap(); await page.waitForTimeout(1500);
    ok(`${tag}: a second tap in Stock takes it back off`, (await page.getByRole("checkbox", { name: "Have Milk" }).getAttribute("aria-checked")) === "true");

    // The Recipes tab, a recipe, and back.
    const nav = page.getByRole("navigation", { name: "Main" });
    ok(`${tag}: four tabs (Recipes, Meals, Stock, Lists), no search`, (await nav.getByRole("button").allInnerTexts()).join() === "Recipes,Meals,Stock,Lists" && (await page.getByRole("search").count()) === 0);
    await nav.getByRole("button", { name: "Recipes" }).tap(); await page.waitForTimeout(500);
    await settingsHere("Recipes");
    ok(`${tag}: Recipes lit`, (await nav.getByRole("button", { name: "Recipes" }).getAttribute("aria-current")) === "page");
    ok(`${tag}: no plus button at the top of Recipes`, (await page.locator("header, .sticky").getByRole("button", { name: "Add recipes" }).count()) === 0);
    // A recipe's ingredients onto the list straight from its row: the same sheet, spices unticked below the things to buy.
    const chiliRow = page.getByRole("button", { name: "Add Turkey chili to the list" }).first();
    for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await chiliRow.isVisible()) break; await all.tap(); await page.waitForTimeout(200); }
    ok(`${tag}: each recipe row has an add-to-list button`, await chiliRow.isVisible());
    if (tag.startsWith("phone")) await page.screenshot({ path: `${dir}/6a-recipes-overview-${tag}.png` });
    await chiliRow.tap(); await page.waitForTimeout(400);
    const chiliSheet = page.getByRole("dialog", { name: "Add to the list" });
    ok(`${tag}: it opens the add-to-list sheet for that recipe`, (await chiliSheet.isVisible()) && (await chiliSheet.getByRole("heading", { name: "Turkey chili" }).isVisible()));
    const cumin = chiliSheet.getByRole("checkbox", { name: "1 tsp cumin" }), turkey = chiliSheet.getByRole("checkbox", { name: "1 lb ground turkey" });
    ok(`${tag}: spices start unticked`, (await cumin.getAttribute("aria-checked")) === "false" && (await chiliSheet.getByRole("checkbox", { name: "2 tbsp chili powder" }).getAttribute("aria-checked")) === "false");
    ok(`${tag}: and sit below the things to buy, under Spices`, (await turkey.getAttribute("aria-checked")) === "true" && (await cumin.boundingBox()).y > (await turkey.boundingBox()).y && await chiliSheet.getByText("Spices", { exact: true }).isVisible());
    if (tag.startsWith("phone")) await page.screenshot({ path: `${dir}/6c-add-to-list-${tag}.png` });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    const tacos = page.getByRole("button", { name: /^Tacos/ }).first();
    for (const all of await page.getByRole("button", { name: /^All \d+/ }).all()) { if (await tacos.isVisible()) break; await all.tap(); await page.waitForTimeout(200); }
    await tacos.tap(); await page.waitForTimeout(300);
    ok(`${tag}: recipe screen`, (await page.getByRole("heading", { name: "Tacos" }).isVisible()) && (await page.getByRole("radio", { name: "Quick" }).isVisible()));
    const addBtn = await page.getByRole("button", { name: "Add to the list" }).boundingBox();
    ok(`${tag}: Add to the list at the top of the recipe, without scrolling`, Boolean(addBtn) && addBtn.y + addBtn.height < height - 100 && addBtn.y < (await page.getByRole("radio", { name: "Quick" }).boundingBox()).y);
    await settingsHere("a recipe");
    await page.screenshot({ path: `${dir}/6-recipe-${tag}.png`, fullPage: true });
    if (tag === "phone-light") {
      // Editing a recipe, and adding it to the list, when the save fails: the sheet stays with what was typed or ticked.
      await page.getByRole("button", { name: "Edit", exact: true }).tap(); await page.waitForTimeout(400);
      const edit = page.getByRole("dialog", { name: "Edit Tacos" });
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
