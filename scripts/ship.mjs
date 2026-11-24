// Ships the current branch (Nov 23: the merge loop every round redid by hand), each step printed with its time:
//   node scripts/ship.mjs --title "What it does" --body /path/to/body.md
// 1. pushes the branch (never forced) and opens its pull request if it has none (the title and body are needed then;
//    the body must end with the Claude Code line);
// 2. waits for GitHub's "check" to pass on the pushed commit: it waits for the check to appear (no checks reported
//    yet is never done), and stops on a failure;
// 3. merges with a merge commit (no squash, no admin override), then checks out main and pulls it (fast-forward only);
// 4. waits for Vercel's production deployment of that commit to be Ready;
// 5. if the helper's version in extension-working/ differs from extension/'s, runs scripts/release-helper.mjs.
// A CI script, so it waits by asking again every few seconds, with a limit for each wait.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
const began = Date.now();
const secs = (ms) => `${(ms / 1000).toFixed(0)} s`;
const run = (cmd, args, { quiet = false } = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed${r.stderr ? `: ${r.stderr.trim()}` : ""}`);
  return r.stdout.trim();
};
const tryRun = (cmd, args) => { try { return run(cmd, args, { quiet: true }); } catch { return null; } };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function step(name, fn) {
  const t = Date.now();
  process.stdout.write(`▸ ${name}\n`);
  const said = await fn();
  console.log(`  ${said ? `${said} ` : ""}(${secs(Date.now() - t)}, ${secs(Date.now() - began)} in all)`);
}
/** Asks `look` every `every` ms until it answers something other than undefined, or gives up after `limit` ms. */
async function waitFor(what, look, { every = 10_000, limit = 30 * 60_000 } = {}) {
  const end = Date.now() + limit;
  let last = "";
  for (;;) {
    const r = await look((note) => { if (note !== last) { console.log(`  … ${note}`); last = note; } });
    if (r !== undefined) return r;
    if (Date.now() > end) throw new Error(`Gave up waiting for ${what} after ${secs(limit)}.`);
    await pause(every);
  }
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const title = opt("--title"), bodyFile = opt("--body");

try {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "main" || branch === "HEAD") throw new Error("Run this on the branch to ship, not main.");
  if (run("git", ["status", "--porcelain", "--untracked-files=no"])) throw new Error("There are changes not committed; commit them first.");
  const sha = run("git", ["rev-parse", "HEAD"]);
  let pr;

  await step(`Push ${branch}`, () => { run("git", ["push", "-u", "origin", branch], { quiet: true }); return sha.slice(0, 7); });

  await step("Pull request", () => {
    const found = tryRun("gh", ["pr", "view", branch, "--json", "number,url,state"]);
    const open = found && JSON.parse(found);
    if (open && open.state === "OPEN") { pr = open; return `#${pr.number} already open: ${pr.url}`; }
    if (!title || !bodyFile) throw new Error("No open pull request for this branch: give --title and --body <file> to open one.");
    if (!existsSync(bodyFile)) throw new Error(`No body file at ${bodyFile}.`);
    if (!readFileSync(bodyFile, "utf8").trimEnd().endsWith(FOOTER)) throw new Error(`The body must end with: ${FOOTER}`);
    const url = run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body-file", bodyFile], { quiet: true }).split("\n").pop();
    pr = JSON.parse(run("gh", ["pr", "view", url, "--json", "number,url,state"], { quiet: true }));
    return `#${pr.number} opened: ${pr.url}`;
  });

  await step(`Check on ${sha.slice(0, 7)}`, () => waitFor("the check", (note) => {
    const raw = tryRun("gh", ["api", `repos/{owner}/{repo}/commits/${sha}/check-runs?check_name=check`]);
    const runs = raw ? JSON.parse(raw).check_runs ?? [] : [];
    // The newest run of "check" for this very commit; none yet means it hasn't started, never that it's done.
    const latest = runs.sort((a, b) => Date.parse(b.started_at ?? 0) - Date.parse(a.started_at ?? 0))[0];
    if (!latest) { note("no check reported yet"); return undefined; }
    if (latest.status !== "completed") { note(`check ${latest.status.replace("_", " ")}`); return undefined; }
    if (latest.conclusion === "success") return `passed: ${latest.html_url}`;
    throw new Error(`The check ended ${latest.conclusion}: ${latest.html_url}`);
  }));

  await step(`Merge #${pr.number}`, () => {
    // --match-head-commit: merges only the commit that was checked, never one pushed meanwhile.
    run("gh", ["pr", "merge", String(pr.number), "--merge", "--match-head-commit", sha], { quiet: true });
    run("git", ["checkout", "-q", "main"], { quiet: true });
    run("git", ["pull", "-q", "--ff-only"], { quiet: true });
    return `main is at ${run("git", ["rev-parse", "--short", "HEAD"])}`;
  });

  const merged = run("git", ["rev-parse", "HEAD"]);
  await step("Vercel production", () => waitFor("Vercel", (note) => {
    const raw = tryRun("vercel", ["ls", "simmer", "--environment", "production", "--json"]);
    const all = raw ? JSON.parse(raw).deployments ?? [] : [];
    const mine = all.filter((d) => d.meta?.githubCommitSha === merged).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!mine) { note(`no production deployment of ${merged.slice(0, 7)} yet`); return undefined; }
    if (mine.state === "READY") return `Ready: ${mine.url}`;
    if (mine.state === "ERROR" || mine.state === "CANCELED") throw new Error(`The deployment ended ${mine.state}: ${mine.url}`);
    note(mine.state.toLowerCase());
    return undefined;
  }, { every: 5_000, limit: 15 * 60_000 }));

  await step("Helper", () => {
    const version = (dir) => { try { return JSON.parse(readFileSync(`${ROOT}${dir}/manifest.json`, "utf8")).version; } catch { return ""; } };
    const working = version("extension-working"), released = version("extension");
    if (working === released) return `unchanged (${released})`;
    execFileSync("node", ["scripts/release-helper.mjs"], { cwd: ROOT, stdio: "inherit" });
    return `released ${working} (was ${released || "none"}); press reload on Simmer in chrome://extensions`;
  });
  console.log(`Shipped in ${secs(Date.now() - began)}.`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
