"use client";
import { useEffect, useState } from "react";
import { dateIn, framed, type CartLine, type Frozen, type Item, type Kitchen, type ListState, type Pick, type Section, type Staple, type Store } from "@/lib/client";
import { addDays } from "@/lib/time";
import { PAGE } from "@/lib/safeway-helper.mjs";
import { findItems, firstToFind, pickFor, qtyFor } from "@/lib/shop";
import { Icon } from "./icons";
import { CartView, FindView, ProductImage, UpdateNotice, useSafeway } from "./Safeway";
import { BrandBar, Button, EmptyState, Group, IconButton, Notice, Row, Segmented, Sheet, scrollAppTo } from "./ui";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const STORE_NAMES: Record<Store, string> = { safeway: "Safeway", "trader-joes": "Trader Joe's", costco: "Costco" };
/** The stores Find and Cart can shop online. Just Safeway for now; each one here gets its own Find and cart. */
export const ONLINE_STORES: Store[] = ["safeway"];
const SECTION_NAMES: Record<Section, string> = { fresh: "Fresh", pantry: "Pantry", freezer: "Freezer", household: "Household" };
const SECTION_ORDER: Section[] = ["fresh", "pantry", "freezer", "household"];

export type ListActions = {
  add: (text: string, filing?: { store: Store; section: Section }) => void;
  check: (it: Item, checked: boolean) => void;
  move: (it: Item, to: { store?: Store; section?: Section }) => void;
  remove: (it: Item) => void;
  done: (store: Store) => void;
  need: (it: Item) => void;
  have: () => void;
  freeze: (text: string) => void;
  /** Out of stock: open the planned night this item was for, to swap the meal. */
  swapFor?: (forWhat: string) => void;
  takeOut: (f: Frozen) => void;
};

const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const nextDay = (from: string, wd: number) => addDays(from, (wd - weekday(from) + 7) % 7);
const dayWord = (d: string) => (d === dateIn(0) ? "today" : d === dateIn(1) ? "tomorrow" : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }));
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
/** The rhythm: Safeway orders go in on Tuesdays; Trader Joe's is a Wednesday, about two weeks after the last trip. */
const safewayDay = () => nextDay(dateIn(0), 2);
function traderJoesDay(last: string) {
  const due = last ? addDays(last, 14) : dateIn(0);
  return nextDay(due > dateIn(0) ? due : dateIn(0), 3);
}
const age = (added: string) => {
  if (!added) return "";
  const days = Math.round((Date.parse(`${dateIn(0)}T12:00:00Z`) - Date.parse(`${added}T12:00:00Z`)) / 864e5);
  return days < 7 ? "this week" : days < 14 ? "1 week in" : days < 60 ? `${Math.floor(days / 7)} weeks in` : `${Math.floor(days / 30)} months in`;
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
  const details = [it.quantity, SECTION_NAMES[it.section], it.for ? `for ${it.for}` : it.addedBy && `${it.addedBy} added`].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center">
      <div className="min-w-0 flex-1">
        <Row lead={<Check on={it.checked} />} title={<span className={it.checked ? "text-muted line-through" : ""}>{it.item.charAt(0).toUpperCase() + it.item.slice(1)}</span>} subtitle={details} role="checkbox" checked={it.checked} onClick={() => act.check(it, !it.checked)} />
      </div>
      <div className="pr-2"><IconButton icon="more" label={`More for ${it.item}`} onClick={onMore} /></div>
    </div>
  );
}

/**
 * A Safeway item: its usual product's picture (when one's known), and where it stands, which comes from the cart (no
 * tick to keep in step). Tapping it opens Find on it.
 */
