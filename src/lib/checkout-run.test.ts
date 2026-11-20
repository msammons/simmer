// Test runs (Nov 13): getting ready, the Face ID approval, and the test run, with the helper stood in for (its jobs
// answer with copies of Safeway's checkout page) and the phone's Face ID signature stood in for, as in passkeys.test.ts.
// Nothing here, or in what it tests, presses Place Order.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@simplewebauthn/server", async (real) => ({
  ...(await real<typeof import("@simplewebauthn/server")>()),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("./jobs", () => ({ queueJob: vi.fn(), waitForJob: vi.fn(), cartChanging: vi.fn(async () => false), HELPER_VERSION: "9.9.9", helperStatus: vi.fn(async () => ({ seen: "", away: false, outdated: false })) }));
vi.mock("./push", () => ({ wakeHelper: vi.fn(async () => {}) }));
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import pages from "./checkout-pages.json";
import { loadSettings, recordedForTests, resetCheckout, saveSettings } from "./checkout";
import { approve as approveWith, settleOrder, followOrder, placeOrder as placeWith, confirmationNumberIn, confirmed, expectFor, followTestRun, orderNumberIn, pickupTimes, prepare, testRun, type ReadyView } from "./checkout-run";
import { cartChanging, queueJob, waitForJob, type Job, type JobKind } from "./jobs";
import { resetKv } from "./kv";
import { wakeHelper } from "./push";
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
type Reading = { stopped: string; chosen: { id: string; words: string } | null; final: ReturnType<typeof page> | null; times?: { id: string; words: string }[]; bagsOwn?: boolean };
const READY: Reading = { stopped: "ready", chosen: FRI6, final: page(), bagsOwn: true };
/** The helper's listing of free times (Nov 14), and its getting ready with the one picked. */
let helperBy = "9.9.9";
const helper = (kind: JobKind, args: Record<string, unknown>): Reading => (args.list ? { stopped: "times", chosen: null, final: null, times: [FRI6] } : READY);

/** The helper, stood in for: each job is answered with what `does` says, at once (or left going with `going`). */
let does: (kind: JobKind, args: Record<string, unknown>) => Reading = helper;
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
  does = helper; going = false; counter = 0; n = 0; helperBy = "9.9.9";
  vi.mocked(queueJob).mockReset(); vi.mocked(waitForJob).mockReset();
  vi.mocked(queueJob).mockImplementation(async (kind, args) => {
    const j: Job = { id: `j${++n}`, kind, status: "waiting", args, result: null, created: new Date().toISOString(), updated: new Date().toISOString() };
    jobs.set(j.id, j);
    return j;
  });
  vi.mocked(waitForJob).mockImplementation(async (id) => {
    const j = jobs.get(id);
    if (!j) return null;
    // Taken by the helper Simmer ships unless a test says otherwise (`by`).
    if (j.status === "waiting" && !going) {
      const result = does(j.kind, j.args) as unknown as Record<string, unknown>;
      // A placing job that got as far as Place Order was let press first ("may I press?", Nov 19).
      const asked = j.kind === "checkoutPlace" && ["placed", "pressed", "not pressed"].includes(String(result.stopped)) && !["simmer said no", "place order stayed off"].includes(String(result.why ?? ""));
      Object.assign(j, { status: "done", args: { by: helperBy, ...j.args }, result, updated: new Date().toISOString(), ...(asked && { pressedAt: new Date().toISOString() }) });
    }
    return { ...j };
  });
  await saveSettings({ on: true, limitCents: 2000, store: "100 Main St", card: "4242" });
  await setCartLine({ productId: "184420001", qty: 1, name: "Lucerne milk", price: "$2.99" });
  const o = await registrationOptions(req());
  verifyReg.mockResolvedValueOnce({ verified: true, registrationInfo: { credential: { id: "cred-1", publicKey: new Uint8Array([1]), counter: 0 }, userVerified: true } } as never);
  await verifyRegistration(req(), answer(o.challenge, "cred-1", "webauthn.create"));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T05:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

