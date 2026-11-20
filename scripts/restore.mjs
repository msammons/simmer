// Puts a backup's tabs back (src/lib/ops/backup.ts). Never runs by itself. The env file comes from Vercel (production's
// Redis keys); pull a fresh one for every run, since it's deleted as soon as it's read:
//   vercel env pull /tmp/simmer.env --environment=production && node scripts/restore.mjs /tmp/simmer.env          lists the backups
//   vercel env pull /tmp/simmer.env --environment=production && node scripts/restore.mjs /tmp/simmer.env latest   shows what would change
//   vercel env pull /tmp/simmer.env --environment=production && node scripts/restore.mjs /tmp/simmer.env <time> --apply   writes it back
// Without --apply nothing is written. With it, every tab in the backup is written whole and its version counted up, all
// in one step in Redis (one EVAL), so a change being worked out at the same moment starts again from the restored rows
// instead of writing over them, and no one ever sees half a restore. Tabs that aren't in the backup (ordering's
// Checkout tabs are never in one) are left as they are. Nothing secret is printed.
import { pathToFileURL } from "node:url";

/** KEYS: each tab's rows key, then each tab's version key; ARGV: each tab's rows. Answers how many were put back. */
export const RESTORE = `local n = math.floor(#KEYS / 2)
for i = 1, n do
  redis.call("SET", KEYS[i], ARGV[i])
  redis.call("INCR", KEYS[n + i])
end
return n`;

const TIME = 24; // "2026-11-19T00:00:00.000Z"

/** The backups' times, oldest first, from the keys under the prefix (each backup's keys start with its time). */
export function backupTimes(keys, prefix) {
  return [...new Set(keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length, prefix.length + TIME)))]
    .filter((t) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(t)).sort();
}

/** What a restore would do, as lines to print: each tab's rows in the backup and now, and the tabs left alone. */
export function describe(time, backup, now, allNow) {
  const tabs = Object.keys(backup.tabs).sort();
  const lines = [`Backup ${time}: ${tabs.length} tabs.`];
  for (const t of tabs) {
    const was = now[t] ?? null, same = JSON.stringify(was) === JSON.stringify(backup.tabs[t]);
    lines.push(`  ${t}: ${backup.tabs[t].length} rows${same ? " (unchanged)" : ` (now ${was == null ? "missing" : was.length + " rows"})`}`);
  }
  for (const s of backup.skipped ?? []) lines.push(`  ${s.tab}: not in this backup (too big to keep, ${s.bytes} bytes)`);
  const extra = allNow.filter((t) => !(t in backup.tabs)).sort();
  if (extra.length) lines.push(`Left as they are (not in the backup): ${extra.join(", ")}`);
  return lines;
}

/** The one EVAL that puts every tab of the backup back, with each tab's version counted up. */
export function restoreCommand(ns, backup) {
  const tabs = Object.keys(backup.tabs).sort();
  return ["EVAL", RESTORE, tabs.length * 2, ...tabs.map((t) => `${ns}:tab:${t}`), ...tabs.map((t) => `${ns}:tabv:${t}`), ...tabs.map((t) => JSON.stringify(backup.tabs[t]))];
}

/** A backup's tabs and what was left out of it, read from its index and one key per tab. */
export async function readBackup(redis, prefix, time) {
  const index = JSON.parse((await redis("GET", `${prefix}${time}`)) ?? "null");
  if (!index || !Array.isArray(index.tabs)) return null; // no index: never finished
  const rows = index.tabs.length ? await redis("MGET", ...index.tabs.map((t) => `${prefix}${time}:${t}`)) : [];
  if (rows.some((r) => r == null)) return null; // a tab's key is gone: not whole
  return { tabs: Object.fromEntries(index.tabs.map((t, i) => [t, JSON.parse(rows[i])])), skipped: index.skipped ?? [] };
}

/** Runs the steps: list the backups, show what one would change, and (only with apply) put it back. Answers the lines printed. */
export async function run(redis, ns, which, apply) {
  const prefix = `${ns}:backup:`;
  const times = backupTimes((await redis("KEYS", `${prefix}*`)) ?? [], prefix);
  if (!which) {
    return [times.length ? "Backups (oldest first):\n" + times.map((t) => "  " + t).join("\n") : "No backups yet.", "", "Add a backup's time (or latest) to see what it would put back."];
  }
  const time = which === "latest" ? times.at(-1) : which;
  if (!time || !times.includes(time)) throw new Error(`No backup ${which}.`);
  const backup = await readBackup(redis, prefix, time);
  if (!backup) throw new Error(`Backup ${time} isn't whole; pick another.`);
  const tabs = Object.keys(backup.tabs);
  const got = tabs.length ? await redis("MGET", ...tabs.map((t) => `${ns}:tab:${t}`)) : [];
  const now = Object.fromEntries(tabs.map((t, i) => [t, got[i] == null ? null : JSON.parse(got[i])]));
  const allNow = ((await redis("KEYS", `${ns}:tab:*`)) ?? []).map((k) => k.slice(`${ns}:tab:`.length));
  const lines = describe(time, backup, now, allNow);
  if (!apply) return [...lines, "", "Nothing written. Add --apply to put these back."];
  const n = await redis(...restoreCommand(ns, backup));
  return [...lines, "", `Put back ${n} tabs.`];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { fromEnvFile } = await import("./ops-env.mjs");
  const args = process.argv.slice(2);
  const [file, which] = args.filter((a) => a !== "--apply");
  const { redis, ns } = fromEnvFile(file);
  try {
    console.log((await run(redis, ns, which, args.includes("--apply"))).join("\n"));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
