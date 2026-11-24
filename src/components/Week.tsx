"use client";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dish, Kind, NewDish, PlanData, Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, kindOf, plainName } from "@/lib/week";
import { addDays, todayIn } from "@/lib/time";
import { BrandBar, ConfirmSheet, Group, Held, MoreMenu, Row, Sheet } from "./ui";
import { Icon } from "./icons";

// The Meals tab is a list of days from today, each with its meals, picked from her recipes (Nov 16, from Robin's run;
// Simmer doesn't pick meals itself). Kids' lunches, snacks and desserts are mostly Stock; Lunch stays as an option.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? plainName(id);


// ---- Meals (tab)

/** The kinds in the order she plans them, with their headings in the add sheet (Nov 17). */
const KIND_ORDER: Kind[] = ["quick", "regular", "kids", "breakfast", "lunchmeal", "dessert", "side"];
const KIND_HEADERS: Record<Kind, string> = { quick: "Quick", regular: "Regular", kids: "Kids' dinners", breakfast: "Breakfast", lunchmeal: "Lunch", dessert: "Desserts", side: "Sides" };

/** "Wed, Nov 18": every day by its date (Sam, Nov 16: dates, not Today and Tomorrow). One formatter, made once. */
const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
function dayName(day: string): string {
  return DAY.format(new Date(`${day}T12:00:00Z`));
}


/**
 * The Meals tab (Nov 16, from Robin's run): a list of days, opened on today, 7 of them, with Show more for up to 14.
 * Each day ends with a quiet Add meal row, after its meals (Nov 18), which opens every recipe with kind pills. A day can
 * hold more than one thing. Tap a meal for its recipe; its ⋯ moves it to another day or takes it off (asking first),
 * and what only it needed comes off the list (server side, lib/plan.ts). Old meal plans are kept (Sam, Nov 24): past
 * days with meals sit above today, scrolled past, and a meal shopped for or whose day has passed is dimmed; its ⋯
 * switches it back on (on today, if its day has passed), and its things go on the list again. Simmer doesn't pick meals (Sam, Nov 10; again with Robin,
 * Nov 15).
 */
