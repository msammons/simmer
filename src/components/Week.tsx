"use client";
import { useMemo, useRef, useState } from "react";
import type { Dish, Kind, NewDish, PlanData, Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, KINDS, kindOf } from "@/lib/week";
import { Icon, type IconName } from "./icons";
import { BrandBar, ConfirmSheet, Group, Held, Row, Sheet } from "./ui";

// The Meals tab is this week's dinners, in any order, by kind; she picks them from her recipes (Nov 10: Simmer doesn't
// pick meals itself). Lunches aren't planned here: lunch foods are Stock things.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;


// ---- Meals (tab)

/** "a quick dinner", "a dessert": one of a kind, in a sentence. */
const ONE: Record<Kind, string> = { quick: "a quick dinner", regular: "a regular dinner", kids: "a kids' dinner", dessert: "a dessert", side: "a side", breakfast: "a breakfast" };

/**
 * The Meals tab, the one place the week is planned and changed (Nov 10). Every kind shows the same way: its dinners
 * (tap for the recipe, or take one off), then "Add one" / "Add another", which opens her recipes of that kind to pick
 * from. Simmer doesn't pick meals itself (Matt, Nov 10). Every change happens at once, and the grocery list follows:
 * what a new dinner needs goes on, and what only a dinner taken off needed comes off, unless it's ticked off or in the
 * cart (server side, lib/plan.ts).
 */
export function MealsScreen({ plan, recipes, dinnerGroceries, onOpen, onRemove, onCount, onAdd, onNewPlan }: {
  plan: PlanData | null; recipes: Recipe[];
  /** How many lines are on the lists: what New plan empties. */
  dinnerGroceries: number;
  // No note bar after a change (Matt, Nov 10: it made the page jump); the dinners and counts show what changed.
  onOpen: (d: Dish) => void; onRemove: (d: Dish) => void; onCount: (d: Dish, count: number) => Promise<unknown>; onAdd: (kind: Kind) => void; onNewPlan: () => void;
}) {
  const dishes = plan?.dishes ?? [];
  const [taking, setTaking] = useState<Dish | null>(null); // waiting on "Take it off?"
  const [starting, setStarting] = useState(false); // waiting on "Start a new plan?"
  // How many of each dinner, as tapped (Nov 10): shown at once and sent at once. Taps while one is on its way aren't
  // sent one by one: when it answers, the latest number goes as one change (Nov 11: no timer waits for the taps to
  // stop), so quick taps never pile up requests (they ran into "It's busy right now" and lost changes).
  const [want, setWant] = useState<Record<string, number>>({});
  const wanted = useRef<Record<string, number>>({}); // the same, for sends that finish later
  const sending = useRef<Record<string, boolean>>({});
  const counted = (recipe: string) => dishes.filter((d) => d.recipe === recipe).length;
  const settle = (recipe: string, n: number) => setWant((w) => {
    if (w[recipe] !== n) return w;
    const x = { ...w }; delete x[recipe]; delete wanted.current[recipe]; return x;
  });
  function send(d: Dish, n: number) {
    sending.current[d.recipe] = true;
    // A change that fails shows the plan as it is again (and the alert says why).
    onCount(d, n).then(() => true, () => false).then((ok) => {
      sending.current[d.recipe] = false;
      const latest = wanted.current[d.recipe];
      if (ok && latest !== undefined && latest !== n) return send(d, latest);
      if (!ok) { delete wanted.current[d.recipe]; setWant((w) => { const x = { ...w }; delete x[d.recipe]; return x; }); return; }
      settle(d.recipe, n);
    });
  }
  function tap(d: Dish, by: number) {
    const n = Math.max(0, (want[d.recipe] ?? counted(d.recipe)) + by);
    if (n === 0) return setTaking(d); // the last one off asks first
    wanted.current[d.recipe] = n;
    setWant((w) => ({ ...w, [d.recipe]: n }));
    if (!sending.current[d.recipe]) send(d, n);
  }
  return (
    <div className="space-y-6">
      {/* New plan, the one fresh start for the whole app, in the pinned top bar beside Settings (Matt, Nov 11: no heading;
          it's used at the start of each shop, so it lives with planning rather than in Settings). */}
      <BrandBar trailing={plan && (dishes.length > 0 || dinnerGroceries > 0) && (
        <button onClick={() => setStarting(true)} className="glass flex h-11 shrink-0 items-center rounded-full px-4 t-sub font-semibold text-accent transition active:scale-[0.97]">New plan</button>
      )} />
      <h1 className="sr-only">Meals</h1>
      {!plan && <Held groups={[2, 2, 1]} />}
      {plan && (
        <>
          {KINDS.map((k) => {
            const mine = dishes.filter((d) => d.kind === k);
            // The same dinner planned more than once shows once, with how many (Nov 10): − and + change it.
            const groups = [...new Map(mine.map((d) => [d.recipe, mine.filter((x) => x.recipe === d.recipe)])).values()];
            return (
              <Group key={k} header={KIND_NAMES[k]}>
                {groups.map((same) => {
                  const d = same[same.length - 1];
                  const r = recipes.find((x) => x.id === d.recipe);
                  const name = mealName(d.recipe, recipes);
                  const n = want[d.recipe] ?? same.length;
                  return (
                    <div key={d.recipe} className="flex items-center gap-1.5 pr-3">
                      <div className="min-w-0 flex-1">
                        <Row title={name} onClick={r ? () => onOpen(d) : undefined} />
                      </div>
                      <RoundButton quiet icon="minus" label={n > 1 ? `One less ${name}` : `Take ${name} off the plan`} onClick={() => tap(d, -1)} />
                      <span className="w-5 text-center t-headline tabular-nums" aria-label={`${name}: ${n}`}>{n}</span>
                      <RoundButton quiet icon="plus" label={`One more ${name}`} onClick={() => tap(d, 1)} />
                    </div>
                  );
                })}
                {/* Something left to pick: Add. All of the kind planned: nothing more (Matt, Nov 10). None of the kind: says so;
                    recipes are added on the Recipes tab. */}
                {recipes.some((r) => r.active && kindOf(r) === k && !mine.some((d) => d.recipe === r.id))
                  ? <Row icon="plus" title="Add" accessory="chevron" onClick={() => onAdd(k)} />
                  : !mine.length && <Nothing>No recipes</Nothing>}
              </Group>
            );
          })}
        </>
      )}
      {/* A new plan asks first: every dinner comes off and the lists are emptied; the Safeway cart stays. */}
      <ConfirmSheet open={starting} title="Start a new plan?" confirm="New plan" danger
        message={`Everything starts fresh: ${[
          dishes.length ? (dishes.length === 1 ? "this dinner comes off" : `these ${dishes.length} dinners come off`) : "",
          dinnerGroceries ? `the lists are emptied (${dinnerGroceries} ${dinnerGroceries === 1 ? "thing" : "things"})` : "",
        ].filter(Boolean).join(" and ")}. What's in the Safeway cart stays.`}
        onConfirm={() => { onNewPlan(); setStarting(false); }} onCancel={() => setStarting(false)} />
      {/* Taking one off asks first (Nov 9: a confirm, never an Undo). */}
      <ConfirmSheet open={Boolean(taking)} title={taking ? `Take ${mealName(taking.recipe, recipes)} off the plan?` : ""} confirm="Take it off" danger
        message="What only it needed comes off the grocery list."
        onConfirm={() => {
          if (!taking) return;
          // All of them: one change for however many there are.
          if (counted(taking.recipe) > 1) onCount(taking, 0).catch(() => {}); else onRemove(taking);
          delete wanted.current[taking.recipe];
          setWant((w) => { const x = { ...w }; delete x[taking.recipe]; return x; });
          setTaking(null);
        }} onCancel={() => setTaking(null)} />
    </div>
  );
}

