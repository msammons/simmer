"use client";
import { useMemo, useState, type ReactNode } from "react";
import { dateIn, type Counts, type Dish, type Kind, type NewDish, type PlanData, type Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, KINDS, kindOf, pickMany, rank, somethingElse, type Context } from "@/lib/week";
import { Check } from "./Shop";
import { Icon, type IconName } from "./icons";
import { BrandBar, Button, EmptyState, Group, Notice, Row, Sheet } from "./ui";

// Dinners are planned by number for the next shop, not by day (Nov 3): the Meals tab is this week's dinners, in any
// order, and planning (on this page, Nov 10) starts from last time's numbers.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;
const NOTHING_ELSE = "No other ideas from your recipes";

export function contextFor(p: PlanData, recipes: Recipe[], trips = { traderJoes: p.trips.traderJoes, costco: p.trips.costco }): Context {
  return { recipes, lastMade: p.lastMade, people: p.people, trips, freezer: p.freezer ?? [], today: dateIn(0) };
}

// ---- Meals (tab)

/** A starting-over or first plan: Simmer's picks for these numbers, each kind in order. */
export function freshPicks(counts: Partial<Record<Kind, number>>, ctx: Context, now: string[]): NewDish[] {
  // This week's dinners count as just made: picked again only when nothing else fits.
  const c = { ...ctx, lastMade: { ...ctx.lastMade, ...Object.fromEntries(now.map((id) => [id, ctx.today])) } };
  return pickMany(counts, [], c).map((x) => ({ kind: x.kind, recipe: x.recipe, pinned: false }));
}

/**
 * The Meals tab, the one place the week is planned and changed (Nov 10: "This week" and a separate plan were the same
 * thing twice). Each dinner: tap for its recipe, Something else, or take it off; each kind ends with Add another; Add a
 * meal searches; Start over fills the week again with fresh picks. Every change happens at once, and the grocery list
 * follows: what a new dinner needs goes on, and what only a dinner taken off or swapped out needed comes off, unless
 * it's ticked off or in the cart (server side, lib/plan.ts).
 */