export function MealsScreen({ plan, recipes, onOpen, onRemove, onMove, onAdd, onSwitchOn }: {
  plan: PlanData | null; recipes: Recipe[];
  onOpen: (d: Dish) => void; onRemove: (d: Dish) => void; onMove: (d: Dish, day: string) => void; onAdd: (kind: Kind | null, day: string) => void;
  onSwitchOn: (d: Dish) => void;
}) {
  const dishes = useMemo(() => plan?.dishes ?? [], [plan]);
  const old = useMemo(() => plan?.old ?? [], [plan]);
  const [taking, setTaking] = useState<Dish | null>(null); // waiting on "Take it off?"
  const [moving, setMoving] = useState<Dish | null>(null); // picking another day for this dinner
  const [long, setLong] = useState(false); // Show more: 14 days instead of 7
  const today = todayIn();
  const days = Array.from({ length: long ? 14 : 7 }, (_, i) => addDays(today, i));
  const undated = dishes.filter((d) => !d.day);
  const oldUndated = old.filter((d) => !d.day);
  const last = days[days.length - 1];
  const later = [...old, ...dishes].filter((d) => d.day && d.day > last).sort((a, b) => a.day!.localeCompare(b.day!));
  const dim = useMemo(() => new Set(old.map((d) => d.id)), [old]);
  // Looked up once per change, not once per meal (Nov 19).
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const byDay = useMemo(() => {
    const m = new Map<string, Dish[]>();
    for (const d of [...old, ...dishes]) if (d.day) m.set(d.day, [...(m.get(d.day) ?? []), d]);
    return m;
  }, [old, dishes]);
  // Every past day with a meal, oldest first (Sam, Nov 24: history kept for good; Meals opens on today).
  const past = [...byDay.keys()].filter((d) => d < today).sort();
  // Opened on today, once the plan is in: past days are above, scrolled past.
  const todayRef = useRef<HTMLDivElement>(null);
  const seeked = useRef(false);
  const hasPast = past.length > 0;
  useLayoutEffect(() => {
    if (!plan || seeked.current) return;
    seeked.current = true;
    if (hasPast) todayRef.current?.scrollIntoView({ block: "start" });
  }, [plan, hasPast]);
  const meal = (d: Dish) => {
    const r = byId.get(d.recipe);
    const name = r?.name ?? plainName(d.recipe);
    const off = dim.has(d.id);
    const kind = d.kind === "quick" || d.kind === "regular" ? undefined : KIND_NAMES[d.kind];
    return (
      <div key={d.id} className="flex items-center gap-1 pr-3" data-old={off ? "yes" : undefined}>
        <div className="min-w-0 flex-1">
          <Row title={off ? <span className="text-muted">{name}</span> : name} value={kind} onClick={r ? () => onOpen(d) : undefined} />
        </div>
        {/* The dinner's ⋯ (Sam, Nov 17: row actions behind ⋯, as on every screen). A dimmed one's switches it back on. */}
        {off ? (
          <MoreMenu label={`More for ${name}`} title={name} onPick={(v) => { if (v === "on") onSwitchOn(d); }}
            options={[{ value: "on", label: "Switch back on" }]} />
        ) : (
          <MoreMenu label={`More for ${name}`} title={name} onPick={(v) => { if (v === "move") setMoving(d); else if (v === "take") setTaking(d); }}
            options={[{ value: "move", label: "Move to another day" }, { value: "take", label: "Take off the plan" }]} />
        )}
      </div>
    );
  };
  const day = (day: string) => {
    // Every day ends with its own Add row, after its meals (Sam, Nov 18: back from the first meal's ⋯).
    const name = dayName(day);
    return (
      <Group key={day} header={name}>
        {(byDay.get(day) ?? []).map((d) => meal(d))}
        {/* As Recipes' Add recipe row: a grey + and grey words (Sam, Nov 17: the orange was still too bold).
            One Add; the sheet has every kind, with a filter (Sam, Nov 18: no picking the kind first). */}
        <button type="button" aria-label={`Add meal to ${name}`} onClick={() => onAdd(null, day)} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-sunk">
          <Icon name="plus" className="size-5 text-muted" strokeWidth={2.2} /><span className="t-body text-muted">Add meal</span>
        </button>
      </Group>
    );
  };
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Meals</h1>
      {!plan && <Held groups={[2, 2, 2]} />}
      {plan && (
        <>
          {oldUndated.length > 0 && <Group header="Earlier">{oldUndated.map((d) => meal(d))}</Group>}
          {past.map(day)}
          {/* Clear of the top bar when opened here. */}
          <div ref={todayRef} className="scroll-mt-[calc(env(safe-area-inset-top)+4.5rem)]">{day(today)}</div>
          {days.slice(1).map(day)}
          <button type="button" onClick={() => setLong(!long)} className="w-full py-2 t-sub font-semibold text-accent">{long ? "Show fewer days" : "Show more days"}</button>
          {later.length > 0 && <Group header="Later">{later.map((d) => meal(d))}</Group>}
          {undated.length > 0 && <Group header="Not on a day">{undated.map((d) => meal(d))}</Group>}
        </>
      )}
      {moving && <PickDaySheet name={mealName(moving.recipe, recipes)} dishes={dishes} recipes={recipes} onClose={() => setMoving(null)} onPick={(day) => { const d = moving; setMoving(null); if (day !== d.day) onMove(d, day); }} />}
      {/* Taking one off asks first (Nov 9: a confirm, never an Undo). */}
      <ConfirmSheet open={Boolean(taking)} title={taking ? `Take ${mealName(taking.recipe, recipes)} off the plan?` : ""} confirm="Take it off" danger
        message="What only it needed comes off the list."
        onConfirm={() => { if (taking) onRemove(taking); setTaking(null); }} onCancel={() => setTaking(null)} />
    </div>
  );
}

// ---- Add a meal (any time)

/** Nothing to pick: said plainly, in grey, and not tappable (Sam, Nov 10: Recipes is one tab away; no jump to it). */
function Nothing({ children }: { children: string }) {
  return <Row title={<span className="text-muted">{children}</span>} />;
}

/**
 * Add one of a kind to this week: her recipes of that kind, A–Z, to pick from (no suggestions: Simmer doesn't pick
 * meals, Nov 10); the search box finds any recipe, which goes in under its own kind. Recipes only. One already planned
 * shows "Planned" and can't go in twice.
 */
