"use client";
import { useEffect, useState } from "react";
import { framed, type CartLine, type Item, type ListState, type Store } from "@/lib/client";
import { buyAmount, cartTotal, needBeside, findItems, money, qtyFor, type FindItem } from "@/lib/shop";
import { norm } from "@/lib/words";
import { FindView, ProductImage, Stepper, UpdateNotice, useSafeway, type Safeway } from "./Safeway";
import { Check, STORE_NAMES } from "./Shop";
import { BrandBar, Button, EmptyState, Group, Notice, Row, Segmented, Sheet } from "./ui";

/**
 * Lists (the redesign, Nov 2): one list per store, and All for shopping in person. The Safeway rows are also its cart:
 * "Same as last time" (Add puts the usual in the cart), "To find" (Find opens Safeway's choices), "In the cart" (− / +).
 * Trader Joe's, Costco and All are checklists: tick what you got, then Done shopping (confirmed first). No Clear here
 * (Nov 11): New plan on Meals is the one fresh start, and it empties the lists. When Safeway can't be reached (the helper hasn't checked in for a couple of
 * minutes), the Safeway rows are a checklist too and the cart is greyed (Nov 3).
 */
export type Where = "all" | Store;
const WHERE: { value: Where; label: string }[] = [{ value: "all", label: "All" }, { value: "safeway", label: "Safeway" }, { value: "trader-joes", label: "Trader Joe's" }, { value: "costco", label: "Costco" }];
const STORES = Object.keys(STORE_NAMES) as Store[];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type ListsActions = {
  add: (text: string, store?: Store) => Promise<unknown>;
  check: (it: Item, checked: boolean) => void;
  move: (it: Item, store: Store) => void;
  /** Done shopping: ticked items off; `cart` also takes what's in the Safeway cart off (the order went through). */
  done: (store: Store, cart?: boolean) => Promise<unknown>;
  putBack: (items: Item[]) => void;
};

