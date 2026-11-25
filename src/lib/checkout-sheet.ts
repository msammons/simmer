// What Check out's sheet offers for a reading of Safeway's checkout, and what follows a test run (Sam, Nov 24), as plain
// code with tests (checkout-sheet.test.ts). The server's checks (checkout-run.ts) are unchanged by any of this: these
// only choose what the sheet shows.
import type { ReadyView, RunResult } from "./checkout-run";
// TIMES_RAN_OUT is also the server's words (checkout-run.ts imports it), so the two can't drift apart.

/** Nothing stops it and there's a reading of its own to approve. */
const approvable = (v: ReadyView) => !v.stops.length && v.totalCents !== null && Boolean(v.preparedId);

/**
 * The buttons under a reading: Place order when the server allows placing; Test run only when one is required (this
 * checkout's fingerprint hasn't passed a test run: "We only need the test run button if it's required"). Both are
 * greyed while something stops the reading.
 */
export function readyButtons(v: ReadyView): { place: boolean; test: boolean; enabled: boolean } {
  // An out-of-date helper's run wouldn't count (checkout-run.ts followTestRun), so none is offered then: the muted line
  // says the helper needs updating instead (review, Nov 24).
  return { place: v.canOrder, test: v.needsTest && !v.helperOutdated, enabled: approvable(v) };
}

/**
 * After a test run (Sam, Nov 24: "don't need to pick another time on a test"): one that passed reads Safeway again at
 * once with the same time and bags, a new reading with its own id (the approval it used is gone, and each lasts 2
 * minutes); one that didn't shows what stopped it.
 */
export const afterTestRun = (r: RunResult): "read again" | "show" => (r.ok ? "read again" : "show");

/** A reading made again: the time gone by then shows the times again (with an Alert saying so); else it's shown. */
export const afterReadAgain = (v: ReadyView): "times" | "ready" => (v.timeGone ? "times" : "ready");

/**
 * The times read again after the picked one went (review, Nov 24): the same day when only the time went, else Safeway's
 * first day (undefined), since the day itself is gone.
 */
export const dayAfterGone = (v: Pick<ReadyView, "dayGone">, day: string | undefined): string | undefined => (v.dayGone ? undefined : day || undefined);

/**
 * Getting ready refuses a time that isn't among those just offered (they're kept 10 minutes from the last reading). The
 * sheet then reads the times afresh rather than showing the old ones, where every tap would be refused again.
 */
export const TIMES_RAN_OUT = "Those pickup times are out of date, so they've been read again. Pick a time.";
export const timesRanOut = (problem: string) => problem === TIMES_RAN_OUT;

/** Safeway no longer offers the time or day: the words checkout.ts uses for those stops. */
const GONE = /isn't offered any more/;

/** "Check Safeway": an order may be on its way or may have gone through (not sure, or another order going). */
const CHECK_SAFEWAY = /Check Safeway/;

/**
 * The controls under what stopped a reading, a test run or placing (review, Nov 24), so that every message names a
 * control that's showing: Pick another time always (the times read afresh); Try again (the same time and bags read
 * again) only with a time picked and when that time hasn't gone, since a gone time must offer the times instead.
 * None after "not sure the order went through", or when another order may be on its way ("Check Safeway"): nothing
 * that could lead to a second order.
 */
export function stopButtons(reasons: string[], picked: boolean, unsure = false): { pickTime: boolean; tryAgain: boolean } {
  if (unsure || reasons.some((r) => CHECK_SAFEWAY.test(r))) return { pickTime: false, tryAgain: false };
  return { pickTime: true, tryAgain: picked && !reasons.some((r) => GONE.test(r)) };
}

