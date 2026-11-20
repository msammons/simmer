// @vitest-environment jsdom
// Too many wrong passcodes (429) never signs the household out (Nov 19, review): only a wrong passcode (401) does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, AuthError, LockedError, SIGNED_OUT } from "./api";
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
