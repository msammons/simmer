import { describe, expect, it } from "vitest";
import { checkoutPrint } from "../../scripts/checkout-print.mjs";
import saved from "./checkout-print.json";

describe("the helper's checkout fingerprint", () => {
  it("is in step with the helper's code (run node scripts/checkout-print.mjs after changing it)", () => {
    expect(saved.print).toBe(checkoutPrint());
  });
});
