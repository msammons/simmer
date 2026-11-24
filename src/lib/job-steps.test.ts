// Where the helper is in a job (Nov 23, Sam: "some sort of status message saying what the app is doing as it goes"): the
// steps it reports kept on the job, the wait that answers at each new step, the route that takes them, and how long each
// step took, kept with the job's time.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => { void fn(); } }));

import { kv, resetKv } from "./kv";
import { resetLockout } from "./ops/lockout";
import { finishJob, jobStatus, noteStep, queueJob, resetJobs, STEPS_KEPT, stepSeconds, takeJob, waitForJob } from "./jobs";
import * as route from "@/app/api/safeway/jobs/route";

const post = (b: unknown) => new Request("http://x/api/safeway/jobs", { method: "POST", body: JSON.stringify(b), headers: { "x-passcode": "right-one", "x-real-ip": "1.2.3.4", "content-type": "application/json" } });
const get = (q: string) => new Request(`http://x/api/safeway/jobs?${q}`, { headers: { "x-passcode": "right-one", "x-real-ip": "1.2.3.4" } });

beforeEach(() => { process.env.HOUSEHOLD_PASSCODE = "right-one"; resetJobs(); resetKv(); resetLockout(); });

describe("a job's steps", () => {
  it("keeps the latest step and the list in order, even when reports arrive out of order; never touches status or updated", async () => {
    const j = await queueJob("cart", {});
    const taken = (await takeJob("1.0.0", false))!;
    const t = Date.now();
    expect(await noteStep(j.id, "cart", t)).toBe(true);
    expect(await noteStep(j.id, "pickup", t + 2000)).toBe(true);
    expect(await noteStep(j.id, "wait", t + 1000)).toBe(true); // sent before pickup, arrived after
    expect(await noteStep(j.id, "wait", t + 1000)).toBe(false); // the same report twice counts once
    const now = (await jobStatus(j.id))!;
    expect(now).toMatchObject({ status: "working", step: "pickup", stepAt: new Date(t + 2000).toISOString(), updated: taken.updated });
    expect(now.steps!.map((s) => s.step)).toEqual(["cart", "wait", "pickup"]);
  });

  it("keeps the newest STEPS_KEPT, and takes nothing odd, nothing for a job not being done", async () => {
    const j = await queueJob("cart", {});
    expect(await noteStep(j.id, "cart", Date.now())).toBe(false); // still waiting: nobody's doing it
    await takeJob("1.0.0", false);
    for (let i = 0; i < STEPS_KEPT + 5; i++) await noteStep(j.id, i % 2 ? "wait" : "cart", Date.now() + i);
    expect((await jobStatus(j.id))!.steps).toHaveLength(STEPS_KEPT);
    expect(await noteStep(j.id, "Not A Step!", Date.now())).toBe(false);
    expect(await noteStep("../x", "cart", Date.now())).toBe(false);
    // A clock far off is taken as Simmer's.
    await noteStep(j.id, "read", 0);
    expect(Math.abs(Date.parse((await jobStatus(j.id))!.stepAt!) - Date.now())).toBeLessThan(5000);
    await finishJob(j.id, true, { products: [], signedIn: true });
    expect(await noteStep(j.id, "late", Date.now())).toBe(false);
  });

  it("the wait answers as soon as the step changes, and at once when the asker's step is behind", async () => {
    const j = await queueJob("cart", {});
    await takeJob("1.0.0", false);
    const t0 = Date.now();
    setTimeout(() => void noteStep(j.id, "cart", Date.now()), 400);
    const a = await waitForJob(j.id, 5000);
    expect(a?.step).toBe("cart");
    expect(Date.now() - t0).toBeLessThan(1500);
    // Asked with no step yet ("") while it has one: answered at once.
    const t1 = Date.now();
    expect((await waitForJob(j.id, 5000, ""))?.step).toBe("cart");
    expect(Date.now() - t1).toBeLessThan(200);
    // Asked with the step it has: waits for the next one.
    setTimeout(() => void noteStep(j.id, "wait", Date.now()), 400);
    const b = await waitForJob(j.id, 5000, a!.stepAt);
    expect(b?.step).toBe("wait");
    // Nothing new: answered after its time, still going.
    const t2 = Date.now();
    expect((await waitForJob(j.id, 700, b!.stepAt))?.status).toBe("working");
    expect(Date.now() - t2).toBeGreaterThanOrEqual(650);
  });

  it("works out seconds per step: from queueing to the first, each until the next, the last until the report", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 23, 18, 0, s)).toISOString();
    expect(stepSeconds({ created: at(0), steps: [{ step: "cart", at: at(1) }, { step: "wait", at: at(3) }, { step: "pickup", at: at(4) }, { step: "cart", at: at(10) }, { step: "wait", at: at(11) }] }, at(15)))
      .toEqual({ start: 1, cart: 3, wait: 5, pickup: 6 });
    expect(stepSeconds({ created: at(0) }, at(5))).toBeNull();
  });

  it("keeps seconds per step with the job's time when it finishes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
      const j = await queueJob("cart", {});
      await takeJob("1.0.0", false);
      vi.setSystemTime(Date.now() + 1000); await noteStep(j.id, "cart", Date.now());
      vi.setSystemTime(Date.now() + 2000); await noteStep(j.id, "wait", Date.now());
      vi.setSystemTime(Date.now() + 4000);
      await finishJob(j.id, true, { products: [], signedIn: true });
      const times = (await kv().lrange("simmer:job-times", 0, -1)).map((t) => JSON.parse(t));
      expect(times).toEqual([{ at: expect.any(String), kind: "cart", s: 7, ok: true, st: { start: 1, cart: 2, wait: 4 } }]);
    } finally { vi.useRealTimers(); }
  });
});

describe("the jobs route", () => {
  it("step { id, step, at } keeps it; the job's wait carries it and answers at the next one after `since`", async () => {
    const j = await queueJob("search", { query: "milk" });
    await takeJob("1.0.0", false);
    const r = await route.POST(post({ op: "step", id: j.id, step: "search", at: Date.now() }));
    expect(await r.json()).toEqual({ ok: true });
    const odd = await route.POST(post({ op: "step", id: j.id, step: "<b>", at: Date.now() }));
    expect(await odd.json()).toEqual({ ok: false });
    const w = await (await route.GET(get(`id=${j.id}&wait=1&since=`))).json();
    expect(w.job).toMatchObject({ status: "working", step: "search" });
    setTimeout(() => void route.POST(post({ op: "step", id: j.id, step: "wait", at: Date.now() })), 300);
    const t = Date.now();
    const w2 = await (await route.GET(get(`id=${j.id}&wait=1&since=${encodeURIComponent(w.job.stepAt)}`))).json();
    expect(w2.job.step).toBe("wait");
    expect(Date.now() - t).toBeLessThan(1500);
  });

  it("refuses a step without the passcode", async () => {
    const r = await route.POST(new Request("http://x/api/safeway/jobs", { method: "POST", body: JSON.stringify({ op: "step", id: "x", step: "cart", at: 1 }), headers: { "content-type": "application/json", "x-real-ip": "1.2.3.5" } }));
    expect(r.status).toBe(401);
  });
});