export function MealsScreen({ plan, recipes, error, note, onNote, onOpen, onRemove, onSwap, onAdd, onAddOne, onStartOver }: {
  plan: PlanData | null; recipes: Recipe[]; error: string | null;
  /** A note after a change ("Took Tacos off. 3 things came off the list."); tapping it puts it away. */
  note: string | null; onNote: () => void;
  onOpen: (d: Dish) => void; onRemove: (d: Dish) => void; onSwap: (d: Dish, recipe: string) => void;
  onAdd: (d: NewDish) => void; onAddOne: () => void; onStartOver: (dishes: NewDish[], counts: Counts) => Promise<string | null>;
}) {
  const dishes = plan?.dishes ?? [];
  const [taking, setTaking] = useState<Dish | null>(null); // waiting on "Take it off?"
  const [starting, setStarting] = useState(false); // the Start over sheet
  const [skipped, setSkipped] = useState<Record<string, string[]>>({}); // per dinner, what Something else has offered
  const [none, setNone] = useState<string | null>(null); // a dinner id or a kind Simmer had nothing more for
  if (!plan) return <div className="space-y-6"><BrandBar /><h1 className="sr-only">Meals</h1>{error && <Notice>{error}</Notice>}</div>;
  const ctx = contextFor(plan, recipes);
  const ids = dishes.map((d) => d.recipe);
  function swap(d: Dish) {
    const seen = skipped[d.id] ?? [];
    const next = somethingElse(d.kind, d.recipe, ids, ctx, seen);
    if (!next) return setNone(d.id);
    setNone(null);
    setSkipped({ ...skipped, [d.id]: [...seen, d.recipe] });
    onSwap(d, next.recipe.id);
  }
  function another(kind: Kind) {
    const [c] = pickMany({ [kind]: 1 }, ids, ctx);
    if (!c) return setNone(kind);
    setNone(null);
    onAdd({ kind, recipe: c.recipe, pinned: false });
  }
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Meals</h1>
      {error && <Notice>{error}</Notice>}
      {note && <Notice tone="info" onClick={onNote}>{note}</Notice>}
      {!dishes.length ? (
        <EmptyState icon="pot" title="Nothing planned" action={<Button onClick={() => setStarting(true)} icon="calendar">Plan</Button>}>
          Simmer picks dinners for the next shop from your recipes.
        </EmptyState>
      ) : (
        <>
          <h2 className="t-title px-1">This week</h2>
          {/* Every kind, each the same way (Matt, Nov 10: the "Also add" chips under the rest read oddly). */}
          {KINDS.map((k) => (
            <Group key={k} header={KIND_NAMES[k]}>
              {dishes.filter((d) => d.kind === k).map((d) => {
                const r = recipes.find((x) => x.id === d.recipe);
                const name = mealName(d.recipe, recipes);
                return (
                  <div key={d.id} className="flex items-center gap-1 pr-2">
                    <div className="min-w-0 flex-1">
                      <Row title={name} subtitle={none === d.id ? NOTHING_ELSE : undefined} accessory={r ? "chevron" : undefined} onClick={r ? () => onOpen(d) : undefined} />
                    </div>
                    <RoundButton quiet icon="refresh" label={`Something else instead of ${name}`} onClick={() => swap(d)} />
                    <RoundButton quiet icon="close" label={`Take ${name} off this week`} onClick={() => setTaking(d)} />
                  </div>
                );
              })}
              {/* Simmer adds its next idea of this kind (Matt, Nov 10: "Add another", not "One more" or "Suggest another"). */}
              <Row icon="plus" title={dishes.some((d) => d.kind === k) ? "Add another" : "Add one"} subtitle={none === k ? NOTHING_ELSE : undefined} onClick={() => another(k)} />
            </Group>
          ))}
          <Group><Row icon="search" title="Add a meal" accessory="chevron" onClick={onAddOne} /></Group>
          <Button variant="secondary" className="w-full" icon="refresh" onClick={() => setStarting(true)}>Start over</Button>
        </>
      )}
      {/* Taking one off asks first (Nov 9: a confirm, never an Undo). */}
      {taking && (
        <Sheet label="Take it off" title={`Take ${mealName(taking.recipe, recipes)} off this week?`} onClose={() => setTaking(null)}>
          <div className="space-y-3 pb-2">
            <p className="t-sub text-muted">What only it needed comes off the grocery list, unless it&apos;s ticked off or in the cart.</p>
            <Button className="w-full" onClick={() => { onRemove(taking); setTaking(null); }}>Take it off</Button>
            <Button variant="secondary" className="w-full" onClick={() => setTaking(null)}>Cancel</Button>
          </div>
        </Sheet>
      )}
      {starting && <StartOverSheet plan={plan} recipes={recipes} onStart={onStartOver} onClose={() => setStarting(false)} />}
    </div>
  );
}

/**
 * Start over (or plan the first time): a task, so a sheet. The trips for this shop, then the week filled again with
 * fresh picks: as many of each kind as this week has (last time's numbers when it's empty). Asks first when it replaces
 * dinners, since what only they needed comes off the list.
 */
