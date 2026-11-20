// @vitest-environment jsdom
// Too many wrong passcodes (429) never signs the household out (Nov 19, review): only a wrong passcode (401) does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, AuthError, etagOf, LockedError, SIGNED_OUT } from "./api";
import { UNCHANGED } from "./synced";
import { store } from "./storage";

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("the server turning a request down", () => {
  let signedOut = 0;
  const count = () => { signedOut++; };
  beforeEach(() => { signedOut = 0; store.setPasscode("saved-one"); window.addEventListener(SIGNED_OUT, count); });
  afterEach(() => { window.removeEventListener(SIGNED_OUT, count); vi.unstubAllGlobals(); });

  it("too many wrong passcodes: says so in plain words, keeps the saved passcode, signs nothing out", async () => {
    vi.stubGlobal("fetch", answer(429, { error: "Too many wrong passcodes. Try again in a few minutes." }));
    const e = await api.list().catch((x) => x);
    expect(e).toBeInstanceOf(LockedError);
    expect(e).not.toBeInstanceOf(AuthError);
    expect(e.message).toBe("Too many wrong passcodes. Try again in a few minutes.");
    expect(signedOut).toBe(0);
    expect(store.passcode()).toBe("saved-one");
  });

  it("a wrong passcode signs out", async () => {
    vi.stubGlobal("fetch", answer(401, { error: "Wrong passcode." }));
    await expect(api.list()).rejects.toBeInstanceOf(AuthError);
    expect(signedOut).toBe(1);
  });
});

describe("nothing changed answers (Nov 19)", () => {
  beforeEach(() => { store.setPasscode("saved-one"); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("sends If-None-Match with the phone's ETag and reads a 304 as unchanged", async () => {
    const fetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 304, headers: { etag: '"list.1"' } }));
    vi.stubGlobal("fetch", fetch);
    expect(await api.listSince('"list.1"')).toBe(UNCHANGED);
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>)["if-none-match"]).toBe('"list.1"');
  });

  it("sends no If-None-Match without an ETag, and keeps the answer's ETag beside it (the recipes array too)", async () => {
    const fetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ recipes: [] }), { status: 200, headers: { etag: '"recipes.4"' } }));
    vi.stubGlobal("fetch", fetch);
    const r = await api.recipesSince(null);
    expect((fetch.mock.calls[0][1]!.headers as Record<string, string>)["if-none-match"]).toBeUndefined();
    if (r === UNCHANGED) throw new Error("expected a full answer");
    expect(etagOf(r)).toBe('"recipes.4"');
    expect(etagOf(r.recipes)).toBe('"recipes.4"');
  });

  it("keeps a saved copy's ETag only once the copy itself is kept", () => {
    store.setList({ items: [], staples: [] }, '"list.7"');
    expect(store.listEtag()).toBe('"list.7"');
    store.setList({ items: [], staples: [] });
    expect(store.listEtag()).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    store.setList({ items: [], staples: [] }, '"list.8"');
    setItem.mockRestore();
    expect(store.listEtag()).toBeNull();
  });
});
