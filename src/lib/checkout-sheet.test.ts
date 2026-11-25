// Check out's sheet (Sam, Nov 24): Test run only when one is required, and a test run that passed reads Safeway again.
import { describe, expect, it } from "vitest";
import { afterReadAgain, afterTestRun, dayAfterGone, readyButtons, stopButtons, timesRanOut, TIMES_RAN_OUT } from "./checkout-sheet";
import type { ReadyView } from "./checkout-run";

const view = (over: Partial<ReadyView> = {}): ReadyView => ({
  store: "100 Main St", window: "Fri 6–7 AM", card: "4242", items: 1, totalCents: 694, stops: [], highlights: [],
  bagsOwn: true, feesCents: null, canOrder: true, orderWhy: "", needsTest: false, preparedId: "abc", ...over,
});

describe("what a reading offers", () => {
  it("only Place order once this checkout has passed a test run", () => {
    expect(readyButtons(view())).toEqual({ place: true, test: false, enabled: true });
  });
  it("Test run, and no Place order, while a test run is required", () => {
    expect(readyButtons(view({ canOrder: false, orderWhy: "Do a test run first", needsTest: true }))).toEqual({ place: false, test: true, enabled: true });
  });
  it("Test run while one is required even with the server's switch off", () => {
    expect(readyButtons(view({ canOrder: false, orderWhy: "Ordering is turned off for now.", needsTest: true }))).toMatchObject({ place: false, test: true });
  });
  it("neither when placing is closed for another reason and no test run is required", () => {
    expect(readyButtons(view({ canOrder: false, orderWhy: "Ordering is turned off for now." }))).toMatchObject({ place: false, test: false });
  });
  it("greyed while something stops it or there's nothing to approve", () => {
    expect(readyButtons(view({ stops: ["Over the limit."] })).enabled).toBe(false);
    expect(readyButtons(view({ totalCents: null })).enabled).toBe(false);
    expect(readyButtons(view({ preparedId: "" })).enabled).toBe(false);
  });
});

describe("after a test run", () => {
  it("one that passed reads Safeway again at once; one that didn't shows why", () => {
    expect(afterTestRun({ ok: true, would: "Would place $6.94 · Fri 6–7 AM" })).toBe("read again");
    expect(afterTestRun({ ok: false, reasons: ["Safeway's pickup time changed."] })).toBe("show");
  });
  it("the reading made again shows, or the times again when the time has gone by", () => {
    expect(afterReadAgain(view())).toBe("ready");
    expect(afterReadAgain(view({ timeGone: true, preparedId: "", stops: ["That pickup time isn't offered any more. Pick another time."] }))).toBe("times");
  });
});

// Review, Nov 24.
describe("an out-of-date helper", () => {
  it("offers no test run (it wouldn't count): the muted line says the helper needs updating", () => {
    const v = view({ canOrder: false, orderWhy: "The helper on the computer needs updating first.", needsTest: true, helperOutdated: true });
    expect(readyButtons(v)).toMatchObject({ place: false, test: false });
  });
});

describe("the times read again", () => {
  it("on the same day when only the time went, from Safeway's first day when the day went", () => {
    expect(dayAfterGone({ dayGone: false }, "Fri tile")).toBe("Fri tile");
    expect(dayAfterGone({ dayGone: true }, "Fri tile")).toBeUndefined();
    expect(dayAfterGone({}, "")).toBeUndefined();
  });
  it("afresh when the times shown ran out, never the old ones", () => {
    expect(timesRanOut(TIMES_RAN_OUT)).toBe(true);
    expect(timesRanOut("The computer with Safeway didn't finish. Try again.")).toBe(false);
  });
});

describe("the controls under what stopped it (every message names one that's showing)", () => {
  it("Pick another time, and Try again with a time picked", () => {
    expect(stopButtons(["The cart changed since. Try again."], true)).toEqual({ pickTime: true, tryAgain: true });
    expect(stopButtons(["Over the limit."], false)).toEqual({ pickTime: true, tryAgain: false });
  });
  it("only the times when the time or day itself has gone, never Try again with it", () => {
    expect(stopButtons(["That pickup time isn't offered any more. Pick another time."], true)).toEqual({ pickTime: true, tryAgain: false });
    expect(stopButtons(["That pickup day isn't offered any more. Pick another day."], true)).toEqual({ pickTime: true, tryAgain: false });
  });
  it("after a test run passed but the reading again stopped, Pick another time shows (no dead end)", () => {
    expect(stopButtons(["Safeway's bags couldn't be set. Try again."], true).pickTime).toBe(true);
  });
  it("nothing after not sure the order went through", () => {
    expect(stopButtons(["Not sure the order went through. Check Safeway before trying again."], true, true)).toEqual({ pickTime: false, tryAgain: false });
  });
});
