"use client";
// Shop's Safeway side: searching Safeway for a list item (Find) and putting products in the Safeway cart.
// Searches and cart changes are jobs done by the Safeway helper in Chrome on a computer (lib/jobs.ts); the panel at
// the computer shows this same screen, so it works the same everywhere. Product pictures are Safeway's own, shown from
// Safeway's addresses (nothing's stored).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, AuthError, errorText, type CartLine, type Job, type JobKind, type Pick } from "@/lib/client";
import { PAGE } from "@/lib/safeway-helper.mjs";
import { addedFor, buyAmount, nextAfter, qtyFor, rankResults, type FindItem, type Product } from "@/lib/shop";
import { Icon } from "./icons";
import { Button, EmptyState, Group } from "./ui";
import manifest from "../../extension-working/manifest.json";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Simmer on the computer is older than this one: where to get the new one. A quiet group at the end of Shop,
 * so it never pushes the list down when it shows (Nov 11: no bars).
 */
export function UpdateNote() {
  return (
    <Group footer="Open it, put what's inside in place of the old Simmer folder, then press reload on Simmer in Chrome's extensions page.">
      <a href={`/simmer-helper-v${manifest.version}.zip`} download className="flex items-center gap-3 px-4 py-3 active:bg-sunk">
        <span className="min-w-0 flex-1 t-body">Simmer in Chrome needs an update</span>
        <span className="shrink-0 t-sub text-accent">Get the new one</span>
      </a>
    </Group>
  );
}

export const NOT_ANSWERING = "Can't reach Safeway right now. Check things off in the store instead.";
/** Plain words for why a job didn't happen. */
function problemText(error: string): string {
  if (error === "not-answering" || error === "stuck") return NOT_ANSWERING;
  if (error === "signed-out") return "Safeway isn't signed in. Sign in to Safeway, then try again.";
  if (error === "not-found") return "Couldn't find that product on Safeway just now. Try again.";
  if (error === "not-loaded") return "Safeway didn't load. Try again in a minute.";
  return "That didn't go through on Safeway. Try again.";
}

type JobOutcome = { ok: true; result: Record<string, unknown> } | { ok: false; problem: string };

/**
 * The Safeway cart as Simmer knows it, whether the computer's answering, and doing jobs there. Quantities being changed
 * show straight away (`pending`) and settle when Safeway has them.
 */
