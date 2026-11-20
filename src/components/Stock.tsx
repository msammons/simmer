"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Item, type Section, type Staple, type StapleKind } from "@/lib/client";
import { useKitchen, useList } from "@/lib/app-data";
import { linesOf, rowsOf, type Answer, type StockRow } from "@/lib/stock-rows";
import { norm } from "@/lib/words";
import { shownAmount } from "@/lib/shop";
import { Icon } from "./icons";
import { BrandBar, Button, ConfirmSheet, EmptyState, Group, Held, MoreMenu, Row, Sheet, AddField, sameProps } from "./ui";

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
 * only what's marked Need (and, since Nov 19, a dinner's things); open, all of them; a group shows from its first thing (Sam). The field at the top puts something on
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

/** The list and the freezer come from their stores; each row is drawn again only when it changes. */
export function StockScreen({ act }: { act: StockActions }) {
  const list = useList();
  const kitchen = useKitchen();
  const [removing, setRemoving] = useState<Staple | null>(null); // waiting on "Remove from Stock?" (a confirm, never an Undo)
  const [grouping, setGrouping] = useState<Staple | null>(null); // "Put in a group" open for this thing
  // Groups she opened or closed by hand (Nov 19): kept as she left them, so a group never pops open or shut when its
  // things change. One she hasn't touched starts open when everything in it shows anyway, closed otherwise.
  const [opened, setOpened] = useState<Map<string, boolean>>(() => new Map());
  const [renaming, setRenaming] = useState<string | null>(null); // "Rename group" open for this group
  const [ungrouping, setUngrouping] = useState<string | null>(null); // waiting on "Remove the … group?"
  const [added, setAdded] = useState(""); // the thing just added: brought into view and lit for a moment
  // Show everything on the list (Sam, Nov 17: a hide/show with a checkmark; each says what it shows): every kept thing
  // (specialty too) and every group, opened.
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => rowsOf(list, kitchen, { all: showAll }), [list, kitchen, showAll]);
  const staples = useMemo(() => list?.staples ?? [], [list]);
  const groups = useMemo(() => groupsOf(staples), [staples]);
  const shownNames = useMemo(() => new Set(rows.map((r) => norm(r.name))), [rows]);
  const seen = useCallback(() => setAdded(""), []);
  const item = (r: StockRow) => <StockItem key={r.key} r={r} act={act} onRemove={setRemoving} onGroup={setGrouping} fresh={Boolean(added) && norm(r.name) === norm(added)} onSeen={seen} />;
  return (
    <div className="space-y-5">
      <BrandBar />
      <h1 className="sr-only">List</h1>
      {/* Add (Nov 16, Sam): a field as on Shop, with Specialty or Common and a group in one small row; marked Need at once. */}
      <AddFields staples={staples} groups={groups} shown={shownNames} label="Add item to the list" placeholder="Add item" onAdd={(t, more) => { addNeed(staples, t, act, more); setAdded(t); }} />
      {/* The list's own ⋯, above the list on the right (Sam, Nov 17: not beside Add), the same as a row's. */}
      {list && rows.length > 0 && (
        <div className="-mb-3 flex justify-end pr-2">
          <MoreMenu label="More for the list" title="List" onPick={(v) => { if (v === "all") setShowAll((s) => !s); }}
            options={[{ value: "all", label: showAll ? "✓ Show all groups" : "Show all groups" }]} />
        </div>
      )}
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
              // Closed, a group shows what's in the cart (Need) and what the planned dinners need (Sam, Nov 19: a dinner's
              // thing in a group shows by itself); open, everything in it. Every group closes (Sam, Nov 19: "strange that any
              // category can't be collapsed"): one whose things all show anyway starts open and closes to its name alone.
              const wanted = (r: StockRow) => r.answer === "need" || r.meal;
              const allWanted = l.rows.every(wanted);
              const isOpen = showAll || (opened.get(key) ?? allWanted);
              const shown = isOpen ? l.rows : allWanted ? [] : l.rows.filter(wanted);
              const flip = () => { if (!showAll) setOpened((o) => new Map(o).set(key, !isOpen)); };
              // Right under another group: one line between them, not two.
              const afterGroup = all[i - 1]?.kind === "group";
              // A group (Nov 19, Sam): its header row tinted, the name in the usual colour (coloured words are a dinner's
              // things), an arrow, and the faint coloured line around its cells; tapping it switches between all its items and only
              // cart items (Nov 19: not in its ⋯, which only renames or removes the group).
              return [
                <div key={key} data-group={l.name} className="relative divide-y divide-line">
                  <div className="flex h-[3.25rem] items-center bg-accent/[0.08] pr-2">
                    <button type="button" aria-expanded={isOpen} aria-label={cap(l.name)} onClick={flip}
                      className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-4 pr-2 text-left">
                      <span className="min-w-0 truncate t-body font-semibold text-ink">{cap(l.name)}</span>
                      <Icon name="down" className={`size-4 shrink-0 text-muted transition-transform ${isOpen ? "" : "-rotate-90"}`} strokeWidth={2.2} />
                    </button>
                    {/* The group's own ⋯ (Nov 16, Sam: "remove or rename a category"). */}
                    <MoreMenu label={`More for the ${l.name} group`} title={cap(l.name)}
                      onPick={(v) => { if (v === "rename") setRenaming(l.name); else if (v === "remove") setUngrouping(l.name); }}
                      options={[{ value: "rename", label: "Rename group" }, { value: "remove", label: "Remove group" }]} />
                  </div>
                  {shown.map((r) => item(r))}
                  <span aria-hidden className={`pointer-events-none absolute inset-0 !border !border-accent/20 ${afterGroup ? "!border-t-0" : ""}`} />
                </div>,
              ];
            })}
          </Group>
        );
      })}
      {renaming && <RenameGroupSheet name={renaming} onClose={() => setRenaming(null)} onSave={(to) => { const from = renaming; setRenaming(null); if (to !== from) act.keepGroup(from, to); }} />}
      <ConfirmSheet open={Boolean(ungrouping)} title={ungrouping ? `Remove the ${cap(ungrouping)} group?` : ""} confirm="Remove group"
        onConfirm={() => { if (ungrouping) act.keepGroup(ungrouping, ""); setUngrouping(null); }} onCancel={() => setUngrouping(null)} />
      {grouping && <GroupSheet staple={grouping} groups={groups} onClose={() => setGrouping(null)} onSave={(group) => { const s = grouping; setGrouping(null); act.keepSet(s.item, { group }); }} />}
      <ConfirmSheet open={Boolean(removing)} title={removing ? `Remove ${cap(removing.item)} from the list?` : ""} message="You can add it again any time." confirm="Remove from the list" danger
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

