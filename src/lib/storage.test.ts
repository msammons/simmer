import { beforeEach, describe, expect, it } from "vitest";

// A plain localStorage for the phone's saved copies.
const mem = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
});
const { store } = await import("./storage");

describe("a copy kept with its ETag (Nov 19)", () => {
  beforeEach(() => mem.clear());

  it("keeps the copy and its ETag in one key, read back together", () => {
    store.setList({ items: [], staples: [] } as never, "\"e1\"");
    expect([...mem.keys()]).toEqual(["sm.list"]);
    expect(store.list()).toEqual({ items: [], staples: [] });
    expect(store.listEtag()).toBe("\"e1\"");
  });

  it("opens a copy saved before ETags, with no ETag, and drops the old separate ETag key", () => {
    mem.set("sm.list", JSON.stringify({ items: [], staples: [] }));
    mem.set("sm.list.etag", JSON.stringify("\"old\""));
    expect(store.list()).toEqual({ items: [], staples: [] });
    expect(store.listEtag()).toBeNull();
    store.setList({ items: [], staples: [] } as never, null);
    expect(mem.has("sm.list.etag")).toBe(false);
    expect(store.listEtag()).toBeNull();
  });

  it("leaves no ETag when the copy couldn't be saved", () => {
    store.setPlan({ dishes: [] } as never, "\"p1\"");
    const setItem = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => { throw new Error("full"); };
    store.setPlan({ dishes: [{}] } as never, "\"p2\"");
    globalThis.localStorage.setItem = setItem;
    expect(store.planEtag()).toBeNull();
    expect(store.plan()).toBeNull();
  });
});
