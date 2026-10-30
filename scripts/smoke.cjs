/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, run with node */
// Browser smoke test at iPhone size (light and dark) and iPad size: passcode, planning, the tabs, Settings on every
// screen, a recipe and back, the freezer, and a passcode turned down mid-use. Saves screenshots to .data/shots.
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
    ok(`${tag}: reaches This week`, await seen(page.getByRole("heading", { name: "This week" }), 8000));
    await page.waitForTimeout(800);
    await settingsHere("This week");
    const sub = await page.locator("header p").first().textContent().catch(() => "");
    ok(`${tag}: the week reads as its start date`, /^[A-Z][a-z]{2} \d{1,2}$/.test(sub ?? ""), sub ?? "");
    await page.screenshot({ path: `${dir}/1-week-${tag}.png` });

    if (tag === "phone-light") {
      // Plan the week: page through and save (the number of pages depends on the day).
      await page.getByRole("button", { name: /^(Plan (the|next) week|Change the plan)/ }).first().tap(); await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(400);
      ok("plan: dinners suggested", await page.getByRole("heading", { name: "Dinners" }).isVisible());
      await page.screenshot({ path: `${dir}/2-dinners.png` });
      if (await page.getByRole("button", { name: "Next", exact: true }).isVisible()) { await page.getByRole("button", { name: "Next", exact: true }).tap(); await page.waitForTimeout(300); }
      await page.getByRole("button", { name: "Save the week" }).tap();
      ok("plan: saved, and the week shows", await seen(page.getByRole("heading", { name: /^(The|Next) week$/ }), 10000));
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/2-week-planned.png`, fullPage: true });
      // A night with a recipe: Cook opens it on top of This week; Back says where it goes and goes there.
      const nights = page.locator("section").filter({ has: page.getByRole("heading", { name: /^(The|Next) week$/ }) }).first().getByRole("button");
      let cooked = false;
      for (let i = 0; i < (await nights.count()) && !cooked; i++) {
        await nights.nth(i).tap(); await page.waitForTimeout(300);
        if (await page.getByRole("button", { name: /^Cook/ }).isVisible()) { await page.getByRole("button", { name: /^Cook/ }).tap(); cooked = true; }
        else { await page.keyboard.press("Escape"); await page.waitForTimeout(200); }
      }
      await page.waitForTimeout(400);
      ok("week: a night's recipe opens", cooked && (await page.getByRole("radio", { name: "Quick" }).isVisible()));
      await settingsHere("a recipe from This week");
      const nav = page.getByRole("navigation", { name: "Main" });
      ok("week: This week stays lit under the recipe", (await nav.getByRole("button", { name: "This week" }).getAttribute("aria-current")) === "page");
      await page.screenshot({ path: `${dir}/3-recipe-from-week.png` });
      await page.locator("header").getByRole("button", { name: "This week" }).tap(); await page.waitForTimeout(400);
      ok("week: back goes to This week", await page.getByRole("heading", { name: "This week" }).isVisible());
      await page.getByRole("button", { name: /^Cook|Tonight/ }).first().waitFor({ timeout: 300 }).catch(() => {});
      await nav.getByRole("button", { name: "This week" }).tap(); await page.waitForTimeout(400);
      ok("week: the tab starts fresh", await page.getByRole("heading", { name: "This week" }).isVisible());
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

    await page.getByRole("button", { name: "Groceries" }).tap(); await page.waitForTimeout(800);
    await settingsHere("Groceries");
    await page.screenshot({ path: `${dir}/5-groceries-${tag}.png`, fullPage: true });
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

    // Search, a recipe, and back to the results.
    await page.getByRole("button", { name: "Search", exact: true }).tap(); await page.waitForTimeout(500);
    await settingsHere("Recipes");
    ok(`${tag}: no plus button at the top of Recipes`, (await page.locator("header, .sticky").getByRole("button", { name: "Add recipes" }).count()) === 0);
    await page.keyboard.type("Tacos"); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
    ok(`${tag}: search finds the recipe`, await page.getByText("1 found").isVisible());
    await page.getByRole("button", { name: /^Tacos/ }).tap(); await page.waitForTimeout(300);
    ok(`${tag}: recipe screen`, (await page.getByRole("heading", { name: "Tacos" }).isVisible()) && (await page.getByRole("radio", { name: "Quick" }).isVisible()));
    await settingsHere("a recipe");
    await page.screenshot({ path: `${dir}/6-recipe-${tag}.png`, fullPage: true });
    await page.getByRole("button", { name: "Add to the list" }).tap(); await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^Add \d+ to the list/ }).tap(); await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Recipes" }).first().tap(); await page.waitForTimeout(300);
    ok(`${tag}: back to the results`, (await page.getByRole("heading", { name: "Recipes" }).isVisible()) && (await page.getByText("1 found").isVisible()));
    await page.getByRole("button", { name: "Back to Groceries" }).tap(); await page.waitForTimeout(500);
    ok(`${tag}: back from search to the last tab`, await page.getByRole("heading", { name: "Groceries" }).isVisible());
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