/** The groups already used, A to Z, each once whatever its capitals. */
const groupsOf = (staples: Staple[]) => [...new Map(staples.filter((s) => s.group).map((s) => [norm(s.group), s.group])).values()].sort((a, b) => a.localeCompare(b));

const pillSelect = "h-9 appearance-none truncate rounded-full bg-sunk pl-3.5 pr-8 text-base font-semibold text-ink outline-none ring-accent focus:ring-2";

/**
 * A name and Add, and for something new one small row (Nov 16, Sam: "the option to pick or make a group" and common or
 * specialty, without a crowded sheet): Specialty or Common, and a group, each the phone's own picker; New group… turns
 * the group into a small box. Something already kept shows as she types; tapping it marks it Need.
 */
function AddFields({ staples, groups, shown, label, placeholder, onAdd }: {
  staples: Staple[]; groups: string[]; shown: Set<string>; label: string; placeholder: string;
  onAdd: (text: string, more: { kind: StapleKind; group: string }) => void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<StapleKind>("specialty");
  const [group, setGroup] = useState("");
  const [newGroup, setNewGroup] = useState(false);
  const [made, setMade] = useState<string[]>([]); // new group names typed for this thing, to pick between
  const q = norm(text);
  const kept = staples.some((s) => norm(s.item) === q);
  // Only what's kept but not showing (Nov 16, Sam: why show what's already on the list?): a specialty thing that left
  // after the shop, to bring back as Need instead of adding it twice. What's showing has its own Need on its row.
  const known = q ? staples.filter((s) => norm(s.item).includes(q) && norm(s.item) !== q && !shown.has(norm(s.item))).slice(0, 4) : [];
  const reset = () => { setText(""); setKind("specialty"); setGroup(""); setNewGroup(false); setMade([]); };
  const add = (t: string) => { onAdd(t, { kind, group: group.trim() }); reset(); };
  return (
    // Only Add adds (Sam, Nov 17: finishing a new group's name added the thing): the keyboard's Done closes the keyboard.
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) add(text.trim()); }} className="space-y-2.5"
      onKeyDown={(e) => { if (e.key === "Enter" && e.target instanceof HTMLInputElement) { e.preventDefault(); e.target.blur(); } }}>
      <div className="flex gap-2">
        <AddField value={text} onChange={setText} placeholder={placeholder} label={label} />
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
            // Done or a tap elsewhere turns it back into the Group pill, showing the new name, to change again (Sam, Nov 17).
            <input value={group} onChange={(e) => setGroup(e.target.value.slice(0, 40))} placeholder="Group name" aria-label="New group" autoFocus enterKeyHint="done"
              onBlur={() => { const g = group.trim(); setGroup(g); if (g) setMade((m) => (m.some((x) => norm(x) === norm(g)) ? m : [...m, g])); setNewGroup(false); }}
              className="h-9 min-w-0 flex-1 rounded-full bg-sunk px-3.5 text-base outline-none ring-accent focus:ring-2" />
          ) : (
            <span className="relative min-w-0">
              <select aria-label="Group" value={group} onChange={(e) => (e.target.value === "\u0000new" ? (setNewGroup(true), setGroup("")) : setGroup(e.target.value))} className={`${pillSelect} max-w-full`}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g} value={g}>{cap(g)}</option>)}
                {made.filter((m) => !groups.some((g) => norm(g) === norm(m))).map((m) => <option key={m} value={m}>{cap(m)}</option>)}
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

