// Renders public/icon.svg to the PNG icons iOS and Android use, and the Chrome helper's (extension-working/icon.png). Run after changing the SVG: node scripts/make-icons.mjs
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

// Playwright is not a project dependency: use whichever copy is installed on this machine.
const { chromium } = createRequire(import.meta.url)("playwright");

const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512], ["extension-working/icon.png", 128]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: new URL(name.includes("/") ? `../${name}` : `../public/${name}`, import.meta.url).pathname, omitBackground: false });
}
await browser.close();