/** Approving the last reading shown (its preparedId, Nov 19), as the phone does. */
let shown: ReadyView | null = null;
const approve = (r: Request, f: unknown, id = shown?.preparedId ?? "") => approveWith(r, f, id);
/** Placing, with what the phone showed. */
const placeOrder = (id: string, s = { totalCents: shown?.totalCents ?? null, window: shown?.window ?? "" }) => placeWith(id, s);
/** Get ready: the free times offered, then FRI6 picked. */
const ready = async () => {
  const listing = does;
  does = (k, a) => (a.list ? helper(k, a) : listing(k, a));
  await pickupTimes();
  does = listing;
  shown = (await prepare(undefined, FRI6.id)) as ReadyView;
  return shown;
};
const approved = async () => {
  await ready();
  const a = await approve(req(), await faceId());
  if (!a.ok) throw new Error(a.reasons.join(" "));
  return a.approvalId;
};
const recorded = async (what: string) => (await recordedForTests()).filter((r) => r[1] === what).map((r) => JSON.parse(r[2]));

describe("picking the pickup time (Nov 14)", () => {
  const SAT = { id: "9999SAT20261114REGULARDUG900100-2026-11-14", words: "9 AM - 10 AM price Free" };
  const FLASH = { id: "9999FRI20261113FLASHDUG2100-2026-11-13", words: "Ready by 9 PM price $3.95" };
  const PRICED = { id: "9999SAT20261114REGULARDUG10001100-2026-11-14", words: "10 AM - 11 AM price $2.00" };
  const FRI_TILE = "SelectedFRIDAY Nov, 13 Fri Nov 13", SAT_TILE = "select slots for SATURDAY Nov, 14 Sat Nov 14";
  it("offers the days and the day's times, Flash too with its price (Nov 16), choosing none", async () => {
    does = () => ({ stopped: "times", chosen: null, final: null, days: [{ label: FRI_TILE }, { label: SAT_TILE }], day: FRI_TILE, times: [FRI6, FLASH, { id: "9999FRI20261113REGULARDUG900100-2026-11-13", words: "9 AM - 10 AM" }] } as never);
    const t = await pickupTimes();
    expect(t).toMatchObject({ days: [{ key: FRI_TILE, label: "Fri, Nov 13" }, { key: SAT_TILE, label: "Sat, Nov 14" }], day: FRI_TILE,
      times: [{ id: FRI6.id, time: "6–7 AM", price: "Free", flash: false }, { id: FLASH.id, time: "Ready by 9 PM", price: "$3.95", flash: true }] });
  });
  it("reads another day when asked, and remembers every time offered", async () => {
    does = (_k, a) => (a.windowId ? READY : a.day === SAT_TILE ? { stopped: "times", chosen: null, final: null, days: [{ label: FRI_TILE }, { label: SAT_TILE }], day: SAT_TILE, times: [SAT, PRICED] } : { stopped: "times", chosen: null, final: null, days: [{ label: FRI_TILE }], day: FRI_TILE, times: [FRI6] }) as never;
    await pickupTimes();
    const sat = await pickupTimes(undefined, SAT_TILE);
    expect(queueJob).toHaveBeenLastCalledWith("checkoutPrepare", { list: true, day: SAT_TILE });
    expect("times" in sat && sat.times.map((x) => x.id)).toEqual([SAT.id]); // a paid time that isn't Flash isn't offered: it could never be ordered
    expect((await prepare(undefined, FRI6.id) as ReadyView).stops).toEqual([]); // Friday's, offered first, still taken
  });
  it("never passes on a day that isn't Safeway's tile", async () => {
    await pickupTimes(undefined, "Place Order");
    expect(queueJob).toHaveBeenLastCalledWith("checkoutPrepare", { list: true });
  });
  it("gets ready only with a time it just offered", async () => {
    await expect(prepare(undefined, FRI6.id)).rejects.toThrow(/Pick a pickup time/);
    await pickupTimes();
    await expect(prepare(undefined, "9999SAT20261114REGULARDUG900100-2026-11-14")).rejects.toThrow(/Pick a pickup time/);
    expect((await prepare(undefined, FRI6.id) as ReadyView).stops).toEqual([]);
  });
  it("stops when Safeway's chosen time isn't the one picked", async () => {
    await pickupTimes();
    does = () => ({ ...READY, chosen: { id: "9999FRI20261113REGULARDUG700800-2026-11-13", words: "7 AM - 8 AM price Free" } });
    expect((await prepare(undefined, FRI6.id) as ReadyView).stops).toContain("Safeway's pickup time isn't the one picked.");
  });
  it("doesn't start while a cart change is still on its way to Safeway (Nov 16)", async () => {
    vi.mocked(cartChanging).mockResolvedValueOnce(true);
    const asked = vi.mocked(queueJob).mock.calls.length;
    await expect(pickupTimes()).rejects.toThrow(/still changing/);
    expect(vi.mocked(queueJob).mock.calls.length).toBe(asked);
  });

  it("says where Safeway stopped, in plain words", async () => {
    does = () => ({ stopped: "signed out", chosen: null, final: null });
    await expect(pickupTimes()).rejects.toThrow(/signed out/);
  });
});

