// The helper's checkout fingerprint (Nov 18, Sam: "if we make frequent updates you could need a test run all the
// time"): a hash of every helper file with the parts marked not-checkout left out, so a test run is needed when the
// code checkout runs changes, and not for a search or cart-button fix. Written to src/lib/checkout-print.json, which a
// test keeps in step: node scripts/checkout-print.mjs
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "extension-working");

/** The fingerprint of the helper as it is in extension-working/. Only .js and .html count; marked parts drop out. */
export function checkoutPrint() {
  const h = createHash("sha256");
  for (const f of readdirSync(dir).filter((f) => /\.(js|html)$/.test(f)).sort()) {
    const text = readFileSync(path.join(dir, f), "utf8").replace(/[ \t]*\/\/ not-checkout:start[^\n]*\n[\s\S]*?[ \t]*\/\/ not-checkout:end[^\n]*\n/g, "");
    h.update(`${f}\n${text}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const print = checkoutPrint();
  writeFileSync(path.join(root, "src/lib/checkout-print.json"), `${JSON.stringify({ print }, null, 2)}\n`);
  console.log(`checkout fingerprint ${print}`);
}
