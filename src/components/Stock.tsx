"use client";
import { useState } from "react";
import { type Frozen, type Item, type Kitchen, type ListState, type Section, type Staple, type Store } from "@/lib/client";
import { norm } from "@/lib/words";
import { STORE_NAMES } from "./Shop";
import { BrandBar, Button, EmptyState, Group, Notice } from "./ui";

/**
 * Stock (the redesign, Nov 2): what the house keeps, by section, A to Z (checking never moves a row). Simmer assumes we
 * have everything: a tap means we're out and puts it on its store's list; a second tap takes it back off. What this
 * week's meals need is highlighted, with the amount. ⋯ moves a thing to another section or takes it out of Stock.
 */
const SECTIONS: { id: Section; name: string }[] = [{ id: "fresh", name: "Fresh" }, { id: "pantry", name: "Pantry" }, { id: "freezer", name: "Freezer" }, { id: "household", name: "Household" }];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type StockActions = {
  /** Out: on its store's list. */
  out: (name: string, store: Store, section: Section, amount?: string) => void;
  /** Have it after all: off the list again. */
  have: (it: Item) => void;
  /** A highlighted (meal) item we're out of: it joins the list. */
  need: (it: Item) => void;
  takeOut: (f: Frozen) => void;
  keepAdd: (text: string, section?: Section) => void;
  keepMove: (item: string, section: Section) => void;
  keepRemove: (s: Staple) => void;
};

type StockRow = { key: string; name: string; section: Section; have: boolean; meal: Item | null; open: Item | null; staple: Staple | null; frozen: Frozen | null; store: Store };

function rowsOf(list: ListState | null, kitchen: Kitchen | null): StockRow[] {
  const items = list?.items ?? [];
  const onList = (name: string) => items.find((i) => !i.checked && !i.check && norm(i.item) === norm(name)) ?? null;
  const mealOf = (name: string) => items.find((i) => i.check && !i.checked && norm(i.item) === norm(name)) ?? null;
  const rows: StockRow[] = (list?.staples ?? []).map((s) => {
    const open = onList(s.item);
    return { key: `s|${norm(s.item)}`, name: s.item, section: s.section, have: !open, meal: mealOf(s.item), open, staple: s, frozen: null, store: s.store };
  });
  const known = new Set(rows.map((r) => norm(r.name)));
  // What the meals need that isn't kept as a staple: highlighted in its section until it's checked.
  for (const it of items) {
    if (!it.check || it.checked || known.has(norm(it.item))) continue;
    known.add(norm(it.item));
    rows.push({ key: `m|${it.id}`, name: it.item, section: it.section, have: true, meal: it, open: null, staple: null, frozen: null, store: it.store });
  }
  for (const f of kitchen?.freezer ?? []) {
    if (known.has(norm(f.item))) continue;
    known.add(norm(f.item));
    const open = onList(f.item);
    rows.push({ key: `f|${f.id}`, name: f.item, section: "freezer", have: !open, meal: null, open, staple: null, frozen: f, store: (f.store as Store) || "safeway" });
  }
  return rows;
}

function Circle({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full ${on ? "bg-[#2E7D4F] text-white" : "border-2 border-muted/50"}`}>
      {on && <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
    </span>
  );
}

export function StockScreen({ list, kitchen, error, act }: { list: ListState | null; kitchen: Kitchen | null; error: string | null; act: StockActions }) {
  const [text, setText] = useState("");
  const [removed, setRemoved] = useState<Staple | null>(null); // for Undo
  const rows = rowsOf(list, kitchen);
  const tap = (r: StockRow) => {
    if (!r.have && r.open) return act.have(r.open);
    if (r.meal) return act.need(r.meal);
    if (r.frozen) act.takeOut(r.frozen);
    act.out(r.name, r.store, r.section, r.staple?.quantity);
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (text.trim()) { act.keepAdd(text.trim()); setText(""); } };
  return (
    <div className="space-y-5">
      <BrandBar />
      <h1 className="sr-only">Stock</h1>
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something" aria-label="Add something to Stock" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </form>
      <div className="flex items-center gap-1.5 whitespace-nowrap px-4 t-foot text-muted">
        <span aria-hidden className="flex size-4 items-center justify-center rounded-full bg-[#2E7D4F] text-white">
          <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        We have it
        <span aria-hidden className="ml-3 size-4 rounded-[5px] bg-accent/15" />
        In meals
      </div>
      {removed && <Notice tone="info" onClick={() => { act.keepAdd(removed.item, removed.section); setRemoved(null); }}>Removed {cap(removed.item)} from Stock. <span className="font-semibold text-accent">Undo</span></Notice>}
      {list && !rows.length && <EmptyState icon="home" title="Nothing in Stock yet">Add the things you always keep.</EmptyState>}
      {SECTIONS.map(({ id, name }) => {
        const here = rows.filter((r) => r.section === id).sort((a, b) => a.name.localeCompare(b.name));
        if (!here.length) return null;
        return (
          <Group key={id} header={name}>
            {here.map((r) => (
              <div key={r.key} className={`flex items-center pr-2 ${r.meal ? "bg-accent/15" : ""}`}>
                <button role="checkbox" aria-checked={r.have} aria-label={`Have ${r.name}`} onClick={() => tap(r)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
                  <Circle on={r.have} />
                  <span className="min-w-0 flex-1">
                    <span className="block t-body">{cap(r.name)}</span>
                    {!r.have && r.open && <span className="block t-foot text-muted">On the list · {STORE_NAMES[r.open.store]}</span>}
                  </span>
                  {r.meal?.quantity && <span className="shrink-0 t-sub text-muted">{r.meal.quantity}</span>}
                </button>
                {r.staple && (
                  <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-muted">
                    <span aria-hidden>⋯</span>
                    <select value="" aria-label={`More for ${r.name}`} className="absolute inset-0 size-full cursor-pointer opacity-0 text-base"
                      onChange={(e) => { const v = e.target.value; if (v === "remove") { act.keepRemove(r.staple!); setRemoved(r.staple); } else if (v) act.keepMove(r.name, v as Section); }}>
                      <option value="" disabled>{cap(r.name)}</option>
                      {SECTIONS.map((s) => <option key={s.id} value={s.id} disabled={s.id === r.section}>Move to {s.name}</option>)}
                      <option value="remove">Remove from Stock</option>
                    </select>
                  </label>
                )}
              </div>
            ))}
          </Group>
        );
      })}
    </div>
  );
}
