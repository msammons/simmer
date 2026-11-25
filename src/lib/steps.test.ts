// The words said while something is happening (Nov 23; Nov 24, Sam: "status messages don't always show when something
// is happening with checkout"): every step the helper reports has words, and every wait has its own words for when the
// helper hasn't said a step yet.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOOKING, STEP_WORDS, WAIT_WORDS, cartReadWords, stepWords, waitWords, type CheckoutWait } from "./steps";

/** Every step key the helper sends (read from its source, never changed here). */
const helperSteps = (): string[] => {
  const src = readFileSync(new URL("../../extension-working/safeway.js", import.meta.url), "utf8");
  const keys = new Set<string>();
  for (const m of src.matchAll(/\bstep\(([^)]*)\)/g)) for (const k of m[1].matchAll(/"([a-z][a-z-]*)"/g)) keys.add(k[1]);
  return [...keys];
};

describe("the helper's steps in words", () => {
  it("has words for every step the helper sends, checkout's included", () => {
    const keys = helperSteps();
    expect(keys).toEqual(expect.arrayContaining(["cart", "wait", "checkout", "times", "day", "time", "bags", "read", "check", "confirm"]));
    for (const k of keys) expect(STEP_WORDS[k], k).toMatch(/…$/);
  });

  it("says the wait's own words for no step or one it doesn't know", () => {
    expect(stepWords(undefined, "Looking…")).toBe("Looking…");
    expect(stepWords("something-new", "Looking…")).toBe("Looking…");
    expect(stepWords("bags", "Looking…")).toBe("Setting the bags…");
  });
});

describe("the Check out sheet's waits", () => {
  const waits: CheckoutWait[] = ["times", "day", "read", "faceid", "test", "place"];

  it("has short, plain words for every wait before the helper's first step", () => {
    expect(waits.map((w) => waitWords(w))).toEqual([
      "Reading pickup times…", "Reading that day's times…", "Reading Safeway's checkout…", "Checking with Face ID…", "Starting the test run…", "Placing the order…",
    ]);
    for (const w of waits) expect(WAIT_WORDS[w].length).toBeLessThan(32);
  });

  it("says the helper's step once it's said one, in every wait that follows the helper", () => {
    expect(waitWords("times", "cart")).toBe("Opening your Safeway cart…");
    expect(waitWords("day", "day")).toBe("Reading that day's times…");
    expect(waitWords("read", "time")).toBe("Choosing the time…");
    expect(waitWords("test", "check")).toBe("Checking everything before ordering…");
    expect(waitWords("place", "confirm")).toBe("Waiting for Safeway to confirm…");
  });

  it("says Face ID while Face ID is asked and checked, whatever step was last", () => {
    expect(waitWords("faceid", "read")).toBe("Checking with Face ID…");
  });

  it("falls back to the wait's words for a step it doesn't know", () => {
    expect(waitWords("place", "something-new")).toBe("Placing the order…");
    expect(waitWords("test", null)).toBe("Starting the test run…");
  });

  it("never uses technical words", () => {
    for (const w of [...Object.values(WAIT_WORDS), ...Object.values(STEP_WORDS), LOOKING]) expect(w).not.toMatch(/computer|helper|server|job|queue|request|loading/i);
  });
});

describe("Shop's status while Safeway's cart is read", () => {
  it("says Looking… before the helper's first step, then its steps", () => {
    expect(cartReadWords(undefined)).toBe("Looking…");
    expect(cartReadWords("wait")).toBe("Waiting for Safeway…");
  });
});