describe("getting ready", () => {
  it("needs ordering set up and on (but not the server's switch, which is for real orders)", async () => {
    expect(process.env.CHECKOUT_ENABLED).not.toBe("on");
    await saveSettings({ on: false, limitCents: 2000, store: "100 Main St", card: "4242" });
    await expect(pickupTimes()).rejects.toThrow(/Turn on ordering/);
    await expect(prepare(undefined, FRI6.id)).rejects.toThrow(/Turn on ordering/);
    await saveSettings({ on: true, limitCents: 0, store: "100 Main St", card: "4242" });
    await expect(pickupTimes()).rejects.toThrow(/limit/);
    expect(queueJob).not.toHaveBeenCalled();
  });

  it("shows Safeway's figures, the free pickup time, and nothing stopping it", async () => {
    const v = await ready();
    expect(v).toMatchObject({ store: expect.stringMatching(/^100 Main St/), window: "Fri 6–7 AM", card: "4242", items: 1, totalCents: 694, stops: [] });
    expect(queueJob).toHaveBeenCalledWith("checkoutPrepare", { list: true });
    expect(queueJob).toHaveBeenCalledWith("checkoutPrepare", { windowId: FRI6.id });
    expect((await recorded("test ready"))[0]).toMatchObject({ stopped: "ready", totalCents: 694 });
  });

  it("leaves Safeway's taxes and fees out when comparing with Simmer's estimate, and shows them (Nov 14)", async () => {
    // $2.99 of milk in Simmer's cart; Safeway's total $6.94 is the milk plus a $3.95 small-order fee.
    const v = await ready();
    expect(v.highlights).toEqual([]);
    expect(v.feesCents).toBe(395);
    does = () => ({ ...READY, final: page((t) => t.replace("Estimated total $6.94", "Estimated total $9.94")) });
    expect((await ready()).highlights).toEqual([expect.stringMatching(/more than expected/)]);
  });

  it("asks for the bags she picked, shows Safeway's, and stops when they aren't the ones picked (Nov 16)", async () => {
    does = (k, a) => (a.list ? helper(k, a) : { ...READY, bagsOwn: true });
    await pickupTimes();
    expect(await prepare(undefined, FRI6.id, undefined, true)).toMatchObject({ bagsOwn: true, stops: [] });
    expect(queueJob).toHaveBeenCalledWith("checkoutPrepare", { windowId: FRI6.id, bagsOwn: true });
    await pickupTimes();
    expect(((await prepare(undefined, FRI6.id, undefined, false)) as ReadyView).stops).toContain("Safeway's bags aren't the ones picked.");
  });

  it("is followed while the helper is still at it, without the app keeping time", async () => {
    await pickupTimes();
    going = true;
    const w = await prepare(undefined, FRI6.id);
    expect(w).toEqual({ waiting: "j2" });
    going = false;
    expect(await prepare("j2")).toMatchObject({ totalCents: 694 });
    expect(queueJob).toHaveBeenCalledTimes(2);
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
    expect((await recorded("test approval"))[0]).toMatchObject({ ok: true, faceId: "cred-1", totalCents: 694, windowId: FRI6.id, slot: { ready: "6 AM - 7 AM", type: "REGULAR", priceCents: 0 } });
  });

  it("the first time, takes the store and card Safeway shows, and remembers them once approved (Nov 14)", async () => {
    await saveSettings({ on: true, limitCents: 2000, store: "", card: "" });
    const v = await ready();
    expect(v).toMatchObject({ store: expect.stringMatching(/^100 Main St/), card: "4242", stops: [], remember: true });
    expect(await loadSettings()).toMatchObject({ store: "", card: "" }); // getting ready only reads
    expect(await approve(req(), await faceId())).toMatchObject({ ok: true });
    expect(await loadSettings()).toMatchObject({ store: expect.stringMatching(/^100 Main St/), card: "4242" });
    // After that, another card stops it.
    does = () => ({ ...READY, final: page((t) => t.replace("Visa •••• 4242", "Visa •••• 9999")) });
    expect((await ready()).stops).toContain("Safeway shows a different card.");
  });

  it("the first time, an unreadable store or card still stops it, and nothing is remembered", async () => {
    await saveSettings({ on: true, limitCents: 2000, store: "", card: "" });
    does = () => ({ ...READY, final: page((t) => t.replace("Visa •••• 4242", "Visa")) });
    expect((await ready()).stops).toContain("Safeway shows a different card.");
    expect(await approve(req(), await faceId())).toMatchObject({ ok: false });
    expect(await loadSettings()).toMatchObject({ store: "", card: "" });
  });

  it("a failed Face ID remembers nothing", async () => {
    await saveSettings({ on: true, limitCents: 2000, store: "", card: "" });
    await ready();
    verifyAuth.mockRejectedValueOnce(new Error("no"));
    expect(await approve(req(), await faceId())).toMatchObject({ ok: false });
    expect(await loadSettings()).toMatchObject({ store: "", card: "" });
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
    expect(queueJob).toHaveBeenLastCalledWith("checkoutDry", { approvalId: id, windowId: FRI6.id, bagsOwn: true });
    expect((await recorded("test run")).at(-1)).toMatchObject({ ok: true, faceId: "cred-1", approvalId: id });
  });

  it("doesn't count when an older helper ran it (outside review, Nov 18)", async () => {
    helperBy = "9.9.8";
    expect(await testRun(await approved())).toMatchObject({ ok: false, reasons: [expect.stringMatching(/isn't up to date/)] });
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
    expect((await recorded("test run started"))[0]).toMatchObject({ approvalId: id, windowId: FRI6.id, faceId: "cred-1" });
  });
});

describe("picking the store and card (Nov 14)", () => {
  it("reads both from the look's pages, the last page that shows each", async () => {
    const { choicesOf } = await import("./checkout-run");
    const pages = (await import("./checkout-pages.json")).default as { pickup: { text: string; buttons: string[] }; before: unknown };
    expect(choicesOf([{ text: "Your cart 3 items Checkout" }, pages.pickup])).toEqual({ store: "100 Main St, Springfield, CA 90000", card: "4242" });
    expect(choicesOf([{ text: "Your cart" }])).toEqual({ store: "", card: "" });
    expect(choicesOf([{ text: 7 }, {}])).toEqual({ store: "", card: "" });
  });
});

describe("waking the helper (Nov 14)", () => {
  it("pushes a wake-up with every job checkout asks for, so a sleeping helper takes it", async () => {
    const { lookUp } = await import("./checkout-run");
    vi.mocked(wakeHelper).mockClear();
    await lookUp(undefined, 0).catch(() => {});
    expect(vi.mocked(queueJob).mock.calls.at(-1)?.[0]).toBe("checkoutLook");
    expect(vi.mocked(wakeHelper)).toHaveBeenCalledTimes(1);
  });
});

describe("a late wake-up (Nov 14)", () => {
  it("wakes the helper again each time the phone follows a job nobody has taken", async () => {
    await pickupTimes();
    going = true;
    vi.mocked(wakeHelper).mockClear();
    const w = await prepare(undefined, FRI6.id);
    expect(w).toMatchObject({ waiting: expect.any(String) });
    await prepare((w as { waiting: string }).waiting);
    expect(vi.mocked(wakeHelper)).toHaveBeenCalledTimes(3); // queued, then each follow while it waits
  });
});

describe("placing the order (phase 3, Nov 14)", () => {
  /** A test run that matched, so this helper version may place orders. */
  const passTestRun = async () => { const id = await approved(); await testRun(id); };
  afterEach(() => { delete process.env.CHECKOUT_ENABLED; });

  it("is closed while the server's switch is off, or before this helper has passed a test run", async () => {
    expect((await ready()).canOrder).toBe(false);
    expect((await ready()).orderWhy).toMatch(/turned off/);
    process.env.CHECKOUT_ENABLED = "on";
    expect((await ready()).orderWhy).toMatch(/test run first/);
    await passTestRun();
    expect(await ready()).toMatchObject({ canOrder: true, orderWhy: "" });
  });

  it("refuses with the switch off, and asks nothing of the helper", async () => {
    const id = await approved();
    const asked = vi.mocked(queueJob).mock.calls.length;
    expect(await placeOrder(id)).toMatchObject({ ok: false, reasons: [expect.stringMatching(/turned off/)] });
    expect(vi.mocked(queueJob).mock.calls.length).toBe(asked);
  });

  it("asks the helper once with exactly what was approved, and the cart comes off the list when it's ordered", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "placed", pressed: true, after: { url: "https://x/confirmation", text: "Thank you! Order number: 123456789" } } as never) : helper(k, a));
    const id = await approved();
    const r = await placeOrder(id);
    expect(r).toMatchObject({ ok: true, ordered: "Ordered · pickup Fri 6–7 AM · $6.94", number: "123456789" });
    const placing = vi.mocked(queueJob).mock.calls.filter((c) => c[0] === "checkoutPlace");
    expect(placing).toHaveLength(1);
    expect(placing[0][1]).toMatchObject({ windowId: FRI6.id, expect: {
      total: "$6.94", items: 1, itemsLine: expect.stringMatching(/^Safeway Items \(1\) \$/), card: "4242", storeLine: expect.stringMatching(/^Pick up your order here 100 Main St/),
      whenLine: "Pickup date & time Edit Friday, Nov 13, 6 AM - 7 AM", cart: "184420001x1", deadline: expect.any(Number),
    } });
    // Single use: the same approval again asks nothing more.
    expect(await placeOrder(id)).toMatchObject({ ok: false, reasons: [expect.stringMatching(/already used/)] });
    expect(vi.mocked(queueJob).mock.calls.filter((c) => c[0] === "checkoutPlace")).toHaveLength(1);
  });

  it("says nothing was ordered when Safeway's page didn't match, and isn't sure when it pressed without an answer", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "not pressed", pressed: false, why: "total" } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, reasons: [expect.stringMatching(/didn't match.*total/), "Nothing was ordered."] });
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "pressed", pressed: true, after: null } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, unsure: true });
  });

  it("refuses when the cart changed after the approval, before asking the helper", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    const id = await approved();
    await setCartLine({ productId: "184420002", qty: 1, name: "Yogurt", price: "$1.00" });
    expect(await placeOrder(id)).toMatchObject({ ok: false, reasons: expect.arrayContaining(["The cart changed after the approval."]) });
    expect(vi.mocked(queueJob).mock.calls.filter((c) => c[0] === "checkoutPlace")).toHaveLength(0);
  });

  it("says ordered only when Safeway's page confirms it, else isn't sure and leaves the list alone", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "placed", pressed: true, after: { url: "https://x/erums/cart", text: "Your cart" } } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, unsure: true });
    expect(confirmed({ url: "https://x/order-confirmation", text: "" })).toBe(false); // the address alone isn't proof
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "pressed", pressed: true, after: { url: "https://x/erums/checkout", text: "Thank you for your order! Order number: 55512345" } } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false }); // still going-blocked by the unsure one above

    expect(confirmed({ url: "https://x/erums/cart", text: "Thank you for your order" })).toBe(true);
    expect(confirmed({ url: "https://x/erums/checkout", text: "Something went wrong" })).toBe(false);
    // Safeway's own confirmation address with its order number counts, before the page's words fill in (Nov 18).
    const conf = "https://www.safeway.com/erums/order/confirmation/198111519?summary=savingsApplied&";
    expect(confirmed({ url: conf, text: "Skip to search Grocery" }, conf)).toBe(true);
    expect(confirmed({ url: conf, text: "Skip to search Grocery" })).toBe(false); // the tab never moved there
    expect(confirmed({ url: conf, text: "Skip to search Grocery" }, "https://www.safeway.com/erums/checkout")).toBe(false);
    expect(confirmationNumberIn("https://www.safeway.com/erums/order/confirmation/198111519?summary=x")).toBe("198111519");
    expect(confirmed({ url: "https://www.safeway.com/erums/order/confirmation/", text: "" }, "https://www.safeway.com/erums/order/confirmation/")).toBe(false);
    const evil = "https://evil.example/www.safeway.com/order/confirmation/198111519";
    expect(confirmed({ url: evil, text: "" }, evil)).toBe(false);
  });

  it("counts a confirmation shown in place, without the page moving", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "pressed", pressed: true, after: { url: "https://x/erums/checkout", text: "Thank you for your order! Order number: 55512345" } } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: true, number: "55512345" });
  });

  it("starts no second order while one is going or unsure", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "pressed", pressed: true, after: null } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ unsure: true });
    const asked = vi.mocked(queueJob).mock.calls.filter((c) => c[0] === "checkoutPlace").length;
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, reasons: [expect.stringMatching(/already on its way|isn't sure/)] });
    expect(vi.mocked(queueJob).mock.calls.filter((c) => c[0] === "checkoutPlace")).toHaveLength(asked);
  });

  it("approves only the reading the phone showed: another Get ready meanwhile can't swap the figures (Nov 19)", async () => {
    const first = await ready();
    does = () => ({ ...READY, final: page((t) => t.replace("Estimated total $6.94", "Estimated total $7.94")) });
    await ready(); // someone else gets ready with other figures
    const a = await approve(req(), await faceId(), first.preparedId);
    expect(a).toMatchObject({ ok: true, totalCents: 694 });
    expect(await approve(req(), await faceId(), "nope")).toMatchObject({ ok: false, reasons: expect.arrayContaining(["Get ready again first."]) });
  });

  it("refuses to place what the phone didn't show, before asking the helper (Nov 19)", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    const id = await approved();
    expect(await placeOrder(id, { totalCents: 794, window: "Fri 6–7 AM" })).toMatchObject({ ok: false, reasons: [expect.stringMatching(/isn't what this phone showed/)] });
    expect(vi.mocked(queueJob).mock.calls.filter((c) => c[0] === "checkoutPlace")).toHaveLength(0);
  });

  it("works out the order when the helper reports, with no phone following, and a late report replaces not sure (Nov 19)", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    const approval = await approved();
    going = true;
    const w = await placeOrder(approval);
    expect(w).toHaveProperty("waiting");
    const job = jobs.get((w as { waiting: string }).waiting)!;
    // Lost by the helper (it reloaded): not sure, and the next order waits.
    Object.assign(job, { status: "failed", result: { error: "unsure" } });
    expect(await settleOrder({ ...job })).toMatchObject({ ok: false, unsure: true });
    // Then its own report arrives: ordered, the cart comes off, and the next order may start.
    Object.assign(job, { status: "done", pressedAt: new Date().toISOString(), result: { stopped: "pressed", pressed: true, after: { url: "https://x/erums/checkout", text: "Thank you for your order! Order number: 55512345" } } });
    expect(await settleOrder({ ...job })).toMatchObject({ ok: true, number: "55512345" });
    expect(await followOrder(job.id)).toMatchObject({ ok: true, number: "55512345" });
    expect((await recorded("order")).map((r) => r.ok)).toEqual([false, true]);
    going = false;
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "not pressed", pressed: false, why: "total" } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, reasons: [expect.stringMatching(/didn't match/), "Nothing was ordered."] });
  });

  it("is never sure nothing was ordered once the helper was let press, unless Safeway's page gave a reason (review, Nov 19)", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    // The press's answer was lost (the click started a navigation): not sure, and the next order waits.
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "pressed", pressed: "unknown", after: null } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, unsure: true });
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, reasons: [expect.stringMatching(/already on its way/)] });
  });

  it("an older helper's lost press (\"no answer\") is not sure either", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "not pressed", pressed: false, why: "no answer" } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, unsure: true });
  });

  it("a press reported for a job that was never let press isn't an order (review, Nov 19)", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    const approval = await approved();
    going = true;
    const w = await placeOrder(approval);
    const job = jobs.get((w as { waiting: string }).waiting)!;
    Object.assign(job, { status: "done", result: { stopped: "pressed", pressed: true, after: { url: "https://x/erums/checkout", text: "Thank you for your order! Order number: 55512345" } } });
    expect(await settleOrder({ ...job })).toMatchObject({ ok: false, unsure: true });
  });

  it("following a job Simmer doesn't have says not sure and records it, never \"already reported\" (review, Nov 19)", async () => {
    expect(await followOrder("nosuchjob")).toMatchObject({ ok: false, unsure: true, reasons: [expect.stringMatching(/Not sure/)] });
    expect((await recorded("order")).at(-1)).toMatchObject({ unsure: true, jobId: "nosuchjob", why: "job not found" });
  });

  it("says plainly when Safeway's cart isn't what was approved", async () => {
    process.env.CHECKOUT_ENABLED = "on";
    await passTestRun();
    does = (k, a) => (k === "checkoutPlace" ? ({ stopped: "cart changed", pressed: false } as never) : helper(k, a));
    expect(await placeOrder(await approved())).toMatchObject({ ok: false, reasons: ["Safeway's cart isn't what you approved. Nothing was ordered."] });
  });

  it("reads Safeway's order number when the page shows one", () => {
    expect(orderNumberIn("Thanks! Your order number is 2049384756.")).toBe("2049384756");
    expect(orderNumberIn("Order # 18374628 confirmed")).toBe("18374628");
    expect(orderNumberIn("Thanks for shopping")).toBe("");
  });
});

