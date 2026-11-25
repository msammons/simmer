// What the Safeway helper is doing, in words (Nov 23, Sam: "some sort of status message saying what the app is doing as
// it goes"). The helper reports a short key for each step of a job (extension-working/safeway.js `step`); the app shows
// these words where the person is waiting, in place of what was there, never as a new bar. A key not listed here (a
// newer helper) shows the wait's own words.
export const STEP_WORDS: Record<string, string> = {
  cart: "Opening your Safeway cart…",
  search: "Searching Safeway…",
  wait: "Waiting for Safeway…",
  pickup: "Choosing Pickup…",
  signin: "Signing in to Safeway…",
  google: "Signing in to Safeway…",
  add: "Changing the cart…",
  orders: "Reading your Safeway orders…",
  checkout: "Starting Safeway's checkout…",
  times: "Reading pickup times…",
  day: "Reading that day's times…",
  time: "Choosing the time…",
  bags: "Setting the bags…",
  read: "Reading the order…",
  check: "Checking everything before ordering…",
  confirm: "Waiting for Safeway to confirm…",
};

/** The words for a step, or `fallback` when there's none or it isn't known. */
export const stepWords = (step: string | undefined | null, fallback: string): string => (step && STEP_WORDS[step]) || fallback;

/**
 * Every wait in the Check out sheet (Nov 24, Sam: "status messages don't always show when something is happening with
 * checkout"), with its own words for whenever the helper hasn't said a step: before its first step (queued, or waiting
 * behind another job), and while the phone waits on Simmer itself (Face ID, approving). Something is always said.
 * - times: the pickup days and times read on opening (or afresh after a stop)
 * - day: a day tapped, its times read
 * - read: a time tapped (or the bags changed, Try again, or after a test run passed), Safeway's checkout read with it
 * - faceid: Face ID asked, and its answer checked by Simmer (before a test run or placing)
 * - test: the test run going through Safeway's checkout
 * - place: the order being placed, and Safeway's confirmation waited for
 */
export type CheckoutWait = "times" | "day" | "read" | "faceid" | "test" | "place";
export const WAIT_WORDS: Record<CheckoutWait, string> = {
  times: "Reading pickup times…",
  day: "Reading that day's times…",
  read: "Reading Safeway's checkout…",
  faceid: "Checking with Face ID…",
  test: "Starting the test run…",
  place: "Placing the order…",
};

/** What the sheet says while `wait` goes: the helper's step when it's said one, else the wait's own words. */
export const waitWords = (wait: CheckoutWait, step?: string | null): string => (wait === "faceid" ? WAIT_WORDS.faceid : stepWords(step, WAIT_WORDS[wait]));

/** Shop's status beside Check out while Safeway's cart is read, before the helper's first step and after its last. */
export const LOOKING = "Looking…";
/** What Shop's status says while Safeway's cart is read: the helper's step, else Looking…. */
export const cartReadWords = (step?: string | null): string => stepWords(step, LOOKING);
