// The newest unexpected server errors (src/lib/ops/errors.ts), oldest first.
//   vercel env pull /tmp/simmer.env --environment=production && node scripts/errors.mjs /tmp/simmer.env [how many, default 30]
// (production's Redis keys). The env file is deleted as soon as it's read, so pull a fresh one each time; nothing secret
// is printed.
import { fromEnvFile } from "./ops-env.mjs";

const { redis, ns } = fromEnvFile(process.argv[2]);
const n = Math.max(1, Math.min(200, Number(process.argv[3]) || 30));
const rows = await redis("LRANGE", `${ns}:errors`, -n, -1);
if (!rows?.length) console.log("No errors recorded.");
for (const raw of rows ?? []) {
  try {
    const e = JSON.parse(raw);
    console.log([e.at, e.method, e.route, e.where && `(${e.where})`, "—", e.message, e.digest && `[${e.digest}]`].filter(Boolean).join(" "));
  } catch { console.log(raw); }
}
