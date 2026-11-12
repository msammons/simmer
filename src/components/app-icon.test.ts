// The icon drawn in the page matches the icon file (public/icon.svg), so changing one without the other fails here.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_ICON } from "./app-icon";

describe("the app icon", () => {
  it("is the same as public/icon.svg", () => {
    expect(APP_ICON).toBe(readFileSync(new URL("../../public/icon.svg", import.meta.url), "utf8"));
  });
});
