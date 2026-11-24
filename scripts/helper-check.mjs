// Every check for a helper change, in one command (Nov 23, Sam: "be efficient with tests. And intelligent."):
//   npm run helper-check            (SKIP_BUILD=1 to use the last build of Simmer)
// 1. the helper's decisions, fast (src/helper/helper.test.mjs: the helper's own files on a fake clock, about a second);
// 2. page.js on saved copies of Safeway's real pages (scripts/real-pages-test.mjs; skipped without safeway/);
// 3. the trimmed end-to-end run with a real Chrome and Simmer (scripts/extension-test.mjs).
// Simmer is built once, while 1 and 2 run. Each stage runs once and stops the rest on a failure: a check that passes only
// on a second try is a bug to fix, not to run again. Prints how long each stage took.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

// Playwright comes from outside the project (NODE_PATH), as for the other browser checks.
const env = { ...process.env };
try { createRequire(path.resolve("package.json")).resolve("playwright"); } catch {
  const guess = path.join(os.homedir(), "Projects/mazer/node_modules");
  if (!env.NODE_PATH && existsSync(path.join(guess, "playwright"))) env.NODE_PATH = guess;
}
const sh = (cmd, args, extra = {}, quiet = false) => new Promise((ok) => {
  const p = spawn(cmd, args, { env: { ...env, ...extra }, stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit" });
  p.on("exit", (code) => ok(code ?? 1));
});
const secs = (t) => `${((Date.now() - t) / 1000).toFixed(1)} s`;
const times = [];
const stage = async (name, run) => {
  const t = Date.now();
  console.log(`\n== ${name}`);
  const code = await run();
  times.push(`${name}: ${secs(t)}${code ? " (failed)" : ""}`);
  if (code) { console.log(`\n${times.join("\n")}\n\n${name} failed.`); process.exit(1); }
};

// Simmer's build starts now, behind the first two stages (the end-to-end run uses it).
const tBuild = Date.now();
const build = process.env.SKIP_BUILD ? Promise.resolve(0)
  : sh("npx", ["next", "build"], { HOUSEHOLD_PASSCODE: "test123", GOOGLE_SERVICE_ACCOUNT_JSON: "", GEMINI_API_KEY: "" }, true).then((c) => { times.push(`build (alongside): ${secs(tBuild)}${c ? " (failed)" : ""}`); return c; });

await stage("fast checks (src/helper)", () => sh("npx", ["vitest", "run", "src/helper"]));
await stage("real pages", () => sh("node", ["scripts/real-pages-test.mjs"]));
await stage("waiting for the build", () => build);
await stage("end to end", () => sh("node", ["scripts/extension-test.mjs"], { SKIP_BUILD: "1" }));
console.log(`\n${times.join("\n")}\ntotal: ${secs(tBuild)}\n\nAll passed.`);
