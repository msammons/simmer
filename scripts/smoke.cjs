/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test at iPhone size (light and dark) and iPad size: passcode, planning, the tabs, Settings on every
// screen, the List tab, Shop's store picker and Find / Cart, the Recipes tab, a recipe and back, the freezer, saves that fail (the sheet keeps what was entered), and a passcode turned down mid-use. Saves screenshots to .data/shots.
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
      // Plan the week: page through and save (the number of pages depends on the day).
      await page.getByRole("button", { name: /^(Plan this week|Change)$/ }).first().tap(); await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(400);
      ok("plan: dinners suggested", await page.getByRole("heading", { name: "Dinners" }).isVisible());
      await page.screenshot({ path: `${dir}/2-dinners.png` });
      if (await page.getByRole("button", { name: "Next", exact: true }).isVisible()) { await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300); }
      // A save that fails (the connection drops): the sheet stays with everything planned, says so inside it, and saves on a retry.
      const planSheet = page.getByRole("dialog").last();
      const planned = await planSheet.innerText();
      await page.route("**/api/plan", (r) => (r.request().method() === "POST" ? r.abort() : r.fallback()));
      await page.getByRole("button", { name: "Save the week" }).tap(); await page.waitForTimeout(800);
      ok("plan: a failed save keeps the sheet open", await planSheet.isVisible());
      ok("plan: and says what went wrong inside it", await seen(planSheet.getByRole("alert").filter({ hasText: "No connection. Check your signal and try again." })));
      ok("plan: and keeps what was planned", (await planSheet.innerText()).includes(planned.split("\n").slice(0, 12).join("\n")));
      ok("plan: and the save button works again", await page.getByRole("button", { name: "Save the week" }).isEnabled());
      ok("plan: and nothing shows on the screen behind", (await page.getByText("No connection. Check your signal and try again.").count()) === 1);
      await page.screenshot({ path: `${dir}/2-plan-failed-save.png` });
      if (process.env.FAILED_SHOT) await page.screenshot({ path: process.env.FAILED_SHOT });
      await page.unroute("**/api/plan");
      await page.getByRole("button", { name: "Save the week" }).tap();
      ok("plan: saved, and the week shows", await seen(page.getByRole("heading", { name: "This week" }), 10000));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/2-week-planned.png`, fullPage: true });
      // A night with a recipe: Cook opens it on top of This week; Back says where it goes and goes there.
      const nights = page.locator("section").filter({ has: page.getByRole("heading", { name: "This week" }) }).first().getByRole("button").filter({ hasNotText: /^Change$/ });
      let cooked = false;
      for (let i = 0; i < (await nights.count()) && !cooked; i++) {
        await nights.nth(i).tap(); await page.waitForTimeout(300);
        if (await page.getByRole("button", { name: /^Cook/ }).isVisible()) { await page.getByRole("button", { name: /^Cook/ }).tap(); cooked = true; }
        else { await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
      }
      await page.waitForTimeout(400);
      // The planned nights depend on the day and the sample recipes; on a day none has a recipe to cook, say so and move on.
      if (!cooked) ok("week: a night's recipe opens (skipped: no night with a recipe today)", true);
      else {
      ok("week: a night's recipe opens", await page.getByRole("radio", { name: "Quick" }).isVisible());
      await settingsHere("a recipe from Meals");
      const nav = page.getByRole("navigation", { name: "Main" });
      ok("week: Meals stays lit under the recipe", (await nav.getByRole("button", { name: "Meals" }).getAttribute("aria-current")) === "page");
      await page.screenshot({ path: `${dir}/3-recipe-from-week.png` });
      await page.locator("header").getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("week: back goes to Meals", await page.getByRole("heading", { name: "Meals" }).isVisible());
      await page.getByRole("button", { name: /^Cook|Tonight/ }).first().waitFor({ timeout: 300 }).catch(() => {});
      await nav.getByRole("button", { name: "Meals" }).tap(); await page.waitForTimeout(400);
      ok("week: the tab starts fresh", await page.getByRole("heading", { name: "Meals" }).isVisible());
      }
    }

    if (tag === "phone-light") {
      // Weeks ahead: next week, then the one after, each planned the same way, and the one after that offered.
      for (const [button, heading] of [["Plan next week", "Next week"], [/^Plan the week of /, null]]) {
        const plan = page.getByRole("button", { name: button }).first();
        ok(`weeks ahead: "${button}" offered`, await seen(plan, 8000));
        await plan.tap(); await page.waitForTimeout(500);
        for (let k = 0; k < 3 && await page.getByRole("button", { name: "Next", exact: true }).isVisible(); k++) { await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300); }
        await page.getByRole("button", { name: "Save the week" }).tap(); await page.waitForTimeout(1500);
        if (heading) ok(`weeks ahead: ${heading} shows`, await seen(page.getByRole("heading", { name: heading }), 8000));
      }
      ok("weeks ahead: a week further out is offered next", await seen(page.getByRole("button", { name: /^Plan the week of / }), 8000));
      ok("weeks ahead: three weeks show", (await page.getByRole("button", { name: /^Change$/ }).count()) === 3);
      await page.screenshot({ path: `${dir}/2-weeks-ahead.png`, fullPage: true });
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

    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "List" }).tap(); await page.waitForTimeout(800);
    await settingsHere("List");
    ok(`${tag}: List has the add field`, await page.getByLabel("Add to the list").isVisible());
    await page.screenshot({ path: `${dir}/5-list-${tag}.png`, fullPage: true });
    if (!(await page.getByRole("button", { name: /^More for / }).count())) { await page.getByLabel("Add to the list").fill("eggs"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500); }
    const findAll = page.getByRole("button", { name: "Find at Safeway" });
    const findBox = (await findAll.count()) ? await findAll.boundingBox() : null;
    ok(`${tag}: Find at Safeway is a small button beside Running low`, Boolean(findBox) && findBox.height <= 44 && findBox.width < width / 2, JSON.stringify(findBox));
    // Shop: Find and Cart for one store. With no Safeway helper running, Find says so plainly (and quickly); the cart is empty.
    if (!(await page.getByRole("button", { name: /^More for / }).count())) { await page.getByLabel("Add to the list").fill("eggs"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500); }
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Shop" }).tap(); await page.waitForTimeout(800);
    await settingsHere("Shop");
    ok(`${tag}: Shop opens on Find`, (await page.getByRole("radio", { name: "Find" }).getAttribute("aria-checked")) === "true");
    ok(`${tag}: Find says when the computer isn't answering`, await seen(page.getByText(/It's not answering right now/), 10000));
    await page.screenshot({ path: `${dir}/5b-shop-find-${tag}.png` });
    // The store picker: Safeway, the one online store for now, ticked in its sheet.
    await page.getByRole("button", { name: /Shopping at Safeway/ }).tap();
    ok(`${tag}: the store picker lists Safeway, ticked`, await seen(page.getByRole("radio", { name: "Safeway", checked: true })));
    await page.screenshot({ path: `${dir}/5b-shop-store-${tag}.png` });
    await page.getByRole("radio", { name: "Safeway" }).tap(); await page.waitForTimeout(300);
    ok(`${tag}: the switch stays at the top`, (await page.getByRole("radio", { name: "Find" }).boundingBox()).y < 140);
    await page.getByRole("radio", { name: /^Cart/ }).tap(); await page.waitForTimeout(500);
    ok(`${tag}: an empty cart says so`, await seen(page.getByText("The cart is empty")));
    await page.screenshot({ path: `${dir}/5c-shop-cart-${tag}.png` });
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "List" }).tap(); await page.waitForTimeout(600);
    // A Safeway item on the list opens Shop's Find on it.
    const swItem = page.getByRole("button", { name: /^(Ground turkey|Eggs)/ }).first();
    if (await swItem.count()) {
      const what = ((await swItem.innerText()).split("\n")[0] || "").trim();
      await swItem.tap(); await page.waitForTimeout(600);
      ok(`${tag}: a Safeway item opens Find on it`, await seen(page.getByRole("heading", { name: what })));
      await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "List" }).tap(); await page.waitForTimeout(600);
    }
    await page.getByRole("button", { name: /^Freezer/ }).tap(); await page.waitForTimeout(400);
    await page.getByLabel("Add to the freezer").fill(`2 shrimp ${tag}`); await page.keyboard.press("Enter");
    ok(`${tag}: freezer add`, await seen(page.getByText(`shrimp ${tag}`)));
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    const more = page.getByRole("button", { name: /^More for / }).first();
    if (await more.count()) {
      await more.tap(); await page.waitForTimeout(400);
      ok(`${tag}: an item's options open`, await page.getByRole("heading", { name: "Get it at" }).isVisible());
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    }

    // The Recipes tab, a recipe, and back.
    const nav = page.getByRole("navigation", { name: "Main" });
    ok(`${tag}: four tabs (Meals, Recipes, List, Shop), no search`, (await nav.getByRole("button").allInnerTexts()).join() === "Meals,Recipes,List,Shop" && (await page.getByRole("search").count()) === 0);
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
    await nav.getByRole("button", { name: "List" }).tap(); await page.waitForTimeout(500);
    ok(`${tag}: the recipe's ingredients are on the list`, await seen(page.getByText(/ground beef/i)));

    // The passcode changes while the app is open, with a sheet up: back to the passcode screen, nothing left open.
    await page.evaluate(() => localStorage.setItem("sm.passcode", JSON.stringify("changed")));
    await page.getByRole("button", { name: /^Running low/ }).tap(); await page.waitForTimeout(300);
    await page.getByRole("dialog").getByRole("button", { name: /Add$/ }).first().tap().catch(() => {});
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
