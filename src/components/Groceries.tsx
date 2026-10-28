"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, dateIn, errorText, type Frozen, type Item, type Kitchen, type ListState, type Order, type Pick, type Section, type Staple, type Store } from "@/lib/client";
import { norm } from "@/lib/words";
import { addDays } from "@/lib/time";
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

/** One store's part of the list: fresh first, then pantry, freezer, household; checked items fall to the bottom. */
function StoreGroup({ store, items, act, onMore, footer }: { store: Store; items: Item[]; act: ListActions; onMore: (it: Item) => void; footer?: string }) {
  const rank = (it: Item) => (it.checked ? 10 : 0) + SECTION_ORDER.indexOf(it.section);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b) || a.item.localeCompare(b.item));
  const got = items.filter((i) => i.checked).length;
  return (
    <Group
      header={STORE_NAMES[store]} footer={footer}
      aside={got ? <button className="t-foot font-semibold text-accent" onClick={() => act.done(store)}>Done shopping</button> : <span className="t-foot text-muted">{items.length} to get</span>}
    >
      {sorted.map((it) => <ItemRow key={it.id} it={it} act={act} onMore={() => onMore(it)} />)}
    </Group>
  );
}

export function GroceriesScreen({ list, kitchen, error, act, onSettings, onListChanged }: { list: ListState | null; kitchen: Kitchen | null; error: string | null; act: ListActions; onSettings: () => void; onListChanged: () => void }) {
  const [freezer, setFreezer] = useState(false);
  // The Safeway order the helper fills on the computer, and the products picked before (for "Open in Safeway").
  const [order, setOrderOnly] = useState<Order | null>(null);
  // When the order was last heard of: drawing can't read the clock, so it's noted with each news of the order.
  const [now, setNow] = useState(() => Date.now());
  const setOrder = useCallback((o: Order | null) => { setOrderOnly(o); setNow(Date.now()); }, []);
  const [orderOpen, setOrderOpen] = useState(false);
  const [picks, setPicks] = useState<Pick[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    api.picks(ctl.signal).then((r) => setPicks(r.picks), () => {});
    api.order(ctl.signal).then((r) => setOrder(r.order), () => {});
    return () => ctl.abort();
  }, [setOrder]);
  const pickFor = (it: Item) => picks.find((p) => norm(p.item) === norm(it.item));
  const [text, setText] = useState("");
  const [more, setMore] = useState<Item | null>(null);
  const [staples, setStaples] = useState(false);
  const all = list?.items ?? [];
  const toCheck = all.filter((i) => i.check && !i.checked);
  const items = all.filter((i) => !(i.check && !i.checked));
  const stores = (Object.keys(STORE_NAMES) as Store[]).filter((s) => items.some((i) => i.store === s));
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (text.trim()) { act.add(text.trim()); setText(""); } };
  return (
    <div className="space-y-6">
      <TopBar title="Groceries" subtitle={`Safeway order ${dayWord(safewayDay())}`} trailing={<IconButton icon="sliders" label="Settings" onClick={onSettings} />} />
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add eggs, 2 lemons…" aria-label="Add to the list" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </form>
      <Group>
        <Row icon="list" title="Running low?" subtitle="Add from the things you always keep" accessory="chevron" onClick={() => setStaples(true)} />
        <Row icon="snow" title="Freezer" subtitle={kitchen?.freezer.length ? `${kitchen.freezer.length} thing${kitchen.freezer.length === 1 ? "" : "s"} · oldest: ${kitchen.freezer[0].item.toLowerCase()}` : "What's in there"} accessory="chevron" onClick={() => setFreezer(true)} />
      </Group>
      {toCheck.length > 0 && (
        <Group header="Check you have these" aside={<button className="t-foot font-semibold text-accent" onClick={act.have}>I have the rest</button>}
          footer="From the week's plan. Tap any you're out of to put it on the list.">
          {toCheck.map((it) => <Row key={it.id} title={it.item.charAt(0).toUpperCase() + it.item.slice(1)} subtitle={[it.quantity, it.for && `for ${it.for}`].filter(Boolean).join(" · ")} value="Need it" onClick={() => act.need(it)} />)}
        </Group>
      )}
      {list && !items.length && !toCheck.length && <EmptyState icon="list" title="Nothing on the list">Add what you need, or tap Running low.</EmptyState>}
      {(items.some((i) => i.store === "safeway" && !i.checked) || (order && isOpen(order))) && (
        <Group>
          <Row icon="list" title="Fill my Safeway cart" subtitle={orderLine(order, now)} accessory="chevron" onClick={() => setOrderOpen(true)} />
        </Group>
      )}
      {stores.map((s) => (
        <StoreGroup key={s} store={s} items={items.filter((i) => i.store === s)} act={act} onMore={setMore}
          footer={s === "trader-joes" ? `Next Trader Joe's trip: ${shortDate(traderJoesDay(kitchen?.trips.lastTraderJoes ?? ""))}` : undefined} />
      ))}
      {freezer && <FreezerSheet items={kitchen?.freezer ?? []} act={act} onClose={() => setFreezer(false)} />}
      {more && <ItemSheet it={more} act={act} pick={more.store === "safeway" ? pickFor(more) : undefined} onClose={() => setMore(null)} />}
      {orderOpen && <OrderSheet order={order} now={now} onOrder={setOrder} onListChanged={onListChanged} onClose={() => setOrderOpen(false)} />}
      {staples && list && <StaplesSheet staples={list.staples} items={items} act={act} onClose={() => setStaples(false)} />}
    </div>
  );
}

