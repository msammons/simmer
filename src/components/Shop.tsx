"use client";
import { useEffect, useState } from "react";
import { store, type CartLine, type Item, type ListState, type Store } from "@/lib/client";
import { cartFor, cartTotal, findItems, money, shownAmount, type FindItem } from "@/lib/shop";
import { CheckoutSheet } from "./Checkout";
import { CartPlus, FindView, Stepper, useSafeway, type Safeway } from "./Safeway";
import { Alert, BrandBar, ConfirmSheet, EmptyState, Group, Held, Segmented, Sheet, AddButton } from "./ui";
import { Icon } from "./icons";

/**
 * Shop (Sam, Nov 12): one page, grouped by store (Safeway, Trader Joe's, Costco; a store with nothing doesn't show).
 * Every row is the same: a tick (got it, in the store or delivered), the household's name for the thing, and one small
 * line under it (Safeway's product and how much is needed, or just the amount). While Safeway can be reached, a Safeway
 * row also has Add (its usual product into the cart), Find (Safeway's choices, in a sheet) or − n + once it's in the
 * cart; the Safeway header has what's in the cart and Add usuals, and cart things added on Safeway's own site end the
 * group. When Safeway can't be reached (a job the helper didn't pick up), its rows are a plain checklist. One Done
 * shopping (confirmed first) takes what's ticked off in every store. No Clear here (Nov 11): New plan on Meals is the
 * one fresh start, and it empties the list.
 */
export const STORE_NAMES: Record<Store, string> = { safeway: "Safeway", "trader-joes": "Trader Joe's", costco: "Costco" };
const STORES = Object.keys(STORE_NAMES) as Store[];
/** The filter at the top (Sam, Nov 12): every store, or one store's rows only, the same rows either way. */
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
};

