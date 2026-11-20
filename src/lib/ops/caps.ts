// A day's limit on what costs a reading by the recipe and grocery helper (Nov 19): anyone with the passcode can drive
// recipe reading and filing, so each has a generous cap per day (the household's day). Counted in Redis, gone after two days.
import { AsyncLocalStorage } from "node:async_hooks";
import { NS } from "../store/tabs";
import { todayIn } from "../time";
import { bump } from "./counter";

export const CAPS = { read: 200, filing: 2000 } as const;
export type CapKind = keyof typeof CAPS;

/** What a person sees when today's recipe readings have run out. */
export const READ_CAP_REACHED = "That's all the recipes that can be read today. Try again tomorrow.";

const counted = new AsyncLocalStorage<ReadonlySet<CapKind>>();

/**
 * Runs `fn` as one counted `kind` (Nov 19, review: reading a list of ideas counted once in the route and twice more
 * inside): the route counts it with withinCap first, and the calls made while `fn` runs aren't counted again.
 */
export const counting = <T>(kind: CapKind, fn: () => T): T => counted.run(new Set([...(counted.getStore() ?? []), kind]), fn);

/**
 * Counts one more of `kind` today and says whether it's still within the cap. Call it right before each one (a failure
 * to count lets it through: the cap guards against runaway use, it never stands in the way of the household).
 */
export async function withinCap(kind: CapKind, now = new Date()): Promise<boolean> {
  if (counted.getStore()?.has(kind)) return true; // this request has already been counted (see `counting`)
  try {
    return (await bump(`${NS}:cap:${kind}:${todayIn(now)}`, 2 * 86400)) <= CAPS[kind];
  } catch (e) {
    console.error("couldn't count today's", kind, e);
    return true;
  }
}
