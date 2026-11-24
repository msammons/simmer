// What Check out's sheet offers for a reading of Safeway's checkout, and what follows a test run (Sam, Nov 24), as plain
// code with tests (checkout-sheet.test.ts). The server's checks (checkout-run.ts) are unchanged by any of this: these
// only choose what the sheet shows.
import type { ReadyView, RunResult } from "./checkout-run";

/** Nothing stops it and there's a reading of its own to approve. */
const approvable = (v: ReadyView) => !v.stops.length && v.totalCents !== null && Boolean(v.preparedId);

/**
 * The buttons under a reading: Place order when the server allows placing; Test run only when one is required (this
 * checkout's fingerprint hasn't passed a test run: "We only need the test run button if it's required"). Both are
 * greyed while something stops the reading.
 */
export function readyButtons(v: ReadyView): { place: boolean; test: boolean; enabled: boolean } {
  return { place: v.canOrder, test: v.needsTest, enabled: approvable(v) };
}

/**
 * After a test run (Sam, Nov 24: "don't need to pick another time on a test"): one that passed reads Safeway again at
 * once with the same time and bags, a new reading with its own id (the approval it used is gone, and each lasts 2
 * minutes); one that didn't shows what stopped it.
 */
export const afterTestRun = (r: RunResult): "read again" | "show" => (r.ok ? "read again" : "show");

/** A reading made again: the time gone by then shows the times again (with an Alert saying so); else it's shown. */
export const afterReadAgain = (v: ReadyView): "times" | "ready" => (v.timeGone ? "times" : "ready");
