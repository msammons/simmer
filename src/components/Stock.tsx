"use client";
import { useState } from "react";
import { type Item, type Kitchen, type ListState, type Section, type Staple, type StapleKind } from "@/lib/client";
import { linesOf, rowsOf, type Answer, type StockRow } from "@/lib/stock-rows";
import { norm } from "@/lib/words";
import { Icon } from "./icons";
import { BrandBar, Button, ConfirmSheet, EmptyState, Group, Held, Row, Segmented, Sheet } from "./ui";

/**
 * Stock (the redesign, Nov 2): what the house keeps, by section, A to Z (an answer never moves a row). Checking the house
 * (Nov 11, Sam): every row is answered with one switch, Have | Need (you can't have and need a thing at once); Need puts
 * it on its store's list, Have marks it checked, and the lit side tapped again makes it unanswered. What the planned
 * dinners need is highlighted in its own section, with how much (no legend: Sam, Nov 11). ⋯ moves a thing to
 * another section, takes it out of Stock, or keeps a dinner's thing in Stock for good. A new plan clears every answer.
 * Nothing goes on a list by itself (Nov 10: no Every week).
 *
 * Nov 16 (Robin's run): common things always show; specialty things show only while they're on the list or answered,
 * and leave after the shop. Things she puts in the same group (Cheese, Yogurt) sit under it: closed, a group shows
 * only what's marked Need; open, all of them; a group of one is just its thing. The big + adds something in a few taps,
 * marked Need at once.
 */
const SECTIONS: { id: Section; name: string }[] = [{ id: "fresh", name: "Fresh" }, { id: "pantry", name: "Pantry" }, { id: "freezer", name: "Freezer" }, { id: "household", name: "Household" }];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type StockActions = {
  /** A row answered: have, need, or back to unanswered. */
  answer: (r: StockRow, a: Answer) => void;
  /** Something kept (from ⋯), or quick added: common or specialty, maybe in a group, and with need, on the list at once. */
  keepAdd: (text: string, section?: Section, more?: { kind?: StapleKind; group?: string; need?: boolean }) => void;
  keepMove: (item: string, section: Section) => void;
  /** A kept thing made common or specialty, or put in a group ("" for none). */
  keepSet: (item: string, change: { kind?: StapleKind; group?: string }) => void;
  /** A dinner's thing that isn't kept in Stock: moved to another section (it's on the list under that section too). */
  mealMove: (it: Item, section: Section) => void;
  keepRemove: (s: Staple) => void;
};

