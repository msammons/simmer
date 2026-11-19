import { afterEach, describe, expect, it, vi } from "vitest";
import { Synced } from "./synced";

/** A promise answered by hand, to play out the order answers come back in. */
function later<T>() {
  let ok!: (v: T) => void, bad!: (e: unknown) => void;
  const p = new Promise<T>((a, b) => { ok = a; bad = b; });
  return { p, ok, bad };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
type L = string[];
const add = (x: string) => (l: L) => [...l, x];

function make(initial: L | null = [], read: () => Promise<L> = () => Promise.resolve([])) {
  const failed = vi.fn(), readFailed = vi.fn(), keep = vi.fn();
  const s = new Synced<L>(initial, { read, failed, readFailed, keep });
  return { s, failed, readFailed, keep };
}

afterEach(() => { vi.useRealTimers(); });

describe("Synced", () => {
  it("shows a change at once and keeps it shown through an earlier change's answer", async () => {
    const { s } = make();
    const a = later<L>(), b = later<L>();
    const sent: string[] = [];
    s.change(() => { sent.push("a"); return a.p; }, add("a"));
    s.change(() => { sent.push("b"); return b.p; }, add("b"));
    expect(s.get()).toEqual(["a", "b"]);
    await tick();
    expect(sent).toEqual(["a"]); // one at a time
    a.ok(["a"]);
    await tick();
    expect(sent).toEqual(["a", "b"]);
    expect(s.get()).toEqual(["a", "b"]); // b still shows while on its way
    b.ok(["a", "b"]);
    await tick();
    expect(s.get()).toEqual(["a", "b"]);
    expect(s.busy).toBe(false);
  });

  it("drops a failed change at once, says so once the rest are done, then reads the newest copy", async () => {
    const read = vi.fn(() => Promise.resolve(["b", "z"]));
    const { s, failed } = make([], read);
    const a = later<L>(), b = later<L>();
    const ra = s.change(() => a.p, add("a"));
    s.change(() => b.p, add("b"));
    a.bad(new Error("nope"));
    await tick();
    expect(s.get()).toEqual(["b"]);
    expect(failed).not.toHaveBeenCalled();
    expect(await ra).toEqual({ error: new Error("nope") });
    b.ok(["b"]);
    await tick();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    await tick();
    expect(s.get()).toEqual(["b", "z"]);
  });

  it("drops a read that started before a change answered", async () => {
    const r = later<L>();
    const { s } = make([], () => r.p);
    const reading = s.refresh();
    await s.change(() => Promise.resolve(["a"]), add("a"));
    r.ok([]);
    await reading;
    expect(s.get()).toEqual(["a"]);
  });

  it("drops a read that answers while a change is on its way", async () => {
    const r = later<L>(), a = later<L>();
    const { s } = make([], () => r.p);
    s.change(() => a.p, add("a"));
    const reading = s.refresh();
    r.ok(["old"]);
    await reading;
    expect(s.get()).toEqual(["a"]);
  });

  it("reads again once the changes are done when a read was dropped for them (review, Nov 19)", async () => {
    const r = later<L>(), a = later<L>();
    const reads = [r.p, Promise.resolve(["a", "theirs"])];
    const read = vi.fn(() => reads.shift()!);
    const { s } = make([], read);
    s.change(() => a.p, add("a"));
    const reading = s.refresh();
    r.ok(["old"]);
    await reading;
    expect(read).toHaveBeenCalledTimes(1);
    a.ok(["a"]);
    await tick(); await tick();
    expect(read).toHaveBeenCalledTimes(2);
    expect(s.get()).toEqual(["a", "theirs"]);
  });

  it("never lets an older read replace a newer one", async () => {
    const r1 = later<L>(), r2 = later<L>();
    const reads = [r1, r2];
    const { s } = make([], () => reads.shift()!.p);
    const one = s.refresh(), two = s.refresh();
    r2.ok(["new"]); await two;
    r1.ok(["old"]); await one;
    expect(s.get()).toEqual(["new"]);
  });

  it("keeps the server's copy, not what's laid over it", async () => {
    const { s, keep } = make();
    await s.change(() => Promise.resolve(["a"]), add("a"));
    expect(keep).toHaveBeenLastCalledWith(["a"]);
  });

  it("tells a failed read whether something is showing", async () => {
    const { s, readFailed } = make(null, () => Promise.reject(new Error("offline")));
    await s.refresh();
    expect(readFailed).toHaveBeenCalledWith(new Error("offline"), false);
  });

  it("settled: one read on its way, or one just answered, is enough", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const read = vi.fn(() => Promise.resolve(["x"]));
    const { s } = make([], read);
    const a = s.settled(5000), b = s.settled(5000);
    await Promise.all([a, b]);
    expect(read).toHaveBeenCalledTimes(1);
    await s.settled(5000);
    expect(read).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 6000);
    await s.settled(5000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("tells listeners on each change", async () => {
    const { s } = make();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    await s.change(() => Promise.resolve(["a"]), add("a"));
    expect(fn).toHaveBeenCalledTimes(2); // shown, then answered
    off();
    await s.change(() => Promise.resolve(["a", "b"]));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
