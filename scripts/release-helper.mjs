// Fills extension/ with the released helper: extension-working/ as it is on origin/main, never the files being edited.
// extension/ is what Chrome loads on the Safeway computer, and git ignores it, so switching branches never touches it.
// Run after a helper change ships: node scripts/release-helper.mjs (then press reload on Simmer in chrome://extensions).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const git = (...args) => execFileSync("git", args, { cwd: root });
git("fetch", "-q", "origin");
const tmp = mkdtempSync(path.join(tmpdir(), "simmer-helper-"));
try {
  const tar = git("archive", "origin/main", "extension-working");
  execFileSync("tar", ["-x", "-C", tmp], { input: tar });
  const out = path.join(root, "extension");
  // Replace what's inside, keeping the folder itself, so Chrome's loaded copy stays the same folder.
  if (!existsSync(out)) mkdirSync(out);
  for (const f of readdirSync(out)) rmSync(path.join(out, f), { recursive: true, force: true });
  cpSync(path.join(tmp, "extension-working"), out, { recursive: true });
  const { version } = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
  console.log(`extension/ now holds the released helper, ${version}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
