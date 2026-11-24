// What the Safeway helper is doing, in words (Nov 23, Sam: "some sort of status message saying what the app is doing as
// it goes"). The helper reports a short key for each step of a job (extension-working/safeway.js `step`); the app shows
// these words where the person is waiting, in place of what was there, never as a new bar. A key not listed here (a
// newer helper) leaves the words as they were.
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