// Flash (Nov 16, outside review): Place Order looks for the approved Flash ready time and price, as the page writes them.
describe("what Place Order looks for on a Flash time", () => {
  it("asks for the day, then the ready time and price on the slot line", () => {
    const e = expectFor({
      windowId: "9999THU20261112FLASHDUG2105-2026-11-12", windowWords: "Ready by 9:05 PM price $3.95", faceId: "", itemsCents: 500,
      cartKey: "1x1", totalCents: 894, items: 1, card: "4242", store: "100 Main St", at: 0,
      slot: { ready: "Ready by 9:05 PM", type: "FLASH", priceCents: 395 },
    } as never);
    expect(e.whenLine).toBe("Pickup date & time Edit Thursday, Nov 12");
    expect(e.slotLine).toBe("Ready by 9:05 PM Slot type FLASH price $3.95");
    expect(pages.pickup.text).toContain(e.slotLine);
  });

  it("asks for the bags as approved, when the approval has them (Nov 16)", () => {
    const base = { windowId: FRI6.id, windowWords: "Fri 6–7 AM", faceId: "", itemsCents: 299, cartKey: "1x1", totalCents: 694, items: 1, card: "4242", store: "100 Main St", at: 0, slot: { ready: "6 AM - 7 AM", type: "", priceCents: 0 } };
    expect(expectFor({ ...base, bagsOwn: false } as never).bagsOwn).toBe(false);
    expect("bagsOwn" in expectFor(base as never)).toBe(false);
  });
});
