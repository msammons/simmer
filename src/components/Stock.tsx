"use client";
import { useEffect, useRef, useState } from "react";
import { type Item, type Kitchen, type ListState, type Section, type Staple, type StapleKind } from "@/lib/client";
import { linesOf, rowsOf, type Answer, type StockRow } from "@/lib/stock-rows";
import { norm } from "@/lib/words";
import { Icon } from "./icons";
import { BrandBar, Button, ConfirmSheet, EmptyState, Group, Held, Row, Sheet } from "./ui";

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
 * only what's marked Need; open, all of them; a group shows from its first thing (Sam). The field at the top puts something on
 * the list as Need at once. Called List on screen since Nov 16 (Sam).
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
  /** A group renamed, or removed (`to` ""): its things move with it and stay kept. */
  keepGroup: (from: string, to: string) => void;
  /** A dinner's thing that isn't kept in Stock: moved to another section (it's on the list under that section too). */
  mealMove: (it: Item, section: Section) => void;
  keepRemove: (s: Staple) => void;
};

export function StockScreen({ list, kitchen, act }: { list: ListState | null; kitchen: Kitchen | null; act: StockActions }) {
  const [removing, setRemoving] = useState<Staple | null>(null); // waiting on "Remove from Stock?" (a confirm, never an Undo)
  const [grouping, setGrouping] = useState<Staple | null>(null); // "Put in a group" open for this thing
  const [open, setOpen] = useState<Set<string>>(new Set()); // the groups opened
  const [renaming, setRenaming] = useState<string | null>(null); // "Rename group" open for this group
  const [ungrouping, setUngrouping] = useState<string | null>(null); // waiting on "Remove the … group?"
  const [added, setAdded] = useState(""); // the thing just added: brought into view and lit for a moment
  const rows = rowsOf(list, kitchen);
  const groups = [...new Map((list?.staples ?? []).filter((s) => s.group).map((s) => [norm(s.group), s.group])).values()].sort((a, b) => a.localeCompare(b));
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const item = (r: StockRow) => <StockItem key={r.key} r={r} act={act} onRemove={setRemoving} onGroup={setGrouping} fresh={Boolean(added) && norm(r.name) === norm(added)} onSeen={() => setAdded("")} />;
  return (
    <div className="space-y-5">
      <BrandBar />
      <h1 className="sr-only">List</h1>
      {/* Add (Nov 16, Sam): a field as on Shop, with Specialty or Common and a group in one small row; marked Need at once. */}
      <AddFields staples={list?.staples ?? []} shown={new Set(rows.map((r) => norm(r.name)))} label="Add something to the list" placeholder="Add something" onAdd={(t, more) => { addNeed(list?.staples ?? [], t, act, more); setAdded(t); }} />
      {!list && <Held />}
      {list && !rows.length && <EmptyState icon="list" title="Nothing on the list yet">Add the things you always keep.</EmptyState>}
      {SECTIONS.map(({ id, name }) => {
        const here = rows.filter((r) => r.section === id).sort((a, b) => a.name.localeCompare(b.name));
        if (!here.length) return null;
        return (
          <Group key={id} header={name}>
            {linesOf(here).flatMap((l, i, all) => {
              if (l.kind === "row") return [item(l.row)];
              const key = `${id}|${norm(l.name)}`;
              const isOpen = open.has(key);
              const shown = isOpen ? l.rows : l.rows.filter((r) => r.answer === "need");
              // Nothing to show or hide (every thing in it is Need): the header stays, without Show all / Show less (Sam, Nov 16).
              const toggles = !l.rows.every((r) => r.answer === "need");
              // Right under another group: one line between them, not two.
              const afterGroup = all[i - 1]?.kind === "group";
              // A group (Nov 16, Sam): full width with nothing indented, a colored line around its cells, a tinted header
              // row with the group's name, and a plain "Show all" / "Show less" in place of a caret.
              return [
                <div key={key} data-group={l.name} className="relative divide-y divide-line">
                  <div className="flex h-[3.25rem] items-center bg-accent/[0.16] pr-2">
                    <button type="button" aria-expanded={toggles ? isOpen : undefined} aria-label={cap(l.name)} onClick={() => toggles && toggle(key)}
                      className="flex h-full min-w-0 flex-1 items-center gap-2 pl-4 pr-2 text-left">
                      <span className="min-w-0 flex-1 truncate t-body font-semibold text-accent">{cap(l.name)}</span>
                      {toggles && <span className="shrink-0 t-sub font-semibold text-accent">{isOpen ? "Show less" : "Show all"}</span>}
                    </button>
                    {/* The group's own ⋯ (Nov 16, Sam: "remove or rename a category"). */}
                    <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-accent">
                      <span aria-hidden>⋯</span>
                      <select value="" aria-label={`More for the ${l.name} group`} className="absolute inset-0 size-full cursor-pointer opacity-0 text-base"
                        onChange={(e) => { if (e.target.value === "rename") setRenaming(l.name); else if (e.target.value === "remove") setUngrouping(l.name); }}>
                        <option value="" disabled>{cap(l.name)}</option>
                        <option value="rename">Rename group</option>
                        <option value="remove">Remove group (keeps its things)</option>
                      </select>
                    </label>
                  </div>
                  {(toggles ? shown : l.rows).map((r) => item(r))}
                  <span aria-hidden className={`pointer-events-none absolute inset-0 !border-2 !border-accent/60 ${afterGroup ? "!border-t-0" : ""}`} />
                </div>,
              ];
            })}
          </Group>
        );
      })}
      {renaming && <RenameGroupSheet name={renaming} onClose={() => setRenaming(null)} onSave={(to) => { const from = renaming; setRenaming(null); if (to !== from) act.keepGroup(from, to); }} />}
      <ConfirmSheet open={Boolean(ungrouping)} title={ungrouping ? `Remove the ${cap(ungrouping)} group?` : ""} message="The things in it stay on the list, on their own." confirm="Remove group"
        onConfirm={() => { if (ungrouping) act.keepGroup(ungrouping, ""); setUngrouping(null); }} onCancel={() => setUngrouping(null)} />
      {grouping && <GroupSheet staple={grouping} groups={groups} onClose={() => setGrouping(null)} onSave={(group) => { const s = grouping; setGrouping(null); act.keepSet(s.item, { group }); }} />}
      <ConfirmSheet open={Boolean(removing)} title={removing ? `Remove ${cap(removing.item)} from the list?` : ""} message="It stops showing here." confirm="Remove from the list" danger
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
 * Something added as Need (Nov 16): a thing already kept is marked Need as it is; a new one is kept as specialty (it
 * leaves Stock after the shop; ⋯ makes it common or puts it in a group).
 */
export function addNeed(staples: Staple[], text: string, act: Pick<StockActions, "keepAdd">, more: { kind?: StapleKind; group?: string } = {}) {
  const had = staples.find((s) => norm(s.item) === norm(text));
  // Into a group: where the group's other things are, so it doesn't split across sections (Nov 16).
  const with_ = more.group ? staples.find((s) => s.group && norm(s.group) === norm(more.group!)) : undefined;
  act.keepAdd(had?.item ?? text, had ? undefined : with_?.section, had ? { need: true } : { need: true, kind: more.kind ?? "specialty", ...(more.group && { group: more.group }) });
}

const pillSelect = "h-9 appearance-none truncate rounded-full bg-sunk pl-3.5 pr-8 text-base font-semibold text-ink outline-none ring-accent focus:ring-2";

/**
 * A name and Add, and for something new one small row (Nov 16, Sam: "the option to pick or make a group" and common or
 * specialty, without a crowded sheet): Specialty or Common, and a group, each the phone's own picker; New group… turns
 * the group into a small box. Something already kept shows as she types; tapping it marks it Need.
 */
function AddFields({ staples, shown, label, placeholder, onAdd, autoFocus = false }: {
  staples: Staple[]; shown: Set<string>; label: string; placeholder: string; autoFocus?: boolean;
  onAdd: (text: string, more: { kind: StapleKind; group: string }) => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<StapleKind>("specialty");
  const [group, setGroup] = useState("");
  const [newGroup, setNewGroup] = useState(false);
  const groups = [...new Map(staples.filter((s) => s.group).map((s) => [norm(s.group), s.group])).values()].sort((a, b) => a.localeCompare(b));
  const q = norm(text);
  const kept = staples.some((s) => norm(s.item) === q);
  // Only what's kept but not showing (Nov 16, Sam: why show what's already on the list?): a specialty thing that left
  // after the shop, to bring back as Need instead of adding it twice. What's showing has its own Need on its row.
  const known = q ? staples.filter((s) => norm(s.item).includes(q) && norm(s.item) !== q && !shown.has(norm(s.item))).slice(0, 4) : [];
  const reset = () => { setText(""); setKind("specialty"); setGroup(""); setNewGroup(false); };
  const add = (t: string) => { onAdd(t, { kind, group: group.trim() }); reset(); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add(text.trim()); }} className="space-y-2.5">
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={label} enterKeyHint="done" autoFocus={autoFocus}
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </div>
      {/* Once she types something new (Nov 16, Sam: they "don't need to appear until you add"). It shows under the field
          as she types, so nothing she's about to tap moves; something already kept needs neither. */}
      {text.trim() && !kept && (
        <div className="flex items-center gap-2 px-1">
          <span className="relative shrink-0">
            <select aria-label="How often" value={kind} onChange={(e) => setKind(e.target.value as StapleKind)} className={pillSelect}>
              <option value="specialty">Specialty</option>
              <option value="common">Common</option>
            </select>
            <Icon name="down" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          </span>
          {newGroup ? (
            <input value={group} onChange={(e) => setGroup(e.target.value.slice(0, 40))} placeholder="Group name" aria-label="New group" autoFocus enterKeyHint="done"
              className="h-9 min-w-0 flex-1 rounded-full bg-sunk px-3.5 text-base outline-none ring-accent focus:ring-2" />
          ) : (
            <span className="relative min-w-0">
              <select aria-label="Group" value={group} onChange={(e) => (e.target.value === "\u0000new" ? (setNewGroup(true), setGroup("")) : setGroup(e.target.value))} className={`${pillSelect} max-w-full`}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g} value={g}>{cap(g)}</option>)}
                <option value={"\u0000new"}>New group…</option>
              </select>
              <Icon name="down" className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            </span>
          )}
        </div>
      )}
      {known.length > 0 && (
        <Group>
          {known.map((s) => <Row key={s.item} title={cap(s.item)} value="Need" onClick={() => add(s.item)} />)}
        </Group>
      )}
    </form>
  );
}