export function AddMealSheet({ kind, day, plan, recipes, onAdd, onClose }: { kind: Kind | null; day: string; plan: PlanData; recipes: Recipe[]; onAdd: (dish: NewDish) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  // Which kind to show: every kind at first, each under its heading (Sam, Nov 18: a filter in the sheet, not a pick before it).
  const [only, setOnly] = useState<Kind | "">(kind ?? "");
  // Already on this day: "Planned" (the same recipe can go on another day).
  const planned = useMemo(() => new Set([...plan.dishes, ...(plan.old ?? [])].filter((d) => d.day === day).map((d) => d.recipe)), [plan.dishes, plan.old, day]);
  const term = q.trim();
  // Each recipe's kind worked out once (Nov 19); snacks, drinks and sauces (no kind) are never planned.
  const kinds = useMemo(() => new Map(recipes.map((r) => [r, kindOf(r)])), [recipes]);
  const all = useMemo(() => recipes.filter((r) => kinds.get(r) !== null).sort((a, b) => a.name.localeCompare(b.name)), [recipes, kinds]);
  const mine = useMemo(() => (only ? all.filter((r) => kinds.get(r) === only) : all), [all, kinds, only]);
  const found = useMemo(() => (term ? searchRecipes(recipes, term).filter((r) => kinds.get(r) != null && (!only || kinds.get(r) === only)) : []), [recipes, kinds, term, only]);
  const byKind = useMemo(() => KIND_ORDER.map((k) => [k, mine.filter((r) => kinds.get(r) === k)] as const).filter(([, rs]) => rs.length), [mine, kinds]);
  // Closes at once (Sam, Nov 10: no "Saving…"): the dinner shows on Meals straight away and saves behind it.
  function add(dish: NewDish) {
    onAdd(dish);
    onClose();
  }
  // Just the name (Sam, Nov 10: no lines under rows).
  const row = (r: Recipe) => {
    const here = planned.has(r.id);
    return <Row key={r.id} title={r.name} value={here ? "Planned" : undefined} disabled={here}
      onClick={here ? undefined : () => add({ kind: kinds.get(r) ?? "regular", recipe: r.id, pinned: true, day })} />;
  };
  return (
    <Sheet label="Add a meal" title={dayName(day)} onClose={onClose} tall>
      <div className="space-y-5 pb-2">
        {/* No autofocus: on a phone the keyboard would cover the list. */}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe" aria-label="Find a recipe" enterKeyHint="search"
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        {/* Every kind as a pill, All first (Sam, Nov 18: pills, all types), wrapping on a narrow phone. */}
        <div role="radiogroup" aria-label="Kind" className="flex flex-wrap gap-2">
          {([["", "All"], ...KIND_ORDER.map((k) => [k, KIND_HEADERS[k]])] as [Kind | "", string][]).map(([k, name]) => (
            <button key={k || "all"} type="button" role="radio" aria-checked={only === k} onClick={() => setOnly(k)}
              className={`h-9 rounded-full px-4 t-sub font-semibold transition active:scale-95 ${only === k ? "glass-tint text-on-accent" : "bg-sunk text-ink"}`}>{name}</button>
          ))}
        </div>
        {term || only ? (
          <Group>
            {term ? found.slice(0, 30).map((r) => row(r)) : mine.map((r) => row(r))}
            {term && !found.length && <Nothing>{`No recipe called “${term.slice(0, 80)}”`}</Nothing>}
            {!term && !mine.length && <Nothing>No recipes</Nothing>}
          </Group>
        ) : mine.length ? (
          // Every kind, each under its own heading, in the order she plans them.
          byKind.map(([k, rs]) => <Group key={k} header={KIND_HEADERS[k]}>{rs.map((r) => row(r))}</Group>)
        ) : <Group><Nothing>No recipes</Nothing></Group>}
      </div>
    </Sheet>
  );
}

/** Which day, for a recipe added from its own page (Nov 16): the next 14 days, tap one, each showing what's already on it (Sam, Nov 17), as Meals marks what's planned. */
export function PickDaySheet({ name, dishes, recipes, onPick, onClose }: { name: string; dishes: Dish[]; recipes: Recipe[]; onPick: (day: string) => void; onClose: () => void }) {
  const today = todayIn();
  const on = (day: string) => dishes.filter((d) => d.day === day).map((d) => mealName(d.recipe, recipes)).join(", ") || undefined;
  return (
    <Sheet label="Which day" title={name} onClose={onClose}>
      <div className="pb-2">
        <Group header="Which day?">
          {Array.from({ length: 14 }, (_, i) => addDays(today, i)).map((day) => <Row key={day} title={dayName(day)} subtitle={on(day)} onClick={() => onPick(day)} />)}
        </Group>
      </div>
    </Sheet>
  );
}


