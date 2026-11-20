import { describe, expect, it } from "vitest";
import { checkoutPrint, covered, split, withoutVersion } from "../../scripts/checkout-print.mjs";
import saved from "./checkout-print.json";

const parts = (name: string): string[] => split(covered().find(([n]: string[]) => n === name)![1], name).parts;
const braces = (s: string) => [...s].reduce((n, c) => n + (c === "{" ? 1 : c === "}" ? -1 : 0), 0);

describe("the helper's checkout fingerprint", () => {
  it("is in step with the helper's code (run node scripts/checkout-print.mjs after changing it)", () => {
    expect(saved.print).toBe(checkoutPrint());
  });

  it("leaves the helper's version out, and nothing else in its manifest", () => {
    const a = withoutVersion(JSON.stringify({ version: "26.11.19", permissions: ["tabs"] }));
    expect(a).toBe(withoutVersion(JSON.stringify({ version: "26.12.1", permissions: ["tabs"] })));
    expect(a).not.toBe(withoutVersion(JSON.stringify({ version: "26.11.19", permissions: ["tabs", "cookies"] })));
    expect(covered().find(([n]: string[]) => n === "extension-working/manifest.json")![1]).not.toContain('"version"');
  });

  it("marks only whole marker lines, and stops on nested, unclosed or stray markers", () => {
    expect(split("a\n// not-checkout:start x\nb\n// not-checkout:end\nc").kept).toBe("a\nc");
    expect(() => split('x = "// not-checkout:start"; press();')).toThrow();
    expect(() => split("// not-checkout:start\n// not-checkout:start\n// not-checkout:end\n// not-checkout:end")).toThrow();
    expect(() => split("// not-checkout:start\nb")).toThrow();
    expect(() => split("b\n// not-checkout:end")).toThrow();
    expect(() => split("// not-checkout:endXYZ")).toThrow();
  });

  // What each marked part may hold (outside review, Nov 18): if a part grows over code checkout runs, this fails.
  it("keeps only searching and the Purchases page out, in safeway.js: whole functions, nothing run at load", () => {
    const ps = parts("extension-working/safeway.js");
    expect(ps).toHaveLength(2);
    expect(ps.map((p) => [...p.matchAll(/^async function (\w+)\(/gm)].map((m) => m[1]))).toEqual([["searchHere"], ["readOrders"]]);
    for (const p of ps) {
      expect(braces(p)).toBe(0);
      // At the left edge only comments, the one function's first line and its closing brace: nothing that runs at load.
      for (const line of p.split("\n").filter((l) => l && !/^\s/.test(l))) expect(line).toMatch(/^(\/\/|\/\*\*|\*|\s*\*|async function (searchHere|readOrders)\(|\})/);
    }
  });

  it("keeps only quantities, snapshots, the Purchases page and samples out, in page.js, after every checkout action", () => {
    const file = covered().find(([n]) => n === "extension-working/page.js")![1];
    const ps = parts("extension-working/page.js");
    expect(ps).toHaveLength(2);
    const allowed = ["setQty", "snapshot", "orders", "sample"];
    expect(ps.flatMap((p) => [...p.matchAll(/action === "(\w+)"/g)].map((m) => m[1]))).toEqual(allowed);
    for (const p of ps) {
      expect(braces(p)).toBe(0);
      // At the action level (two spaces) only comments, the allowed actions and their closing braces.
      for (const line of p.split("\n").filter((l) => /^ {2}\S/.test(l))) expect(line).toMatch(/^ {2}(\/\/|if \(action === "(setQty|snapshot|orders|sample)"\)|\})/);
    }
    // Every checkout action comes before the first marked part, so nothing marked runs on the way to one.
    const first = file.indexOf("// not-checkout:start");
    for (const a of ["read", "look", "pressCheckout", "pressDay", "pressPickupEdit", "placeOrder", "bagsState", "setBags", "pressMoreTimes", "waitFor", "readWindows", "chooseWindow"])
      expect(file.indexOf(`action === "${a}"`), a).toBeLessThan(first);
  });
});
