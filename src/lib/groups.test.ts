// The List's groups (Sam, Nov 24): kept until Remove group, so a group with no things left stays.
import { describe, expect, it } from "vitest";
import { afterChange, groupsOf, namesOf, renamed, sectionOf, type Group } from "./groups";

const thing = (section: Group["section"], group: string) => ({ section, group });

describe("groups", () => {
  it("reads the groups on things as kept, each once per section whatever its capitals", () => {
    expect(groupsOf(undefined, [thing("fresh", "Cheese"), thing("fresh", "cheese"), thing("pantry", ""), thing("pantry", "Snacks")]))
      .toEqual([{ section: "fresh", name: "Cheese" }, { section: "pantry", name: "Snacks" }]);
    expect(groupsOf([{ section: "fresh", name: "Milk" }], [])).toEqual([{ section: "fresh", name: "Milk" }]);
  });

  it("keeps a group when its last thing is removed, ungrouped or put in another group", () => {
    const one = [thing("fresh", "Milk")];
    expect(afterChange([], one, [])).toEqual([{ section: "fresh", name: "Milk" }]);
    expect(afterChange([], one, [thing("fresh", "")])).toEqual([{ section: "fresh", name: "Milk" }]);
    expect(afterChange([], one, [thing("fresh", "Dairy")])).toEqual([{ section: "fresh", name: "Dairy" }, { section: "fresh", name: "Milk" }]);
  });

  it("moves a group with its things to another part of the list, and keeps it where some stay", () => {
    expect(afterChange([{ section: "pantry", name: "Oats" }], [thing("pantry", "Oats")], [thing("fresh", "Oats")])).toEqual([{ section: "fresh", name: "Oats" }]);
    expect(afterChange([], [thing("pantry", "Oats"), thing("pantry", "Oats")], [thing("fresh", "Oats"), thing("pantry", "Oats")]))
      .toEqual([{ section: "fresh", name: "Oats" }, { section: "pantry", name: "Oats" }]);
  });

  it("renames every copy of a group, merges into one already there, and removes it with an empty name", () => {
    const gs: Group[] = [{ section: "fresh", name: "Cheese" }, { section: "pantry", name: "cheese" }, { section: "fresh", name: "Dairy" }];
    expect(renamed(gs, "CHEESE", "Fancy cheese")).toEqual([{ section: "fresh", name: "Dairy" }, { section: "fresh", name: "Fancy cheese" }, { section: "pantry", name: "Fancy cheese" }]);
    expect(renamed(gs, "cheese", "dairy")).toEqual([{ section: "fresh", name: "dairy" }, { section: "pantry", name: "dairy" }]);
    expect(renamed(gs, "cheese", "")).toEqual([{ section: "fresh", name: "Dairy" }]);
  });

  it("gives the pickers each name once, A to Z, and where a group sits", () => {
    const gs: Group[] = [{ section: "pantry", name: "Snacks" }, { section: "fresh", name: "Cheese" }, { section: "pantry", name: "cheese" }];
    expect(namesOf(gs)).toEqual(["Cheese", "Snacks"]);
    expect(sectionOf(gs, "SNACKS")).toBe("pantry");
    expect(sectionOf(gs, "nope")).toBeUndefined();
  });
});
