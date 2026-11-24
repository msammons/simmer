// scripts/helper-status.mjs read against what jobs.ts really keeps (the in-memory store standing in for Redis), so the
// report keeps up with the keys and shapes it reads.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kv, resetKv } from "./kv";
import { finishJob, queueJob, resetJobs, takeJob } from "./jobs";
import { report } from "../../scripts/helper-status.mjs";

/** Redis's commands the report sends, answered from the in-memory store. */
const redis = async (cmd, ...a) => {
  const s = kv();
  if (cmd === "GET") return s.get(a[0]);
  if (cmd === "MGET") return s.mget(...a);
  if (cmd === "ZRANGE") return s.zrange(a[0], Number(a[1]), Number(a[2]));
  if (cmd === "LRANGE") return s.lrange(a[0], Number(a[1]), Number(a[2]));
  throw new Error(`The report only reads (sent ${cmd}).`);
};

describe("helper status", () => {
  beforeEach(() => { resetJobs(); resetKv(); });

  it("shows the check-in, open jobs, the last jobs, how long they take, and the test run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
      const a = await queueJob("search", { query: "milk" });
      await takeJob("26.11.23.5", true);
      vi.setSystemTime(Date.now() + 4_000);
      await finishJob(a.id, true, { products: [{ id: "1", name: "Some Milk", price: "$3", image: "", inCart: false, qty: 0 }], signedIn: true });
      const b = await queueJob("checkoutPrepare", {});
      await takeJob("26.11.23.5", true);
      vi.setSystemTime(Date.now() + 10_000);
      await finishJob(b.id, true, { stopped: "signed out", chosen: null, final: null });
      const c = await queueJob("setQty", { productId: "1", qty: 2 });
      await takeJob("26.11.23.5", true);
      vi.setSystemTime(Date.now() + 2_000);
      await finishJob(c.id, false, { error: "signed-out" });
      await queueJob("cart", {});
      await kv().set("simmer:checkout-dry-passed", JSON.stringify(["abc"]), { ex: 60 });
      const text = (await report(redis, "simmer", { now: Date.now(), print: "abc", ships: "26.11.23.6" })).join("\n");
      expect(text).toContain("version 26.11.23.5 (Simmer ships 26.11.23.6)");
      expect(text).toContain("panel open");
      expect(text).toMatch(/Open jobs \(1\)\n {2}\S+ {2}cart/);
      expect(text).toMatch(/checkoutPrepare +done +10\.0 s {2}stopped signed out/);
      expect(text).toMatch(/search +done +4\.0 s {2}"milk", signed in, 1 products/);
      expect(text).not.toContain("Some Milk");
      expect(text).toMatch(/cart +waiting\n/); // not finished: no time yet
      expect(text).toMatch(/setQty +1 jobs, median 2\.0 s, max 2\.0 s; failed: signed-out ×1/);
      expect(text).toMatch(/search +1 jobs, median 4\.0 s, max 4\.0 s\n/);
      expect(text).toMatch(/checkoutPrepare +1 jobs, median 10\.0 s, max 10\.0 s\n/); // a stop is a report, not a failure
      expect(text).toContain("this checkout (abc) has passed a test run");
    } finally { vi.useRealTimers(); }
  });
});