/** ⋯ as the phone's own menu: what can be done with one row. Its space stays when there's nothing, so rows line up. */
function More({ name, options, onPick }: { name: string; options: { value: string; label: string; off?: boolean }[]; onPick: (v: string) => void }) {
  if (!options.some((o) => !o.off)) return <span aria-hidden className="size-9 shrink-0" />;
  return (
    <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-muted">
      <span aria-hidden>⋯</span>
      <select value="" aria-label={`More for ${name}`} onChange={(e) => { if (e.target.value) onPick(e.target.value); }} className="absolute -inset-1 cursor-pointer opacity-0 text-base">
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

/**
 * One line above the list, with something in the Safeway cart: its price and a Check out button with a cart. (Show
 * checked moved to the ⋯ by Add, Nov 17: on, what's ticked stays, struck through; off, it's hidden.) With Safeway signed out on the computer (Nov 16) the cart is greyed: no
 * price, and the button says Signed out and can't be pressed. While the cart is changing or being read (Nov 16, Sam:
 * no checking out while things are in progress), Check out is greyed too.
 */
function TopLine({ cart, menu }: { cart: { price: string; onCheckOut: () => void; off?: boolean; busy?: boolean } | null; menu: React.ReactNode }) {
  return (
    // Above the list (Sam, Nov 17): Check out and the cart's price on the left, away from Shop's own ⋯ on the right.
    <div className="flex min-h-10 items-center gap-2.5 pl-1 pr-2">
      {cart && (
        <span className="flex min-w-0 flex-row-reverse items-center justify-end gap-2.5">
          {cart.price && <span className="truncate t-sub text-muted">{cart.price}</span>}
          <button onClick={cart.onCheckOut} disabled={cart.off || cart.busy} className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 t-sub font-semibold ${cart.off || cart.busy ? "bg-sunk text-muted" : "bg-accent text-on-accent active:scale-95"}`}>
            <Icon name="cart" className="size-[18px]" strokeWidth={2} />{cart.off ? "Signed out" : "Check out"}
          </button>
        </span>
      )}
      <span className="ml-auto">{menu}</span>
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
  // Show got (Nov 14): on, ticked things stay, struck through; off, they're hidden. Only the toggle decides; remembered
  // on this phone.
  const [showGot, setShowGotState] = useState(() => store.showGot());
  const setShowGot = (on: boolean) => { setShowGotState(on); store.setShowGot(on); };
  const tickIt = (it: Item, on: boolean) => act.check(it, on);
  const [ordering, setOrdering] = useState(false); // "Ordered?" waiting on its confirm
  const [checkingOut, setCheckingOut] = useState(false); // the Check out sheet (Nov 13)
  const [reading, setReading] = useState(true); // Safeway's cart being read as Shop opens
  const [where, setWhere] = useState<Where>("all");
  const items = (list?.items ?? []).filter((i) => !(i.check && !i.checked)); // what Stock highlights isn't on the list yet
  // What Find goes through: the Safeway things not got yet.
  const toFind = findItems(list?.items ?? [], list?.staples ?? [], sw.picks);
  const findOf = (id: string) => toFind.find((f) => f.id === id);
  // Every Safeway row's product (ticked ones too, so a ticked row still says what was bought).
  const infos = new Map(findItems(items.filter((i) => i.store === "safeway").map((i) => ({ ...i, checked: false })), list?.staples ?? [], sw.picks).map((f) => [f.id, f]));
  // Safeway signed out on the computer (Nov 16, Sam): what Simmer has as the cart may not be right, so it isn't shown
  // and the Safeway rows are a plain checklist until a cart read sees Safeway signed in again.
  const signedOut = sw.loaded && sw.signedOut;
  const live = sw.loaded && !sw.away && !signedOut; // Safeway can be reached: its rows get their controls

  // Opening Shop reads Safeway's own cart, and Simmer's copy takes what's there (Nov 14: only the helper's panel did,
  // so on the phone the copy went stale: 6 in the cart here, 4 on Safeway).
  const { run, refresh } = sw;
  useEffect(() => {
    const c = new AbortController();
    run("cart", {}, c.signal).then((r) => { if (r.ok) refresh(); }).finally(() => { if (!c.signal.aborted) setReading(false); });
    return () => c.abort();
  }, [run, refresh]);
  // Signed out: coming back to Simmer (after signing in on the computer) reads Safeway's cart again.
  useEffect(() => {
    if (!signedOut) return;
    const back = () => { if (document.visibilityState === "visible") run("cart", {}).then((r) => { if (r.ok) refresh(); }); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [signedOut, run, refresh]);

  // The cart, with a change on its way counted (taken out: gone at once).
  const lines = signedOut ? [] : sw.cart.map((l) => ({ ...l, qty: sw.qtyOf(l.productId, l.qty) })).filter((l) => l.qty > 0);
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

  // What the filter shows.
  const here = where === "all" ? items : items.filter((i) => i.store === where);
  /** The rows shown: what's ticked only with Show got on. */
  const visible = showGot ? items : items.filter((i) => !i.checked);

  /** A list item's row. */
  const itemRow = (it: Item) => {
    const n = inCart(it);
    const f = infos.get(it.id);
    const l = lineOf.get(it.id);
    const waiting = f?.picked ? sw.pending[f.picked.id] ?? 0 : 0; // just added, on its way to Safeway
    const amount = shownAmount(it.quantity);
    const need = amount;
    // Safeway's product and how many under the name (back Nov 17: Sam wanted the product kept, only the extra words gone).
    const name = l?.name ?? f?.picked?.name;
    const sub = it.store === "safeway" && name ? [name, need && `Need ${need}`].filter(Boolean).join(" · ") : need ? (it.store === "safeway" ? `Need ${need}` : need) : undefined;
    let control: React.ReactNode = null;
    if (it.store === "safeway" && live) {
      if (l) control = <Stepper compact qty={l.qty} name={cap(it.item)} onChange={(q) => sw.setQty({ id: l.productId, name: l.name, price: l.price, image: l.image }, q, l.item || l.name, null, { alt: l.name, on: "cart" })} />;
      else if (f?.picked && waiting > 0) control = <Stepper compact qty={waiting} name={cap(it.item)} onChange={(q) => sw.setQty(product(f.picked!), q, f.query, f)} />;
      else if (!it.checked && f?.picked) control = <CartPlus name={cap(it.item)} onClick={() => addUsual(f)} />;
      else if (!it.checked && findOf(it.id)) control = <button onClick={() => setFinding(it.id)} aria-label={`Find ${cap(it.item)} at Safeway`} className={`${pill} glass text-accent`}>Find</button>;
    }
    const canPick = it.store === "safeway" && live && Boolean(findOf(it.id)) && Boolean(f?.picked || l);
    return (
      <ShopRow key={it.id} title={cap(it.item)} sub={sub} checked={it.checked} onTick={() => tickIt(it, !it.checked)} control={control}
        more={<More name={cap(it.item)} options={moreFor(it, n, canPick)} onPick={(v) => (v === "pick" ? setFinding(it.id) : act.move(it, v as Store))} />} />
    );
  };

  const shown = (where === "all" ? STORES : [where]).filter((s) => visible.some((i) => i.store === s) || (s === "safeway" && loose.length > 0));

  return (
    <div className="space-y-5">
      <BrandBar below={<Segmented label="Store" value={where} options={WHERE} onChange={setWhere} />} />
      <h1 className="sr-only">Shop</h1>
      <form onSubmit={submit} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something" aria-label="Add something" enterKeyHint="done"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <AddButton disabled={!text.trim()} />
      </form>

      {!list ? <Held /> : !here.length && !shown.length ? <EmptyState icon="cart" title={where === "all" ? "Nothing to buy" : `Nothing to buy at ${STORE_NAMES[where]}`} /> : (
        <>
          <TopLine menu={(
          <label className="relative flex size-9 shrink-0 items-center justify-center text-[22px] leading-none text-muted">
            <span aria-hidden>⋯</span>
            <select value="" aria-label="More for Shop" className="absolute -inset-1 cursor-pointer opacity-0 text-base"
              onChange={(e) => { const v = e.target.value; if (v === "checked") setShowGot(!showGot); else if (v === "bought") setOrdering(true); }}>
              <option value="" disabled>Shop</option>
              <option value="checked">{showGot ? "✓ Show checked" : "Show checked"}</option>
              {/* For when Simmer can't tell by itself that the order went through (Sam, Nov 17: into this ⋯, from a link under Safeway). */}
              {lines.length > 0 && <option value="bought">Mark the Safeway cart bought</option>}
            </select>
          </label>
          )}
            cart={where !== "all" && where !== "safeway" ? null
              : signedOut ? { price: "", onCheckOut: () => {}, off: true }
              : live && count > 0 ? { price: `${estimate ? "about " : ""}${money(total)}`, onCheckOut: () => setCheckingOut(true), busy: reading || Object.keys(sw.pending).length > 0 } : null} />
          {!shown.length && <EmptyState icon="cart" title="Everything's got" />}
          {shown.map((s) => (
            <div key={s} className="space-y-2">
            <Group header={STORE_NAMES[s]} aside={s === "safeway" && live && usual.length > 1 && (
              <button onClick={autoFill} className="shrink-0 t-foot font-semibold text-accent">Add usuals ({usual.length})</button>
            )}>
              {visible.filter((i) => i.store === s).map(itemRow)}
              {/* Put in the cart on Safeway's own site: in the cart, but not for anything on the list. */}
              {s === "safeway" && loose.map((l) => (
                <ShopRow key={l.productId} title={l.name} sub={l.price || undefined} more={<More name={l.name} options={[]} onPick={() => {}} />}
                  control={live && <Stepper compact qty={l.qty} name={l.name} onChange={(q) => sw.setQty({ id: l.productId, name: l.name, price: l.price, image: l.image }, q, l.item || l.name, null, { alt: l.name, on: "cart" })} />} />
              ))}
            </Group>
            {/* For when Simmer can't tell by itself that the order went through (it reads Safeway's Purchases page once
                the cart page says it's empty, Nov 3). */}
            </div>
          ))}
        </>
      )}
      {/* Last, so it never pushes the list down when it shows. */}

      {finding && findOf(finding) && (
        <Sheet label="Safeway's choices" wide onClose={() => setFinding(null)}>
          <FindSheet sw={sw} items={toFind} id={finding} onId={setFinding} onGot={(id) => { const x = items.find((i) => i.id === id); if (x) tickIt(x, true); }} />
        </Sheet>
      )}
      {checkingOut && <CheckoutSheet count={count} total={total} estimate={estimate} onClose={() => { setCheckingOut(false); void sw.refresh(); }} />}
      <ConfirmSheet open={ordering} title="Mark the cart bought?" message="Everything in the cart comes off Shop, as bought." confirm="Mark it bought"
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
