"use client";
import { useState } from "react";
import type { Item, ListState, Section, Staple, Store } from "@/lib/client";
import { Button, EmptyState, Group, IconButton, Notice, Row, Sheet, TopBar } from "./ui";

export const STORE_NAMES: Record<Store, string> = { safeway: "Safeway", "trader-joes": "Trader Joe's", costco: "Costco" };
const SECTION_NAMES: Record<Section, string> = { fresh: "Fresh", pantry: "Pantry", freezer: "Freezer", household: "Household" };
const SECTION_ORDER: Section[] = ["fresh", "pantry", "freezer", "household"];

export type ListActions = {
  add: (text: string, filing?: { store: Store; section: Section }) => void;
  check: (it: Item, checked: boolean) => void;
  move: (it: Item, to: { store?: Store; section?: Section }) => void;
  remove: (it: Item) => void;
  done: (store: Store) => void;
};

/** A round check, filled when the item's in the cart. */
export function Check({ on }: { on: boolean }) {
  return (
    <span className={`flex size-6 items-center justify-center rounded-full border-2 ${on ? "border-accent bg-accent text-on-accent" : "border-muted/50"}`} aria-hidden>
      {on && <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5 9-10" /></svg>}
    </span>
  );
}

function ItemRow({ it, act, onMore }: { it: Item; act: ListActions; onMore: () => void }) {
  const details = [it.quantity, SECTION_NAMES[it.section], it.addedBy && `${it.addedBy} added`].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center">
      <div className="min-w-0 flex-1">
        <Row lead={<Check on={it.checked} />} title={<span className={it.checked ? "text-muted line-through" : ""}>{it.item.charAt(0).toUpperCase() + it.item.slice(1)}</span>} subtitle={details} role="checkbox" checked={it.checked} onClick={() => act.check(it, !it.checked)} />
      </div>
      <div className="pr-2"><IconButton icon="more" label={`More for ${it.item}`} onClick={onMore} /></div>
    </div>
  );
}

/** One store's part of the list: fresh first, then pantry, freezer, household; checked items fall to the bottom. */
function StoreGroup({ store, items, act, onMore }: { store: Store; items: Item[]; act: ListActions; onMore: (it: Item) => void }) {
  const rank = (it: Item) => (it.checked ? 10 : 0) + SECTION_ORDER.indexOf(it.section);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b) || a.item.localeCompare(b.item));
  const got = items.filter((i) => i.checked).length;
  return (
    <Group
      header={STORE_NAMES[store]}
      aside={got ? <button className="t-foot font-semibold text-accent" onClick={() => act.done(store)}>Done shopping</button> : <span className="t-foot text-muted">{items.length} to get</span>}
    >
      {sorted.map((it) => <ItemRow key={it.id} it={it} act={act} onMore={() => onMore(it)} />)}
    </Group>
  );
}

export function GroceriesScreen({ list, error, act, onSettings }: { list: ListState | null; error: string | null; act: ListActions; onSettings: () => void }) {
  const [text, setText] = useState("");
  const [more, setMore] = useState<Item | null>(null);
  const [staples, setStaples] = useState(false);
  const items = list?.items ?? [];
  const stores = (Object.keys(STORE_NAMES) as Store[]).filter((s) => items.some((i) => i.store === s));
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (text.trim()) { act.add(text.trim()); setText(""); } };
  return (
    <div className="space-y-6">
      <TopBar title="Groceries" subtitle={items.length ? `${items.filter((i) => !i.checked).length} to get` : "The list you share"} trailing={<IconButton icon="sliders" label="Settings" onClick={onSettings} />} />
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add eggs, 2 lemons…" aria-label="Add to the list" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </form>
      <Group>
        <Row icon="list" title="Running low?" subtitle="Add from the things you always keep" accessory="chevron" onClick={() => setStaples(true)} />
      </Group>
      {list && !items.length && <EmptyState icon="list" title="Nothing on the list">Add what you need, or tap Running low.</EmptyState>}
      {stores.map((s) => <StoreGroup key={s} store={s} items={items.filter((i) => i.store === s)} act={act} onMore={setMore} />)}
      {more && <ItemSheet it={more} act={act} onClose={() => setMore(null)} />}
      {staples && list && <StaplesSheet staples={list.staples} items={items} act={act} onClose={() => setStaples(false)} />}
    </div>
  );
}

/** An item's options: which store, which section, or take it off. */
function ItemSheet({ it, act, onClose }: { it: Item; act: ListActions; onClose: () => void }) {
  return (
    <Sheet label={it.item} title={it.item} onClose={onClose}>
      <div className="space-y-5 pb-2">
        <Group header="Get it at">
          {(Object.keys(STORE_NAMES) as Store[]).map((s) => (
            <Row key={s} title={STORE_NAMES[s]} role="radio" checked={it.store === s} accessory="check" onClick={() => { act.move(it, { store: s }); onClose(); }} />
          ))}
        </Group>
        <Group header="Part of the list">
          {SECTION_ORDER.map((s) => (
            <Row key={s} title={SECTION_NAMES[s]} role="radio" checked={it.section === s} accessory="check" onClick={() => { act.move(it, { section: s }); onClose(); }} />
          ))}
        </Group>
        <Button variant="secondary" onClick={() => { act.remove(it); onClose(); }} className="w-full">Take it off the list</Button>
      </div>
    </Sheet>
  );
}

/** The things the house always keeps: tap what's low to put it on the list. */
function StaplesSheet({ staples, items, act, onClose }: { staples: Staple[]; items: Item[]; act: ListActions; onClose: () => void }) {
  const onList = (s: Staple) => items.some((i) => !i.checked && i.item.toLowerCase() === s.item.toLowerCase());
  return (
    <Sheet label="Running low" title="Running low?" onClose={onClose}>
      <div className="pb-2">
        {staples.length ? (
          <Group footer="These are the things you always keep, from your staples list.">
            {staples.map((s) => (
              <Row key={s.item} title={s.item} subtitle={STORE_NAMES[s.store]} value={onList(s) ? "On the list" : "Add"}
                onClick={onList(s) ? undefined : () => act.add(s.quantity ? `${s.item}` : s.item, { store: s.store, section: s.section })} />
            ))}
          </Group>
        ) : (
          <p className="t-sub text-muted">No staples yet.</p>
        )}
      </div>
    </Sheet>
  );
}
