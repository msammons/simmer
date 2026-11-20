// The tab store without Redis (Nov 19): local dev, tests, and the smoke and helper checks, which run `next start` with no
// Redis keys. The same transactions as in production run against it; each tab starts as its sample in data/ (the tab's
// name in lower case, spaces as dashes: "Plan counts" → data/plan-counts.csv), read the first time the tab is.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "../parse";
import { CAS, PREFIX, type TabStore } from "./tabs";

export const sampleFile = (tab: string) => path.join(process.cwd(), "data", `${tab.toLowerCase().replace(/ /g, "-")}.csv`);

export function memoryStore(): TabStore & { reset(tabs?: string[]): void } {
  const data = new Map<string, string>();
  const seeded = new Map<string, Promise<void>>();
  // A tab's sample, read once and only if nothing has written the tab first.
  const seed = (k: string) => {
    if (!k.startsWith(PREFIX)) return;
    if (!seeded.has(k)) seeded.set(k, readFile(sampleFile(k.slice(PREFIX.length)), "utf8").then(parseCsv, () => []).then((rows) => {
      if (rows.length && !data.has(k)) data.set(k, JSON.stringify(rows));
    }));
    return seeded.get(k);
  };
  const ready = (ks: string[]) => Promise.all(ks.map(seed));
  return {
    get: async (k) => { await ready([k]); return data.get(k) ?? null; },
    set: async (k, v) => { data.set(k, v); return "OK"; },
    mget: async (...ks) => { await ready(ks); return ks.map((k) => data.get(k) ?? null); },
    keys: async (pattern) => { const pre = pattern.replace(/\*$/, ""); return [...data.keys()].filter((k) => k.startsWith(pre)); },
    // CAS in one step, as Redis runs it: nothing else can run between the check and the write.
    eval: async (script, keys, args) => {
      if (script !== CAS) throw new Error("Only CAS runs in memory.");
      const n = keys.length / 2;
      for (let i = 0; i < n; i++) if (args[i] !== "!" && (data.get(keys[2 * i + 1]) ?? "") !== args[i]) return 0;
      for (let i = 0; i < n; i++) {
        if (args[n + i] === "!") continue;
        data.set(keys[2 * i], args[n + i]);
        data.set(keys[2 * i + 1], String(Number(data.get(keys[2 * i + 1]) ?? 0) + 1));
      }
      return 1;
    },
    /** For tests: these tabs (or all) back to their samples. */
    reset: (tabs) => {
      for (const k of [...data.keys(), ...seeded.keys()]) {
        const tab = k.startsWith(PREFIX) ? k.slice(PREFIX.length) : k.replace(/^[^:]+:tabv:/, "");
        if (!tabs || tabs.includes(tab)) { data.delete(k); seeded.delete(k); }
      }
    },
  };
}
