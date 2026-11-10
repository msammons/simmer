"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { dateIn, type Counts, type Dish, type Kind, type NewDish, type PlanData, type Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, KINDS, kindOf, MAX_COUNT, pickMany, rank, somethingElse, type Choice, type Context } from "@/lib/week";
import { Check } from "./Shop";
import { Icon, type IconName } from "./icons";
import { BrandBar, Button, EmptyState, Group, Notice, Row, Sheet } from "./ui";

// Dinners are planned by number for the next shop, not by day (Nov 3): the Meals tab is this week's dinners, in any
// order, and planning asks how many of each.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;
const NOTHING_ELSE = "No other ideas from your recipes";
const COUNT_NAMES: Record<Kind, string> = { quick: "Quick dinners", regular: "Regular dinners", kids: "Kids' dinners", dessert: "Desserts", side: "Sides", breakfast: "Breakfasts" };
const ONE_NAME: Record<Kind, string> = { quick: "A quick dinner", regular: "A regular dinner", kids: "A kids' dinner", dessert: "A dessert", side: "A side", breakfast: "A breakfast" };

export function contextFor(p: PlanData, recipes: Recipe[], trips = { traderJoes: p.trips.traderJoes, costco: p.trips.costco }): Context {
  return { recipes, lastMade: p.lastMade, people: p.people, trips, freezer: p.freezer ?? [], today: dateIn(0) };
}

// ---- Meals (tab)

