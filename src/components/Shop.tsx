"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { store, type CartLine, type Item, type Store } from "@/lib/client";
import { useList } from "@/lib/app-data";
import { cartTotal, findItems, money, shownAmount, type FindItem } from "@/lib/shop";
import { CartPlus, FindView, Stepper, useSafewayCart, type Safeway } from "./Safeway";
import { Alert, BrandBar, ConfirmSheet, EmptyState, Group, Held, MoreMenu, Segmented, Sheet, AddField, sameProps, type MoreOption } from "./ui";
import { Icon } from "./icons";
// Check out isn't loaded on demand (Nov 19): a tap before it arrived opened the sheet late, and it saved only ~3 KB.
import { CheckoutSheet } from "./Checkout";

// Check out (with ordering and Face ID) loads on its own; App fetches it once the app is showing, so it opens at once.


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
};

/** ⋯ as the phone's own menu: what can be done with one row. Its space stays when there's nothing, so rows line up. */
function More({ name, options, onPick }: { name: string; options: MoreOption[]; onPick: (v: string) => void }) {
  if (!options.some((o) => !o.off)) return <span aria-hidden className="size-9 shrink-0" />;
  return <MoreMenu label={`More for ${name}`} title={name} options={options} onPick={onPick} />;
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
      <span className={`block break-words t-body ${checked ? "text-muted line-through" : ""}`}>{title}</span>
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

/** What a list item's row offers beside its name: − n + (in the cart, or on its way there), Add, Find, or nothing. */
type Control = "cart" | "wait" | "plus" | "find" | "";
/** A tap on a row, handed to Shop: tick, a number for − n +, Add, Find (or Pick another), or Get it at another store. */
type RowTap = { what: "tick" | "plus" | "find" } | { what: "cart" | "wait"; qty: number } | { what: "move"; store: Store };

/**
 * A list item's row, drawn again only when what it shows changes (a tick redraws its own row, not the list). Everything
 * it gets is plain data and one tap handler that stays the same.
 */
const ShopItemRow = memo(function ShopItemRow({ it, sub, control, qty, inCart, canPick, onTap }: {
  it: Item; sub?: string; control: Control; qty: number; inCart: number; canPick: boolean; onTap: (it: Item, tap: RowTap) => void;
}) {
  const name = cap(it.item);
  const c = control === "cart" || control === "wait" ? <Stepper compact qty={qty} name={name} onChange={(q) => onTap(it, { what: control, qty: q })} />
    : control === "plus" ? <CartPlus name={name} onClick={() => onTap(it, { what: "plus" })} />
    : control === "find" ? <button onClick={() => onTap(it, { what: "find" })} aria-label={`Find ${name} at Safeway`} className={`${pill} glass text-accent`}>Find</button>
    : null;
  return (
    <ShopRow title={name} sub={sub} checked={it.checked} onTick={() => onTap(it, { what: "tick" })} control={c}
      more={<More name={name} options={moreFor(it, inCart, canPick)} onPick={(v) => onTap(it, v === "pick" ? { what: "find" } : { what: "move", store: v as Store })} />} />
  );
}, sameProps);

/** The list comes from its store; the Safeway cart and its jobs from SafewayHost (kept across tab taps). */
export function ShopScreen({ act }: { act: ShopActions }) {
  const list = useList();
  const sw = useSafewayCart();
  // The Safeway cart is read as Shop opens (each tab tap opens it fresh) and when the app comes back to it.
  const { look } = sw;
  useEffect(() => {
    queueMicrotask(look);
    const back = () => { if (document.visibilityState === "visible") look(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [look]);
  const [text, setText] = useState("");
  const [finding, setFinding] = useState<string | null>(null); // the Safeway item whose choices are open, by id
  // Show got (Nov 14): on, ticked things stay, struck through; off, they're hidden. Only the toggle decides; remembered
  // on this phone.
  const [showGot, setShowGotState] = useState(() => store.showGot());
  const setShowGot = (on: boolean) => { setShowGotState(on); store.setShowGot(on); };
  const tickIt = (it: Item, on: boolean) => act.check(it, on);
  const [ordering, setOrdering] = useState(false); // "Ordered?" waiting on its confirm
  const [checkingOut, setCheckingOut] = useState(false); // the Check out sheet (Nov 13)
  const [where, setWhere] = useState<Where>("all");
  const { items, toFind, findable, infos } = useMemo(() => {
    const all = list?.items ?? [], staples = list?.staples ?? [];
    const items = all.filter((i) => !(i.check && !i.checked)); // what Stock highlights isn't on the list yet
    // What Find goes through: the Safeway things not got yet.
    const toFind = findItems(all, staples, sw.picks);
    // Every Safeway row's product (ticked ones too, so a ticked row still says what was bought).
    const infos = new Map(findItems(items.filter((i) => i.store === "safeway").map((i) => ({ ...i, checked: false })), staples, sw.picks).map((f) => [f.id, f]));
    return { items, toFind, findable: new Set(toFind.map((f) => f.id)), infos };
  }, [list, sw.picks]);
  // Safeway signed out on the computer (Nov 16, Sam): what Simmer has as the cart may not be right, so it isn't shown
  // and the Safeway rows are a plain checklist until a cart read sees Safeway signed in again.
  const signedOut = sw.loaded && sw.signedOut;
  const live = sw.loaded && !sw.away && !signedOut; // Safeway can be reached: its rows get their controls

  // The cart, with a change on its way counted (taken out: gone at once).
  const { cart, pending } = sw;
  const { lines, total, estimate, count, lineOf, inCartOf, loose } = useMemo(() => {
    const lines = signedOut ? [] : cart.map((l) => ({ ...l, qty: pending[l.productId] ?? l.qty })).filter((l) => l.qty > 0);
    // Each list item's cart line (its first, when there are more) and how many in all; every other line ends the
    // Safeway group.
    const byItem = new Map<string, CartLine>(), inCartOf = new Map<string, number>();
    for (const l of lines) if (l.itemId) { if (!byItem.has(l.itemId)) byItem.set(l.itemId, l); inCartOf.set(l.itemId, (inCartOf.get(l.itemId) ?? 0) + l.qty); }
    const lineOf = new Map<string, CartLine>();
    for (const it of items) { const l = it.store === "safeway" && byItem.get(it.id); if (l) lineOf.set(it.id, l); }
    const tied = new Set([...lineOf.values()].map((l) => l.productId));
    return { lines, ...cartTotal(lines), count: lines.reduce((n, l) => n + l.qty, 0), lineOf, inCartOf, loose: lines.filter((l) => !tied.has(l.productId)) };
  }, [cart, pending, signedOut, items]);
  const inCart = (it: Item) => (it.store === "safeway" ? inCartOf.get(it.id) ?? 0 : 0);

  const product = (p: { id: string; name: string; image?: string }) => ({ id: p.id, name: p.name, price: "", image: p.image ?? "" });
  const want = (f: FindItem) => ({ p: product(f.picked!), qty: Math.max(1, f.want), query: f.query, forItem: f });
  const addUsual = (f: FindItem) => { if (f.picked) { const w = want(f); void sw.setQty(w.p, w.qty, w.query, w.forItem); } };
  // Usuals not in the cart yet, for Add usuals: every row shows its count at once; Safeway takes them one after another.
  const usual = toFind.filter((f) => f.picked && !lineOf.has(f.id) && !(pending[f.picked.id] > 0));

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

  /** A row's tap: worked out with what's showing now, through one handler that stays the same for the rows. */
  const tap = (it: Item, t: RowTap) => {
    if (t.what === "tick") return tickIt(it, !it.checked);
    if (t.what === "find") return setFinding(it.id);
    if (t.what === "move") return act.move(it, t.store);
    const f = infos.get(it.id), l = lineOf.get(it.id);
    if (t.what === "cart" && l) void sw.setQty({ id: l.productId, name: l.name, price: l.price, image: l.image }, t.qty, l.item || l.name, null, { alt: l.name, on: "cart" });
    else if (t.what === "wait" && f?.picked) void sw.setQty(product(f.picked), t.qty, f.query, f);
    else if (t.what === "plus" && f) addUsual(f);
  };
  const latestTap = useRef(tap);
  useLayoutEffect(() => { latestTap.current = tap; });
  const onTap = useCallback((it: Item, t: RowTap) => latestTap.current(it, t), []);

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
    let control: Control = "", qty = 0;
    if (it.store === "safeway" && live) {
      if (l) { control = "cart"; qty = l.qty; }
      else if (f?.picked && waiting > 0) { control = "wait"; qty = waiting; }
      else if (!it.checked && f?.picked) control = "plus";
      else if (!it.checked && findable.has(it.id)) control = "find";
    }
    const canPick = it.store === "safeway" && live && findable.has(it.id) && Boolean(f?.picked || l);
    return <ShopItemRow key={it.id} it={it} sub={sub} control={control} qty={qty} inCart={n} canPick={canPick} onTap={onTap} />;
  };

  const shown = (where === "all" ? STORES : [where]).filter((s) => visible.some((i) => i.store === s) || (s === "safeway" && loose.length > 0));

  return (
    <div className="space-y-5">
      {/* Add pinned with the store switch (Sam, Nov 19): reachable from anywhere in a long list; above the switch, in
          the same place as on List. */}
      <BrandBar below={(
        <div className="space-y-3">
          <form onSubmit={submit} className="flex gap-2">
            <AddField value={text} onChange={setText} placeholder="Add item" label="Add item" />
          </form>
          <Segmented label="Store" value={where} options={WHERE} onChange={setWhere} />
        </div>
      )} />
      <h1 className="sr-only">Shop</h1>

      {!list ? <Held /> : !here.length && !shown.length ? <EmptyState icon="cart" title={where === "all" ? "Nothing to buy" : `Nothing to buy at ${STORE_NAMES[where]}`} /> : (
        <>
          <TopLine menu={(
          <MoreMenu label="More for Shop" title="Shop" onPick={(v) => { if (v === "checked") setShowGot(!showGot); else if (v === "bought") setOrdering(true); }}>
            <option value="checked">{showGot ? "✓ Show checked" : "Show checked"}</option>
            {/* For when Simmer can't tell by itself that the order went through (Sam, Nov 17: into this ⋯, from a link under Safeway). */}
            {lines.length > 0 && <option value="bought">Mark the Safeway cart bought</option>}
          </MoreMenu>
          )}
            cart={where !== "all" && where !== "safeway" ? null
              : signedOut ? { price: "", onCheckOut: () => {}, off: true }
              : live && count > 0 ? { price: `${estimate ? "about " : ""}${money(total)}`, onCheckOut: () => setCheckingOut(true), busy: sw.reading || Object.keys(pending).length > 0 } : null} />
          {!shown.length && <EmptyState icon="cart" title="Everything's got" />}
          {shown.map((s) => (
            <div key={s} className="space-y-2">
            <Group header={STORE_NAMES[s]} aside={s === "safeway" && live && usual.length > 1 && (
              <button onClick={() => void sw.fill(usual.map(want))} className="shrink-0 t-foot font-semibold text-accent">Add usuals ({usual.length})</button>
            )}>
              {visible.filter((i) => i.store === s).map(itemRow)}
              {/* Put in the cart on Safeway's own site: in the cart, but not for anything on the list. */}
              {s === "safeway" && loose.map((l) => (
                <ShopRow key={l.productId} title={l.name} sub={l.price || undefined} more={<More name={l.name} options={[]} onPick={() => {}} />}
                  control={live && <Stepper compact qty={l.qty} name={l.name} onChange={(q) => sw.setQty({ id: l.productId, name: l.name, price: l.price, image: l.image }, q, l.item || l.name, null, { alt: l.name, on: "cart" })} />} />
              ))}
            </Group>
            </div>
          ))}
        </>
      )}
      {finding && findable.has(finding) && (
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
