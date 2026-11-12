"use client";
import { useEffect, useState } from "react";
import { framed, type CartLine, type Item, type ListState, type Store } from "@/lib/client";
import { buyAmount, cartFor, cartTotal, findItems, money, needBeside, type FindItem } from "@/lib/shop";
import { FindView, Stepper, UpdateNote, useSafeway, type Safeway } from "./Safeway";
import { Alert, BrandBar, Button, ConfirmSheet, EmptyState, Group, Held, Segmented, Sheet } from "./ui";

/**
 * Shop (Matt, Nov 12): one page, grouped by store (Safeway, Trader Joe's, Costco; a store with nothing doesn't show).
 * Every row is the same: a tick (got it, in the store or delivered), the household's name for the thing, and one small
 * line under it (Safeway's product and how much is needed, or just the amount). While Safeway can be reached, a Safeway
 * row also has Add (its usual product into the cart), Find (Safeway's choices, in a sheet) or − n + once it's in the
 * cart; the Safeway header has what's in the cart and Auto-fill, and cart things added on Safeway's own site end the
 * group. When Safeway can't be reached (a job the helper didn't pick up), its rows are a plain checklist. One Done
 * shopping (confirmed first) takes what's ticked off in every store. No Clear here (Nov 11): New plan on Meals is the
 * one fresh start, and it empties the list.
 */