/** A group's new name (Nov 16): its things move with it. */
function RenameGroupSheet({ name, onClose, onSave }: { name: string; onClose: () => void; onSave: (to: string) => void }) {
  const [to, setTo] = useState(cap(name));
  return (
    <Sheet label="Rename group" title="Rename group" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (to.trim()) onSave(to.trim()); }} className="space-y-4 pb-2 pt-1">
        <input value={to} onChange={(e) => setTo(e.target.value.slice(0, 40))} aria-label="Group name" enterKeyHint="done" autoFocus
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!to.trim()} className="w-full">Save</Button>
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
function StockItem({ r, act, onRemove, onGroup, fresh = false, onSeen }: { r: StockRow; act: StockActions; onRemove: (s: Staple) => void; onGroup: (s: Staple) => void; fresh?: boolean; onSeen?: () => void }) {
  // Just added (Nov 16): brought into view and lit for a moment, so she sees where it went (no note, nothing moves).
  const own = useRef<HTMLDivElement>(null);
  useEffect(() => { if (fresh) own.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [fresh]);
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
    <div ref={own} data-fresh={fresh || undefined} onAnimationEnd={fresh ? onSeen : undefined} data-meal={r.meal || undefined} className={`flex h-[3.75rem] items-center gap-2 pl-4 pr-2 ${fresh ? "sm-flash" : ""}`}>
      {/* A meal thing's amount on its own line (Sam, Nov 11: "we need to know amounts"), so the name stays whole. Every
          row is one fixed height, room for both lines, so rows are even ("uneven heights is annoying too"). */}
      {/* A planned dinner's thing (Nov 16, Sam: "a treatment that's not a highlight", "a text color difference"): its name in
          the accent color, nothing more (the dinner and amount aren't needed here, Sam the same day). */}
      <span className={`min-w-0 flex-1 truncate t-body ${r.meal ? "font-medium text-accent" : ""}`}>{cap(r.name)}</span>
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
            {r.staple ? <option value="remove">Remove from the list</option> : <option value="keep">Always keep on the list</option>}
          </select>
        </label>
      ) : <span aria-hidden className="size-9 shrink-0" />}
    </div>
  );
}