export function StockScreen({ list, kitchen, act }: { list: ListState | null; kitchen: Kitchen | null; act: StockActions }) {
  const [removing, setRemoving] = useState<Staple | null>(null); // waiting on "Remove from Stock?" (a confirm, never an Undo)
  const [adding, setAdding] = useState(false);
  const [grouping, setGrouping] = useState<Staple | null>(null); // "Put in a group" open for this thing
  const [open, setOpen] = useState<Set<string>>(new Set()); // the groups opened
  const rows = rowsOf(list, kitchen);
  const groups = [...new Map((list?.staples ?? []).filter((s) => s.group).map((s) => [norm(s.group), s.group])).values()].sort((a, b) => a.localeCompare(b));
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const item = (r: StockRow, inGroup = false) => <StockItem key={r.key} r={r} act={act} inGroup={inGroup} onRemove={setRemoving} onGroup={setGrouping} />;
  return (
    <div className="space-y-5">
      <BrandBar />
      <h1 className="sr-only">Stock</h1>
      <Button icon="plus" onClick={() => setAdding(true)} className="w-full">Add something</Button>
      {!list && <Held />}
      {list && !rows.length && <EmptyState icon="home" title="Nothing in Stock yet">Add the things you always keep.</EmptyState>}
      {SECTIONS.map(({ id, name }) => {
        const here = rows.filter((r) => r.section === id).sort((a, b) => a.name.localeCompare(b.name));
        if (!here.length) return null;
        return (
          <Group key={id} header={name}>
            {linesOf(here).flatMap((l) => {
              if (l.kind === "row") return [item(l.row)];
              const key = `${id}|${norm(l.name)}`;
              const isOpen = open.has(key);
              const shown = isOpen ? l.rows : l.rows.filter((r) => r.answer === "need");
              return [
                <button key={key} type="button" aria-expanded={isOpen} onClick={() => toggle(key)}
                  className={`flex h-[3.75rem] w-full items-center gap-2 pl-4 pr-4 text-left ${l.rows.some((r) => r.meal) ? "bg-accent/15" : ""}`}>
                  <span className="min-w-0 flex-1 truncate t-body font-semibold">{cap(l.name)}</span>
                  <Icon name="down" className={`size-5 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>,
                ...shown.map((r) => item(r, true)),
              ];
            })}
          </Group>
        );
      })}
      {adding && <AddSheet staples={list?.staples ?? []} groups={groups} onClose={() => setAdding(false)} onAdd={(text, more) => { setAdding(false); act.keepAdd(text, undefined, { ...more, need: true }); }} />}
      {grouping && <GroupSheet staple={grouping} groups={groups} onClose={() => setGrouping(null)} onSave={(group) => { const s = grouping; setGrouping(null); act.keepSet(s.item, { group }); }} />}
      <ConfirmSheet open={Boolean(removing)} title={removing ? `Remove ${cap(removing.item)} from Stock?` : ""} message="It stops showing here." confirm="Remove from Stock" danger
        onConfirm={() => { if (removing) act.keepRemove(removing); setRemoving(null); }} onCancel={() => setRemoving(null)} />
    </div>
  );
}

/** The groups already used, to tap one, and a box for a new one. */
function GroupPicker({ groups, value, onChange }: { groups: string[]; value: string; onChange: (g: string) => void }) {
  const chip = (on: boolean) => `rounded-full px-3.5 py-1.5 t-sub font-semibold transition ${on ? "bg-accent text-on-accent" : "bg-sunk text-ink"}`;
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!value} onClick={() => onChange("")} className={chip(!value)}>No group</button>
        {groups.map((g) => <button key={g} type="button" aria-pressed={norm(value) === norm(g)} onClick={() => onChange(g)} className={chip(norm(value) === norm(g))}>{cap(g)}</button>)}
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value.slice(0, 40))} placeholder="Or a new group, like Cheese" aria-label="Group" enterKeyHint="done"
        className="h-11 w-full rounded-full bg-sunk px-4 text-base outline-none ring-accent focus:ring-2" />
    </div>
  );
}

/**
 * Quick add (Nov 16): a name, common or specialty, maybe a group, and it's on the list as Need. Something already kept
 * shows as she types; tapping it marks it Need.
 */
function AddSheet({ staples, groups, onClose, onAdd }: {
  staples: Staple[]; groups: string[]; onClose: () => void;
  onAdd: (text: string, more: { kind?: StapleKind; group?: string }) => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<StapleKind>("specialty");
  const [group, setGroup] = useState("");
  const q = norm(text);
  const known = q ? staples.filter((s) => norm(s.item).includes(q)).slice(0, 5) : [];
  const exact = staples.some((s) => norm(s.item) === q);
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (text.trim()) onAdd(text.trim(), { kind, group: group.trim() }); };
  return (
    <Sheet label="Add something" title="Add something" onClose={onClose}>
      <form onSubmit={submit} className="space-y-5 pb-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Half and half" aria-label="Add something to Stock" enterKeyHint="done" autoFocus
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        {known.length > 0 && (
          <Group header="Already in Stock">
            {known.map((s) => <Row key={s.item} title={cap(s.item)} value="Need" accessory="chevron" onClick={() => onAdd(s.item, {})} />)}
          </Group>
        )}
        {!exact && (
          <>
            <div className="space-y-1.5">
              <Segmented label="How often" value={kind} onChange={setKind} options={[{ value: "common", label: "Common" }, { value: "specialty", label: "Specialty" }]} />
              <p className="px-4 t-foot text-muted">{kind === "common" ? "Shows on Stock every time, to check." : "Shows on Stock until it's bought."}</p>
            </div>
            <div className="space-y-1.5">
              <h2 className="px-4 t-foot font-semibold text-muted">Group</h2>
              <GroupPicker groups={groups} value={group} onChange={setGroup} />
            </div>
          </>
        )}
        <Button type="submit" disabled={!text.trim()} className="w-full">Add as Need</Button>
      </form>
    </Sheet>
  );
}

/** Put a kept thing in a group, or none (Nov 16). */
function GroupSheet({ staple, groups, onClose, onSave }: { staple: Staple; groups: string[]; onClose: () => void; onSave: (g: string) => void }) {
  const [group, setGroup] = useState(staple.group);
  return (
    <Sheet label="Put in a group" title={cap(staple.item)} onClose={onClose}>
      <div className="space-y-5 pb-2">
        <GroupPicker groups={groups} value={group} onChange={setGroup} />
        <Button onClick={() => onSave(group.trim())} className="w-full">Done</Button>
      </div>
    </Sheet>
  );
}

/** One thing: its name (a meal thing's amount under it), Have | Need (one lit at most; the lit one tapped again clears it), and ⋯. */
function StockItem({ r, act, inGroup, onRemove, onGroup }: { r: StockRow; act: StockActions; inGroup: boolean; onRemove: (s: Staple) => void; onGroup: (s: Staple) => void }) {
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
    <div className={`flex h-[3.75rem] items-center gap-2 pr-2 ${inGroup ? "pl-8" : "pl-4"} ${r.meal ? "bg-accent/15" : ""}`}>
      {/* A meal thing's amount on its own line (Sam, Nov 11: "we need to know amounts"), so the name stays whole. Every
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
              else if (v === "group" && r.staple) onGroup(r.staple);
              else if ((v === "common" || v === "specialty") && r.staple) act.keepSet(r.staple.item, { kind: v });
              else if (v && r.staple) act.keepMove(r.name, v as Section);
              else if (v && r.item) act.mealMove(r.item, v as Section);
            }}>
            <option value="" disabled>{cap(r.name)}</option>
            {SECTIONS.map((s) => <option key={s.id} value={s.id} disabled={s.id === r.section}>Move to {s.name}</option>)}
            {r.staple && <option value="group">{r.staple.group ? "Change group" : "Put in a group"}</option>}
            {r.staple && (r.staple.kind === "specialty"
              ? <option value="common">Make common (always shows)</option>
              : <option value="specialty">Make specialty (shows until bought)</option>)}
            {r.staple ? <option value="remove">Remove from Stock</option> : <option value="keep">Always keep in Stock</option>}
          </select>
        </label>
      ) : <span aria-hidden className="size-9 shrink-0" />}
    </div>
  );
}
