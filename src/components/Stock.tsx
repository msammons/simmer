"use client";
import { useState } from "react";
import { type Item, type Kitchen, type ListState, type Section, type Staple } from "@/lib/client";
import { rowsOf, toCheck, type Answer, type StockRow } from "@/lib/stock-rows";
import { BrandBar, Button, ConfirmSheet, EmptyState, Group, Held } from "./ui";

/**
 * Stock (the redesign, Nov 2): what the house keeps, by section, A to Z (an answer never moves a row). Checking the house
 * (Nov 11, Matt): every row is answered with one switch, Have | Need (you can't have and need a thing at once); Need puts
 * it on its store's list, Have marks it checked, and the lit side tapped again makes it unanswered. What the planned
 * dinners need is highlighted in its own section, with how much, and counted until each is answered. ⋯ moves a thing to
 * another section, takes it out of Stock, or keeps a dinner's thing in Stock for good. A new plan clears every answer.
 * Nothing goes on a list by itself (Nov 10: no Every week).
 */
const SECTIONS: { id: Section; name: string }[] = [{ id: "fresh", name: "Fresh" }, { id: "pantry", name: "Pantry" }, { id: "freezer", name: "Freezer" }, { id: "household", name: "Household" }];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type StockActions = {
  /** A row answered: have, need, or back to unanswered. */
  answer: (r: StockRow, a: Answer) => void;
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
  const left = toCheck(rows);
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
      {list && rows.length > 0 && (
        <p className="flex items-center gap-1.5 px-4 t-foot text-muted">
          <span className="flex-1">Need puts it on the list.</span>
          {rows.some((r) => r.meal) && <><span aria-hidden className="size-3.5 rounded-[4px] bg-accent/15" /> {left ? `In meals · ${left} to check` : "In meals · all checked"}</>}
        </p>
      )}
      {list && !rows.length && <EmptyState icon="home" title="Nothing in Stock yet">Add the things you always keep.</EmptyState>}
      {SECTIONS.map(({ id, name }) => {
        const here = rows.filter((r) => r.section === id).sort((a, b) => a.name.localeCompare(b.name));
        if (!here.length) return null;
        return (
          <Group key={id} header={name}>
            {here.map((r) => <StockItem key={r.key} r={r} act={act} onRemove={setRemoving} />)}
          </Group>
        );
      })}
      <ConfirmSheet open={Boolean(removing)} title={removing ? `Remove ${cap(removing.item)} from Stock?` : ""} message="It stops showing here." confirm="Remove from Stock" danger
        onConfirm={() => { if (removing) act.keepRemove(removing); setRemoving(null); }} onCancel={() => setRemoving(null)} />
    </div>
  );
}

/** One thing: its name (a meal thing's amount under it), Have | Need (one lit at most; the lit one tapped again clears it), and ⋯. */
function StockItem({ r, act, onRemove }: { r: StockRow; act: StockActions; onRemove: (s: Staple) => void }) {
  const side = (a: "have" | "need", label: string) => {
    const on = r.answer === a;
    return (
      <button type="button" aria-pressed={on} aria-label={`${label}: ${r.name}`} onClick={() => act.answer(r, on ? "check" : a)}
        className={`min-w-[3rem] rounded-full px-2.5 py-1.5 t-sub font-semibold transition-colors ${on ? "bg-accent text-on-accent" : "text-muted"}`}>
        {label}
      </button>
    );
  };
  const menu = r.staple || (r.meal && r.item);
  return (
    <div className={`flex h-[3.75rem] items-center gap-2 pl-4 pr-2 ${r.meal ? "bg-accent/15" : ""}`}>
      {/* A meal thing's amount on its own line (Matt, Nov 11: "we need to know amounts"), so the name stays whole. Every
          row is one fixed height, room for both lines, so rows are even ("uneven heights is annoying too"). */}
      <span className="min-w-0 flex-1">
        <span className="block truncate t-body">{cap(r.name)}</span>
        {r.amount && <span className="block truncate t-foot text-muted">{r.amount}</span>}
      </span>
      <span role="group" aria-label={`Have or need ${r.name}`} className="flex shrink-0 rounded-full bg-sunk p-0.5">
        {side("have", "Have")}
        {side("need", "Need")}
      </span>
      {menu ? (
        <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-muted">
          <span aria-hidden>⋯</span>
          <select value="" aria-label={`More for ${r.name}`} className="absolute inset-0 size-full cursor-pointer opacity-0 text-base"
            onChange={(e) => {
              const v = e.target.value;
              if (v === "remove" && r.staple) onRemove(r.staple);
              else if (v === "keep") act.keepAdd(r.name, r.section);
              else if (v && r.staple) act.keepMove(r.name, v as Section);
              else if (v && r.item) act.mealMove(r.item, v as Section);
            }}>
            <option value="" disabled>{cap(r.name)}</option>
            {SECTIONS.map((s) => <option key={s.id} value={s.id} disabled={s.id === r.section}>Move to {s.name}</option>)}
            {r.staple ? <option value="remove">Remove from Stock</option> : <option value="keep">Always keep in Stock</option>}
          </select>
        </label>
      ) : <span aria-hidden className="size-9 shrink-0" />}
    </div>
  );
}
