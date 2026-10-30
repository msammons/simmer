import { beforeEach, describe, expect, it } from "vitest";
import { cancelJob, finishJob, helperStatus, jobStatus, queueJob, resetJobs, takeJob } from "./jobs";
import { loadCart, loadPicks, resetSafeway, setCartLine } from "./safeway";

const milk = { productId: "960001", query: "milk", name: "Lucerne Milk 2% - 1/2 Gallon", price: "$3.49", image: "https://images.example/milk.jpg", itemId: "m", item: "milk" };

describe("jobs for the Safeway helper", () => {
  beforeEach(() => { resetJobs(); resetSafeway(); });

  it("isn't answering until the helper checks in", async () => {
    expect((await helperStatus()).answering).toBe(false);
    expect(await takeJob("1.0.0", false)).toBeNull();
    expect((await helperStatus()).answering).toBe(true);
  });

  it("goes from Simmer to the helper and back, oldest first", async () => {
    const a = await queueJob("search", { query: "milk" });
    const b = await queueJob("search", { query: "bananas" });
    const took = await takeJob("1.0.0", true);
    expect(took).toMatchObject({ id: a.id, status: "working" });
    await finishJob(a.id, true, { products: [{ id: "1", name: "Milk", price: "$3", image: "https://x/y.jpg", inCart: false, qty: 0 }, { id: "bad", name: "x" }], signedIn: true });
    const done = (await jobStatus(a.id)).job;
    expect(done?.status).toBe("done");
    expect((done?.result?.products as unknown[]).length).toBe(1); // only real products come back
    expect((await takeJob("1.0.0", true))?.id).toBe(b.id);
    expect(await takeJob("1.0.0", true)).toBeNull();
  });

  it("puts a quantity set on Safeway in the cart, and keeps the pick with its picture", async () => {
    const j = await queueJob("setQty", { ...milk, qty: 2 });
    await takeJob("1.0.0", false);
    await finishJob(j.id, true, { ok: true, qty: 2 });
    expect(await loadCart()).toMatchObject([{ productId: "960001", qty: 2, itemId: "m", item: "milk", image: milk.image }]);
    expect(await loadPicks()).toEqual([{ item: "milk", id: "960001", name: milk.name, image: milk.image }]);
    const off = await queueJob("setQty", { ...milk, qty: 0 });
    await takeJob("1.0.0", false);
    await finishJob(off.id, true, { ok: true, qty: 0 });
    expect(await loadCart()).toEqual([]);
  });

  it("turns quick taps on the same product into one trip", async () => {
    const a = await queueJob("setQty", { ...milk, qty: 1 });
    const b = await queueJob("setQty", { ...milk, qty: 3 });
    expect(b.id).toBe(a.id);
    expect((await takeJob("1.0.0", false))?.args.qty).toBe(3);
  });

  it("a failure says why, and a cancelled job isn't taken", async () => {
    const a = await queueJob("setQty", { ...milk, qty: 1 });
    await takeJob("1.0.0", false);
    await finishJob(a.id, false, { error: "signed-out" });
    expect((await jobStatus(a.id)).job).toMatchObject({ status: "failed", result: { error: "signed-out" } });
    expect(await loadCart()).toEqual([]);
    const c = await queueJob("search", { query: "eggs" });
    await cancelJob(c.id);
    expect(await takeJob("1.0.0", false)).toBeNull();
  });

  it("a search keeps the cart in step with what Safeway shows", async () => {
    await setCartLine({ ...milk, qty: 2 });
    await setCartLine({ productId: "5", qty: 1, name: "Bread" });
    const s = await queueJob("search", { query: "milk" });
    await takeJob("1.0.0", false);
    await finishJob(s.id, true, { products: [{ id: "960001", name: milk.name, inCart: true, qty: 3 }, { id: "5", name: "Bread", inCart: false }], signedIn: true });
    expect((await loadCart()).map((l) => [l.productId, l.qty])).toEqual([["960001", 3]]);
  });
});
