// The helper's checkout fingerprint (Nov 18, Sam: "if we make frequent updates you could need a test run all the
// time"): a hash of the helper (every .js, .html and manifest.json in extension-working/) and of the page details and
// settings Simmer sends it (src/lib/safeway-helper.mjs), with the parts marked not-checkout left out, so a test run is
// needed when anything checkout runs or shares changes, and not for a search or cart-button fix. Written to
// src/lib/checkout-print.json, which a test keeps in step: node scripts/checkout-print.mjs
//
// A marked part is whole lines from a line that is only `// not-checkout:start …` to one that is only
// `// not-checkout:end`. Anything else (nested, unclosed, or the words anywhere else) stops with an error, and
// src/lib/checkout-print.test.ts pins what each part may hold, so a part can't grow over code checkout runs.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "extension-working");
const MARK = /^[ \t]*\/\/ not-checkout:(start|end)(?:\s.*)?$/;

/** A file's text split into what counts and its marked parts; throws on anything but clean, unnested markers. */
export function split(text, name = "file") {
  const kept = [], parts = [];
  let part = null;
  text.split("\n").forEach((line, i) => {
    const m = MARK.exec(line);
    if (!m && line.includes("not-checkout:")) throw new Error(`${name}:${i + 1}: "not-checkout:" outside a marker line`);
    if (m?.[1] === "start") { if (part) throw new Error(`${name}:${i + 1}: a marked part inside another`); part = []; return; }
    if (m?.[1] === "end") { if (!part) throw new Error(`${name}:${i + 1}: an end with no start`); parts.push(part.join("\n")); part = null; return; }
    (part ?? kept).push(line);
  });
  if (part) throw new Error(`${name}: a marked part with no end`);
  return { kept: kept.join("\n"), parts };
}

/**
 * The manifest without its version (Sam, Nov 19: "I don't want constant test runs"): a new helper version alone doesn't
 * need a test run; its permissions, scripts and everything else still count.
 */
export const withoutVersion = (text) => { const m = JSON.parse(text); delete m.version; return JSON.stringify(m, null, 2); };

/** The files the fingerprint covers, by name, with their text. */
export function covered() {
  const read = (f) => { const t = readFileSync(path.join(dir, f), "utf8"); return f === "manifest.json" ? withoutVersion(t) : t; };
  const files = readdirSync(dir).filter((f) => /\.(js|html)$/.test(f) || f === "manifest.json").sort().map((f) => [`extension-working/${f}`, read(f)]);
  return [...files, ["src/lib/safeway-helper.mjs", readFileSync(path.join(root, "src/lib/safeway-helper.mjs"), "utf8")]];
}

export function checkoutPrint() {
  const h = createHash("sha256");
  for (const [name, text] of covered()) h.update(`${name}\n${split(text, name).kept}\n`);
  return h.digest("hex").slice(0, 16);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const print = checkoutPrint();
  writeFileSync(path.join(root, "src/lib/checkout-print.json"), `${JSON.stringify({ print }, null, 2)}\n`);
  console.log(`checkout fingerprint ${print}`);
}