function SafewayRow({ it, inCart, image, onFind, onMore }: { it: Item; inCart: number; image?: string; onFind: () => void; onMore: () => void }) {
  const details = it.checked ? "Got it" : inCart ? `In the cart · ${inCart}` : [it.quantity, it.for ? `for ${it.for}` : it.addedBy && `${it.addedBy} added`].filter(Boolean).join(" · ");
  return (
    <div className={`flex items-center ${inCart || it.checked ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <Row lead={<ProductImage src={image} small />} title={cap(it.item)} subtitle={details} onClick={onFind} />
      </div>
      <div className="pr-2"><IconButton icon="more" label={`More for ${it.item}`} onClick={onMore} /></div>
    </div>
  );
}

/** One store's part of the list: fresh first, then pantry, freezer, household; what's got falls to the bottom. */
function StoreGroup({ store, items, act, onMore, footer, cart, picks, onFind }: {
  store: Store; items: Item[]; act: ListActions; onMore: (it: Item) => void; footer?: string; cart: CartLine[]; picks: Pick[]; onFind?: (it: Item) => void;
}) {
  const got = (it: Item) => it.checked || (store === "safeway" && qtyFor(cart, it.id) > 0);
  const rank = (it: Item) => (got(it) ? 10 : 0) + SECTION_ORDER.indexOf(it.section);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b) || a.item.localeCompare(b.item));
  const left = items.filter((i) => !got(i)).length;
  return (
    <Group
      header={STORE_NAMES[store]} footer={footer}
      aside={left < items.length ? <button className="t-foot font-semibold text-accent" onClick={() => act.done(store)}>Done shopping</button> : <span className="t-foot text-muted">{items.length} to get</span>}
    >
      {sorted.map((it) => (store === "safeway" && onFind
        ? <SafewayRow key={it.id} it={it} inCart={qtyFor(cart, it.id)} image={cart.find((l) => l.itemId === it.id)?.image ?? pickFor(picks, it.item)?.image} onFind={() => onFind(it)} onMore={() => onMore(it)} />
        : <ItemRow key={it.id} it={it} act={act} onMore={() => onMore(it)} />))}
    </Group>
  );
}

export type ShopView = "find" | "cart";

/**
 * The List tab: everything to get, from every store. A Safeway item opens Shop's Find on it (`onFind`), as does the
 * Find at Safeway chip for all of them.
 */
export function ListScreen({ list, kitchen, error, act, onFind }: {
  list: ListState | null; kitchen: Kitchen | null; error: string | null; act: ListActions; onFind: (id?: string) => void;
}) {
  const sw = useSafeway();
  // Done shopping at Safeway empties the cart too: show that once the list has changed.
  const here: ListActions = { ...act, done: (s) => { void Promise.resolve(act.done(s) as unknown).then(() => { if (s === "safeway") sw.refresh(); }); } };
  const toFind = findItems(list?.items ?? [], list?.staples ?? [], sw.picks);
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">List</h1>
      {error && <Notice>{error}</Notice>}
      <ListView list={list} kitchen={kitchen} act={here} cart={sw.cart} picks={sw.picks} onFind={onFind} anyToFind={toFind.some((x) => !qtyFor(sw.cart, x.id))} />
    </div>
  );
}

/**
 * The Shop tab: one online store at a time (picked at the top), finding the list's items there and its cart, switched
 * beside it. Find goes through the list's items for that store one at a time; the cart is the store's real cart,
 * changed through the computer. `startAt` opens Find on a list item.
 */
export function ShopScreen({ list, error, act, startAt, onList }: {
  list: ListState | null; error: string | null; act: ListActions; startAt: string | null; onList: () => void;
}) {
  const sw = useSafeway();
  // In the helper's panel, beside Safeway, Shop opens on Cart (Sam, Oct 31); opened for a list item, on Find.
  const [view, setView] = useState<ShopView>(() => (!startAt && framed() ? "cart" : "find"));
  const [online, setOnline] = useState<Store>(ONLINE_STORES[0]); // the store Find and Cart are for
  const [findAt, setFindAt] = useState<string | null>(startAt); // the item Find shows, by id
  const toFind = findItems(list?.items ?? [], list?.staples ?? [], sw.picks);
  const at = findAt ? toFind.findIndex((x) => x.id === findAt) : -1;
  const index = at >= 0 ? at : findAt === "end" ? toFind.length : firstToFind(toFind, sw.cart);
  // The item showing stays put once it's shown: without this, adding it to the cart (or the cart reloading) moved Find
  // to another item under the finger, and the next Add could land on the wrong item.
  const shownId = sw.loaded && view === "find" ? toFind[index]?.id ?? null : null;
  useEffect(() => { if (shownId && (findAt === null || at < 0) && findAt !== "end") queueMicrotask(() => setFindAt(shownId)); }, [shownId, findAt, at]);
  const go = (v: ShopView) => { scrollAppTo(0); setView(v); };
  const find = () => { setFindAt(toFind[firstToFind(toFind, sw.cart)]?.id ?? null); go("find"); };
  const count = sw.cart.length;
  const options: { value: ShopView; label: string }[] = [{ value: "find", label: "Find" }, { value: "cart", label: count ? `Cart · ${count}` : "Cart" }];
  const name = STORE_NAMES[online];
  return (
    <div className="space-y-6">
      <BrandBar below={
        <div className="flex items-center gap-2">
          <StorePicker store={online} onPick={setOnline} />
          <div className="min-w-0 flex-1"><Segmented label="Show" value={view} options={options} onChange={go} /></div>
        </div>
      } />
      <h1 className="sr-only">Shop at {name}</h1>
      {error && <Notice>{error}</Notice>}
      {sw.outdated && <UpdateNotice />}
      {view === "find" && <FindView store={name} items={toFind} index={index} onIndex={(i) => { scrollAppTo(0); setFindAt(toFind[i]?.id ?? "end"); }} sw={sw} onCart={() => go("cart")} onList={onList}
        onGot={(id) => { const x = list?.items.find((i) => i.id === id); if (x) act.check(x, true); }} />}
      {view === "cart" && <CartView store={name} sw={sw} onFind={toFind.length ? find : null} />}
    </div>
  );
}

/** Which online store Find and Cart are for: the store's name, tapped to change it. */
function StorePicker({ store, onPick }: { store: Store; onPick: (s: Store) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={`Shopping at ${STORE_NAMES[store]}. Change store`} className="glass flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-4 pr-3 t-sub font-semibold">
        {STORE_NAMES[store]}<Icon name="down" className="size-4 text-muted" strokeWidth={2.4} />
      </button>
      {open && (
        <Sheet label="Shop at" title="Shop at" onClose={() => setOpen(false)}>
          <div className="pb-2">
            <Group footer="Trader Joe's and Costco stay on the list for shopping in person.">
              {ONLINE_STORES.map((s) => (
                <Row key={s} role="radio" checked={store === s} onClick={() => { onPick(s); setOpen(false); }} title={STORE_NAMES[s]} accessory="check" />
              ))}
            </Group>
          </div>
        </Sheet>
      )}
    </>
  );
}

function ListView({ list, kitchen, act, cart, picks, onFind, anyToFind }: {
  list: ListState | null; kitchen: Kitchen | null; act: ListActions; cart: CartLine[]; picks: Pick[]; onFind: (id?: string) => void; anyToFind: boolean;
}) {
  const [sheet, setSheet] = useState<"freezer" | "staples" | "check" | null>(null);
  const [text, setText] = useState("");
  // The item whose options are open, by id: the sheet shows it as the list is now (another phone may have moved it).
  const [moreId, setMoreId] = useState<string | null>(null);
  const more = list?.items.find((i) => i.id === moreId) ?? null;
  const all = list?.items ?? [];
  const toCheck = all.filter((i) => i.check && !i.checked);
  const items = all.filter((i) => !(i.check && !i.checked));
  const stores = (Object.keys(STORE_NAMES) as Store[]).filter((s) => items.some((i) => i.store === s));
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (text.trim()) { act.add(text.trim()); setText(""); } };
  const frozen = kitchen?.freezer.length ?? 0;
  const chip = "glass inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 t-sub font-semibold text-accent transition active:scale-[0.97]";
  return (
    <>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add eggs, 2 lemons…" aria-label="Add to the list" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button className={chip} onClick={() => setSheet("staples")}><Icon name="list" className="size-[18px]" />Running low</button>
        <button className={chip} onClick={() => setSheet("freezer")}><Icon name="snow" className="size-[18px]" />Freezer{frozen ? ` · ${frozen}` : ""}</button>
        {anyToFind && <button className={chip} onClick={() => onFind()}><Icon name="search" className="size-[18px]" />Find at Safeway</button>}
      </div>
      {toCheck.length > 0 && (
        <Group><Row icon="check" title="Check you have these" subtitle={`${toCheck.length} pantry thing${toCheck.length === 1 ? "" : "s"} from the plan`} value={String(toCheck.length)} accessory="chevron" onClick={() => setSheet("check")} /></Group>
      )}
      {list && !items.length && !toCheck.length && <EmptyState icon="list" title="Nothing on the list">Add what you need, or tap Running low.</EmptyState>}
      {stores.map((s) => (
        <StoreGroup key={s} store={s} items={items.filter((i) => i.store === s)} act={act} onMore={(it) => setMoreId(it.id)} cart={cart} picks={picks}
          onFind={s === "safeway" ? (it) => onFind(it.id) : undefined}
          footer={s === "trader-joes" ? `Next Trader Joe's trip: ${shortDate(traderJoesDay(kitchen?.trips.lastTraderJoes ?? ""))}` : s === "safeway" ? `Safeway order ${dayWord(safewayDay())}` : undefined} />
      ))}
      {sheet === "freezer" && <FreezerSheet items={kitchen?.freezer ?? []} act={act} onClose={() => setSheet(null)} />}
      {sheet === "staples" && list && <StaplesSheet staples={list.staples} items={items} act={act} onClose={() => setSheet(null)} />}
      {sheet === "check" && <CheckSheet items={toCheck} act={act} onClose={() => setSheet(null)} />}
      {more && <ItemSheet key={more.id} it={more} act={act} pick={more.store === "safeway" ? pickFor(picks, more.item) : undefined}
        onFind={more.store === "safeway" && !more.checked && !more.check ? () => { setMoreId(null); onFind(more.id); } : undefined} onClose={() => setMoreId(null)} />}
    </>
  );
}

