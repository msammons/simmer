import { describe, expect, it } from "vitest";
import { parseCsv, parseProfile } from "./parse";
import { addDays, zoned } from "./time";

describe("parsing", () => {
  it("reads quoted CSV with commas and blank lines", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n\n1,2\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["1", "2"]]);
  });
  it("reads the Profile tab and reports bad rows", () => {
    const { profile, ignored } = parseProfile(parseCsv([
      "who,type,value",
      "household,rule,Weeknights in 30 minutes",
      "Felix,role,\"Child, 11\"",
      "Felix,dislike,Mushrooms",
      "Felix,allergy,Peanuts",
      "Matt,role,Adult A",
      "Matt,favorite,Tacos",
      "Ghost,like,Soup",
    ].join("\n")));
    expect(profile.household).toEqual(["Weeknights in 30 minutes"]);
    expect(profile.people.map((p) => [p.name, p.isAdult, p.dislikes, p.allergies])).toEqual([["Felix", false, ["Mushrooms"], ["Peanuts"]], ["Matt", true, [], []]]);
    expect(ignored.map((i) => i.why[0])).toEqual(['unknown type "favorite" (use role, like, dislike, allergy, note)', "no role row, so this person is left out"]);
  });
});

describe("dates", () => {
  it("adds days by the calendar, across the nights the clocks change", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("turns a wall-clock time into the right moment in summer and winter", () => {
    expect(zoned("2026-07-01", "18:00").toISOString()).toBe("2026-07-02T01:00:00.000Z");
    expect(zoned("2026-12-01", "18:00").toISOString()).toBe("2026-12-02T02:00:00.000Z");
  });
});
