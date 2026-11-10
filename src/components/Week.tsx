"use client";
import { useMemo, useState, type ReactNode } from "react";
import { dateIn, type Counts, type Dish, type Kind, type NewDish, type PlanData, type Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, KINDS, kindOf, pickMany, rank, somethingElse, type Choice, type Context } from "@/lib/week";
import { Check } from "./Shop";
import { Icon, type IconName } from "./icons";
import { BrandBar, Button, EmptyState, Group, Notice, Row, Sheet } from "./ui";

// Dinners are planned by number for the next shop, not by day (Nov 3): the Meals tab is this week's dinners, in any
// order, and planning (on this page, Nov 10) starts from last time's numbers.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;
const NOTHING_ELSE = "No other ideas from your recipes";
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
function PinSheet({ kind, recipes, status, onPick, onRecipes, onClose }: { kind: Kind; recipes: Recipe[]; status?: ReactNode; onPick: (recipe: string) => void; onRecipes: () => void; onClose: () => void }) {
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
          {!found.length && <ToRecipes missing={q.trim() ? `No recipe called “${q.trim()}” yet` : "No recipes of this kind yet"} onClick={onRecipes} />}
        </Group>
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

// ---- Plan (sheet)

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

let pickSeq = 0; // tells picks apart, even two of the same

/**
 * Plan the next shop, on the Meals page itself (Matt, Nov 10: the Plan sheet repeated the page). It opens with Simmer's
 * picks for last time's numbers; each can be swapped (Something else), picked yourself (tap it), or taken off, and
 * "Add another" adds one of a kind. Nothing changes until Save: then the picks replace this week's dinners and their
 * groceries go on the list once (changing the live week one by one would leave a swapped dinner's groceries behind).
 * The app keeps this draft while you visit other tabs. This week's dinners count as just made, so they come back only
 * when nothing else fits. Lunches aren't planned: they're Every week things in Stock.
 */
export function PlanPage({ plan, recipes, onSave, onRecipes, onCancel }: { plan: PlanData; recipes: Recipe[]; onSave: (dishes: NewDish[], counts: Counts) => Promise<string | null>; onRecipes: () => void; onCancel: () => void }) {
  const [trips, setTrips] = useState({ traderJoes: plan.trips.traderJoes, costco: plan.trips.costco });
  const keyed = (c: Choice, pinned = false): Picked => ({ ...c, key: String(pickSeq++), pinned, skipped: [], nothing: false });
  // An open place (Nov 10): when Simmer runs out of ideas for a kind, the rest of the number shows as places to pick
  // one yourself, instead of a count of how many "fit".
  const open = (kind: Kind): Picked => keyed({ kind, recipe: "", why: "" });
  const contextWith = (t: typeof trips) => {
    const c = contextFor(plan, recipes, t);
    // This week's dinners count as just made: picked again only when nothing else fits.
    return { ...c, lastMade: { ...c.lastMade, ...Object.fromEntries(plan.dishes.map((d) => [d.recipe, c.today])) } };
  };
  /** Simmer's picks for these numbers, keeping the ones already settled (picked yourself), each kind in order. */
  const fill = (counts: Partial<Record<Kind, number>>, keep: Picked[], t: typeof trips): Picked[] => {
    const need = Object.fromEntries(KINDS.map((k) => [k, Math.max(0, (counts[k] ?? 0) - keep.filter((p) => p.kind === k).length)])) as Record<Kind, number>;
    const all = pickMany(need, keep.map((p) => p.recipe).filter(Boolean), contextWith(t));
    return KINDS.flatMap((k) => {
      const got = all.filter((c) => c.kind === k);
      return [...keep.filter((p) => p.kind === k), ...got.map((c) => keyed(c)), ...Array.from({ length: Math.max(0, need[k] - got.length) }, () => open(k))];
    });
  };
  const [picks, setPicks] = useState<Picked[]>(() => fill(plan.counts, [], trips));
  const [pinFor, setPinFor] = useState<{ key: string } | { kind: Kind } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ctx = contextWith(trips);
  const ids = () => [...plan.dishes.map((d) => d.recipe), ...picks.map((p) => p.recipe)].filter(Boolean);
  const setPick = (key: string, change: Partial<Picked>) => setPicks((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  function another(p: Picked) {
    const next = somethingElse(p.kind, p.recipe, ids(), ctx, p.skipped);
    if (!next) return setPick(p.key, { nothing: true });
    setPick(p.key, { recipe: next.recipe.id, why: next.why, pinned: false, skipped: [...p.skipped, p.recipe], nothing: false });
  }
  function oneMore(kind: Kind) {
    const [c] = pickMany({ [kind]: 1 }, ids(), ctx);
    setPicks((ps) => [...ps, c ? keyed(c) : open(kind)]);
  }
  /** A trip changes what can be picked: Simmer's own picks are picked again; the ones picked yourself stay. */
  function setTrip(change: Partial<typeof trips>) {
    const t = { ...trips, ...change };
    setTrips(t);
    setPicks((ps) => fill(Object.fromEntries(KINDS.map((k) => [k, ps.filter((p) => p.kind === k).length])), ps.filter((p) => p.pinned && p.recipe), t));
  }
  async function save() {
    setBusy(true); setProblem(null);
    const counts = Object.fromEntries(KINDS.map((k) => [k, picks.filter((p) => p.kind === k).length])) as Record<Kind, number>;
    const p = await onSave(picks.filter((x) => x.recipe).map((x) => ({ kind: x.kind, recipe: x.recipe, pinned: x.pinned })), { ...plan.counts, ...counts });
    if (p) { setProblem(p); setBusy(false); }
  }
  const since = (d: string) => (d ? `Last trip ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "No trip yet");
  const shown = KINDS.filter((k) => picks.some((p) => p.kind === k));
  const pinKind = pinFor ? ("kind" in pinFor ? pinFor.kind : picks.find((p) => p.key === pinFor.key)?.kind) : undefined;
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Plan the next shop</h1>
      <div className="px-1">
        <h2 className="t-title">Next shop</h2>
        {plan.dishes.length > 0 && <p className="mt-1 t-sub text-muted">Saving replaces this week&apos;s {plan.dishes.length === 1 ? "dinner" : `${plan.dishes.length} dinners`}.</p>}
      </div>
      <Group header="Trips" footer="Meals that need Trader Joe's or Costco are only picked when there's a trip.">
        <Row lead={<Check on={trips.traderJoes} />} title="Trader Joe's trip" subtitle={since(plan.trips.lastTraderJoes)} role="checkbox" checked={trips.traderJoes} onClick={() => setTrip({ traderJoes: !trips.traderJoes })} />
        <Row lead={<Check on={trips.costco} />} title="Costco trip" subtitle={since(plan.trips.lastCostco)} role="checkbox" checked={trips.costco} onClick={() => setTrip({ costco: !trips.costco })} />
      </Group>
      {shown.map((k) => (
        <Group key={k} header={KIND_NAMES[k]}>
          {picks.filter((p) => p.kind === k).map((p) => {
            if (!p.recipe) return (
              <div key={p.key} className="flex items-center gap-2 px-4 py-3">
                <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setPinFor({ key: p.key })}>
                  <Icon name="plus" className="size-5 shrink-0 text-accent" strokeWidth={2.2} />
                  <span className="min-w-0 t-body font-semibold text-accent">Pick {ONE_NAME[k].toLowerCase()}</span>
                </button>
                <RoundButton quiet icon="close" label={`Remove this ${KIND_NAMES[k].toLowerCase()} place`} onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} />
              </div>
            );
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
      {shown.length > 0 && <p className="-mt-3 t-sub px-1 text-muted">Tap one to pick it yourself.</p>}
      <div className="space-y-2">
        <p className="t-foot px-1 font-semibold text-muted">{shown.length ? "Also add" : "Add dinners"}</p>
        <div className="flex flex-wrap gap-2">{KINDS.filter((k) => !shown.includes(k)).map((k) => <Chip key={k} onClick={() => oneMore(k)}>{KIND_NAMES[k]}</Chip>)}</div>
      </div>
      {problem && <Notice>{problem}</Notice>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button className="flex-1" disabled={busy || !picks.some((p) => p.recipe)} onClick={save}>{busy ? "Saving…" : "Save"}</Button>
      </div>
      {pinFor && pinKind && (
        <PinSheet kind={pinKind} recipes={recipes} onRecipes={() => { setPinFor(null); onRecipes(); }} onClose={() => setPinFor(null)} onPick={(recipe) => {
          // A recipe goes under its own kind (a searched dessert isn't a quick dinner).
          const r = recipes.find((x) => x.id === recipe);
          const kind = (r && kindOf(r)) || pinKind;
          if ("key" in pinFor) setPick(pinFor.key, { recipe, kind, pinned: true, why: "", nothing: false });
          else setPicks((ps) => [...ps, keyed({ kind, recipe, why: "" }, true)]);
          setPinFor(null);
        }} />
      )}
    </div>
  );
}