/** Pantry things from the week's plan: tap any you're out of to put it on the list. */
function CheckSheet({ items, act, onClose }: { items: Item[]; act: ListActions; onClose: () => void }) {
  return (
    <Sheet label="Check you have these" title="Check you have these" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {items.length ? (
          <Group footer="From the week's plan. Tap any you're out of to put it on the list.">
            {items.map((it) => <Row key={it.id} title={cap(it.item)} subtitle={[it.quantity, it.for && `for ${it.for}`].filter(Boolean).join(" · ")} value="Need it" onClick={() => act.need(it)} />)}
          </Group>
        ) : <p className="t-sub text-center text-muted">All checked.</p>}
        {items.length > 0 && <Button variant="secondary" onClick={() => { act.have(); onClose(); }} className="w-full">I have the rest</Button>}
      </div>
    </Sheet>
  );
}

/** An item's options: which store, which section, or take it off; for Safeway, its usual product there. */
function ItemSheet({ it, act, pick, onFind, onClose }: { it: Item; act: ListActions; pick?: Pick; onFind?: () => void; onClose: () => void }) {
  return (
    <Sheet label={it.item} title={it.item} onClose={onClose}>
      <div className="space-y-5 pb-2">
        {(onFind || pick) && (
          <Group footer={pick ? "Your usual, picked last time." : undefined}>
            {onFind && <Row icon="search" title="Find it at Safeway" subtitle={pick?.name} accessory="chevron" onClick={onFind} />}
            {!onFind && pick && <Row title="Open in Safeway" subtitle={pick.name} accessory="external" href={productUrl(pick.id)} />}
          </Group>
        )}
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
        {it.for && it.for !== "lunches" && act.swapFor && (
          <Group header="Didn't get it?" footer={`It's for ${it.for}. Move it to another store above, or swap the meal.`}>
            <Row icon="refresh" title="Swap the meal" accessory="chevron" onClick={() => { onClose(); act.swapFor!(it.for); }} />
          </Group>
        )}
        <Button variant="secondary" onClick={() => { act.remove(it); onClose(); }} className="w-full">Take it off the list</Button>
      </div>
    </Sheet>
  );
}

