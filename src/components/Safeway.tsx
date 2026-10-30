"use client";
// Shop's Find and Cart: searching Safeway for a list item and putting products in the Safeway cart, and the cart itself.
// Searches and cart changes are jobs done by the Safeway helper in Chrome on a computer (lib/jobs.ts); the panel at
// the computer shows this same screen, so it works the same everywhere. Product pictures are Safeway's own, shown from
// Safeway's addresses (nothing's stored).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, AuthError, errorText, type CartLine, type Job, type JobKind, type Pick } from "@/lib/client";
import { PAGE } from "@/lib/safeway-helper.mjs";
import { cartTotal, money, qtyFor, rankResults, type FindItem, type Product } from "@/lib/shop";
import { Icon } from "./icons";
import { Button, EmptyState, Group, Notice } from "./ui";

export const cartUrl = () => `${PAGE.site}${PAGE.cartPath}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain words for why a job didn't happen. */
export const NOT_ANSWERING = "Safeway searches run on the computer with Chrome open. It's not answering right now.";
function problemText(error: string): string {
  if (error === "not-answering" || error === "stuck") return NOT_ANSWERING;
  if (error === "signed-out") return "Safeway isn't signed in on the computer. Sign in there, then try again.";
  if (error === "not-found") return "That product didn't come up on Safeway just now. Try searching again.";
  if (error === "not-loaded") return "Safeway didn't load on the computer. Try again in a minute.";
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
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.cart();
      if (!alive.current) return;
      setCart(r.cart); setPicks(r.picks); setAnswering(r.answering); setLoaded(true);
    } catch (e) { if (!(e instanceof AuthError) && alive.current) setLoaded(true); }
  }, []);
  useEffect(() => {
    queueMicrotask(refresh);
    const visible = () => document.visibilityState === "visible";
    const t = setInterval(() => { if (visible()) refresh(); }, 30_000);
    const back = () => { if (visible()) refresh(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [refresh]);

  /**
   * Queues a job and follows it. When the computer hasn't checked in lately it says so at once instead of waiting; a
   * job nobody takes is given up by Simmer after about 35 seconds.
   */
  const run = useCallback(async (kind: JobKind, args: Record<string, unknown>, signal?: AbortSignal): Promise<JobOutcome> => {
    let job: Job, heard = true;
    try {
      const q = await api.queueJob(kind, args);
      heard = q.answering;
      setAnswering(q.answering);
      job = q.job;
    } catch (e) { return { ok: false, problem: errorText(e) }; }
    // Not heard from lately: give it a few seconds (the panel may have just opened), then say so rather than wait on.
    let quiet = heard ? 0 : Date.now() + 5000;
    for (const end = Date.now() + 120_000; Date.now() < end;) {
      await new Promise((r) => setTimeout(r, quiet ? 800 : 1200));
      if (signal?.aborted) { api.cancelJob(job.id).catch(() => {}); return { ok: false, problem: "" }; }
      try {
        const s = await api.job(job.id, signal);
        if (!s.job) return { ok: false, problem: problemText("") };
        if (quiet && s.job.status === "waiting" && !s.answering && Date.now() > quiet) {
          api.cancelJob(job.id).catch(() => {});
          setAnswering(false);
          return { ok: false, problem: NOT_ANSWERING };
        }
        if (s.job.status !== "waiting" || s.answering) quiet = 0;
        if (s.job.status === "done") { setAnswering(true); return { ok: true, result: s.job.result ?? {} }; }
        if (s.job.status === "failed") {
          const error = String(s.job.result?.error ?? "");
          if (error === "not-answering" || error === "stuck") setAnswering(false);
          return { ok: false, problem: error === "cancelled" ? "" : problemText(error) };
        }
      } catch (e) {
        if (signal?.aborted) return { ok: false, problem: "" };
        if (e instanceof AuthError) return { ok: false, problem: "" };
      }
    }
    return { ok: false, problem: NOT_ANSWERING };
  }, []);

  /** Sets how many of a product are in the Safeway cart (0 takes it out), for a list item when it's from Find. */
  const setQty = useCallback(async (p: Product, qty: number, query: string, forItem?: { id: string; item: string }) => {
    setProblem(null);
    setPending((x) => ({ ...x, [p.id]: qty }));
    const r = await run("setQty", { productId: p.id, qty, query, name: p.name, price: p.price, image: p.image, ...(forItem && { itemId: forItem.id, item: forItem.item }) });
    if (!alive.current) return;
    setPending((x) => { if (x[p.id] !== qty) return x; const { [p.id]: _gone, ...rest } = x; void _gone; return rest; });
    if (r.ok) {
      const now = Number(r.result.qty ?? qty);
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

  /** How many of a product are in the cart, counting a change on its way. */
  const qtyOf = (productId: string, fallback = 0) => pending[productId] ?? cart.find((l) => l.productId === productId)?.qty ?? fallback;

  return { cart, picks, answering, loaded, pending, problem, setProblem, refresh, run, setQty, qtyOf };
}
export type Safeway = ReturnType<typeof useSafeway>;

/** A product's picture from Safeway, or a quiet placeholder. */
export function ProductImage({ src }: { src?: string }) {
  const [broken, setBroken] = useState("");
  return src && broken !== src
    // eslint-disable-next-line @next/next/no-img-element -- Safeway's own picture, shown from Safeway
    ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(src)} className="size-14 shrink-0 rounded-xl bg-white object-contain p-1" />
    : <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-sunk text-muted"><Icon name="bag" className="size-6" /></span>;
}

/** − qty +, with a trash in place of − at one. */
export function Stepper({ qty, name, busy, onChange }: { qty: number; name: string; busy?: boolean; onChange: (n: number) => void }) {
  const btn = "glass flex size-9 items-center justify-center rounded-full text-accent transition active:scale-90 disabled:opacity-40";
  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${busy ? "opacity-70" : ""}`}>
      <button className={btn} aria-label={qty <= 1 ? `Take ${name} out of the cart` : `One less ${name}`} onClick={() => onChange(qty - 1)}>
        <Icon name={qty <= 1 ? "trash" : "minus"} className="size-[18px]" strokeWidth={2.2} />
      </button>
      <span className="w-6 text-center t-headline tabular-nums" aria-label={`${qty} in the cart`}>{qty}</span>
      <button className={btn} aria-label={`One more ${name}`} disabled={qty >= 24} onClick={() => onChange(qty + 1)}>
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