// ---- Add a meal (any time)

/** Nothing to pick: said plainly, in grey, and not tappable (Matt, Nov 10: Recipes is one tab away; no jump to it). */
function Nothing({ children }: { children: string }) {
  return <Row title={<span className="text-muted">{children}</span>} />;
}

/** Snacks, drinks and sauces are never planned (`kindOf`), so they're not offered. */
const plannable = (r: Recipe) => kindOf(r) !== null;

/**
 * Add one of a kind to this week: her recipes of that kind, A–Z, to pick from (no suggestions: Simmer doesn't pick
 * meals, Nov 10); the search box finds any recipe, which goes in under its own kind. Recipes only. One already planned
 * shows "Planned" and can't go in twice.
 */
export function AddMealSheet({ kind, plan, recipes, onAdd, onClose }: { kind: Kind; plan: PlanData; recipes: Recipe[]; onAdd: (dish: NewDish) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const planned = useMemo(() => new Set(plan.dishes.map((d) => d.recipe)), [plan.dishes]);
  const term = q.trim();
  const mine = useMemo(() => recipes.filter((r) => r.active && kindOf(r) === kind).sort((a, b) => a.name.localeCompare(b.name)), [recipes, kind]);
  const found = useMemo(() => (term ? searchRecipes(recipes, term).filter(plannable) : []), [recipes, term]);
  // Closes at once (Matt, Nov 10: no "Saving…"): the dinner shows on Meals straight away and saves behind it.
  function add(dish: NewDish) {
    onAdd(dish);
    onClose();
  }
  // Just the name (Matt, Nov 10: no lines under rows).
  const row = (r: Recipe) => {
    const here = planned.has(r.id);
    return <Row key={r.id} title={r.name} value={here ? "Planned" : undefined} disabled={here}
      onClick={here ? undefined : () => add({ kind: kindOf(r) ?? kind, recipe: r.id, pinned: true })} />;
  };
  return (
    <Sheet label="Add a meal" title={`Add ${ONE[kind]}`} onClose={onClose} tall>
      <div className="space-y-5 pb-2">
        {/* No autofocus: on a phone the keyboard would cover the list. */}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe" aria-label="Find a recipe" enterKeyHint="search"
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Group>
          {term ? found.slice(0, 30).map((r) => row(r)) : mine.map((r) => row(r))}
          {term && !found.length && <Nothing>{`No recipe called “${term.slice(0, 80)}”`}</Nothing>}
          {!term && !mine.length && <Nothing>No recipes</Nothing>}
        </Group>
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
