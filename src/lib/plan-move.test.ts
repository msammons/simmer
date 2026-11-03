import { describe, expect, it, vi } from "vitest";
import { addDays, todayIn } from "./time";

// The old Plan and Lunch plan tabs, as they were before planning by number (Nov 3): yesterday's night, coming nights
// (one made, one waiting for its groceries, one with the boys' own dinner), and lunches.
const today = todayIn(), yesterday = addDays(today, -1), soon = addDays(today, 1), later = addDays(today, 9);
const OLD: Record<string, string> = {
  "plan.csv": [
    "date,meal,kids_meal,effort,eating,pinned,planned_by,made,notes,groceries",
    `${yesterday},tacos-1,,quick,everyone,,Robin,,,`,
    `${today},turkey-chili-1,,regular,everyone,yes,Robin,yes,,`,
    `${soon},salmon-1,mac-1,quick,kids separate,,Robin,,,`,
    `${later},tacos-1,,quick,everyone,,Robin,,,later`,
    `${addDays(today, 2)},,,skip,everyone,,,,,`,
  ].join("\n"),
  "lunch-plan.csv": [
    "date,kid,main,fruit,side,treat,snack,school_lunch,no_school,groceries",
    `${yesterday},Theo,Bean and cheese burrito,Grapes,Goldfish,,,,,`,
    `${soon},Theo,Bean and cheese burrito,Grapes,Goldfish,,Cheese and crackers,,,`,
    `${soon},Leo,,,,,,,yes,`,
  ].join("\n"),
};
vi.mock("node:fs/promises", async (actual) => {
  const real = await actual<typeof import("node:fs/promises")>();
  const readFile = (async (p: string, enc: BufferEncoding) => {
    const name = String(p).split("/").pop()!;
    return name in OLD ? OLD[name] : real.readFile(p, enc);
  }) as typeof real.readFile;
  return { ...real, default: { ...real, readFile }, readFile };
});

describe("moving the old plan over", () => {
  it("turns coming nights and lunches into things to make and pack, once", async () => {
    const { loadPlan } = await import("./plan");
    const { loadList } = await import("./groceries");
    const p = await loadPlan();
    // Not yesterday's, not the one made, not the skipped night.
    expect(p.dishes.map((d) => [d.kind, d.recipe]).sort()).toEqual([["kids", "mac-1"], ["quick", "salmon-1"], ["quick", "tacos-1"]]);
    expect(p.lunches).toHaveLength(1);
    expect(p.lunches[0]).toMatchObject({ kid: "Theo", main: "Bean and cheese burrito", snack: "Cheese and crackers" });
    expect(p.lastMade["turkey-chili-1"]).toBe(today); // made in the old plan still counts
    // The night whose groceries were waiting has them on the list now; the others had theirs already.
    const items = (await loadList()).items;
    expect(items.some((i) => i.item === "ground beef")).toBe(true);
    expect(items.some((i) => i.item === "broccoli")).toBe(false);
    const again = await loadPlan();
    expect(again.dishes).toHaveLength(3);
    expect(again.lunches).toHaveLength(1);
  });
});