type Search = { query: string; state: "loading" | "done" | "failed"; products: Product[]; signedIn: boolean; problem: string; slow: boolean };

/**
 * One list item at a time: search Safeway (Simmer's own search first: the remembered product, else the usual one, else
 * the item), the usual first, Add puts the wanted number in the cart, − / + after that. Skip or Next moves on.
 */
export function FindView({ items, index, onIndex, sw, onCart, onList }: {
  items: FindItem[]; index: number; onIndex: (i: number) => void; sw: Safeway; onCart: () => void; onList: () => void;
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
    setSearches((s) => (s[q]?.state === "done" && !again ? s : { ...s, [q]: { query: q, state: "loading", products: [], signedIn: true, problem: "", slow: false } }));
    const slow = setTimeout(() => setSearches((s) => (s[q]?.state === "loading" ? { ...s, [q]: { ...s[q], slow: true } } : s)), 6000);
    const r = await sw.run("search", { query: q }, c.signal);
    clearTimeout(slow);
    if (c.signal.aborted) return;
    setSearches((s) => ({ ...s, [q]: r.ok
      ? { query: q, state: "done", products: (r.result.products as Product[]) ?? [], signedIn: r.result.signedIn !== false, problem: "", slow: false }
      : { query: q, state: "failed", products: [], signedIn: true, problem: r.problem || NOT_ANSWERING, slow: false } }));
  }, [sw]);
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

  if (!items.length) {
    return <EmptyState icon="bag" title="Nothing to find" action={<Button variant="secondary" onClick={onList}>Back to the list</Button>}>There&apos;s nothing on the list for Safeway.</EmptyState>;
  }
  if (!it) {
    return <EmptyState icon="check" title="That's everything" action={<Button onClick={onCart}>See the cart</Button>}>You&apos;ve been through the whole list for Safeway.</EmptyState>;
  }
  const s = searches[query];
  const results = s?.state === "done" ? rankResults(s.products, { picked: it.picked, usual: it.usual, item: it.item }) : [];
  const inCartForIt = qtyFor(sw.cart, it.id);
  const last = index === items.length - 1;
  const move = (to: number) => { ctl.current?.abort(); onIndex(to); };
  return (
    <div className="space-y-5">
      <div>
        <p className="t-foot font-semibold text-muted">{index + 1} of {items.length}</p>
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">{cap(it.item)}</h2>
        <p className="t-sub text-muted">{[it.want > 1 ? `${it.want} wanted` : it.quantity && `${it.quantity} on the list`, inCartForIt ? `In the cart · ${inCartForIt}` : ""].filter(Boolean).join(" · ") || "One wanted"}</p>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const q = query.trim(); if (q) search(q, true); }}>
        <input value={query} onChange={(e) => setTyped((t) => ({ ...t, [it.id]: e.target.value }))} aria-label="Search Safeway" placeholder="Search Safeway" enterKeyHint="search"
          className="h-[52px] min-w-0 flex-1 rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Button type="submit" variant="secondary" disabled={!query.trim() || s?.state === "loading"} className="shrink-0 px-5">Search</Button>
      </form>
      {sw.problem && <Notice onClick={() => sw.setProblem(null)}>{sw.problem}</Notice>}
      {(!s || s.state === "loading") && (
        <Group footer={s?.slow ? "The first search can take up to half a minute." : undefined}>
          {[0, 1, 2].map((k) => (
            <div key={k} className="flex items-center gap-3 px-4 py-3" aria-hidden>
              <span className="size-14 shrink-0 animate-pulse rounded-xl bg-sunk" />
              <span className="flex-1 space-y-2"><span className="block h-3.5 w-3/4 animate-pulse rounded-full bg-sunk" /><span className="block h-3 w-1/4 animate-pulse rounded-full bg-sunk" /></span>
            </div>
          ))}
          <p className="sr-only" role="status">Looking on Safeway</p>
        </Group>
      )}
      {s?.state === "failed" && (
        <Notice>
          {s.problem}{" "}
          <button className="font-semibold text-accent" onClick={() => search(query, true)}>Try again</button>
        </Notice>
      )}
      {s?.state === "done" && !s.signedIn && <Notice>Safeway isn&apos;t signed in on the computer. Sign in there to add things.</Notice>}
      {s?.state === "done" && (results.length ? (
        <Group>
          {results.map(({ product: p, usual }) => {
            const qty = sw.qtyOf(p.id, p.inCart ? p.qty ?? 1 : 0);
            return (
              <ProductRow key={p.id} p={p} sub={<>{p.price}{usual && <span className="font-semibold text-accent">{p.price ? " · " : ""}Your usual</span>}</>}
                control={qty > 0
                  ? <Stepper qty={qty} name={p.name} busy={p.id in sw.pending} onChange={(n) => sw.setQty(p, n, query, it)} />
                  : <Button size="md" variant={usual ? "primary" : "secondary"} className="shrink-0" disabled={!s.signedIn} onClick={() => sw.setQty(p, it.want || 1, query, it)}>Add</Button>} />
            );
          })}
        </Group>
      ) : <EmptyState icon="search" title="Nothing came up">Try other words.</EmptyState>)}
      <div className="flex gap-3">
        <Button variant="secondary" className="flex-1" disabled={index === 0} onClick={() => move(index - 1)}>Back</Button>
        {inCartForIt
          ? <Button className="flex-1" onClick={() => (last ? onCart() : move(index + 1))}>{last ? "See the cart" : "Next item"}</Button>
          : <Button variant="secondary" className="flex-1" onClick={() => move(index + 1)}>Skip</Button>}
      </div>
    </div>
  );
}

