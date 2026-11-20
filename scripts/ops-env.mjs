// Shared by scripts/errors.mjs and scripts/restore.mjs: reads a pulled env file (vercel env pull <file> --environment=production), deletes it at
// once, and talks to the Redis database through its REST address. Never prints a secret.
import { readFileSync, rmSync } from "node:fs";

/** The Redis address, token and key prefix from the env file, which is deleted as soon as it's read. */
export function fromEnvFile(path) {
  if (!path) { console.error("Give the path of a pulled env file (vercel env pull <file> --environment=production)."); process.exit(2); }
  let text;
  try { text = readFileSync(path, "utf8"); } finally { try { rmSync(path, { force: true }); } catch { /* already gone */ } }
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) { console.error("That env file has no Redis address and token."); process.exit(2); }
  const ns = process.env.SIMMER_DATA_PREFIX || env.SIMMER_DATA_PREFIX || "simmer";
  /** One Redis command, e.g. redis("LRANGE", key, 0, -1). */
  const redis = async (...cmd) => {
    const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(cmd.map(String)) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) throw new Error(`Redis said ${r.status}${body.error ? ": " + body.error : ""}`);
    return body.result;
  };
  return { redis, ns };
}
