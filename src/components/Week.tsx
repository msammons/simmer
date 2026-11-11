"use client";
import { useMemo, useState } from "react";
import type { Dish, Kind, NewDish, PlanData, Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, KINDS, kindOf } from "@/lib/week";
import { Icon, type IconName } from "./icons";
import { BrandBar, Button, Group, Notice, Row, Sheet } from "./ui";

// The Meals tab is this week's dinners, in any order, by kind; she picks them from her recipes (Nov 10: Simmer doesn't
// pick meals itself). Lunches aren't planned here: they're Every week things in Stock.

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
export function MealsScreen({ plan, recipes, error, note, onNote, onOpen, onRemove, onMore, onAdd, onNewPlan }: {
  plan: PlanData | null; recipes: Recipe[]; error: string | null;
  /** A note after a change ("Took Tacos off. 3 things came off the list."); tapping it puts it away. */
  note: string | null; onNote: () => void;
  onOpen: (d: Dish) => void; onRemove: (d: Dish) => void; onMore: (d: Dish) => void; onAdd: (kind: Kind) => void; onNewPlan: () => void;
}) {
  const dishes = plan?.dishes ?? [];
  const [taking, setTaking] = useState<Dish | null>(null); // waiting on "Take it off?"
  const [starting, setStarting] = useState(false); // waiting on "Start a new plan?"
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Meals</h1>
      {error && <Notice>{error}</Notice>}
      {note && <Notice tone="info" onClick={onNote}>{note}</Notice>}
      {plan && (
        <>
          {/* No weeks or dates on screen (Matt, Nov 10): it's the plan, until a new one starts. */}
          <div className="flex items-baseline justify-between px-1">
            <h2 className="t-title">The plan</h2>
            {dishes.length > 0 && <button className="t-sub font-semibold text-accent active:opacity-60" onClick={() => setStarting(true)}>New plan</button>}
          </div>
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
                  return (
                    <div key={d.recipe} className="flex items-center gap-1.5 pr-3">
                      <div className="min-w-0 flex-1">
                        <Row title={name} onClick={r ? () => onOpen(d) : undefined} />
                      </div>
                      <RoundButton quiet icon="minus" label={same.length > 1 ? `One less ${name}` : `Take ${name} off the plan`} onClick={() => (same.length > 1 ? onRemove(d) : setTaking(d))} />
                      <span className="w-5 text-center t-headline tabular-nums" aria-label={`${name}: ${same.length}`}>{same.length}</span>
                      <RoundButton quiet icon="plus" label={`One more ${name}`} onClick={() => onMore(d)} />
                    </div>
                  );
                })}
                <Row icon="plus" title={mine.length ? "Add another" : "Add one"} accessory="chevron" onClick={() => onAdd(k)} />
              </Group>
            );
          })}
        </>
      )}
      {/* A new plan asks first: every dinner comes off; the list stays (what they needed was bought). */}
      {starting && (
        <Sheet label="New plan" title="Start a new plan?" onClose={() => setStarting(false)}>
          <div className="space-y-3 pb-2">
            <p className="t-sub text-muted">{dishes.length === 1 ? "This dinner comes off." : `These ${dishes.length} dinners come off.`} The grocery list stays as it is.</p>
            <Button className="w-full" onClick={() => { onNewPlan(); setStarting(false); }}>New plan</Button>
            <Button variant="secondary" className="w-full" onClick={() => setStarting(false)}>Cancel</Button>
          </div>
        </Sheet>
      )}
      {/* Taking one off asks first (Nov 9: a confirm, never an Undo). */}
      {taking && (
        <Sheet label="Take it off" title={`Take ${mealName(taking.recipe, recipes)} off the plan?`} onClose={() => setTaking(null)}>
          <div className="space-y-3 pb-2">
            <p className="t-sub text-muted">What only it needed comes off the grocery list.</p>
            <Button className="w-full" onClick={() => { onRemove(taking); setTaking(null); }}>Take it off</Button>
            <Button variant="secondary" className="w-full" onClick={() => setTaking(null)}>Cancel</Button>
          </div>
        </Sheet>
      )}
    </div>
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
 * Add one of a kind to this week: her recipes of that kind, A–Z, to pick from (no suggestions: Simmer doesn't pick
 * meals, Nov 10); the search box finds any recipe, which goes in under its own kind. Recipes only. One already planned
 * shows "Planned" and can't go in twice.
 */
export function AddMealSheet({ kind, plan, recipes, onAdd, onRecipes, onClose }: { kind: Kind; plan: PlanData; recipes: Recipe[]; onAdd: (dish: NewDish) => Promise<string | null>; onRecipes: () => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const planned = useMemo(() => new Set(plan.dishes.map((d) => d.recipe)), [plan.dishes]);
  const term = q.trim();
  const mine = useMemo(() => recipes.filter((r) => r.active && kindOf(r) === kind).sort((a, b) => a.name.localeCompare(b.name)), [recipes, kind]);
  const found = useMemo(() => (term ? searchRecipes(recipes, term).filter(plannable) : []), [recipes, term]);
  async function add(dish: NewDish) {
    if (busy) return;
    setBusy(true); setProblem(null);
    const bad = await onAdd(dish);
    if (!bad) return onClose();
    setProblem(bad); setBusy(false);
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
        {busy ? <Notice tone="info">Saving…</Notice> : problem && <Notice>{problem}</Notice>}
        {/* No autofocus: on a phone the keyboard would cover the list. */}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe" aria-label="Find a recipe" enterKeyHint="search"
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Group>
          {term ? found.slice(0, 30).map((r) => row(r)) : mine.map((r) => row(r))}
          {term && !found.length && <ToRecipes missing={`No recipe called “${term.slice(0, 80)}” yet`} onClick={onRecipes} />}
          {!term && !mine.length && <ToRecipes missing={`No ${KIND_NAMES[kind].toLowerCase()} recipes yet`} onClick={onRecipes} />}
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