/** The Safeway cart as Simmer knows it: change quantities, take things out, and check out on Safeway. */
export function CartView({ sw, onFind }: { sw: Safeway; onFind: (() => void) | null }) {
  const { total, estimate } = cartTotal(sw.cart.map((l) => ({ ...l, qty: sw.qtyOf(l.productId, l.qty) })));
  if (sw.loaded && !sw.cart.length) {
    return (
      <div className="space-y-5">
        {sw.problem && <Notice onClick={() => sw.setProblem(null)}>{sw.problem}</Notice>}
        <EmptyState icon="cart" title="The cart is empty" action={onFind && <Button onClick={onFind}>Find them at Safeway</Button>}>
          What you add from the list shows here.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {sw.problem && <Notice onClick={() => sw.setProblem(null)}>{sw.problem}</Notice>}
      {sw.answering === false && <Notice tone="info">{NOT_ANSWERING} Changes here wait until it is.</Notice>}
      <Group footer="Only what was added here shows. Anything added on Safeway itself is in the cart there too.">
        {sw.cart.map((l) => {
          const qty = sw.qtyOf(l.productId, l.qty);
          const p = { id: l.productId, name: l.name, price: l.price, image: l.image };
          return (
            <ProductRow key={l.productId} p={p} sub={[l.price, l.item && `for ${l.item}`].filter(Boolean).join(" · ")}
              control={<Stepper qty={qty} name={l.name} busy={l.productId in sw.pending} onChange={(n) => sw.setQty(p, n, l.name, l.itemId ? { id: l.itemId, item: l.item } : undefined)} />} />
          );
        })}
        <div className="flex items-baseline justify-between px-4 py-3">
          <span className="t-headline">{estimate ? "About" : "Total"}</span>
          <span className="t-headline tabular-nums">{money(total)}</span>
        </div>
      </Group>
      <Button href={cartUrl()} icon="external" className="w-full">Check out on Safeway</Button>
    </div>
  );
}
