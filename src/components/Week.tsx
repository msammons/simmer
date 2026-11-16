"use client";
import { useMemo, useState } from "react";
import type { Dish, Kind, NewDish, PlanData, Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, kindOf } from "@/lib/week";
import { addDays, todayIn } from "@/lib/time";
import { Icon, type IconName } from "./icons";
import { BrandBar, ConfirmSheet, Group, Held, Row, Sheet } from "./ui";

// The Meals tab is a list of days from today, each with its meals, picked from her recipes (Nov 16, from Robin's run;
// Simmer doesn't pick meals itself). Kids' lunches, snacks and desserts are mostly Stock; Lunch stays as an option.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;


// ---- Meals (tab)

/** "a quick dinner", "a dessert": one of a kind, in a sentence. */
const ONE: Record<Kind, string> = { quick: "a quick dinner", regular: "a regular dinner", kids: "a kids' dinner", dessert: "a dessert", side: "a side", breakfast: "a breakfast", lunchmeal: "a lunch" };

/** "Today", "Tomorrow", then "Wed, Nov 18". */
function dayName(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The kinds a day's More offers (Sam, Nov 16: lunch stays as an option; desserts and kids' lunches are mostly Stock). */
const MORE: Kind[] = ["breakfast", "lunchmeal", "kids", "dessert", "side"];

/**
 * The Meals tab (Nov 16, from Robin's run): a list of days starting today, 7 of them, with Show more for up to 14. Each
 * day has Quick and Regular, which open her recipes of that kind to pick one for that day, and More for the other
 * kinds. A day can hold more than one thing. Tap a meal for its recipe; − takes it off (asking first), and what only it
 * needed comes off the grocery list (server side, lib/plan.ts). Days before today drop off by themselves. Simmer
 * doesn't pick meals (Sam, Nov 10; again with Robin, Nov 15).
 */
export function MealsScreen({ plan, recipes, dinnerGroceries, onOpen, onRemove, onAdd, onNewPlan }: {
  plan: PlanData | null; recipes: Recipe[];
  /** How many lines are on the lists: what New plan empties. */
  dinnerGroceries: number;
  onOpen: (d: Dish) => void; onRemove: (d: Dish) => void; onAdd: (kind: Kind, day: string) => void; onNewPlan: () => void;
}) {
  const dishes = plan?.dishes ?? [];
  const [taking, setTaking] = useState<Dish | null>(null); // waiting on "Take it off?"
  const [starting, setStarting] = useState(false); // waiting on "Start a new plan?"
  const [more, setMore] = useState<string | null>(null); // the day whose More is open
  const [long, setLong] = useState(false); // Show more: 14 days instead of 7
  const today = todayIn();
  const days = Array.from({ length: long ? 14 : 7 }, (_, i) => addDays(today, i));
  const undated = dishes.filter((d) => !d.day);
  const later = dishes.filter((d) => d.day && d.day > days[days.length - 1]);
  const meal = (d: Dish) => {
    const r = recipes.find((x) => x.id === d.recipe);
    const name = mealName(d.recipe, recipes);
    return (
      <div key={d.id} className="flex items-center gap-1 pr-3">
        <div className="min-w-0 flex-1">
          <Row title={name} value={d.kind === "quick" || d.kind === "regular" ? undefined : KIND_NAMES[d.kind]} onClick={r ? () => onOpen(d) : undefined} />
        </div>
        <RoundButton icon="minus" label={`Take ${name} off the plan`} onClick={() => setTaking(d)} />
      </div>
    );
  };
  const pill = "glass flex h-9 items-center rounded-full px-4 t-sub font-semibold text-accent transition active:scale-[0.97]";
  return (
    <div className="space-y-6">
      {/* New plan, the one fresh start for the whole app, in the pinned top bar beside Settings (Sam, Nov 11). */}
      <BrandBar trailing={plan && (dishes.length > 0 || dinnerGroceries > 0) && (
        <button onClick={() => setStarting(true)} className="glass flex h-11 shrink-0 items-center rounded-full px-4 t-sub font-semibold text-accent transition active:scale-[0.97]">New plan</button>
      )} />
      <h1 className="sr-only">Meals</h1>
      {!plan && <Held groups={[2, 2, 2]} />}
      {plan && (
        <>
          {days.map((day) => (
            <Group key={day} header={dayName(day, today)}>
              {dishes.filter((d) => d.day === day).map(meal)}
              <div className="flex gap-2 px-4 py-3">
                <button className={pill} onClick={() => onAdd("quick", day)} aria-label={`Quick for ${dayName(day, today)}`}>Quick</button>
                <button className={pill} onClick={() => onAdd("regular", day)} aria-label={`Regular for ${dayName(day, today)}`}>Regular</button>
                <button className={pill} onClick={() => setMore(day)} aria-label={`More for ${dayName(day, today)}`}>More</button>
              </div>
            </Group>
          ))}
          <button onClick={() => setLong(!long)} className="w-full py-2 t-sub font-semibold text-accent">{long ? "Show fewer days" : "Show more days"}</button>
          {later.length > 0 && <Group header="Later">{later.map(meal)}</Group>}
          {undated.length > 0 && <Group header="Not on a day">{undated.map(meal)}</Group>}
        </>
      )}
      {more && (
        <Sheet label="More" title={dayName(more, today)} onClose={() => setMore(null)}>
          <div className="pb-2">
            <Group>{MORE.map((k) => <Row key={k} title={KIND_NAMES[k] === "Kids'" ? "Kids' dinner" : KIND_NAMES[k]} accessory="chevron" onClick={() => { const d = more; setMore(null); onAdd(k, d); }} />)}</Group>
          </div>
        </Sheet>
      )}
      {/* A new plan asks first: every meal comes off and the lists are emptied; the Safeway cart stays. */}
      <ConfirmSheet open={starting} title="Start a new plan?" confirm="New plan" danger
        message={`Everything starts fresh: ${[
          dishes.length ? (dishes.length === 1 ? "this meal comes off" : `these ${dishes.length} meals come off`) : "",
          dinnerGroceries ? `the lists are emptied (${dinnerGroceries} ${dinnerGroceries === 1 ? "thing" : "things"})` : "",
        ].filter(Boolean).join(" and ")}. What's in the Safeway cart stays.`}
        onConfirm={() => { onNewPlan(); setStarting(false); }} onCancel={() => setStarting(false)} />
      {/* Taking one off asks first (Nov 9: a confirm, never an Undo). */}
      <ConfirmSheet open={Boolean(taking)} title={taking ? `Take ${mealName(taking.recipe, recipes)} off the plan?` : ""} confirm="Take it off" danger
        message="What only it needed comes off the grocery list."
        onConfirm={() => { if (taking) onRemove(taking); setTaking(null); }} onCancel={() => setTaking(null)} />
    </div>
  );
}