/** ⋯ as the phone's own menu: what can be done with one row. */
function More({ name, options, onPick }: { name: string; options: { value: string; label: string; off?: boolean }[]; onPick: (v: string) => void }) {
  if (!options.some((o) => !o.off)) return null;
  return (
    <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-muted">
      <span aria-hidden>⋯</span>
      <select value="" aria-label={`More for ${name}`} onChange={(e) => { if (e.target.value) onPick(e.target.value); }} className="absolute inset-0 size-full cursor-pointer opacity-0 text-base">
        <option value="" disabled>{name}</option>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.off}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** The ⋯ choices for a list item: pick another Safeway product (when there's one to change), or get it somewhere else. */
function moreFor(it: Item, inCart: number, canPick: boolean) {
  return [
    { value: "pick", label: "Pick another", off: !canPick },
    ...STORES.map((s) => ({ value: s, label: `Get it at ${STORE_NAMES[s]}`, off: s === it.store || inCart > 0 })),
  ];
}

/** "2 of 5 got" and (once something's ticked) Done shopping: the top of a checklist. */
function TopLine({ text, onDone }: { text: string; onDone: (() => void) | null }) {
  return (
    <div className="flex min-h-10 items-center gap-1 px-4">
      <span className="min-w-0 flex-1 t-sub font-semibold">{text}</span>
      {onDone && <button onClick={onDone} className="h-9 rounded-full bg-accent px-4 t-sub font-semibold text-on-accent active:scale-95">Done shopping</button>}
    </div>
  );
}

function TickRow({ it, inCart, onTick, more }: { it: Item; inCart: number; onTick: () => void; more: React.ReactNode }) {
  const title = <span className={it.checked ? "text-muted line-through" : ""}>{cap(it.item)}</span>;
  return (
    <div className="flex items-center pr-2">
      <div className="min-w-0 flex-1">
        {inCart
          ? <Row lead={<ProductImage small />} title={title} subtitle={<span className="font-semibold text-accent">In the cart{inCart > 1 ? ` · ${inCart}` : ""}</span>} />
          : <Row lead={<Check on={it.checked} />} title={title} subtitle={buyAmount(it.quantity) || undefined} role="checkbox" checked={it.checked} onClick={onTick} />}
      </div>
      {more}
    </div>
  );
}

export function ListsScreen({ list, error, act, start }: { list: ListState | null; error: string | null; act: ListsActions; start: Where }) {
  const sw = useSafeway();
  const [where, setWhere] = useState<Where>(start);
  const [text, setText] = useState("");
  const [finding, setFinding] = useState<string | null>(null); // the Safeway item whose choices are open, by id
  const [findNext, setFindNext] = useState<string | null>(null); // a Safeway item just added: its choices open once it's on the list
  const [finishing, setFinishing] = useState<Item[] | null>(null); // Done shopping, waiting on its confirm
  const items = (list?.items ?? []).filter((i) => !(i.check && !i.checked)); // what Stock highlights isn't on a list yet
  const toFind = findItems(list?.items ?? [], list?.staples ?? [], sw.picks);
  // With Safeway out of reach its rows are ticked off in the store, so the ticked ones stay showing (Nov 3).
  const toTick = sw.away ? findItems(items.map((i) => (i.store === "safeway" ? { ...i, checked: false } : i)), list?.staples ?? [], sw.picks) : toFind;
  const inCart = (it: Item) => (it.store === "safeway" ? qtyFor(sw.cart, it.id) : 0);
  const findOf = (id: string) => toFind.find((f) => f.id === id);

  // Added on Safeway: its choices open as soon as it's on the list.
  useEffect(() => {
    if (!findNext) return;
    const it = items.find((i) => i.store === "safeway" && !i.checked && norm(i.item) === findNext);
    if (it) queueMicrotask(() => { setFinding(it.id); setFindNext(null); });
  }, [findNext, items]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    const store = where === "all" ? undefined : where;
    void act.add(t, store);
    if (where === "safeway") setFindNext(norm(t.replace(/^(\d+(\.\d+)?|a dozen|dozen|a couple|a few)\s+/i, "")));
  };

  const here = where === "all" ? items.filter((i) => !inCart(i)) : items.filter((i) => i.store === where);
  const ticked = here.filter((i) => i.checked);
  // Done shopping asks first (Nov 3: it replaced the Undo after it), since it can be tapped by mistake.
  const done = () => { if (ticked.length) setFinishing([...ticked]); };
  const doDone = async () => {
    const off = finishing ?? [];
    setFinishing(null);
    const stores = STORES.filter((s) => off.some((i) => i.store === s));
    for (const s of stores) await act.done(s, false);
  };
  const more = (it: Item) => (
    <More name={cap(it.item)} options={moreFor(it, inCart(it), it.store === "safeway" && !inCart(it) && Boolean(findOf(it.id)?.picked))}
      onPick={(v) => (v === "pick" ? setFinding(it.id) : act.move(it, v as Store))} />
  );

  return (
    <div className="space-y-5">
      <BrandBar below={<Segmented label="Store" value={where} options={WHERE} onChange={setWhere} />} />
      <h1 className="sr-only">Lists</h1>
      {error && <Notice>{error}</Notice>}
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something" aria-label="Add something" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </form>

      {where === "safeway"
        ? <SafewayList items={items.filter((i) => i.store === "safeway")} toFind={toTick} sw={sw} more={more} onFind={setFinding}
            onOrdered={() => act.done("safeway", true)}
            onTick={(it) => act.check(it, !it.checked)} onDone={sw.away && ticked.length ? done : null} />
        : (
          <>
            <TopLine text={here.length ? `${ticked.length} of ${here.length} got` : ""} onDone={ticked.length ? done : null} />
            {list && !items.length && <EmptyState icon="list" title="Nothing on the lists" />}
            {(where === "all" ? STORES : [where]).map((s) => {
              const rows = items.filter((i) => i.store === s);
              if (!rows.length) return where === "all" ? null : <EmptyState key={s} icon="list" title={`Nothing for ${STORE_NAMES[s]}`} />;
              return (
                <Group key={s} header={where === "all" ? STORE_NAMES[s] : undefined}>
                  {rows.map((it) => <TickRow key={it.id} it={it} inCart={inCart(it)} onTick={() => act.check(it, !it.checked)} more={more(it)} />)}
                </Group>
              );
            })}
          </>
        )}

      {finding && findOf(finding) && (
        <Sheet label="Safeway's choices" wide onClose={() => setFinding(null)}>
          <div className="pb-2">
            <FindView store="Safeway" items={toFind} index={toFind.findIndex((f) => f.id === finding)} sw={sw}
              onIndex={(i) => (toFind[i] ? setFinding(toFind[i].id) : setFinding(null))} onCart={() => setFinding(null)} onList={() => setFinding(null)}
              onGot={(id) => { const x = items.find((i) => i.id === id); if (x) act.check(x, true); }} />
          </div>
        </Sheet>
      )}
      {finishing && (
        <Sheet label="Done shopping" title={where === "all" ? "Done shopping?" : `Done at ${STORE_NAMES[where]}?`} onClose={() => setFinishing(null)}>
          <div className="space-y-3 pb-2">
            <p className="t-sub text-muted">{finishing.length} thing{finishing.length === 1 ? " comes" : "s come"} off the list{where === "all" ? "s" : ""}.</p>
            <Button className="w-full" onClick={doDone}>Done shopping</Button>
            <Button variant="secondary" className="w-full" onClick={() => setFinishing(null)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** The Safeway list and its cart in one: what's the same as last time, what's to find, and what's in the cart. */
function SafewayList({ items, toFind, sw, more, onFind, onOrdered, onTick, onDone }: {
  items: Item[]; toFind: FindItem[]; sw: Safeway; more: (it: Item) => React.ReactNode; onFind: (id: string) => void;
  onOrdered: () => void; onTick: (it: Item) => void; onDone: (() => void) | null;
}) {
  const away = sw.away;
  const [filling, setFilling] = useState(false);
  // In the helper's panel, the Safeway tab beside it shows Safeway's own cart while this is open, and Simmer's copy
  // takes the quantities shown there.
  const { run, refresh } = sw;
  useEffect(() => {
    if (!framed()) return;
    const c = new AbortController();
    run("cart", {}, c.signal).then((r) => { if (r.ok) refresh(); });
    return () => c.abort();
  }, [run, refresh]);
  const lines = sw.cart.map((l) => ({ ...l, qty: sw.qtyOf(l.productId, l.qty) }));
  const { total, estimate } = cartTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const waiting = toFind.filter((f) => !qtyFor(sw.cart, f.id));
  const usual = waiting.filter((f) => f.picked);
  const find = waiting.filter((f) => !f.picked);
  const itemOf = (id: string) => items.find((i) => i.id === id);
  const addUsual = (f: FindItem) => f.picked && sw.setQty({ id: f.picked.id, name: f.picked.name, price: "", image: f.picked.image ?? "" }, Math.max(1, f.want), f.query, f);
  const autoFill = async () => { setFilling(true); for (const f of usual) await addUsual(f); setFilling(false); };
  const sub = (f: FindItem, last?: boolean) => [buyAmount(f.quantity) && `Need ${buyAmount(f.quantity)}`, last && "Last time"].filter(Boolean).join(" · ") || undefined;
  const got = waiting.filter((f) => itemOf(f.id)?.checked).length;
  // A row's words, and with Safeway out of reach a tick to tap (struck through once got), as Trader Joe's rows are.
  const line = (f: FindItem, lead: React.ReactNode, title: string, subtitle?: string) => {
    const it = itemOf(f.id), on = Boolean(it?.checked);
    return away && it
      ? <Row lead={<Check on={on} />} title={<span className={on ? "text-muted line-through" : ""}>{title}</span>} subtitle={subtitle} role="checkbox" checked={on} onClick={() => onTick(it)} />
      : <Row lead={lead} title={title} subtitle={subtitle} />;
  };
  return (
    <>
      <TopLine text={away ? (waiting.length ? `${got} of ${waiting.length} got` : "") : `${count} in the cart${count ? ` · ${estimate ? "about " : ""}${money(total)}` : ""}`} onDone={onDone} />
      {sw.outdated && <UpdateNotice />}
      {sw.problem && <Notice onClick={() => sw.setProblem(null)}>{sw.problem}</Notice>}
      {away
        ? <Notice tone="info">Can&apos;t reach Safeway right now. Check things off in the store instead.</Notice>
        : sw.answering === false && <Notice tone="info">Safeway isn&apos;t connected right now. Changes wait until it is.</Notice>}
      {usual.length > 0 && (
        <Group header="Same as last time" aside={usual.length > 1 && <button disabled={filling || away} onClick={autoFill} className="t-foot font-semibold text-accent disabled:opacity-40">Auto-fill {usual.length}</button>}>
          {usual.map((f) => (
            <div key={f.id} className="flex items-center pr-2">
              <div className="min-w-0 flex-1">{line(f, <ProductImage src={f.picked?.image} small />, f.picked?.name ?? cap(f.item), sub(f, true))}</div>
              {f.picked && f.picked.id in sw.pending ? <Stepper qty={1} name={f.item} busy onChange={() => {}} />
                : <Button size="md" variant="secondary" className="shrink-0" disabled={away} onClick={() => addUsual(f)}>Add</Button>}
              {itemOf(f.id) && more(itemOf(f.id)!)}
            </div>
          ))}
        </Group>
      )}
      {find.length > 0 && (
        <Group header="To find">
          {find.map((f) => (
            <div key={f.id} className="flex items-center pr-2">
              <div className="min-w-0 flex-1">{line(f, <ProductImage small />, cap(f.item), sub(f))}</div>
              <Button size="md" className="shrink-0" disabled={away} onClick={() => onFind(f.id)}>Find</Button>
              {itemOf(f.id) && more(itemOf(f.id)!)}
            </div>
          ))}
        </Group>
      )}
      {lines.length > 0 && (
        // Greyed while Safeway can't be reached: it's still what's in the cart, but it can't be changed (Nov 3).
        <div className={away ? "opacity-50" : ""} aria-disabled={away || undefined}>
        <Group header="In the cart">
          {lines.map((l: CartLine) => {
            const p = { id: l.productId, name: l.name, price: l.price, image: l.image };
            const it = l.itemId ? itemOf(l.itemId) : undefined;
            return (
              <div key={l.productId} className="flex items-center gap-3 py-3 pl-4 pr-2">
                <ProductImage src={l.image} small />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 t-body">{l.name}</p>
                  <p className="mt-0.5 t-foot text-muted">{[l.price, it && needBeside(it.quantity, l.name, l.qty) ? `Need ${needBeside(it.quantity, l.name, l.qty)}` : ""].filter(Boolean).join(" · ")}</p>
                </div>
                <Stepper qty={l.qty} name={l.name} busy={l.productId in sw.pending} off={away} onChange={(n) => sw.setQty(p, n, l.item || l.name, null, { alt: l.name, on: "cart" })} />
                {it && <More name={cap(it.item)} options={[{ value: "pick", label: "Pick another", off: away }]} onPick={() => onFind(it.id)} />}
              </div>
            );
          })}
        </Group>
        </div>
      )}
      {sw.loaded && !waiting.length && !lines.length && <EmptyState icon="cart" title="Nothing to get at Safeway" />}
      {/* For when Simmer can't tell by itself that the order went through (it reads Safeway's Purchases page once the
          cart page says it's empty, Nov 3). */}
      {lines.length > 0 && <button onClick={onOrdered} className="w-full py-2 t-sub font-semibold text-muted">Ordered? Take the cart off the list</button>}
    </>
  );
}
