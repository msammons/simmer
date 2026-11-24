// Check out's sheet (Sam, Nov 24): Test run only when one is required, and a test run that passed reads Safeway again.
import { describe, expect, it } from "vitest";
import { afterReadAgain, afterTestRun, readyButtons } from "./checkout-sheet";
import type { ReadyView } from "./checkout-run";

const view = (over: Partial<ReadyView> = {}): ReadyView => ({
  store: "100 Main St", window: "Fri 6–7 AM", card: "4242", items: 1, totalCents: 694, stops: [], highlights: [], remember: false,
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