const productUrl = (id: string) => `${PAGE.site}${PAGE.productPath.replace("{id}", id)}`;

/** The things the house always keeps: tap what's low to put it on the list. */
function StaplesSheet({ staples, items, act, onClose }: { staples: Staple[]; items: Item[]; act: ListActions; onClose: () => void }) {
  const onList = (s: Staple) => items.some((i) => !i.checked && i.item.toLowerCase() === s.item.toLowerCase());
  return (
    <Sheet label="Running low" title="Running low?" onClose={onClose}>
      <div className="pb-2">
        {staples.length ? (
          <Group footer="These are the things you always keep, from your staples list.">
            {staples.map((s, i) => (
              <Row key={`${i}|${s.item}`} title={s.item} subtitle={STORE_NAMES[s.store]} value={onList(s) ? "On the list" : "Add"}
                onClick={onList(s) ? undefined : () => act.add(s.item, { store: s.store, section: s.section })} />
            ))}
          </Group>
        ) : (
          <p className="t-sub text-muted">No staples yet.</p>
        )}
      </div>
    </Sheet>
  );
}

/** The freezer, oldest first: planning uses what's here, and the list doesn't buy it again. */
function FreezerSheet({ items, act, onClose }: { items: Frozen[]; act: ListActions; onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <Sheet label="Freezer" title="Freezer" onClose={onClose}>
      <div className="space-y-5 pb-2">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { act.freeze(text.trim()); setText(""); } }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add 2 salmon, chicken thighs…" aria-label="Add to the freezer"
            className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
          <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
        </form>
        {items.length ? (
          <Group footer="Meals that use what's here come up first when the week is planned, the oldest first.">
            {items.map((f) => <Row key={f.id} title={f.item} subtitle={[f.amount, age(f.added)].filter(Boolean).join(" · ")} value="Use one" onClick={() => act.takeOut(f)} />)}
          </Group>
        ) : <p className="t-sub text-center text-muted">Nothing in the freezer yet.</p>}
      </div>
    </Sheet>
  );
}
