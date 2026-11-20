// Typed records over stored rows (Nov 19): the rows written must stay exactly as live data has them.
import { beforeEach, describe, expect, it } from "vitest";
import { append, change, load, save, strings, table, useTabStore, writeTab, readTab } from ".";
import { memoryStore } from "./memory";

beforeEach(() => useTabStore(memoryStore()));

type Thing = { id: string; name: string; done: boolean };
const THINGS = table<Thing>({
  tab: "Things", headers: ["id", "name", "done"],
  read: (get) => (get("id") && get("name") ? { id: get("id"), name: get("name"), done: /^(yes|true)$/i.test(get("done")) } : null),
  cells: (x) => ({ id: x.id, name: x.name, done: x.done ? "yes" : "no" }),
  key: (x) => x.id,
});

describe("writing records back", () => {
  it("keeps the tab's own column order, a column only it has, and unchanged rows exactly", async () => {
    await writeTab("Things", [["Done", "note", "ID", "name"], ["TRUE", "keep me", "a", "milk"], ["no", "mine", "b", "eggs"]]);
    await change(THINGS, (all) => all.map((x) => (x.id === "b" ? { ...x, done: true } : x)));
    expect(await readTab("Things")).toEqual([["Done", "note", "ID", "name"], ["TRUE", "keep me", "a", "milk"], ["yes", "mine", "b", "eggs"]]);
  });
  it("adds a column it lacks at the end, and new records under every header", async () => {
    await writeTab("Things", [["id", "name"], ["a", "milk"]]);
    await append(THINGS, [{ id: "b", name: "eggs", done: true }]);
    expect(await readTab("Things")).toEqual([["id", "name", "done"], ["a", "milk"], ["b", "eggs", "yes"]]);
  });
  it("keeps rows that don't read as a record, and drops blank ones", async () => {
    await writeTab("Things", [["id", "name", "done"], ["", "no id", ""], ["", "", ""], ["a", "milk", "no"]]);
    await save(THINGS, []);
    expect(await readTab("Things")).toEqual([["id", "name", "done"], ["", "no id", ""]]);
  });
  it("starts a missing tab with its headers", async () => {
    await save(THINGS, [{ id: "a", name: "milk", done: false }]);
    expect(await readTab("Things")).toEqual([["id", "name", "done"], ["a", "milk", "no"]]);
  });
  it("gives a row without an id the same one on every read, and writes it in when the row changes", async () => {
    const T = strings("Kept", ["id", "item", "amount"], { idFrom: (get) => get("item") });
    await writeTab("Kept", [["id", "item", "amount"], ["", "salmon", "2"], ["", "peas", "1"]]);
    const [salmon] = await load(T);
    expect((await load(T))[0].id).toBe(salmon.id);
    await change(T, (all) => all.map((r) => (r.id === salmon.id ? { ...r, amount: "1" } : r)));
    expect(await readTab("Kept")).toEqual([["id", "item", "amount"], [salmon.id, "salmon", "1"], ["row-peas", "peas", "1"]]);
  });
  it("writes made-up ids in whenever the tab is saved, so removing the first of two duplicates leaves the second its id", async () => {
    const T = strings("Kept", ["id", "item", "amount"], { idFrom: (get) => get("item") });
    await writeTab("Kept", [["id", "item", "amount"], ["", "salmon", "2"], ["", "salmon", "1"]]);
    const [first, second] = await load(T);
    expect([first.id, second.id]).toEqual(["row-salmon", "row-salmon-2"]);
    await change(T, (all) => all.filter((r) => r.id !== first.id));
    expect(await load(T)).toEqual([{ id: "row-salmon-2", item: "salmon", amount: "1" }]);
    expect(await readTab("Kept")).toEqual([["id", "item", "amount"], ["row-salmon-2", "salmon", "1"]]);
  });
  it("keeps a changed row's cells past the header row", async () => {
    await writeTab("Things", [["id", "name", "done"], ["a", "milk", "no", "typed beside", "and more"]]);
    await change(THINGS, (all) => all.map((x) => ({ ...x, done: true })));
    expect(await readTab("Things")).toEqual([["id", "name", "done"], ["a", "milk", "yes", "typed beside", "and more"]]);
  });
  it("keeps rows that don't read as a record where they were", async () => {
    await writeTab("Things", [["id", "name", "done"], ["", "a note on top", ""], ["a", "milk", "no"], ["", "about milk", ""], ["b", "eggs", "no"], ["c", "jam", "no"], ["", "about jam", ""]]);
    await change(THINGS, (all) => [...all.filter((x) => x.id !== "c"), { id: "d", name: "tea", done: false }]);
    expect(await readTab("Things")).toEqual([["id", "name", "done"], ["", "a note on top", ""], ["a", "milk", "no"], ["", "about milk", ""], ["b", "eggs", "no"], ["d", "tea", "no"], ["", "about jam", ""]]);
  });
  it("writes nothing when a change answers the same records", async () => {
    await writeTab("Things", [["id", "name"], ["a", "milk"]]);
    await change(THINGS, (all) => all);
    expect(await readTab("Things")).toEqual([["id", "name"], ["a", "milk"]]);
  });
});
