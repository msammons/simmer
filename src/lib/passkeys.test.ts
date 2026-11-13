import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The phone's side can't run here, so the library's two checks of the phone's signature are stood in for; everything
// around them (challenges, purposes, expiry, which passkey, its count) is Simmer's own and runs as written.
vi.mock("@simplewebauthn/server", async (real) => ({
  ...(await real<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { recordedForTests, resetCheckout } from "./checkout";
import { useTabStore, type TabStore } from "./google/redis-tabs";
import {
  ADD_MS, addWaiting, approveOptions, askToAdd, CHALLENGE_MS, checkOptions, loadPasskeys, registrationOptions, resetPasskeys, site, verifyApprove,
  verifyCheck, verifyRegistration,
} from "./passkeys";

const verifyReg = vi.mocked(verifyRegistrationResponse);
const verifyAuth = vi.mocked(verifyAuthenticationResponse);

const req = (host = "simmer.example.com") => new Request(`https://${host}/api/checkout/passkey`, { method: "POST", headers: { host } });
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** What a phone sends back: only the parts Simmer reads itself (the rest is the library's, stood in for above). */
const answer = (challenge: string, id = "cred-1", type = "webauthn.get") => ({
  id, rawId: id, type: "public-key", clientExtensionResults: {},
  response: { clientDataJSON: b64({ type, challenge, origin: "https://simmer.example.com" }), authenticatorData: "", signature: "", attestationObject: "" },
});
const registered = (id = "cred-1", counter = 0) => ({
  verified: true, registrationInfo: { credential: { id, publicKey: new Uint8Array([1, 2, 3]), counter }, userVerified: true },
}) as unknown as Awaited<ReturnType<typeof verifyRegistrationResponse>>;
const checked = (id = "cred-1", newCounter = 0, more: object = {}) => ({
  verified: true, authenticationInfo: { credentialID: id, newCounter, userVerified: true, ...more },
}) as unknown as Awaited<ReturnType<typeof verifyAuthenticationResponse>>;

async function setUp(id = "cred-1", counter = 0, token?: string) {
  const o = await registrationOptions(req(), token);
  verifyReg.mockResolvedValueOnce(registered(id, counter));
  return verifyRegistration(req(), answer(o.challenge, id, "webauthn.create"));
}

/** A phone already set up approves the request waiting now with Face ID (its counter left at 0, as an iPhone's is). */
async function approve(by = "cred-1") {
  const { options } = await approveOptions(req());
  verifyAuth.mockResolvedValueOnce(checked(by, 0));
  return verifyApprove(req(), answer(options.challenge, by));
}
/** A new phone asks and is approved: its token. */
async function approvedToken() {
  const { token } = await askToAdd();
  expect((await approve()).ok).toBe(true);
  return token;
}

describe("Face ID for ordering", () => {
  beforeEach(() => {
    resetPasskeys(); resetCheckout(); verifyReg.mockReset(); verifyAuth.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-12T18:00:00Z"));
  });
  afterEach(() => { vi.useRealTimers(); });

  it("asks for Face ID itself, on this site, named Simmer", async () => {
    const o = await registrationOptions(req());
    expect(o.rp).toEqual({ name: "Simmer", id: "simmer.example.com" });
    expect(o.authenticatorSelection).toMatchObject({ userVerification: "required", residentKey: "preferred" });
    await setUp();
    const c = await checkOptions(req());
    expect(c.userVerification).toBe("required");
    expect(c.rpId).toBe("simmer.example.com");
    expect(c.allowCredentials?.map((x) => x.id)).toEqual(["cred-1"]);
  });

  it("works out the site from the host: https, except on this computer", () => {
    expect(site(req("simmer.example.com"))).toEqual({ rpID: "simmer.example.com", origin: "https://simmer.example.com" });
    expect(site(new Request("http://localhost:3202/x", { headers: { host: "localhost:3202" } }))).toEqual({ rpID: "localhost", origin: "http://localhost:3202" });
    expect(() => site(new Request("https://a.example/x", { headers: { host: "a.example/evil" } }))).toThrow();
  });

  it("sets up a phone, then checks it, and records both", async () => {
    expect(await setUp()).toEqual({ ok: true, credentialId: "cred-1" });
    expect(verifyReg.mock.calls[0][0]).toMatchObject({ expectedOrigin: "https://simmer.example.com", expectedRPID: "simmer.example.com", requireUserVerification: true });
    const [key] = await loadPasskeys();
    expect(key).toMatchObject({ id: "cred-1", publicKey: "AQID", counter: 0, name: "Face ID on this phone, Nov 12" });
    const c = await checkOptions(req());
    verifyAuth.mockResolvedValueOnce(checked("cred-1", 0));
    expect(await verifyCheck(req(), answer(c.challenge))).toEqual({ ok: true, credentialId: "cred-1" });
    expect(verifyAuth.mock.calls[0][0]).toMatchObject({ expectedChallenge: c.challenge, requireUserVerification: true, credential: { id: "cred-1", counter: 0 } });
    expect(recordedForTests().map((r) => [r[1], JSON.parse(r[2]).ok])).toEqual([["face id set up", true], ["face id check", true]]);
  });

  it("can't be checked before it's set up", async () => {
    await expect(checkOptions(req())).rejects.toThrow(/isn't set up/);
  });

  it("a challenge runs out after 2 minutes", async () => {
    await setUp();
    const c = await checkOptions(req());
    vi.setSystemTime(Date.now() + CHALLENGE_MS + 1);
    verifyAuth.mockResolvedValue(checked("cred-1", 0));
    expect(await verifyCheck(req(), answer(c.challenge))).toMatchObject({ ok: false, why: expect.stringMatching(/ran out/) });
    expect(verifyAuth).not.toHaveBeenCalled();
    // Just inside 2 minutes is fine.
    const d = await checkOptions(req());
    vi.setSystemTime(Date.now() + CHALLENGE_MS);
    expect((await verifyCheck(req(), answer(d.challenge))).ok).toBe(true);
  });

  it("a set-up challenge runs out after 2 minutes too", async () => {
    const o = await registrationOptions(req());
    vi.setSystemTime(Date.now() + CHALLENGE_MS + 1);
    verifyReg.mockResolvedValue(registered());
    expect((await verifyRegistration(req(), answer(o.challenge, "cred-1", "webauthn.create"))).ok).toBe(false);
    expect(await loadPasskeys()).toEqual([]);
  });

  it("each challenge is good once", async () => {
    await setUp();
    const c = await checkOptions(req());
    verifyAuth.mockResolvedValue(checked("cred-1", 0));
    expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(true);
    expect(await verifyCheck(req(), answer(c.challenge))).toMatchObject({ ok: false, why: expect.stringMatching(/already used/) });
    expect(verifyAuth).toHaveBeenCalledTimes(1);
  });

  it("each set-up challenge is good once", async () => {
    const o = await registrationOptions(req());
    verifyReg.mockResolvedValue(registered("cred-1"));
    expect((await verifyRegistration(req(), answer(o.challenge, "cred-1", "webauthn.create"))).ok).toBe(true);
    verifyReg.mockResolvedValue(registered("cred-2"));
    expect((await verifyRegistration(req(), answer(o.challenge, "cred-2", "webauthn.create"))).ok).toBe(false);
    expect((await loadPasskeys()).map((p) => p.id)).toEqual(["cred-1"]);
  });

  it("a failed check uses up its challenge too", async () => {
    await setUp();
    const c = await checkOptions(req());
    verifyAuth.mockRejectedValueOnce(new Error("Signature did not match"));
    expect(await verifyCheck(req(), answer(c.challenge))).toMatchObject({ ok: false, why: "Face ID didn't match." });
    verifyAuth.mockResolvedValue(checked("cred-1", 0));
    expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(false);
    // The library's own words go in the record, not to the phone.
    expect(JSON.parse(recordedForTests()[1][2])).toMatchObject({ ok: false, error: "Signature did not match" });
  });

  it("a challenge for one purpose doesn't pass for the other", async () => {
    await setUp();
    const token = await approvedToken();
    verifyAuth.mockReset();
    const forSetUp = await registrationOptions(req(), token);
    verifyAuth.mockResolvedValue(checked("cred-1", 0));
    expect(await verifyCheck(req(), answer(forSetUp.challenge))).toMatchObject({ ok: false, why: expect.stringMatching(/something else/) });
    const forCheck = await checkOptions(req());
    verifyReg.mockResolvedValue(registered("cred-2"));
    expect((await verifyRegistration(req(), answer(forCheck.challenge, "cred-2", "webauthn.create"))).ok).toBe(false);
    // A check isn't an approval, and an approval isn't a check.
    await askToAdd();
    const forApprove = await approveOptions(req());
    expect((await verifyCheck(req(), answer(forApprove.options.challenge))).ok).toBe(false);
    const forCheck2 = await checkOptions(req());
    expect((await verifyApprove(req(), answer(forCheck2.challenge))).ok).toBe(false);
    expect(verifyAuth).not.toHaveBeenCalled();
    expect(verifyReg).toHaveBeenCalledTimes(1); // only the first set-up
  });

  it("a challenge made up by the phone doesn't pass", async () => {
    await setUp();
    verifyAuth.mockResolvedValue(checked("cred-1", 0));
    expect((await verifyCheck(req(), answer("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))).ok).toBe(false);
    expect((await verifyCheck(req(), null)).ok).toBe(false);
    expect((await verifyCheck(req(), { id: "cred-1", response: { clientDataJSON: "not json" } })).ok).toBe(false);
  });

  it("a challenge from another site doesn't pass here", async () => {
    await setUp();
    const c = await checkOptions(req("other.example.com"));
    verifyAuth.mockResolvedValue(checked("cred-1", 0));
    expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(false);
  });

  it("an unknown passkey doesn't pass, and uses up the challenge", async () => {
    await setUp();
    const c = await checkOptions(req());
    verifyAuth.mockResolvedValue(checked("someone-else", 0));
    expect(await verifyCheck(req(), answer(c.challenge, "someone-else"))).toMatchObject({ ok: false, why: expect.stringMatching(/isn't set up/) });
    expect(verifyAuth).not.toHaveBeenCalled();
    expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(false);
  });

  it("a passkey's count must go up once it counts", async () => {
    await setUp("cred-1", 5);
    for (const [n, ok] of [[5, false], [3, false], [0, false], [6, true], [6, false], [9, true]] as const) {
      const c = await checkOptions(req());
      verifyAuth.mockResolvedValueOnce(checked("cred-1", n));
      expect([n, (await verifyCheck(req(), answer(c.challenge))).ok]).toEqual([n, ok]);
    }
    expect((await loadPasskeys())[0].counter).toBe(9);
  });

  it("a phone that never counts (always 0) still passes", async () => {
    await setUp("cred-1", 0);
    for (let i = 0; i < 2; i++) {
      const c = await checkOptions(req());
      verifyAuth.mockResolvedValueOnce(checked("cred-1", 0));
      expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(true);
    }
  });

  it("needs Face ID itself, not only a tap, and the passkey the phone named", async () => {
    await setUp();
    let c = await checkOptions(req());
    verifyAuth.mockResolvedValueOnce(checked("cred-1", 1, { userVerified: false }));
    expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(false);
    c = await checkOptions(req());
    verifyAuth.mockResolvedValueOnce({ ...checked("cred-1", 1), verified: false });
    expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(false);
    c = await checkOptions(req());
    verifyAuth.mockResolvedValueOnce(checked("cred-2", 1));
    expect((await verifyCheck(req(), answer(c.challenge))).ok).toBe(false);
  });

  it("the same phone isn't set up twice, and a set-up without Face ID doesn't count", async () => {
    await setUp("cred-1");
    const token = await approvedToken();
    expect(await setUp("cred-1", 0, token)).toMatchObject({ ok: false });
    const o = await registrationOptions(req(), token);
    expect(o.excludeCredentials?.map((x) => x.id)).toEqual(["cred-1"]);
    verifyReg.mockResolvedValueOnce({ verified: true, registrationInfo: { credential: { id: "cred-3", publicKey: new Uint8Array([1]), counter: 0 }, userVerified: false } } as never);
    expect((await verifyRegistration(req(), answer(o.challenge, "cred-3", "webauthn.create"))).ok).toBe(false);
    expect((await loadPasskeys()).map((p) => p.id)).toEqual(["cred-1"]);
    expect(recordedForTests().filter((r) => r[1] === "face id set up").length).toBe(3);
  });

  it("with Redis: a challenge is taken out in one step, and passkeys are kept in their tab", async () => {
    const kv = new Map<string, string>();
    const store = {
      get: async (k) => kv.get(k) ?? null,
      set: async (k, v) => { kv.set(k, v); },
      mget: async (...ks) => ks.map((k) => kv.get(k) ?? null),
      keys: async () => [...kv.keys()],
      getdel: async (k) => { const v = kv.get(k) ?? null; kv.delete(k); return v; },
      del: async (k) => { kv.delete(k); },
    } as TabStore & { getdel(k: string): Promise<string | null>; del(k: string): Promise<void> };
    useTabStore(store);
    try {
      await setUp("cred-1", 0);
      expect(JSON.parse(kv.get("simmer:tab:Checkout passkeys")!)[1].slice(0, 3)).toEqual(["cred-1", "AQID", "0"]);
      const c = await checkOptions(req());
      expect(kv.has(`simmer:checkout-challenge:${c.challenge}`)).toBe(true);
      verifyAuth.mockResolvedValue(checked("cred-1", 2));
      const both = await Promise.all([verifyCheck(req(), answer(c.challenge)), verifyCheck(req(), answer(c.challenge))]);
      expect(both.filter((r) => r.ok).length).toBe(1);
      expect(JSON.parse(kv.get("simmer:tab:Checkout passkeys")!)[1][2]).toBe("2");
    } finally { useTabStore(null); }
  });

  describe("adding a phone once one has Face ID", () => {
    it("the first phone needs nothing but the passcode", async () => {
      await expect(askToAdd()).rejects.toThrow(/straight away/);
      expect((await setUp("cred-1")).ok).toBe(true);
    });

    it("a new phone asks, a phone with Face ID approves, and the new one sets up", async () => {
      await setUp("cred-1");
      expect(await addWaiting()).toBeNull();
      const { token, code } = await askToAdd();
      expect(code).toMatch(/^\d{6}$/);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await addWaiting()).toEqual({ code }); // the code only, never the token
      const { code: shown } = await approveOptions(req());
      expect(shown).toBe(code);
      expect(await approve()).toEqual({ ok: true, credentialId: "cred-1" });
      expect(await addWaiting()).toBeNull();
      expect(await setUp("cred-2", 0, token)).toEqual({ ok: true, credentialId: "cred-2" });
      expect((await loadPasskeys()).map((p) => p.id)).toEqual(["cred-1", "cred-2"]);
      expect(recordedForTests().map((r) => r[1])).toEqual(["face id set up", "face id add asked", "face id add approved", "face id phone added", "face id set up"]);
    });

    it("no token, a wrong one, or one not approved yet is refused", async () => {
      await setUp("cred-1");
      await expect(registrationOptions(req())).rejects.toThrow(/Add this phone/);
      const { token, code } = await askToAdd();
      await expect(registrationOptions(req(), "x".repeat(43))).rejects.toThrow(/Add this phone/);
      await expect(registrationOptions(req(), token)).rejects.toThrow(new RegExp(`other phone first: it shows ${code}`));
      expect(recordedForTests().filter((r) => r[1] === "face id set up refused").length).toBe(3);
      expect((await loadPasskeys()).length).toBe(1);
    });

    it("a request runs out after 5 minutes, approved or not", async () => {
      await setUp("cred-1");
      const { token } = await askToAdd();
      vi.setSystemTime(Date.now() + ADD_MS + 1);
      expect(await addWaiting()).toBeNull();
      await expect(approveOptions(req())).rejects.toThrow(/no new phone waiting/);
      const t2 = await approvedToken();
      const o = await registrationOptions(req(), t2); // asked for in time…
      vi.setSystemTime(Date.now() + ADD_MS + 1);
      await expect(registrationOptions(req(), t2)).rejects.toThrow();
      verifyReg.mockResolvedValueOnce(registered("cred-2"));
      expect((await verifyRegistration(req(), answer(o.challenge, "cred-2", "webauthn.create"))).ok).toBe(false); // …finished too late
      await expect(registrationOptions(req(), token)).rejects.toThrow();
      expect((await loadPasskeys()).length).toBe(1);
    });

    it("an approval is used once", async () => {
      await setUp("cred-1");
      const token = await approvedToken();
      expect((await setUp("cred-2", 0, token)).ok).toBe(true);
      await expect(registrationOptions(req(), token)).rejects.toThrow();
      expect((await loadPasskeys()).length).toBe(2);
    });

    it("a failed set-up keeps the approval for another try", async () => {
      await setUp("cred-1");
      const token = await approvedToken();
      const o = await registrationOptions(req(), token);
      verifyReg.mockRejectedValueOnce(new Error("bad attestation"));
      expect((await verifyRegistration(req(), answer(o.challenge, "cred-2", "webauthn.create"))).ok).toBe(false);
      expect((await setUp("cred-2", 0, token)).ok).toBe(true);
    });

    it("a new request replaces the old one, and an approval for one can't approve another", async () => {
      await setUp("cred-1");
      const first = await askToAdd();
      const { options } = await approveOptions(req()); // bound to the first request
      const second = await askToAdd();
      expect(second.token).not.toBe(first.token);
      verifyAuth.mockResolvedValueOnce(checked("cred-1", 0));
      expect(await verifyApprove(req(), answer(options.challenge))).toMatchObject({ ok: false, why: expect.stringMatching(/replaced/) });
      await expect(registrationOptions(req(), second.token)).rejects.toThrow(/other phone first/);
      await expect(registrationOptions(req(), first.token)).rejects.toThrow(/Add this phone/);
      expect(JSON.parse(recordedForTests().filter((r) => r[1] === "face id add approved").at(-1)![2])).toMatchObject({ ok: false });
      // Approving the second, then asking again: the approved one is gone with it.
      expect((await approve()).ok).toBe(true);
      await askToAdd();
      await expect(registrationOptions(req(), second.token)).rejects.toThrow(/Add this phone/);
    });

    it("approving needs Face ID from a phone already set up", async () => {
      await setUp("cred-1");
      const { token } = await askToAdd();
      let { options } = await approveOptions(req());
      expect((await verifyApprove(req(), answer(options.challenge, "stranger"))).ok).toBe(false);
      ({ options } = await approveOptions(req()));
      verifyAuth.mockRejectedValueOnce(new Error("Signature did not match"));
      expect((await verifyApprove(req(), answer(options.challenge))).ok).toBe(false);
      ({ options } = await approveOptions(req()));
      verifyAuth.mockResolvedValueOnce(checked("cred-1", 0));
      expect((await verifyApprove(req(), answer(options.challenge))).ok).toBe(true);
      verifyAuth.mockResolvedValueOnce(checked("cred-1", 0));
      expect((await verifyApprove(req(), answer(options.challenge))).ok).toBe(false); // its challenge is used up
      await expect(approveOptions(req())).rejects.toThrow(/no new phone waiting/); // already approved
      expect(recordedForTests().filter((r) => r[1] === "face id add approved").map((r) => JSON.parse(r[2]).ok)).toEqual([false, false, true, false]);
      expect((await setUp("cred-2", 0, token)).ok).toBe(true);
    });

    it("with Redis: of two set-ups sent at once with one approval, only one is added", async () => {
      const kv = new Map<string, string>();
      useTabStore({
        get: async (k: string) => kv.get(k) ?? null,
        set: async (k: string, v: string) => { kv.set(k, v); },
        mget: async (...ks: string[]) => ks.map((k) => kv.get(k) ?? null),
        keys: async () => [...kv.keys()],
        getdel: async (k: string) => { const v = kv.get(k) ?? null; kv.delete(k); return v; },
        del: async (k: string) => { kv.delete(k); },
      } as TabStore);
      try {
        await setUp("cred-1");
        const token = await approvedToken();
        const [a, b] = [await registrationOptions(req(), token), await registrationOptions(req(), token)];
        verifyReg.mockResolvedValueOnce(registered("cred-2")).mockResolvedValueOnce(registered("cred-3"));
        const both = await Promise.all([
          verifyRegistration(req(), answer(a.challenge, "cred-2", "webauthn.create")),
          verifyRegistration(req(), answer(b.challenge, "cred-3", "webauthn.create")),
        ]);
        expect(both.filter((r) => r.ok).length).toBe(1);
        expect((await loadPasskeys()).length).toBe(2);
      } finally { useTabStore(null); }
    });
  });
});