export function useSafeway() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [answering, setAnswering] = useState<boolean | null>(null);
  // A job the helper didn't pick up: Shop drops its Safeway controls and the Safeway rows are a plain checklist (Nov 3).
  const [away, setAway] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.cart();
      if (!alive.current) return;
      setCart(r.cart); setPicks(r.picks); setAnswering(r.answering); setAway(r.away === true); setOutdated(r.outdated === true); setLoaded(true);
    } catch (e) { if (!(e instanceof AuthError) && alive.current) setLoaded(true); }
  }, []);
  useEffect(() => {
    queueMicrotask(refresh);
    const visible = () => document.visibilityState === "visible";
    // No timer (Nov 11): the cart loads on open, when the app comes back, and after each job.
    const back = () => { if (visible()) refresh(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [refresh]);

  /**
   * Queues a job and follows it. Each answer about it comes once the job's finished, or after about 20 seconds while it's
   * still going (the server waits, Nov 11: no timer in the app); a job nobody takes is given up by Simmer after 20 seconds.
   */
  const run = useCallback(async (kind: JobKind, args: Record<string, unknown>, signal?: AbortSignal): Promise<JobOutcome> => {
    let job: Job;
    try {
      const q = await api.queueJob(kind, args);
      setAnswering(q.answering);
      job = q.job;
    } catch (e) { return { ok: false, problem: errorText(e) }; }
    for (const end = Date.now() + 150_000; Date.now() < end;) {
      if (signal?.aborted) { api.cancelJob(job.id).catch(() => {}); return { ok: false, problem: "" }; }
      try {
        const s = await api.job(job.id, signal);
        if (!s.job) return { ok: false, problem: problemText("") };
        if (s.job.status === "done") { setAnswering(true); setAway(false); return { ok: true, result: s.job.result ?? {} }; }
        if (s.job.status === "failed") {
          const error = String(s.job.result?.error ?? "");
          // The helper didn't pick it up: Safeway works as a checklist for the rest of this visit (no timer watches it).
          if (error === "not-answering" || error === "stuck") { setAnswering(false); setAway(true); }
          return { ok: false, problem: error === "cancelled" ? "" : problemText(error) };
        }
      } catch (e) {
        if (signal?.aborted) { api.cancelJob(job.id).catch(() => {}); return { ok: false, problem: "" }; }
        if (e instanceof AuthError) return { ok: false, problem: "" };
        return { ok: false, problem: errorText(e) };
      }
    }
    return { ok: false, problem: NOT_ANSWERING };
  }, []);

  /**
   * Sets how many of a product are in the Safeway cart (0 takes it out), for a list item when it's from Find. `query`:
   * the search that brings the product up; `alt`, other words to try; `on: "cart"`, change it on Safeway's cart page
   * first, where it's listed (from Cart). The number shows at once (`pending`); taps while a change is on its way to
   * Safeway aren't sent one by one: when it's done, the latest number goes as one change (Nov 11: always responsive,
   * so the buttons never wait, and two changes for one product still never cross). One that fails puts the cart back
   * and says why.
   */
  const latest = useRef<Record<string, number>>({});
  const sending = useRef<Record<string, boolean>>({});
  const setQty = useCallback(async (p: Product, qty: number, query: string, forItem?: { id: string; item: string } | null, how?: { alt?: string; on?: "cart" }) => {
    setProblem(null);
    setPending((x) => ({ ...x, [p.id]: qty }));
    latest.current[p.id] = qty;
    if (sending.current[p.id]) return;
    sending.current[p.id] = true;
    let sent = qty;
    let r: JobOutcome;
    for (;;) {
      r = await run("setQty", { productId: p.id, qty: sent, query, name: p.name, price: p.price, image: p.image, ...(forItem && { itemId: forItem.id, item: forItem.item }), ...how });
      if (!r.ok || !alive.current || latest.current[p.id] === sent) break;
      sent = latest.current[p.id];
    }
    sending.current[p.id] = false;
    delete latest.current[p.id];
    if (!alive.current) return;
    setPending((x) => { const { [p.id]: _gone, ...rest } = x; void _gone; return rest; });
    if (r.ok) {
      const now = Number(r.result.qty ?? sent);
      setCart((c) => {
        const at = c.find((l) => l.productId === p.id);
        if (!now) return c.filter((l) => l.productId !== p.id);
        if (at) return c.map((l) => (l.productId === p.id ? { ...l, qty: now } : l));
        return [...c, { cart: "safeway", productId: p.id, name: p.name, price: p.price, image: p.image, qty: now, itemId: forItem?.id ?? "", item: forItem?.item ?? "", updated: "" }];
      });
      if (r.result.reached === false) setProblem("Safeway didn't take all of that. The cart shows what's there now.");
      refresh();
    } else if (r.problem) setProblem(r.problem);
  }, [run, refresh]);
  /** The order went through: the cart shows empty at once (the server's answer follows with `refresh`). */
  const forget = useCallback(() => setCart([]), []);
  /** A number shown at once for a product whose change is about to be sent (Auto-fill shows every row's together). */
  const show = useCallback((id: string, qty: number) => setPending((x) => ({ ...x, [id]: qty })), []);

  /** How many of a product are in the cart, counting a change on its way. */
  const qtyOf = (productId: string, fallback = 0) => pending[productId] ?? cart.find((l) => l.productId === productId)?.qty ?? fallback;

  return { cart, picks, answering, away, outdated, loaded, pending, problem, setProblem, refresh, run, setQty, qtyOf, forget, show };
}
export type Safeway = ReturnType<typeof useSafeway>;

/** A product's picture from Safeway, or a quiet placeholder. */
const searchLink = (q: string) => `${PAGE.site}${PAGE.searchPath}${encodeURIComponent(q)}`;
const productLink = (id: string) => `${PAGE.site}${PAGE.productPath.replace("{id}", id)}`;

/** `tile`: a big picture across the top of a product tile once the screen is wide (Find's grid). */
export function ProductImage({ src, small, tile }: { src?: string; small?: boolean; tile?: boolean }) {
  const [broken, setBroken] = useState("");
  const size = `${small ? "size-10 rounded-lg" : "size-14 rounded-xl"}${tile ? " min-[640px]:h-32 min-[640px]:w-full" : ""}`;
  return src && broken !== src
    // eslint-disable-next-line @next/next/no-img-element -- Safeway's own picture, shown from Safeway
    ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(src)} className={`${size} shrink-0 bg-white object-contain p-1`} />
    : <span className={`flex ${size} shrink-0 items-center justify-center bg-sunk text-muted`}><Icon name="bag" className={small ? "size-5" : "size-6"} /></span>;
}

/**
 * − / count / +; − at one takes it out of the cart (a minus, never a trash: Matt, Nov 12). The count changes at once and the buttons never wait (Nov 11: always
 * responsive); quick taps go to Safeway as one change (useSafeway's setQty). `off`: Safeway can't be reached just now,
 * so neither can be pressed (Nov 3).
 */
export function Stepper({ qty, name, off, compact, onChange }: { qty: number; name: string; off?: boolean; compact?: boolean; onChange: (n: number) => void }) {
  // `compact`: on a Shop row, beside the name, so the name keeps room.
  const btn = `glass flex ${compact ? "size-8" : "size-9"} items-center justify-center rounded-full text-accent transition active:scale-90 disabled:opacity-40 disabled:active:scale-100`;
  return (
    <div className={`flex shrink-0 items-center ${compact ? "gap-1" : "gap-1.5"}`}>
      <button className={btn} disabled={off} aria-label={qty <= 1 ? `Take ${name} out of the cart` : `One less ${name}`} onClick={() => onChange(qty - 1)}>
        <Icon name="minus" className="size-[18px]" strokeWidth={2.2} />
      </button>
      <span className={`flex ${compact ? "w-5" : "w-6"} justify-center t-headline tabular-nums`} aria-label={`${qty} in the cart`}>{qty}</span>
      <button className={btn} aria-label={`One more ${name}`} disabled={off || qty >= 24} onClick={() => onChange(qty + 1)}>
        <Icon name="plus" className="size-[18px]" strokeWidth={2.2} />
      </button>
    </div>
  );
}

function ProductRow({ p, sub, control }: { p: { name: string; image?: string }; sub: React.ReactNode; control: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <ProductImage src={p.image} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 t-body">{p.name}</p>
        <p className="mt-0.5 t-foot text-muted">{sub}</p>
      </div>
      {control}
    </div>
  );
}

/**
 * Find's results: a list on a phone; once the screen is wide (the helper's panel dragged wide), tiles filling the width,
 * as many to a row as fit, in reading order. The grid reaches past the app's phone-width column, keeping a gutter.
 */
const GRID = "divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card min-[640px]:grid min-[640px]:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] min-[640px]:gap-3 min-[640px]:divide-y-0 min-[640px]:overflow-visible min-[640px]:rounded-none min-[640px]:bg-transparent";
const TILE = "flex items-center gap-3 px-4 py-3 min-[640px]:flex-col min-[640px]:items-stretch min-[640px]:gap-2 min-[640px]:rounded-[1.375rem] min-[640px]:bg-card min-[640px]:p-3";

function FindProduct({ p, sub, control }: { p: { name: string; image?: string }; sub: React.ReactNode; control: React.ReactNode }) {
  return (
    <div className={TILE}>
      <ProductImage src={p.image} tile />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 t-body min-[640px]:line-clamp-3">{p.name}</p>
        <p className="mt-0.5 t-foot text-muted">{sub}</p>
      </div>
      <div className="shrink-0 min-[640px]:flex min-[640px]:justify-center">{control}</div>
    </div>
  );
}

type Search = { query: string; state: "loading" | "done" | "failed"; products: Product[]; signedIn: boolean };

/**
 * One list item at a time: search Safeway (Simmer's own search first: the remembered product, else the usual one, else
 * the item), the usual first, Add puts one in the cart, − / + after that. Skip or Next (at the top, where it doesn't
 * move anything when it changes) goes on; Find never moves on by itself.
 */
export function FindView({ store, items, index, onIndex, sw, onCart, onList, onGot }: {
  /** The online store being shopped, by name. */
  store: string;
  items: FindItem[]; index: number; onIndex: (i: number) => void; sw: Safeway; onCart: () => void; onList: () => void;
  /** Got it some other way (added on Safeway by hand): ticked off the list. */
  onGot: (id: string) => void;
}) {
  const it = items[index] ?? null;
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [searches, setSearches] = useState<Record<string, Search>>({});
  const ctl = useRef<AbortController | null>(null);
  const query = it ? typed[it.id] ?? it.query : "";
  const search = useCallback(async (q: string, again = false) => {
    if (!q) return;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setSearches((s) => (s[q]?.state === "done" && !again ? s : { ...s, [q]: { query: q, state: "loading", products: [], signedIn: true } }));
    let r = await sw.run("search", { query: q }, c.signal);
    // Safeway can say "no results" for a moment while its page is still building (Oct 31: "canned pumpkin" came back
    // empty, then full the next time), so an empty answer is asked once more before it's shown.
    if (r.ok && r.result.noResults === true && !((r.result.products as Product[] | undefined) ?? []).length && !c.signal.aborted) r = await sw.run("search", { query: q }, c.signal);
    if (c.signal.aborted) return;
    const signedIn = !r.ok || r.result.signedIn !== false;
    setSearches((s) => ({ ...s, [q]: r.ok
      ? { query: q, state: "done", products: (r.result.products as Product[]) ?? [], signedIn }
      : { query: q, state: "failed", products: [], signedIn: true } }));
    // A problem shows over the page (Nov 11: no bars); the results place says what's left to do.
    if (!r.ok) sw.setProblem(r.problem || NOT_ANSWERING);
    else if (!signedIn) sw.setProblem(`${store} isn't signed in. Sign in to ${store} to add things.`);
  }, [sw, store]);
  // The item showing is searched for when it comes up (once; going back to it shows what was found). Its search words
  // are kept from then on, so a pick saved while it shows doesn't start another search.
  const itemId = it?.id ?? "";
  const want = it ? (typed[it.id] ?? it.query) : "";
  const known = Boolean(searches[want]);
  useEffect(() => {
    if (!want || known) return;
    queueMicrotask(() => { setTyped((t) => (itemId in t ? t : { ...t, [itemId]: want })); search(want); });
  }, [want, known, search, itemId]);
  useEffect(() => () => ctl.current?.abort(), []);
  // Each search's results, in the order first shown.
  const [shown, setShown] = useState<Record<string, string[]>>({});
  const shownKey = `${itemId}|${query}`;
  const firstOrder = (() => {
    const done = searches[query];
    return it && done?.state === "done" ? rankResults(done.products, { picked: it.picked, usual: it.usual, item: it.item }).map((r) => r.product.id).join(",") : "";
  })();
  useEffect(() => {
    if (firstOrder) queueMicrotask(() => setShown((m) => (m[shownKey] ? m : { ...m, [shownKey]: firstOrder.split(",") })));
  }, [shownKey, firstOrder]);

  if (!items.length) {
    return <EmptyState icon="bag" title="Nothing to find" action={<Button variant="secondary" onClick={onList}>Back to the list</Button>} />;
  }
  if (!it) {
    return <EmptyState icon="check" title="That's everything" action={<Button onClick={onCart}>See the cart</Button>} />;
  }
  const s = searches[query];
  // Kept in the order first shown: an Add makes that product the remembered pick, and re-ranking then moved another
  // product under the finger (Nov 3).
  const ranked = s?.state === "done" ? rankResults(s.products, { picked: it.picked, usual: it.usual, item: it.item }) : [];
  const order = shown[`${it.id}|${query}`];
  const at = (id: string) => { const i = order?.indexOf(id) ?? -1; return i < 0 ? Infinity : i; };
  const results = order ? [...ranked].sort((a, b) => at(a.product.id) - at(b.product.id)) : ranked;
  const inCartForIt = qtyFor(sw.cart, it.id);
  const last = index === items.length - 1;
  const move = (to: number) => { ctl.current?.abort(); onIndex(to); };
  // Where Next goes: the next item still to find (else the cart). Shown at the top in a row that's always there, so it
  // appearing after an Add doesn't push the results under the finger.
  const to = nextAfter(items, sw.cart, index);
  const next = () => (to < 0 ? onCart() : move(to));
  const top = "flex h-10 max-w-[65%] min-w-0 items-center gap-1 rounded-full px-4 t-sub font-semibold transition active:scale-95";
  return (
    <div className="space-y-5">
      <div>
        <div className="flex h-10 items-center justify-between gap-3">
          <p className="t-foot font-semibold text-muted">{index + 1} of {items.length}</p>
          {inCartForIt
            ? <button onClick={next} className={`${top} glass-tint text-on-accent`}><span className="truncate">{to < 0 ? "See the cart" : `Next: ${cap(items[to].item)}`}</span><Icon name="right" className="size-4 shrink-0" strokeWidth={2.4} /></button>
            : !last && s?.state !== "failed" && <button onClick={() => move(index + 1)} className={`${top} glass text-accent`}>Skip</button>}
        </div>
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">{cap(it.item)}</h2>
        <p className="t-sub text-muted">{[it.want > 1 ? `${it.want} wanted` : buyAmount(it.quantity) && `${buyAmount(it.quantity)} on the list`, inCartForIt ? `In the cart · ${inCartForIt}` : ""].filter(Boolean).join(" · ") || "One wanted"}</p>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const q = query.trim(); if (q) search(q, true); }}>
        <input value={query} onChange={(e) => setTyped((t) => ({ ...t, [it.id]: e.target.value }))} aria-label={`Search ${store}`} placeholder={`Search ${store}`} enterKeyHint="search"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" variant="secondary" disabled={!query.trim() || s?.state === "loading"} className="shrink-0 px-5">Search</Button>
      </form>
      {(!s || s.state === "loading") && (
        <section className="space-y-1.5">
          <div className={GRID}>
            {[0, 1, 2].map((k) => (
              <div key={k} className={TILE} aria-hidden>
                <span className="shimmer size-14 shrink-0 rounded-xl min-[640px]:h-32 min-[640px]:w-full" />
                <span className="flex-1 space-y-2"><span className="shimmer block h-3.5 w-3/4 rounded-full" /><span className="shimmer block h-3 w-1/4 rounded-full" /></span>
              </div>
            ))}
          </div>
          <p className="sr-only" role="status">Looking on {store}</p>
        </section>
      )}
      {s?.state === "failed" && (
        <>
          <EmptyState icon="search" title="Nothing came back" action={<Button variant="secondary" onClick={() => search(query, true)}>Try again</Button>} />
          {/* Without the computer: the usual product, and Safeway's own search, to add it there; then tick it off here. */}
          <Group header={`Add it on ${store} instead`} footer={`Opens ${store}. Once it's in the cart there, tap Got it.`}>
            {it.picked && (
              <ProductRow p={{ name: it.picked.name, image: it.picked.image }} sub={<span className="font-semibold text-accent">Your usual</span>}
                control={<a href={productLink(it.picked.id)} target="_blank" rel="noreferrer" className="glass flex h-10 shrink-0 items-center rounded-full px-4 t-sub font-semibold text-accent">Open</a>} />
            )}
            <a href={searchLink(query || it.item)} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3 active:bg-sunk">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-sunk text-accent"><Icon name="search" className="size-6" /></span>
              <span className="min-w-0 flex-1"><span className="block t-body">Search {store} for &ldquo;{query || it.item}&rdquo;</span></span>
              <Icon name="external" className="size-4 text-muted/70" strokeWidth={2.2} />
            </a>
          </Group>
        </>
      )}
      {s?.state === "done" && (results.length ? (
        <div className={GRID}>
          {results.map(({ product: p, usual }) => {
            const qty = sw.qtyOf(p.id, p.inCart ? p.qty ?? 1 : 0);
            // For the item showing, unless other words were typed and this is plainly something else.
            const forIt = addedFor(p, it, query);
            return (
              <FindProduct key={p.id} p={p} sub={<>{p.price}{usual && <span className="font-semibold text-accent">{p.price ? " · " : ""}Your usual</span>}</>}
                control={qty > 0
                  ? <Stepper qty={qty} name={p.name} onChange={(n) => sw.setQty(p, n, query, forIt)} />
                  : <Button size="md" variant={usual ? "primary" : "secondary"} className="shrink-0 min-[640px]:w-full" disabled={!s.signedIn} onClick={() => sw.setQty(p, 1, query, forIt)}>Add</Button>} />
            );
          })}
        </div>
      ) : <EmptyState icon="search" title="Nothing came up" />)}
      <div className="flex gap-3">
        {index > 0 && <button type="button" aria-label={`Back to ${cap(items[index - 1].item)}`} onClick={() => move(index - 1)} className="glass inline-flex h-[52px] flex-1 items-center justify-center rounded-full px-6 t-headline text-accent transition active:scale-[0.97]">Back</button>}
        {inCartForIt
          ? <Button className="flex-1" onClick={next}>{to < 0 ? "See the cart" : "Next item"}</Button>
          : s?.state === "failed"
            ? <Button className="flex-1" onClick={() => { onGot(it.id); if (!last) move(index + 1); }}>Got it</Button>
            : <Button variant="secondary" className="flex-1" onClick={() => move(index + 1)}>Skip</Button>}
        {s?.state === "failed" && !inCartForIt && <Button variant="secondary" className="flex-1" onClick={() => move(index + 1)}>Skip</Button>}
      </div>
    </div>
  );
}