/** The Meals tab: this week's dinners, by kind; then Plan, for the next shop. */
export function MealsScreen({ plan, recipes, error, note, onNote, onPlan, onOpen, onRemove, onAddOne }: {
  plan: PlanData | null; recipes: Recipe[]; error: string | null;
  /** A note after saving ("Added 6 things to the grocery list."); tapping it puts it away. */
  note: string | null; onNote: () => void;
  onPlan: () => void; onOpen: (d: Dish) => void; onRemove: (d: Dish) => void; onAddOne: () => void;
}) {
  const dishes = plan?.dishes ?? [];
  const empty = plan && !dishes.length;
  const [taking, setTaking] = useState<Dish | null>(null); // waiting on "Take it off?"
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Meals</h1>
      {error && <Notice>{error}</Notice>}
      {note && <Notice tone="info" onClick={onNote}>{note}</Notice>}
      {!plan ? null : empty ? (
        <EmptyState icon="pot" title="Nothing planned" action={<Button onClick={onPlan} icon="calendar">Plan</Button>}>
          Say how many dinners for the next shop, and Simmer picks them from your recipes.
        </EmptyState>
      ) : (
        <>
          <h2 className="t-title px-1">This week</h2>
          {KINDS.map((k) => {
            const mine = dishes.filter((d) => d.kind === k);
            return mine.length > 0 && (
              <Group key={k} header={KIND_NAMES[k]}>
                {mine.map((d) => {
                  const r = recipes.find((x) => x.id === d.recipe);
                  // Tap opens the recipe; the one change made here is taking it off (Nov 9). Plan is for changing the week.
                  return (
                    <div key={d.id} className="flex items-center pr-2">
                      <div className="min-w-0 flex-1">
                        <Row title={mealName(d.recipe, recipes)} accessory={r ? "chevron" : undefined} onClick={r ? () => onOpen(d) : undefined} />
                      </div>
                      <RoundButton quiet icon="close" label={`Take ${mealName(d.recipe, recipes)} off this week`} onClick={() => setTaking(d)} />
                    </div>
                  );
                })}
              </Group>
            );
          })}
          <Group>
            {!dishes.length && <Row title="No dinners this week" />}
            <Row icon="plus" title="Add a meal" accessory="chevron" onClick={onAddOne} />
          </Group>
          <Button variant="secondary" className="w-full" icon="calendar" onClick={onPlan}>Plan the next shop</Button>
        </>
      )}
      {/* Taking one off asks first (Nov 9: a confirm, never an Undo). */}
      {taking && (
        <Sheet label="Take it off" title={`Take ${mealName(taking.recipe, recipes)} off this week?`} onClose={() => setTaking(null)}>
          <div className="space-y-3 pb-2">
            <p className="t-sub text-muted">What it needs stays on the grocery list.</p>
            <Button className="w-full" onClick={() => { onRemove(taking); setTaking(null); }}>Take it off</Button>
            <Button variant="secondary" className="w-full" onClick={() => setTaking(null)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---- Pick a recipe (the Plan sheet's "pick it yourself")

/**
 * Pick one of her recipes: those of that kind, or any, searching. Recipes only (Matt, Nov 10: a meal added as just words
 * read oddly); a searched recipe of another kind is filed under its own kind by the Plan sheet.
 */
function PinSheet({ kind, recipes, status, onPick, onClose }: { kind: Kind; recipes: Recipe[]; status?: ReactNode; onPick: (recipe: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const found = useMemo(() => (q.trim() ? searchRecipes(recipes, q) : recipes.filter((r) => r.active && kindOf(r) === kind).sort((a, b) => a.name.localeCompare(b.name))).slice(0, 30), [q, recipes, kind]);
  return (
    <Sheet label="Pick one" title={`Pick ${ONE_NAME[kind].toLowerCase()}`} onClose={onClose} tall>
      <div className="space-y-4 pb-2">
        {status}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe" aria-label="Find a recipe" enterKeyHint="search"
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Group>
          {found.map((r) => <Row key={r.id} title={r.name} onClick={() => onPick(r.id)} />)}
          {!found.length && <Row title={q.trim() ? `No recipe called “${q.trim()}”` : "No recipes of this kind yet"} subtitle="Add it on the Recipes tab" />}
        </Group>
      </div>
    </Sheet>
  );
}

// ---- Add a meal (any time)

/** Snacks, drinks and sauces are never planned (`kindOf`), so they're not offered. */
const plannable = (r: Recipe) => kindOf(r) !== null;

/**
 * Add a meal to this week (Nov 9, "Search and pick"): one sheet. With nothing typed, a few best picks for this week (the
 * top quick and regular dinner, and whatever the freezer lifts), then every recipe under its kind, names only; typing
 * searches. Recipes only (Nov 10). A recipe goes in under its own kind; one already planned shows "This week" and can't
 * go in twice.
 */
export function AddMealSheet({ plan, recipes, onAdd, onClose }: { plan: PlanData; recipes: Recipe[]; onAdd: (dish: NewDish) => Promise<string | null>; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const planned = useMemo(() => new Set(plan.dishes.map((d) => d.recipe)), [plan.dishes]);
  const suggested = useMemo(() => {
    const ctx = contextFor(plan, recipes);
    const quick = rank("quick", [...planned], ctx), regular = rank("regular", [...planned], ctx);
    const out = [quick[0], regular[0]].filter(Boolean);
    const frozen = [...quick, ...regular].filter((o) => o.why.startsWith("Uses the") && !out.includes(o)).sort((a, b) => b.score - a.score);
    return [...out, ...frozen.slice(0, 2)];
  }, [plan, recipes, planned]);
  const term = q.trim();
  const all = useMemo(() => recipes.filter((r) => r.active && plannable(r)).sort((a, b) => a.name.localeCompare(b.name)), [recipes]);
  const found = useMemo(() => (term ? searchRecipes(recipes, term).filter(plannable) : []), [recipes, term]);
  async function add(dish: NewDish) {
    if (busy) return;
    setBusy(true); setProblem(null);
    const bad = await onAdd(dish);
    if (!bad) return onClose();
    setProblem(bad); setBusy(false);
  }
  // Just the name (Matt, Nov 10: no lines under rows); the kind shows as the group a recipe is under.
  const row = (r: Recipe) => {
    const k = kindOf(r)!;
    const here = planned.has(r.id);
    return <Row key={r.id} title={r.name} value={here ? "This week" : undefined} disabled={here}
      onClick={here ? undefined : () => add({ kind: k, recipe: r.id, pinned: true })} />;
  };
  return (
    <Sheet label="Add a meal" title="Add a meal" onClose={onClose} tall>
      <div className="space-y-5 pb-2">
        {busy ? <Notice tone="info">Saving…</Notice> : problem && <Notice>{problem}</Notice>}
        {/* No autofocus: on a phone the keyboard would cover the suggestions. */}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe" aria-label="Find a recipe" enterKeyHint="search"
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        {term ? (
          <Group>
            {found.slice(0, 30).map((r) => row(r))}
            {!found.length && <Row title={`No recipe called “${term.slice(0, 80)}”`} subtitle="Add it on the Recipes tab" />}
          </Group>
        ) : (
          <>
            {suggested.length > 0 && <Group header="Suggested">{suggested.map((o) => row(o.recipe))}</Group>}
            {KINDS.filter((k) => all.some((r) => kindOf(r) === k)).map((k) => (
              <Group key={k} header={KIND_NAMES[k]}>{all.filter((r) => kindOf(r) === k).map((r) => row(r))}</Group>
            ))}
            {!all.length && <Group><Row title="No recipes yet" subtitle="Add them on the Recipes tab" /></Group>}
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---- Plan (sheet)

/** − count +, from none to MAX_COUNT. */
function Counter({ n, name, onChange }: { n: number; name: string; onChange: (n: number) => void }) {
  const btn = "glass flex size-9 items-center justify-center rounded-full text-accent transition active:scale-90 disabled:opacity-40 disabled:active:scale-100";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button className={btn} aria-label={`One less: ${name}`} disabled={n <= 0} onClick={() => onChange(n - 1)}><Icon name="minus" className="size-[18px]" strokeWidth={2.2} /></button>
      <span className="w-6 text-center t-headline tabular-nums" aria-label={`${name}: ${n}`}>{n}</span>
      <button className={btn} aria-label={`One more: ${name}`} disabled={n >= MAX_COUNT} onClick={() => onChange(n + 1)}><Icon name="plus" className="size-[18px]" strokeWidth={2.2} /></button>
    </div>
  );
}
function CountRow({ title, subtitle, n, onChange }: { title: string; subtitle?: string; n: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1"><span className="block t-body">{title}</span>{subtitle && <span className="mt-0.5 block t-foot text-muted">{subtitle}</span>}</span>
      <Counter n={n} name={title} onChange={onChange} />
    </div>
  );
}
/** `quiet`: a small grey one, for a change that's rare next to the row's main use (Meals' take-it-off). */
function RoundButton({ icon, label, onClick, quiet }: { icon: IconName; label: string; onClick: () => void; quiet?: boolean }) {
  return (
    <button aria-label={label} onClick={onClick} className={`flex size-9 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${quiet ? "text-muted" : "glass text-accent"}`}>
      <Icon name={icon} className="size-[18px]" strokeWidth={2.2} />
    </button>
  );
}
function Chip({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="t-foot h-8 rounded-full bg-sunk px-3 font-semibold text-ink transition active:scale-[0.97]">{children}</button>;
}

type Picked = Choice & { key: string; pinned: boolean; skipped: string[]; nothing: boolean };

/**
 * Plan the next shop: how many of each (starting from last time's numbers), then the picks (Something else, pick one,
 * remove, one more). Saving replaces this week's dinners (Nov 3: nothing is ticked off as made; the food bought is what
 * gets cooked). This week's dinners count as just made, so they come back only when nothing else fits. Lunches aren't planned: they're Every week things in Stock.
 */
export function PlanSheet({ plan, recipes, onSave, onClose }: { plan: PlanData; recipes: Recipe[]; onSave: (dishes: NewDish[], counts: Counts) => Promise<string | null>; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [counts, setCounts] = useState<Counts>(() => ({ ...plan.counts }));
  const [trips, setTrips] = useState({ traderJoes: plan.trips.traderJoes, costco: plan.trips.costco });
  const [picks, setPicks] = useState<Picked[]>([]);
  const [pinFor, setPinFor] = useState<{ key: string } | { kind: Kind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ctx = contextFor(plan, recipes, trips);
  const ids = () => [...plan.dishes.map((d) => d.recipe), ...picks.map((p) => p.recipe)];
  const seq = useRef(0); // tells picks apart, even two of the same
  const keyed = (c: Choice, pinned = false): Picked => ({ ...c, key: String(seq.current++), pinned, skipped: [], nothing: false });
  // An open place (Nov 10): when Simmer runs out of ideas for a kind, the rest of the number shows as places to pick
  // one yourself, instead of a count of how many "fit".
  const open = (kind: Kind): Picked => keyed({ kind, recipe: "", why: "" });

  function toPicks() {
    // This week's dinners count as just made: picked again only when nothing else fits.
    const all = pickMany(counts, [], { ...ctx, lastMade: { ...ctx.lastMade, ...Object.fromEntries(plan.dishes.map((d) => [d.recipe, ctx.today])) } });
    const filled = all.map((c) => keyed(c));
    // Kept in the kinds' order, each kind's open places after its picks.
    setPicks(KINDS.flatMap((k) => [...filled.filter((p) => p.kind === k), ...Array.from({ length: Math.max(0, counts[k] - all.filter((c) => c.kind === k).length) }, () => open(k))]));
    setPage(1);
  }
  const setPick = (key: string, change: Partial<Picked>) => setPicks((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  function another(p: Picked) {
    const next = somethingElse(p.kind, p.recipe, ids(), ctx, p.skipped);
    if (!next) return setPick(p.key, { nothing: true });
    setPick(p.key, { recipe: next.recipe.id, why: next.why, pinned: false, skipped: [...p.skipped, p.recipe], nothing: false });
  }
  function oneMore(kind: Kind) {
    const [c] = pickMany({ [kind]: 1 }, ids().filter(Boolean), ctx);
    setPicks((ps) => [...ps, c ? keyed(c) : open(kind)]);
  }

  const last = 1;
  async function save() {
    setBusy(true); setProblem(null);
    const p = await onSave(picks.filter((x) => x.recipe).map((x) => ({ kind: x.kind, recipe: x.recipe, pinned: x.pinned })), counts);
    if (!p) return onClose();
    setProblem(p); setBusy(false);
  }
  const footer = (
    <div className="space-y-3">
      {problem && page === last && <Notice>{problem}</Notice>}
      <div className="flex gap-2">
        {page > 0 && <Button variant="secondary" onClick={() => setPage(page - 1)}>Back</Button>}
        {page === 0 ? <Button className="flex-1" onClick={toPicks}>Next</Button>
          : page < last ? <Button className="flex-1" onClick={() => setPage(page + 1)}>Next</Button>
          : <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button>}
      </div>
    </div>
  );

  let body: ReactNode;
  if (page === 0) {
    const set = (k: Kind, n: number) => setCounts({ ...counts, [k]: n });
    const since = (d: string) => (d ? `Last trip ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "No trip yet");
    body = (
      <div className="space-y-5">
        <Group header="Dinners" footer={plan.dishes.length ? `Saving replaces this week's ${plan.dishes.length === 1 ? "dinner" : `${plan.dishes.length} dinners`}.` : undefined}>
          {(["quick", "regular", "kids"] as const).map((k) => <CountRow key={k} title={COUNT_NAMES[k]} n={counts[k]} onChange={(n) => set(k, n)} />)}
        </Group>
        <Group header="Also">
          {(["dessert", "side", "breakfast"] as const).map((k) => <CountRow key={k} title={COUNT_NAMES[k]} n={counts[k]} onChange={(n) => set(k, n)} />)}
        </Group>
        <Group header="Trips" footer="Meals that need Trader Joe's or Costco are only picked when there's a trip.">
          <Row lead={<Check on={trips.traderJoes} />} title="Trader Joe's trip" subtitle={since(plan.trips.lastTraderJoes)} role="checkbox" checked={trips.traderJoes} onClick={() => setTrips({ ...trips, traderJoes: !trips.traderJoes })} />
          <Row lead={<Check on={trips.costco} />} title="Costco trip" subtitle={since(plan.trips.lastCostco)} role="checkbox" checked={trips.costco} onClick={() => setTrips({ ...trips, costco: !trips.costco })} />
        </Group>
      </div>
    );
  } else if (page === 1) {
    const shown = KINDS.filter((k) => picks.some((p) => p.kind === k) || counts[k] > 0);
    body = (
      <div className="space-y-5">
        {!shown.length && <Group><Row title="No dinners this time" subtitle="Add one below, or go back and change the numbers" /></Group>}
        {shown.map((k) => (
          <Group key={k} header={KIND_NAMES[k]}>
            {picks.filter((p) => p.kind === k).map((p) => {
              if (!p.recipe) return (
                <div key={p.key} className="flex items-center gap-2 px-4 py-3">
                  <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setPinFor({ key: p.key })}>
                    <Icon name="plus" className="size-5 shrink-0 text-accent" strokeWidth={2.2} />
                    <span className="min-w-0">
                      <span className="block t-body font-semibold text-accent">Pick {ONE_NAME[k].toLowerCase()}</span>
                    </span>
                  </button>
                  <RoundButton quiet icon="close" label={`Remove this ${KIND_NAMES[k].toLowerCase()} place`} onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} />
                </div>
              );
              const r = recipes.find((x) => x.id === p.recipe);
              return (
                <div key={p.key} className="flex items-center gap-2 px-4 py-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setPinFor({ key: p.key })}>
                    <span className="block t-body font-semibold">{mealName(p.recipe, recipes)}</span>
                    {/* No reason under a pick (Matt, Nov 10: clutter); only the answer when Something else has none. */}
                    {p.nothing && <span className="mt-0.5 block t-foot text-muted">{NOTHING_ELSE}</span>}
                  </button>
                  <RoundButton icon="refresh" label={`Something else instead of ${mealName(p.recipe, recipes)}`} onClick={() => another(p)} />
                  <RoundButton icon="close" label={`Remove ${mealName(p.recipe, recipes)}`} onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} />
                </div>
              );
            })}
            {/* A row that says what it does (Matt, Nov 10: "One more" in the header was confusing; "Add another", not "Suggest another"): Simmer adds its next idea. */}
            <Row icon="plus" title="Add another" onClick={() => oneMore(k)} />
          </Group>
        ))}
        <p className="t-sub px-1 text-muted">Tap one to pick it yourself.</p>
        <div className="space-y-2">
          <p className="t-foot px-1 font-semibold text-muted">Also add</p>
          <div className="flex flex-wrap gap-2">{KINDS.filter((k) => !shown.includes(k)).map((k) => <Chip key={k} onClick={() => oneMore(k)}>{KIND_NAMES[k]}</Chip>)}</div>
        </div>
      </div>
    );
  }
  const pinKind = pinFor ? ("kind" in pinFor ? pinFor.kind : picks.find((p) => p.key === pinFor.key)?.kind) : undefined;
  return (
    <>
    <Sheet label="Plan" title={["How many", "Dinners"][page]} onClose={onClose} footer={footer} page={String(page)} pager={{ index: page, total: 2 }}>
      <div className="pb-2">{body}</div>
    </Sheet>
    {/* Beside the Plan sheet, never inside it: inside, it was laid out within the moving sheet (the search box landed in
        the wrong place and the sheet behind kept scrolling). */}
    {pinFor && pinKind && (
        <PinSheet kind={pinKind} recipes={recipes} onClose={() => setPinFor(null)} onPick={(recipe) => {
          // A recipe goes under its own kind (a searched dessert isn't a quick dinner).
          const r = recipes.find((x) => x.id === recipe);
          const kind = (r && kindOf(r)) || pinKind;
          if ("key" in pinFor) setPick(pinFor.key, { recipe, kind, pinned: true, why: "", nothing: false });
          else setPicks((ps) => [...ps, keyed({ kind, recipe, why: "" }, true)]);
          setPinFor(null);
        }} />
    )}
    </>
  );
}
