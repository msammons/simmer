import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTabs } from "./store";
import { cleanAccount, loadAccount, saveAccount } from "./safeway-signin";

afterEach(() => { resetTabs(); vi.unstubAllEnvs(); });

describe("the Google account Simmer signs in to Safeway with (Settings, Nov 24)", () => {
  it("never saved: the address set in Vercel, as version 1 shipped", async () => {
    vi.stubEnv("SAFEWAY_GOOGLE", " Sam@Example.com ");
    expect(await loadAccount()).toEqual({ account: "sam@example.com", set: false });
  });

  it("saved in Settings: that one wins, and saved empty turns signing in off even with Vercel's set", async () => {
    vi.stubEnv("SAFEWAY_GOOGLE", "sam@example.com");
    expect(await saveAccount("Robin@Example.com")).toBe("robin@example.com");
    expect(await loadAccount()).toEqual({ account: "robin@example.com", set: true });
    expect(await saveAccount("")).toBe("");
    expect(await loadAccount()).toEqual({ account: "", set: true });
  });

  it("keeps only an email address", () => {
    expect(cleanAccount("not an address")).toBe("");
    expect(cleanAccount("a@b")).toBe("");
    expect(cleanAccount(`${"x".repeat(120)}@example.com`)).toBe("");
    expect(cleanAccount(42)).toBe("");
  });
});
