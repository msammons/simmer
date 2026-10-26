import { describe, expect, it } from "vitest";
import { loadList } from "./groceries";
import { loadWeek, markMade, saveWeek } from "./plan";
import { addDays, todayIn } from "./time";
import { planLunches, weekOf } from "./week";

describe("saving the week", () => {
  const day = addDays(todayIn(), 1);
  it("saves the nights and puts what they need on the list, once", async () => {
    const week = await loadWeek(weekOf(day));
    expect(week.nights).toHaveLength(7);
    expect(week.lunchOptions.length).toBeGreaterThan(5);
    const nights = week.nights.map((n) => (n.date === day ? { ...n, kind: "regular" as const, meal: "turkey-chili-1", pinned: true } : n));
    const lunches = planLunches(week.monday, week.people.filter((p) => !p.isAdult), week.lunchOptions);
    const first = await saveWeek(nights, lunches, "Marcela");
    expect(first.added).toBeGreaterThan(5);
    const { items } = await loadList();
    const turkey = items.find((i) => i.item === "ground turkey")!;
    expect(turkey).toMatchObject({ section: "fresh", check: false });
    expect(turkey.for).toMatch(/turkey chili/);
    expect(items.find((i) => i.item === "chili powder")).toMatchObject({ section: "pantry", check: true });
    expect((await saveWeek(nights, lunches, "Marcela")).added).toBe(0);
    const again = await loadWeek(day);
    expect(again.planned).toBe(true);
    expect(again.nights.find((n) => n.date === day)).toMatchObject({ meal: "turkey-chili-1", pinned: true, plannedBy: "Marcela" });
    await markMade(day, true);
    expect((await loadWeek(day)).lastMade["turkey-chili-1"]).toBe(day);
  });
});