export const STORE_NAMES: Record<Store, string> = { safeway: "Safeway", "trader-joes": "Trader Joe's", costco: "Costco" };
const STORES = Object.keys(STORE_NAMES) as Store[];
/** The filter at the top (Matt, Nov 12): every store, or one store's rows only, the same rows either way. */
type Where = "all" | Store;
const WHERE: { value: Where; label: string }[] = [{ value: "all", label: "All" }, ...STORES.map((s) => ({ value: s as Where, label: STORE_NAMES[s] }))];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A round check, filled when it's got. */
export function Check({ on }: { on: boolean }) {
  return (
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-accent bg-accent text-on-accent" : "border-muted/50"}`} aria-hidden>
      {on && <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5 9-10" /></svg>}
    </span>
  );
}

export type ShopActions = {
  add: (text: string, store?: Store) => Promise<unknown>;
  check: (it: Item, checked: boolean) => void;
  move: (it: Item, store: Store) => void;
  /** The order went through: `cart` (the list ids in the Safeway cart) comes off the Safeway list as bought. */
  done: (store: Store, cart?: string[]) => Promise<unknown>;
  /** Done shopping: these ticked things come off, whatever their store. */
  doneTicked: (items: Item[]) => Promise<unknown>;
};

/** ⋯ as the phone's own menu: what can be done with one row. Its space stays when there's nothing, so rows line up. */
function More({ name, options, onPick }: { name: string; options: { value: string; label: string; off?: boolean }[]; onPick: (v: string) => void }) {
  if (!options.some((o) => !o.off)) return <span aria-hidden className="size-9 shrink-0" />;
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

/** "2 of 5 got" and Done shopping: always there, greyed until something's ticked (Nov 11). */
function TopLine({ text, onDone }: { text: string; onDone: (() => void) | null }) {
  return (
    <div className="flex min-h-10 items-center gap-1 px-4">
      <span className="min-w-0 flex-1 t-sub font-semibold">{text}</span>
      <button onClick={onDone ?? undefined} disabled={!onDone} className="h-9 shrink-0 rounded-full bg-accent px-4 t-sub font-semibold text-on-accent active:scale-95 disabled:opacity-40 disabled:active:scale-100">Done shopping</button>
    </div>
  );
}

/**
 * One row, the same everywhere: one fixed height with room for two lines (as Stock's rows), so rows are even. `tick`:
 * the check, the name and the small line are one button; without it (a cart thing that isn't on the list) the check's
 * space stays, so the names line up.
 */
function ShopRow({ title, sub, checked, onTick, control, more }: {
  title: string; sub?: string; checked?: boolean; onTick?: () => void; control?: React.ReactNode; more: React.ReactNode;
}) {
  const words = (
    <span className="min-w-0 flex-1">
      <span className={`block truncate t-body ${checked ? "text-muted line-through" : ""}`}>{title}</span>
      {sub && <span className="block truncate t-foot text-muted">{sub}</span>}
    </span>
  );
  return (
    <div className="flex h-[3.75rem] items-center gap-2 pr-2" data-shop-row>
      {onTick
        ? <button onClick={onTick} role="checkbox" aria-checked={Boolean(checked)} className="flex h-full min-w-0 flex-1 items-center gap-3 pl-4 text-left active:bg-sunk"><Check on={Boolean(checked)} />{words}</button>
        : <div className="flex h-full min-w-0 flex-1 items-center gap-3 pl-4"><span aria-hidden className="size-6 shrink-0" />{words}</div>}
      {control}
      {more}
    </div>
  );
}

const pill = "flex h-8 shrink-0 items-center rounded-full px-3.5 t-sub font-semibold transition active:scale-95";

export function ShopScreen({ list, act }: { list: ListState | null; act: ShopActions }) {
  const sw = useSafeway();
  const [text, setText] = useState("");
  const [finding, setFinding] = useState<string | null>(null); // the Safeway item whose choices are open, by id
  const [finishing, setFinishing] = useState<Item[] | null>(null); // Done shopping, waiting on its confirm
  const [ordering, setOrdering] = useState(false); // "Ordered?" waiting on its confirm
  const [where, setWhere] = useState<Where>("all");
  const items = (list?.items ?? []).filter((i) => !(i.check && !i.checked)); // what Stock highlights isn't on the list yet
  // What Find goes through: the Safeway things not got yet.
  const toFind = findItems(list?.items ?? [], list?.staples ?? [], sw.picks);
  const findOf = (id: string) => toFind.find((f) => f.id === id);
  // Every Safeway row's product (ticked ones too, so a ticked row still says what was bought).
  const infos = new Map(findItems(items.filter((i) => i.store === "safeway").map((i) => ({ ...i, checked: false })), list?.staples ?? [], sw.picks).map((f) => [f.id, f]));
  const live = sw.loaded && !sw.away; // Safeway can be reached: its rows get their controls

  // In the helper's panel, the Safeway tab beside it shows Safeway's own cart while this is open, and Simmer's copy
  // takes the quantities shown there.
  const { run, refresh } = sw;
  useEffect(() => {
    if (!framed()) return;
    const c = new AbortController();
    run("cart", {}, c.signal).then((r) => { if (r.ok) refresh(); });
    return () => c.abort();
  }, [run, refresh]);

  // The cart, with a change on its way counted (taken out: gone at once).
  const lines = sw.cart.map((l) => ({ ...l, qty: sw.qtyOf(l.productId, l.qty) })).filter((l) => l.qty > 0);
  const { total, estimate } = cartTotal(lines);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  // Each Safeway row's cart line (its first, when there are more); every other line ends the Safeway group.
  const lineOf = new Map<string, CartLine>();
  for (const it of items) if (it.store === "safeway") { const l = lines.find((x) => x.itemId === it.id); if (l) lineOf.set(it.id, l); }
  const tied = new Set([...lineOf.values()].map((l) => l.productId));
  const loose = lines.filter((l) => !tied.has(l.productId));
  const inCart = (it: Item) => (it.store === "safeway" ? cartFor(lines, it.id).reduce((n, l) => n + l.qty, 0) : 0);

  const product = (p: { id: string; name: string; image?: string }) => ({ id: p.id, name: p.name, price: "", image: p.image ?? "" });
  const addUsual = (f: FindItem) => f.picked && sw.setQty(product(f.picked), Math.max(1, f.want), f.query, f);
  // Usuals not in the cart yet, for Auto-fill: every row shows its count at once; Safeway takes them one after another.
  const usual = toFind.filter((f) => f.picked && !lineOf.has(f.id) && !(sw.pending[f.picked.id] > 0));
  const autoFill = async () => { usual.forEach((f) => sw.show(f.picked!.id, Math.max(1, f.want))); for (const f of usual) await addUsual(f); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    void act.add(t);
  };

  // What the filter shows; "got" and Done shopping go by it (at Trader Joe's, only Trader Joe's ticks come off).
  const here = where === "all" ? items : items.filter((i) => i.store === where);
  const ticked = here.filter((i) => i.checked);
  // Done shopping asks first (Nov 3: it replaced the Undo after it), since it can be tapped by mistake.
  const done = () => { if (ticked.length) setFinishing([...ticked]); };

  /** A list item's row. */
  const itemRow = (it: Item) => {
    const n = inCart(it);
    const f = infos.get(it.id);
    const l = lineOf.get(it.id);
    const waiting = f?.picked ? sw.pending[f.picked.id] ?? 0 : 0; // just added, on its way to Safeway
    const amount = buyAmount(it.quantity);
    const need = l ? needBeside(it.quantity, l.name, l.qty) : amount;
    const name = l?.name ?? f?.picked?.name;
    const sub = it.store === "safeway" && name ? [name, need && `Need ${need}`].filter(Boolean).join(" · ") : amount || undefined;
    let control: React.ReactNode = null;
    if (it.store === "safeway" && live) {
      if (l) control = <Stepper compact qty={l.qty} name={cap(it.item)} onChange={(q) => sw.setQty({ id: l.productId, name: l.name, price: l.price, image: l.image }, q, l.item || l.name, null, { alt: l.name, on: "cart" })} />;
      else if (f?.picked && waiting > 0) control = <Stepper compact qty={waiting} name={cap(it.item)} onChange={(q) => sw.setQty(product(f.picked!), q, f.query, f)} />;
      else if (!it.checked && f?.picked) control = <button onClick={() => addUsual(f)} aria-label={`Add ${cap(it.item)} to the cart`} className={`${pill} glass text-accent`}>Add</button>;
      else if (!it.checked && findOf(it.id)) control = <button onClick={() => setFinding(it.id)} aria-label={`Find ${cap(it.item)} at Safeway`} className={`${pill} glass text-accent`}>Find</button>;
    }
    const canPick = it.store === "safeway" && live && Boolean(findOf(it.id)) && Boolean(f?.picked || l);
    return (
      <ShopRow key={it.id} title={cap(it.item)} sub={sub} checked={it.checked} onTick={() => act.check(it, !it.checked)} control={control}
        more={<More name={cap(it.item)} options={moreFor(it, n, canPick)} onPick={(v) => (v === "pick" ? setFinding(it.id) : act.move(it, v as Store))} />} />
    );
  };

  const shown = (where === "all" ? STORES : [where]).filter((s) => items.some((i) => i.store === s) || (s === "safeway" && loose.length > 0));

  return (
    <div className="space-y-5">
      <BrandBar below={<Segmented label="Store" value={where} options={WHERE} onChange={setWhere} />} />
      <h1 className="sr-only">Shop</h1>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something" aria-label="Add something" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" disabled={!text.trim()} className="shrink-0 px-5">Add</Button>
      </form>

      {!list ? <Held /> : !shown.length ? <EmptyState icon="list" title={where === "all" ? "Nothing on the list" : `Nothing for ${STORE_NAMES[where]}`} /> : (
        <>
          <TopLine text={here.length ? `${ticked.length} of ${here.length} got` : ""} onDone={ticked.length ? done : null} />
          {shown.map((s) => (
            <div key={s} className="space-y-2">
            <Group header={STORE_NAMES[s]} aside={s === "safeway" && live && (count > 0 || usual.length > 1) && (
              <span className="flex min-w-0 items-baseline gap-3 t-foot">
                {count > 0 && <span className="truncate text-muted">{count} in the cart · {estimate ? "about " : ""}{money(total)}</span>}
                {usual.length > 1 && <button onClick={autoFill} className="shrink-0 font-semibold text-accent">Auto-fill {usual.length}</button>}
              </span>
            )}>
              {items.filter((i) => i.store === s).map(itemRow)}
              {/* Put in the cart on Safeway's own site: in the cart, but not for anything on the list. */}
              {s === "safeway" && loose.map((l) => (
                <ShopRow key={l.productId} title={l.name} sub={l.price || undefined} more={<More name={l.name} options={[]} onPick={() => {}} />}
                  control={live && <Stepper compact qty={l.qty} name={l.name} onChange={(q) => sw.setQty({ id: l.productId, name: l.name, price: l.price, image: l.image }, q, l.item || l.name, null, { alt: l.name, on: "cart" })} />} />
              ))}
            </Group>
            {/* For when Simmer can't tell by itself that the order went through (it reads Safeway's Purchases page once
                the cart page says it's empty, Nov 3). */}
            {s === "safeway" && lines.length > 0 && <button onClick={() => setOrdering(true)} className="w-full py-2 t-sub font-semibold text-muted">Ordered? Take the cart off the list</button>}
            </div>
          ))}
        </>
      )}
      {/* Last, so it never pushes the list down when it shows. */}
      {sw.outdated && <UpdateNote />}

      {finding && findOf(finding) && (
        <Sheet label="Safeway's choices" wide onClose={() => setFinding(null)}>
          <FindSheet sw={sw} items={toFind} id={finding} onId={setFinding} onGot={(id) => { const x = items.find((i) => i.id === id); if (x) act.check(x, true); }} />
        </Sheet>
      )}
      <ConfirmSheet open={Boolean(finishing)} title={where === "all" ? "Done shopping?" : `Done at ${STORE_NAMES[where]}?`} confirm="Done shopping"
        message={finishing ? `${finishing.length} thing${finishing.length === 1 ? " comes" : "s come"} off the list.` : ""}
        onConfirm={() => { const off = finishing ?? []; setFinishing(null); void act.doneTicked(off); }} onCancel={() => setFinishing(null)} />
      <ConfirmSheet open={ordering} title="Take the cart off the list?" message="Everything in the cart comes off the Safeway list, as bought." confirm="Take it off"
        onConfirm={() => {
          setOrdering(false);
          // Shown at once: the cart and what it was for come off, then Safeway's cart is read again.
          const ids = sw.cart.map((l) => l.itemId).filter(Boolean);
          sw.forget();
          act.done("safeway", ids).then(() => sw.refresh());
        }} onCancel={() => setOrdering(false)} />
      {/* Safeway's problems (a search or a cart change that didn't happen) show over the page, Find's sheet too. */}
      <Alert open={Boolean(sw.problem)} title="That didn't go through" message={sw.problem ?? ""} onClose={() => sw.setProblem(null)} />
    </div>
  );
}

/** Find, in a sheet over Shop: Safeway's choices for one thing at a time, with their pictures. */
function FindSheet({ sw, items, id, onId, onGot }: { sw: Safeway; items: FindItem[]; id: string; onId: (id: string | null) => void; onGot: (id: string) => void }) {
  return (
    <div className="pb-2">
      <FindView store="Safeway" items={items} index={items.findIndex((f) => f.id === id)} sw={sw}
        onIndex={(i) => onId(items[i]?.id ?? null)} onCart={() => onId(null)} onList={() => onId(null)} onGot={onGot} />
    </div>
  );
}
