/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test at iPhone size, light and dark: passcode, tabs, settings, search. Saves screenshots to .data/shots.
// Run against a local server started with HOUSEHOLD_PASSCODE=test123: npm run build && HOUSEHOLD_PASSCODE=test123 npm start, then node scripts/smoke.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const dir = ".data/shots";
fs.mkdirSync(dir, { recursive: true });
const results = [];
const ok = (n, c, x = "") => results.push(`${c ? "PASS" : "FAIL"} ${n}${x ? " — " + x : ""}`);
(async () => {
  const b = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: scheme, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    await page.goto(process.env.URL || "http://localhost:3000/");
    await page.getByLabel("Household passcode").fill("nope"); await page.getByRole("button", { name: "Get started" }).tap();
    ok(`${scheme}: wrong passcode message`, await page.getByText("That passcode didn't work").waitFor({ timeout: 5000 }).then(() => true, () => false));
    await page.screenshot({ path: `${dir}/1-pass-${scheme}.png` });
    await page.getByLabel("Household passcode").fill("test123"); await page.getByRole("button", { name: "Get started" }).tap();
    ok(`${scheme}: reaches This week`, await page.getByRole("heading", { name: "This week" }).waitFor({ timeout: 8000 }).then(() => true, () => false));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${dir}/2-week-${scheme}.png` });
    if (scheme === "light") {
      // Plan the week: the nights, the trips, the dinners, the lunches, then save.
      // On a weekend the main button plans next week; on a weekday, this week.
      await page.getByRole("button", { name: /^Plan (the|next) week/ }).first().tap(); await page.waitForTimeout(500);
      await page.screenshot({ path: `${dir}/2a-nights.png` });
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(400);
      ok("plan: dinners suggested", await page.getByRole("heading", { name: "Dinners" }).isVisible() && (await page.getByText("Nothing fits this night").count()) < 7);
      await page.screenshot({ path: `${dir}/2b-dinners.png`, fullPage: true });
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300);
      ok("plan: lunches for each boy", (await page.getByText("Felix", { exact: true }).count()) >= 4);
      await page.screenshot({ path: `${dir}/2c-lunches.png` });
      await page.getByRole("button", { name: "Save the week" }).tap();
      ok("plan: saved, and the list told", await page.getByText(/to the grocery list/).waitFor({ timeout: 10000 }).then(() => true, () => false));
      ok("plan: the week shows", await page.getByRole("heading", { name: /^(The|Next) week$/ }).first().isVisible());
      await page.screenshot({ path: `${dir}/2d-week.png`, fullPage: true });
    }
    await page.getByRole("button", { name: "Settings" }).tap(); await page.waitForTimeout(400); await page.screenshot({ path: `${dir}/3-settings-${scheme}.png` });
    await page.getByRole("radio", { name: /^Sage/ }).tap(); await page.waitForTimeout(200);
    ok(`${scheme}: theme switches`, (await page.evaluate(() => document.documentElement.dataset.theme)) === "sage");
    await page.getByRole("radio", { name: /^Simmer$/ }).tap();
    await page.mouse.click(195, 30); await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Groceries" }).tap(); await page.waitForTimeout(800); await page.screenshot({ path: `${dir}/4-groceries-${scheme}.png`, fullPage: true });
    ok(`${scheme}: the plan's pantry things to check`, await page.getByRole("heading", { name: "Check you have these" }).isVisible());
    if (scheme === "light") {
      await page.getByRole("button", { name: "More for ground beef" }).tap(); await page.waitForTimeout(400);
      await page.getByRole("button", { name: /^Swap the meal/ }).tap(); await page.waitForTimeout(600);
      ok("didn't get it: opens the night", await page.getByRole("heading", { name: /^Monday: Tacos/ }).isVisible());
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Groceries" }).tap(); await page.waitForTimeout(600);
    }
    await page.getByRole("button", { name: /^Freezer/ }).tap(); await page.waitForTimeout(400);
    await page.getByLabel("Add to the freezer").fill(`2 shrimp ${scheme}`); await page.keyboard.press("Enter");
    ok(`${scheme}: freezer add`, await page.getByText(`shrimp ${scheme}`).first().waitFor({ timeout: 5000 }).then(() => true, () => false));
    await page.screenshot({ path: `${dir}/4b-freezer-${scheme}.png` });
    await page.getByRole("button", { name: /Use one/ }).first().tap(); await page.waitForTimeout(600);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Search", exact: true }).tap(); await page.waitForTimeout(500);
    await page.keyboard.type("Tacos"); await page.keyboard.press("Enter"); await page.waitForTimeout(300); await page.screenshot({ path: `${dir}/5-search-${scheme}.png` });
    ok(`${scheme}: search finds the recipe`, await page.getByText("1 found").isVisible());
    await page.getByRole("button", { name: /^Tacos/ }).tap(); await page.waitForTimeout(300);
    ok(`${scheme}: recipe screen`, await page.getByRole("heading", { name: "Tacos" }).isVisible() && await page.getByRole("radio", { name: "Quick" }).isVisible());
    await page.screenshot({ path: `${dir}/6-recipe-${scheme}.png`, fullPage: true });
    await page.getByRole("button", { name: "Add to the list" }).tap(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/7-tolist-${scheme}.png` });
    await page.getByRole("button", { name: /^Add \d+ to the list/ }).tap(); await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Recipes" }).first().tap(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Add recipes" }).first().tap(); await page.waitForTimeout(400);
    // A photo: read by the model on the server (here, without a model, it should fail gently, not break).
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await page.locator('input[accept="image/*"]').setInputFiles({ name: "card.png", mimeType: "image/png", buffer: png });
    ok(`${scheme}: a photo is sent and answered`, await page.getByText(/Found|Try again|didn't load|busy|Couldn't find/).first().waitFor({ timeout: 30000 }).then(() => true, () => false));
    await page.screenshot({ path: `${dir}/8a-photo-${scheme}.png` });
    await page.getByRole("button", { name: /^Type it in/ }).tap(); await page.waitForTimeout(200);
    await page.keyboard.type(`Pizza night ${scheme}\nChicken soup ${scheme}\nBreakfast for dinner ${scheme}`);
    await page.getByRole("button", { name: "Read it" }).tap();
    ok(`${scheme}: a list of ideas is found`, await page.getByText("Found 3").waitFor({ timeout: 30000 }).then(() => true, () => false));
    await page.screenshot({ path: `${dir}/8-ideas-${scheme}.png` });
    await page.getByRole("button", { name: "Save 3" }).tap();
    ok(`${scheme}: ideas saved`, await page.getByText(`Pizza night ${scheme}`).waitFor({ timeout: 8000 }).then(() => true, () => false));
    await page.screenshot({ path: `${dir}/9-collection-${scheme}.png`, fullPage: true });
    await page.getByRole("button", { name: "Back to Groceries" }).tap(); await page.waitForTimeout(300);
    ok(`${scheme}: back from search to the last tab`, await page.getByRole("heading", { name: "Groceries" }).isVisible());
    ok(`${scheme}: the recipe's ingredients are on the list`, await page.getByText(/ground beef/i).first().waitFor({ timeout: 5000 }).then(() => true, () => false));
    ok(`${scheme}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    ok(`${scheme}: no console errors`, !errors.length, errors.join(" | "));
    await ctx.close();
  }
  await b.close();
  console.log(results.join("\n"));
})().catch((e) => { console.error(e); console.log(results.join("\n")); process.exit(1); });
