"use client";
import { useState } from "react";
import { type Frozen, type Item, type Kitchen, type ListState, type Section, type Staple, type Store } from "@/lib/client";
import { planRows, rowsOf, type PlanAnswer, type PlanRow, type StockRow } from "@/lib/stock-rows";
import { BrandBar, Button, ConfirmSheet, EmptyState, Group, Held } from "./ui";

/**
 * Stock (the redesign, Nov 2): what the house keeps, by section, A to Z (a tap never moves a row). Simmer assumes we
 * have everything: tick what you need and it goes on its store's list; untick to take it off. ⋯ moves a thing to
 * another section, or takes it out of Stock. Nothing goes on a list by itself (Nov 10: no Every week).
 * At the top, "For this plan" (Nov 11): what the planned dinners need from the house, each answered Have or Need with one
 * switch (you can't have and need a thing at once); tapping the lit side again makes it "to check" again.
 */
/** Ticked: on the list (we need it). Empty: we have it. */
function Tick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-full ${on ? "bg-accent text-on-accent" : "border-2 border-muted/50"}`}>
      {on && <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
    </span>
  );
}

const SECTIONS: { id: Section; name: string }[] = [{ id: "fresh", name: "Fresh" }, { id: "pantry", name: "Pantry" }, { id: "freezer", name: "Freezer" }, { id: "household", name: "Household" }];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type StockActions = {
  /** Out: on its store's list. */
  out: (name: string, store: Store, section: Section, amount?: string) => void;
  /** Have it after all: off the list again. */
  have: (it: Item) => void;
  /** A dinner's thing answered: have (off the list), need (on it), or back to "to check". */
  answer: (it: Item, a: PlanAnswer) => void;
  takeOut: (f: Frozen) => void;
  keepAdd: (text: string, section?: Section) => void;
  keepMove: (item: string, section: Section) => void;
  /** A dinner's thing that isn't kept in Stock: moved to another section (it's on the list under that section too). */
  mealMove: (it: Item, section: Section) => void;
  keepRemove: (s: Staple) => void;
};

export function StockScreen({ list, kitchen, act }: { list: ListState | null; kitchen: Kitchen | null; act: StockActions }) {
  const [text, setText] = useState("");
  const [removing, setRemoving] = useState<Staple | null>(null); // waiting on "Remove from Stock?" (a confirm, never an Undo)
  const rows = rowsOf(list, kitchen);
  const plan = planRows(list);
  const left = plan.filter((r) => r.answer === "check").length;
  const tap = (r: StockRow) => {
    if (!r.have && r.open) return act.have(r.open);
    if (r.frozen) act.takeOut(r.frozen);
    act.out(r.name, r.store, r.section, r.staple?.quantity);
  };
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (text.trim()) { act.keepAdd(text.trim()); setText(""); } };
  return (
    <div className="space-y-5">
      <BrandBar />
      <h1 className="sr-only">Stock</h1>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something" aria-label="Add something to Stock" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </form>
      {!list && <Held />}
      {plan.length > 0 && (
        <Group header="For this plan" aside={<span className="t-foot text-muted">{left ? `${left} to check` : "All checked"}</span>}>
          {plan.map((r) => <PlanItem key={r.key} r={r} act={act} kept={list?.staples.some((s) => s.item.toLowerCase() === r.name.toLowerCase()) ?? false} />)}
        </Group>
      )}
      {/* Tick what you need (Matt, Nov 10: ticking means "I want it", as on any checklist; it used to mean "we have it"). */}
      {list && rows.length > 0 && <p className="px-4 t-foot text-muted">Tick what you need; it goes on the list.</p>}
      {list && !rows.length && <EmptyState icon="home" title="Nothing in Stock yet">Add the things you always keep.</EmptyState>}
      {SECTIONS.map(({ id, name }) => {
        const here = rows.filter((r) => r.section === id).sort((a, b) => a.name.localeCompare(b.name));
        if (!here.length) return null;
        return (
          <Group key={id} header={name}>
            {here.map((r) => (
              <div key={r.key} className="flex items-center pr-2">
                <button role="checkbox" aria-checked={!r.have} aria-label={`Need ${r.name}`} onClick={() => tap(r)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
                  <Tick on={!r.have} />
                  {/* One line, ticked or not (Matt, Nov 11: rows changed height; which list it's on matters only on Lists). */}
                  <span className="min-w-0 flex-1 truncate t-body">{cap(r.name)}</span>
                </button>
                {/* ⋯ on every row that has something to offer (Matt, Nov 11: meal things had none); the rest keep its space. */}
                {r.staple ? (
                  <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-muted">
                    <span aria-hidden>⋯</span>
                    <select value="" aria-label={`More for ${r.name}`} className="absolute inset-0 size-full cursor-pointer opacity-0 text-base"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "remove") setRemoving(r.staple);
                        else if (v) act.keepMove(r.name, v as Section);
                      }}>
                      <option value="" disabled>{cap(r.name)}</option>
                      {SECTIONS.map((s) => <option key={s.id} value={s.id} disabled={s.id === r.section}>Move to {s.name}</option>)}
                      <option value="remove">Remove from Stock</option>
                    </select>
                  </label>
                ) : <span aria-hidden className="size-9 shrink-0" />}
              </div>
            ))}
          </Group>
        );
      })}
      <ConfirmSheet open={Boolean(removing)} title={removing ? `Remove ${cap(removing.item)} from Stock?` : ""} message="It stops showing here." confirm="Remove from Stock" danger
        onConfirm={() => { if (removing) act.keepRemove(removing); setRemoving(null); }} onCancel={() => setRemoving(null)} />
    </div>
  );
}

/** One of the plan's things: its amount, Have | Need (one lit at most; the lit one tapped again clears it), and ⋯. */
function PlanItem({ r, act, kept }: { r: PlanRow; act: StockActions; kept: boolean }) {
  const side = (a: "have" | "need", label: string) => {
    const on = r.answer === a;
    return (
      <button type="button" aria-pressed={on} aria-label={`${label}: ${r.name}`} onClick={() => act.answer(r.item, on ? "check" : a)}
        className={`min-w-[3.25rem] rounded-full px-3 py-1.5 t-sub font-semibold transition-colors ${on ? "bg-accent text-on-accent" : "text-muted"}`}>
        {label}
      </button>
    );
  };
  return (
    <div className="flex min-h-[3.75rem] items-center gap-2 py-2 pl-4 pr-2">
      {/* Two lines on every row, so they're all one height: the name, then how much and for which dinner. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate t-body">{cap(r.name)}</span>
        <span className="block truncate t-foot text-muted">{[r.amount, cap(r.item.for)].filter(Boolean).join(" · ")}</span>
      </span>
      <span role="group" aria-label={`Have or need ${r.name}`} className="flex shrink-0 rounded-full bg-sunk p-0.5">
        {side("have", "Have")}
        {side("need", "Need")}
      </span>
      <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-muted">
        <span aria-hidden>⋯</span>
        <select value="" aria-label={`More for ${r.name}`} className="absolute inset-0 size-full cursor-pointer opacity-0 text-base"
          onChange={(e) => { const v = e.target.value; if (v === "keep") act.keepAdd(r.name, r.item.section); else if (v) act.mealMove(r.item, v as Section); }}>
          <option value="" disabled>{cap(r.name)}</option>
          {SECTIONS.map((s) => <option key={s.id} value={s.id} disabled={s.id === r.item.section}>Move to {s.name}</option>)}
          {!kept && <option value="keep">Always keep in Stock</option>}
        </select>
      </label>
    </div>
  );
}