/** An item's options: which store, which section, or take it off; for Safeway, its usual product there. */
function ItemSheet({ it, act, pick, onClose }: { it: Item; act: ListActions; pick?: Pick; onClose: () => void }) {
  return (
    <Sheet label={it.item} title={it.item} onClose={onClose}>
      <div className="space-y-5 pb-2">
        {pick && (
          <Group footer="The one picked last time. Opens in the Safeway app, to add it there.">
            <Row title="Open in Safeway" subtitle={pick.name} accessory="external" href={productUrl(pick.id)} />
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

const SAFEWAY = "https://www.safeway.com";
const productUrl = (id: string) => `${SAFEWAY}/shop/product-details.${id}.html`;
const searchUrl = (q: string) => `${SAFEWAY}/shop/search-results.html?q=${encodeURIComponent(q)}`;
const isOpen = (o: Order | null) => Boolean(o && (o.status === "waiting" || o.status === "filling" || o.status === "asking"));
const recent = (o: Order, now: number) => now - Date.parse(o.updated) < 12 * 3600_000;


/** The line under "Fill my Safeway cart": what the order's doing, if there is one. */
function orderLine(o: Order | null, now: number) {
  if (!o || (!isOpen(o) && !recent(o, now))) return "Your usual products go in by themselves; it asks about the rest";
  const inCart = o.lines.filter((l) => l.state === "in cart").length;
  if (o.status === "waiting") return "Waiting to start";
  if (o.status === "asking") return `Which ${o.question?.item ?? "one"}? Tap to answer`;
  if (o.status === "filling") return `Filling · ${inCart} of ${o.lines.length} in the cart`;
  if (o.status === "done") return `${inCart} of ${o.lines.length} in the cart · check out in the Safeway app`;
  return o.note || "Stopped";
}

/**
 * The Safeway order: start it, see each item go in, answer when the helper asks which product, stop it. The helper
 * does the work in Chrome on a computer that's left on; the cart is the same one the Safeway app shows.
 */
function OrderSheet({ order, now, onOrder, onListChanged, onClose }: { order: Order | null; now: number; onOrder: (o: Order | null) => void; onListChanged: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const was = useRef(order?.status);
  const send = async (c: Parameters<typeof api.orderChange>[0]) => {
    setBusy(true); setErr("");
    try { onOrder((await api.orderChange(c)).order); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  // While it's open and the order's going, follow it every few seconds; refresh the list when it's over.
  const open = isOpen(order);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => { api.order().then((r) => onOrder(r.order), () => {}); }, 2500);
    return () => clearInterval(t);
  }, [open, onOrder]);
  useEffect(() => {
    if (was.current && was.current !== order?.status) onListChanged();
    was.current = order?.status;
  }, [order?.status, onListChanged]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (order?.status !== "waiting") return;
    const t = setTimeout(() => setSlow(true), Math.max(0, 45_000 - (Date.now() - Date.parse(order.started))));
    return () => { clearTimeout(t); setSlow(false); };
  }, [order?.status, order?.started]);
  const q = order?.status === "asking" ? order.question : null;
  const head = !order || (!open && !recent(order, now)) ? "Fill my Safeway cart" : order.status === "done" ? "Your cart's ready" : order.status === "stopped" ? "Stopped" : q ? `Which ${q.item}?` : "Filling your cart";
  return (
    <Sheet label="Safeway cart" title={head} onClose={onClose}>
      <div className="space-y-5 pb-2">
        {err && <Notice>{err}</Notice>}
        {(!order || (!open && !recent(order, now))) && (
          <>
            <p className="t-sub text-muted">Everything on the list for Safeway goes into your Safeway cart, one thing at a time. Your usual products go in by themselves; it asks here about the rest. Then you pick a time and check out in the Safeway app.</p>
            <Button onClick={() => send({ op: "start" })} disabled={busy} className="w-full">Fill my Safeway cart</Button>
          </>
        )}
        {order?.status === "waiting" && <p className="t-sub text-muted">{slow ? "Waiting to start. It starts once the Safeway helper is running, with Safeway signed in." : "Starting…"}</p>}
        {q && (
          <>
            {q.quantity && <p className="t-sub text-muted">{q.quantity} on the list. {q.options.length ? `${q.options.length} found, the likeliest first.` : ""}</p>}
            {q.options.length ? (
              <Group>
                {q.options.map((o) => (
                  // eslint-disable-next-line @next/next/no-img-element -- a small product picture from Safeway
                  <Row key={o.id} lead={o.image ? <img src={o.image} alt="" className="size-9 rounded-lg bg-white object-contain" /> : undefined} title={o.name} subtitle={o.price}
                    onClick={busy ? undefined : () => send({ op: "answer", id: order!.id, answer: { itemId: q.itemId, pick: { id: o.id, name: o.name } } })} />
                ))}
              </Group>
            ) : <p className="t-sub text-muted">Nothing came up.</p>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (search.trim()) { send({ op: "answer", id: order!.id, answer: { itemId: q.itemId, search: search.trim() } }); setSearch(""); } }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Not here? Look for something else" aria-label="Look for something else"
                className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
            </form>
            <Button variant="secondary" disabled={busy} onClick={() => send({ op: "answer", id: order!.id, answer: { itemId: q.itemId, skip: true } })} className="w-full">Skip this one</Button>
          </>
        )}
        {order && order.lines.length > 0 && (open || recent(order, now)) && (
          <Group footer={order.status === "done" ? "Pick a time and check out in the Safeway app." : order.status === "stopped" ? order.note : undefined}>
            {order.lines.map((l, i) => {
              const now = open && l.state === "to do" && order.lines.findIndex((x) => x.state === "to do") === i;
              const sub = l.state === "in cart" ? `In the cart${(l.qty ?? 1) > 1 ? `, ${l.qty}` : ""}${l.name ? ` · ${l.name}` : ""}` : l.state === "skipped" ? "Skipped" : l.state === "by hand" ? "Add it yourself" : now ? (q ? "Which one?" : order.note || "Looking…") : "";
              return (
                <Row key={l.itemId} lead={<Check on={l.state === "in cart"} />} title={l.item.charAt(0).toUpperCase() + l.item.slice(1)} subtitle={sub}
                  {...(l.state === "by hand" && { href: l.productId ? productUrl(l.productId) : searchUrl(l.item), accessory: "external" as const })} />
              );
            })}
          </Group>
        )}
        {open && <Button variant="secondary" disabled={busy} onClick={() => send({ op: "stop", id: order!.id })} className="w-full">Stop</Button>}
        {order && !open && recent(order, now) && <Button variant="secondary" onClick={() => send({ op: "start" })} disabled={busy} className="w-full">Fill it again</Button>}
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