// ---- Add a meal (any time)

/** Nothing to pick: said plainly, in grey, and not tappable (Sam, Nov 10: Recipes is one tab away; no jump to it). */
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
export function AddMealSheet({ kind, day, plan, recipes, onAdd, onClose }: { kind: Kind; day: string; plan: PlanData; recipes: Recipe[]; onAdd: (dish: NewDish) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  // Already on this day: "Planned" (the same recipe can go on another day).
  const planned = useMemo(() => new Set(plan.dishes.filter((d) => d.day === day).map((d) => d.recipe)), [plan.dishes, day]);
  const term = q.trim();
  const mine = useMemo(() => recipes.filter((r) => kindOf(r) === kind).sort((a, b) => a.name.localeCompare(b.name)), [recipes, kind]);
  const found = useMemo(() => (term ? searchRecipes(recipes, term).filter(plannable) : []), [recipes, term]);
  // Closes at once (Sam, Nov 10: no "Saving…"): the dinner shows on Meals straight away and saves behind it.
  function add(dish: NewDish) {
    onAdd(dish);
    onClose();
  }
  // Just the name (Sam, Nov 10: no lines under rows).
  const row = (r: Recipe) => {
    const here = planned.has(r.id);
    return <Row key={r.id} title={r.name} value={here ? "Planned" : undefined} disabled={here}
      onClick={here ? undefined : () => add({ kind: kindOf(r) ?? kind, recipe: r.id, pinned: true, day })} />;
  };
  return (
    <Sheet label="Add a meal" title={`${dayName(day, todayIn())}: ${ONE[kind]}`} onClose={onClose} tall>
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

/** Which day, for a recipe added from its own page (Nov 16): the next 14 days, tap one. */
export function PickDaySheet({ name, onPick, onClose }: { name: string; onPick: (day: string) => void; onClose: () => void }) {
  const today = todayIn();
  return (
    <Sheet label="Which day" title={name} onClose={onClose}>
      <div className="pb-2">
        <Group header="Which day?">
          {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((day) => <Row key={day} title={dayName(day, today)} accessory="chevron" onClick={() => onPick(day)} />)}
        </Group>
      </div>
    </Sheet>
  );
}

// ---- Small pieces

function RoundButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} onClick={onClick} className="glass flex size-8 shrink-0 items-center justify-center rounded-full text-accent transition active:scale-90 disabled:opacity-40 disabled:active:scale-100">
      <Icon name={icon} className="size-[18px]" strokeWidth={2.2} />
    </button>
  );
}