function StartOverSheet({ plan, recipes, onStart, onClose }: { plan: PlanData; recipes: Recipe[]; onStart: (dishes: NewDish[], counts: Counts) => Promise<string | null>; onClose: () => void }) {
  const [trips, setTrips] = useState({ traderJoes: plan.trips.traderJoes, costco: plan.trips.costco });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const n = plan.dishes.length;
  const counts: Counts = n ? { ...plan.counts, ...Object.fromEntries(KINDS.map((k) => [k, plan.dishes.filter((d) => d.kind === k).length])) } : plan.counts;
  const howMany = KINDS.filter((k) => counts[k] > 0).map((k) => `${counts[k]} ${KIND_NAMES[k].toLowerCase()}`).join(", ");
  const since = (d: string) => (d ? `Last trip ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "No trip yet");
  async function go() {
    setBusy(true); setProblem(null);
    const dishes = freshPicks(counts, contextFor(plan, recipes, trips), plan.dishes.map((d) => d.recipe));
    const p = await onStart(dishes, counts);
    if (!p) return onClose();
    setProblem(p); setBusy(false);
  }
  return (
    <Sheet label="Start over" title={n ? "Start over?" : "Plan the next shop"} onClose={onClose}>
      <div className="space-y-4 pb-2">
        <p className="t-sub text-muted">{n
          ? `This week's ${n === 1 ? "dinner is" : `${n} dinners are`} replaced with new picks${howMany ? ` (${howMany})` : ""}. What only they needed comes off the grocery list.`
          : howMany ? `Simmer picks ${howMany} from your recipes.` : "Add dinners with Add another once there's a plan."}</p>
        <Group header="Trips" footer="Meals that need Trader Joe's or Costco are only picked when there's a trip.">
          <Row lead={<Check on={trips.traderJoes} />} title="Trader Joe's trip" subtitle={since(plan.trips.lastTraderJoes)} role="checkbox" checked={trips.traderJoes} onClick={() => setTrips({ ...trips, traderJoes: !trips.traderJoes })} />
          <Row lead={<Check on={trips.costco} />} title="Costco trip" subtitle={since(plan.trips.lastCostco)} role="checkbox" checked={trips.costco} onClick={() => setTrips({ ...trips, costco: !trips.costco })} />
        </Group>
        {problem && <Notice>{problem}</Notice>}
        <Button className="w-full" disabled={busy} onClick={go}>{busy ? "Picking…" : n ? "Start over" : "Plan"}</Button>
        <Button variant="secondary" className="w-full" disabled={busy} onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
}

// ---- Add a meal (any time)

/** When the recipe isn't there: a way straight to adding it on the Recipes tab (Matt, Nov 10), not just a pointer to it. */
function ToRecipes({ missing, onClick }: { missing: string; onClick: () => void }) {
  return <Row icon="plus" title="Add a recipe" subtitle={missing} accessory="chevron" onClick={onClick} />;
}

/** Snacks, drinks and sauces are never planned (`kindOf`), so they're not offered. */
const plannable = (r: Recipe) => kindOf(r) !== null;

/**
 * Add a meal to this week (Nov 9, "Search and pick"): one sheet. With nothing typed, a few best picks for this week (the
 * top quick and regular dinner, and whatever the freezer lifts), then every recipe under its kind, names only; typing
 * searches. Recipes only (Nov 10). A recipe goes in under its own kind; one already planned shows "This week" and can't
 * go in twice.
 */
export function AddMealSheet({ plan, recipes, onAdd, onRecipes, onClose }: { plan: PlanData; recipes: Recipe[]; onAdd: (dish: NewDish) => Promise<string | null>; onRecipes: () => void; onClose: () => void }) {
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
            {!found.length && <ToRecipes missing={`No recipe called “${term.slice(0, 80)}” yet`} onClick={onRecipes} />}
          </Group>
        ) : (
          <>
            {suggested.length > 0 && <Group header="Suggested">{suggested.map((o) => row(o.recipe))}</Group>}
            {KINDS.filter((k) => all.some((r) => kindOf(r) === k)).map((k) => (
              <Group key={k} header={KIND_NAMES[k]}>{all.filter((r) => kindOf(r) === k).map((r) => row(r))}</Group>
            ))}
            {!all.length && <Group><ToRecipes missing="No recipes yet" onClick={onRecipes} /></Group>}
          </>
        )}
      </div>
    </Sheet>
  );
}

// ---- Small pieces

function RoundButton({ icon, label, onClick, quiet }: { icon: IconName; label: string; onClick: () => void; quiet?: boolean }) {
  return (
    <button aria-label={label} onClick={onClick} className={`flex size-9 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${quiet ? "text-muted" : "glass text-accent"}`}>
      <Icon name={icon} className="size-[18px]" strokeWidth={2.2} />
    </button>
  );
}
