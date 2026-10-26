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
    ok(`${scheme}: reaches This week`, await page.getByText("Nothing planned yet").waitFor({ timeout: 8000 }).then(() => true, () => false));
    ok(`${scheme}: names from the Profile`, await page.getByText(/Matt, Marcela, Felix & Nico/).isVisible());
    await page.screenshot({ path: `${dir}/2-week-${scheme}.png` });
    await page.getByRole("button", { name: "Settings" }).tap(); await page.waitForTimeout(400); await page.screenshot({ path: `${dir}/3-settings-${scheme}.png` });
    await page.getByRole("radio", { name: /^Sage/ }).tap(); await page.waitForTimeout(200);
    ok(`${scheme}: theme switches`, (await page.evaluate(() => document.documentElement.dataset.theme)) === "sage");
    await page.getByRole("radio", { name: /^Simmer$/ }).tap();
    await page.mouse.click(195, 30); await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Groceries" }).tap(); await page.waitForTimeout(300); await page.screenshot({ path: `${dir}/4-groceries-${scheme}.png` });
    await page.getByRole("button", { name: "Search", exact: true }).tap(); await page.waitForTimeout(500);
    await page.keyboard.type("Tacos"); await page.keyboard.press("Enter"); await page.waitForTimeout(300); await page.screenshot({ path: `${dir}/5-search-${scheme}.png` });
    ok(`${scheme}: search remembered`, await page.getByRole("heading", { name: "Recent" }).isVisible());
    await page.getByRole("button", { name: "Back to Groceries" }).tap(); await page.waitForTimeout(300);
    ok(`${scheme}: back from search to the last tab`, await page.getByRole("heading", { name: "Groceries" }).isVisible());
    ok(`${scheme}: no sideways scroll`, (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    ok(`${scheme}: no console errors`, !errors.length, errors.join(" | "));
    await ctx.close();
  }
  await b.close();
  console.log(results.join("\n"));
})().catch((e) => { console.error(e); console.log(results.join("\n")); process.exit(1); });
