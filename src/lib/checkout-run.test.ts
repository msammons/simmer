// Test runs (Nov 13): getting ready, the Face ID approval, and the test run, with the helper stood in for (its jobs
// answer with copies of Safeway's checkout page) and the phone's Face ID signature stood in for, as in passkeys.test.ts.
// Nothing here, or in what it tests, presses Place Order.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@simplewebauthn/server", async (real) => ({
  ...(await real<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("./jobs", () => ({ queueJob: vi.fn(), waitForJob: vi.fn() }));
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import pages from "./checkout-pages.json";
import { recordedForTests, resetCheckout, saveSettings } from "./checkout";
import { approve, followTestRun, prepare, testRun, type ReadyView } from "./checkout-run";
import { queueJob, waitForJob, type Job, type JobKind } from "./jobs";
import { resetKv } from "./kv";
import { checkOptions, registrationOptions, resetPasskeys, verifyRegistration } from "./passkeys";
import { resetSafeway, setCartLine } from "./safeway";

const verifyReg = vi.mocked(verifyRegistrationResponse);
const verifyAuth = vi.mocked(verifyAuthenticationResponse);
const req = () => new Request("https://simmer.example.com/api/checkout", { method: "POST", headers: { host: "simmer.example.com" } });
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const answer = (challenge: string, id = "cred-1", type = "webauthn.get") => ({
  id, rawId: id, type: "public-key", clientExtensionResults: {},
  response: { clientDataJSON: b64({ type, challenge, origin: "https://simmer.example.com" }), authenticatorData: "", signature: "", attestationObject: "" },
});

// Safeway's final page with a free REGULAR window chosen: the saved page (card fixed), its FLASH slot line swapped for
// the window, and the store and total as Simmer's settings and limit expect.
const FRI6 = { id: pages.windows.slots[0].id, words: pages.windows.slots[0].text };
const FRI7 = { id: pages.windows.slots[1].id, words: pages.windows.slots[1].text };
const page = (change: (t: string) => string = (t) => t) => ({
  url: "https://www.safeway.com/erums/checkout?cartId=1",
  text: change(pages.pickup.text.replace(/Confirm CVV /, "").replace(/Ready by 9:05 PM Slot type FLASH price \$3\.95/, "6 AM - 7 AM price Free")),
  buttons: pages.pickup.buttons,
});
type Reading = { stopped: string; chosen: { id: string; words: string } | null; final: ReturnType<typeof page> | null };
const READY: Reading = { stopped: "ready", chosen: FRI6, final: page() };

/** The helper, stood in for: each job is answered with what `does` says, at once (or left going with `going`). */
let does: (kind: JobKind, args: Record<string, unknown>) => Reading = () => READY;
let going = false;
const jobs = new Map<string, Job>();
let n = 0;
let counter = 0;

async function faceId() {
  const c = await checkOptions(req());
  verifyAuth.mockResolvedValueOnce({ verified: true, authenticationInfo: { credentialID: "cred-1", newCounter: ++counter, userVerified: true } } as never);
  return answer(c.challenge);
}

beforeEach(async () => {
  resetCheckout(); resetPasskeys(); resetKv(); resetSafeway(); jobs.clear(); verifyAuth.mockReset(); verifyReg.mockReset();
  does = () => READY; going = false; counter = 0; n = 0;
  vi.mocked(queueJob).mockReset(); vi.mocked(waitForJob).mockReset();
  vi.mocked(queueJob).mockImplementation(async (kind, args) => {
    const j: Job = { id: `j${++n}`, kind, status: "waiting", args, result: null, created: new Date().toISOString(), updated: new Date().toISOString() };
    jobs.set(j.id, j);
    return j;
  });
  vi.mocked(waitForJob).mockImplementation(async (id) => {
    const j = jobs.get(id);
    if (!j) return { job: null, answering: true };
    if (j.status === "waiting" && !going) Object.assign(j, { status: "done", result: does(j.kind, j.args), updated: new Date().toISOString() });
    return { job: { ...j }, answering: true };
  });
  await saveSettings({ on: true, limitCents: 2000, store: "100 Main St", card: "4242" });
  await setCartLine({ productId: "184420001", qty: 1, name: "Lucerne milk", price: "$2.99" });
  const o = await registrationOptions(req());
  verifyReg.mockResolvedValueOnce({ verified: true, registrationInfo: { credential: { id: "cred-1", publicKey: new Uint8Array([1]), counter: 0 }, userVerified: true } } as never);
  await verifyRegistration(req(), answer(o.challenge, "cred-1", "webauthn.create"));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T05:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

const ready = async () => (await prepare()) as ReadyView;
const approved = async () => {
  await ready();
  const a = await approve(req(), await faceId());
  if (!a.ok) throw new Error(a.reasons.join(" "));
  return a.approvalId;
};
const recorded = (what: string) => recordedForTests().filter((r) => r[1] === what).map((r) => JSON.parse(r[2]));

describe("getting ready", () => {
  it("needs ordering set up and on (but not the server's switch, which is for real orders)", async () => {
    expect(process.env.CHECKOUT_ENABLED).not.toBe("on");
    await saveSettings({ on: false, limitCents: 2000, store: "100 Main St", card: "4242" });
    await expect(prepare()).rejects.toThrow(/Turn on ordering/);
    await saveSettings({ on: true, limitCents: 0, store: "100 Main St", card: "4242" });
    await expect(prepare()).rejects.toThrow(/limit/);
    await saveSettings({ on: true, limitCents: 2000, store: "", card: "4242" });
    await expect(prepare()).rejects.toThrow(/store and card/);
    expect(queueJob).not.toHaveBeenCalled();
  });

  it("shows Safeway's figures, the free pickup time, and nothing stopping it", async () => {
    const v = await ready();
    expect(v).toMatchObject({ store: expect.stringMatching(/^100 Main St/), window: "Fri 6–7 AM", card: "4242", items: 1, totalCents: 694, stops: [] });
    expect(queueJob).toHaveBeenCalledWith("checkoutPrepare", {});
    expect(recorded("test ready")[0]).toMatchObject({ stopped: "ready", totalCents: 694 });
  });

  it("is followed while the helper is still at it, without the app keeping time", async () => {
    going = true;
    const w = await prepare();
    expect(w).toEqual({ waiting: "j1" });
    going = false;
    expect(await prepare("j1")).toMatchObject({ totalCents: 694 });
    expect(queueJob).toHaveBeenCalledTimes(1);
  });

  it("says where the helper stopped, in plain words", async () => {
    does = () => ({ stopped: "signed out", chosen: null, final: null });
    expect((await ready()).stops).toEqual(["Safeway is signed out on the computer."]);
    does = () => ({ stopped: "no free pickup time", chosen: null, final: null });
    expect((await ready()).stops).toEqual(["No free pickup time in the next week."]);
  });

  it("lists everything that would stop an order, and the highlights", async () => {
    does = () => ({ ...READY, final: page((t) => t.replace("Estimated total $6.94", "Estimated total $26.94").replace("Visa •••• 4242", "Visa •••• 9999")) });
    await setCartLine({ productId: "184420002", qty: 6, name: "Yogurt", price: "$1.00" });
    const v = await ready();
    expect(v.stops).toEqual(expect.arrayContaining(["$26.94 is over the limit of $20.00.", "Safeway shows a different card."]));
    expect(v.highlights).toEqual(expect.arrayContaining(["6 × Yogurt"]));
  });
});

describe("the approval", () => {
  it("is made with Face ID from what getting ready read, and recorded with the check", async () => {
    await ready();
    const a = await approve(req(), await faceId());
    expect(a).toMatchObject({ ok: true, totalCents: 694, window: "Fri 6–7 AM" });
    expect(recorded("test approval")[0]).toMatchObject({ ok: true, faceId: "cred-1", totalCents: 694, windowId: FRI6.id, slot: { ready: "6 AM - 7 AM", type: "REGULAR", priceCents: 0 } });
  });

  it("is refused when anything stops it", async () => {
    does = () => ({ ...READY, final: page((t) => t.replace("Estimated total $6.94", "Estimated total $26.94")) });
    await ready();
    expect(await approve(req(), await faceId())).toMatchObject({ ok: false, reasons: expect.arrayContaining(["$26.94 is over the limit of $20.00."]) });
  });

  it("is refused more than 2 minutes after getting ready", async () => {
    await ready();
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1);
    expect(await approve(req(), await faceId())).toMatchObject({ ok: false, reasons: ["That was more than 2 minutes ago. Get ready again."] });
  });

  it("is refused when the cart changed since", async () => {
    await ready();
    await setCartLine({ productId: "184420001", qty: 2 });
    expect(await approve(req(), await faceId())).toMatchObject({ ok: false, reasons: expect.arrayContaining(["The cart changed since. Get ready again."]) });
  });

  it("is refused when Face ID fails or is used again, and each reading approves once", async () => {
    await ready();
    const c = await checkOptions(req());
    verifyAuth.mockRejectedValueOnce(new Error("Signature did not match"));
    expect(await approve(req(), answer(c.challenge))).toMatchObject({ ok: false, reasons: expect.arrayContaining(["Face ID didn't match."]) });
    await ready();
    const f = await faceId();
    expect((await approve(req(), f)).ok).toBe(true);
    await ready();
    expect(await approve(req(), f)).toMatchObject({ ok: false, reasons: expect.arrayContaining([expect.stringMatching(/already used/)]) });
    expect(await approve(req(), await faceId())).toMatchObject({ ok: false, reasons: ["Get ready again first."] }); // the reading went with the last try
    expect(await approve(req(), null)).toMatchObject({ ok: false });
  });
});

describe("the test run", () => {
  it("goes with exactly the approved pickup time and says what it would place", async () => {
    const id = await approved();
    expect(await testRun(id)).toEqual({ ok: true, would: "Would place $6.94 · Fri 6–7 AM" });
    expect(queueJob).toHaveBeenLastCalledWith("checkoutDry", { approvalId: id, windowId: FRI6.id });
    expect(recorded("test run").at(-1)).toMatchObject({ ok: true, faceId: "cred-1", approvalId: id });
  });

  it("is single use: a second run with the same approval is refused, before the helper is asked", async () => {
    const id = await approved();
    await testRun(id);
    const asked = vi.mocked(queueJob).mock.calls.length;
    expect(await testRun(id)).toEqual({ ok: false, reasons: ["That approval was already used or ran out. Get ready again."] });
    expect(vi.mocked(queueJob).mock.calls.length).toBe(asked);
    // Two taps at once: only one starts.
    const again = await approved();
    const both = await Promise.all([testRun(again), testRun(again)]);
    expect(both.filter((r) => "ok" in r && r.ok).length).toBe(1);
  });

  it("is refused once the approval ran out, or the cart changed after it", async () => {
    let id = await approved();
    vi.setSystemTime(Date.now() + 2 * 60_000 + 1);
    expect(await testRun(id)).toMatchObject({ ok: false });
    id = await approved();
    await setCartLine({ productId: "184420001", qty: 3 });
    expect(await testRun(id)).toEqual({ ok: false, reasons: ["The cart changed after the approval."] });
  });

  it("reports a changed total", async () => {
    const id = await approved();
    does = () => ({ ...READY, final: page((t) => t.replace("Estimated total $6.94", "Estimated total $7.94")) });
    expect(await testRun(id)).toMatchObject({ ok: false, reasons: expect.arrayContaining(["Safeway's total changed."]) });
  });

  it("reports a different pickup time, even a free one", async () => {
    const id = await approved();
    does = () => ({ ...READY, chosen: FRI7, final: page((t) => t.replace("6 AM - 7 AM price Free", "7 AM - 8 AM price Free")) });
    expect(await testRun(id)).toMatchObject({ ok: false, reasons: expect.arrayContaining(["Safeway's pickup time changed."]) });
  });

  it("reports another pickup window with the same time on another day", async () => {
    const id = await approved();
    does = () => ({ ...READY, chosen: { id: FRI6.id.replace("FRI20261113", "SAT20261114").replace("2026-11-13", "2026-11-14"), words: FRI6.words } });
    expect(await testRun(id)).toEqual({ ok: false, reasons: ["Safeway's pickup time changed."] });
  });

  it("reports Safeway asking for card details", async () => {
    const id = await approved();
    does = () => ({ ...READY, final: page((t) => t.replace("Visa •••• 4242", "Visa •••• 4242 Confirm CVV")) });
    expect(await testRun(id)).toMatchObject({ ok: false, reasons: expect.arrayContaining(["Safeway is asking for card details; finish on Safeway."]) });
  });

  it("reports where the helper stopped short", async () => {
    const id = await approved();
    does = () => ({ stopped: "pickup time gone", chosen: null, final: null });
    expect(await testRun(id)).toEqual({ ok: false, reasons: ["That pickup time isn't offered any more. Get ready again."] });
  });

  it("is followed while going, and reported once", async () => {
    const id = await approved();
    going = true;
    const w = await testRun(id);
    expect(w).toHaveProperty("waiting");
    going = false;
    const job = (w as { waiting: string }).waiting;
    expect(await followTestRun(job)).toMatchObject({ ok: true });
    await expect(followTestRun(job)).rejects.toThrow(/already reported/);
    expect(recorded("test run started")[0]).toMatchObject({ approvalId: id, windowId: FRI6.id, faceId: "cred-1" });
  });
});