/**
 * One thing: its name (a meal thing's amount under it), Have | Need (one lit at most; the lit one tapped again clears it),
 * and ⋯. Drawn again only when its row changes (a Have or Need tap redraws its own row, not the list).
 */
const StockItem = memo(function StockItem({ r, act, onRemove, onGroup, fresh = false, onSeen }: { r: StockRow; act: StockActions; onRemove: (s: Staple) => void; onGroup: (s: Staple) => void; fresh?: boolean; onSeen?: () => void }) {
  // Just added (Nov 16): brought into view and lit for a moment, so she sees where it went (no note, nothing moves).
  const own = useRef<HTMLDivElement>(null);
  const seen = useRef(onSeen);
  useEffect(() => { seen.current = onSeen; });
  useEffect(() => {
    if (!fresh) return;
    own.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    // With motion turned down the light never plays, so its end never comes (Nov 19): done once it's in view.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) seen.current?.();
  }, [fresh]);
  const side = (a: "have" | "need", label: string) => {
    const on = r.answer === a;
    return (
      // A ✓ for Have and a cart for Need (Sam, Nov 17: icons in place of the words, same one tap).
      <button type="button" aria-pressed={on} aria-label={`${label}: ${r.name}`} onClick={() => act.answer(r, on ? "check" : a)}
        className={`flex h-8 w-11 items-center justify-center rounded-full transition-colors ${on ? "bg-accent text-on-accent" : "text-muted"}`}>
        <Icon name={a === "have" ? "check" : "cart"} className="size-[18px]" strokeWidth={2.2} />
      </button>
    );
  };
  const menu = r.staple || (r.meal && r.item);
  return (
    <div ref={own} data-fresh={fresh || undefined} onAnimationEnd={fresh ? onSeen : undefined} data-meal={r.meal || undefined} className={`flex h-[3.75rem] items-center gap-2 pl-4 pr-2 ${fresh ? "sm-flash" : ""}`}>
      {/* A meal thing's amount on its own line (Sam, Nov 11: "we need to know amounts"), so the name stays whole. Every
          row is one fixed height, room for both lines, so rows are even ("uneven heights is annoying too"). */}
      {/* A planned dinner's thing (Sam, Nov 18): how much all the planned dinners need, on its own line under the name;
          no asterisk. Its name is in the highlight colour (Nov 19: its ⋯ differs from a kept thing's, so it looks different). */}
      <span className="min-w-0 flex-1">
        <span className={`block break-words t-body ${r.meal ? "text-accent" : ""}`}>{cap(r.name)}</span>
        {r.meal && shownAmount(r.amount) && <span className="block truncate t-foot text-muted">{shownAmount(r.amount)}</span>}
      </span>
      <span role="group" aria-label={`Have or need ${r.name}`} className="flex shrink-0 rounded-full bg-sunk p-0.5">
        {side("have", "Have")}
        {side("need", "Need")}
      </span>
      {menu ? (
        <MoreMenu label={`More for ${r.name}`} title={cap(r.name)}
          onPick={(v) => {
            if (v === "remove" && r.staple) onRemove(r.staple);
            else if (v === "keep") act.keepAdd(r.name, r.section);
            else if (v === "group" && r.staple) onGroup(r.staple);
            else if ((v === "common" || v === "specialty") && r.staple) act.keepSet(r.staple.item, { kind: v });
            else if (r.staple) act.keepMove(r.name, v as Section);
            else if (r.item) act.mealMove(r.item, v as Section);
          }}>
          {SECTIONS.map((s) => <option key={s.id} value={s.id} disabled={s.id === r.section}>Move to {s.name}</option>)}
          {r.staple && <option value="group">{r.staple.group ? "Change group" : "Put in a group"}</option>}
          {r.staple && (r.staple.kind === "specialty"
            ? <option value="common">Make common (always shows)</option>
            : <option value="specialty">Make specialty (shows until bought)</option>)}
          {r.staple ? <option value="remove">Remove from the list</option> : <option value="keep">Always keep on the list</option>}
        </MoreMenu>
      ) : <span aria-hidden className="size-9 shrink-0" />}
    </div>
  );
}, sameProps);
