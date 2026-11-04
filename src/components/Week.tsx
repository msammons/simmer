"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { dateIn, type Counts, type Dish, type Kind, type NewDish, type PlanData, type Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, KINDS, kindOf, MAX_COUNT, pickMany, somethingElse, type Choice, type Context } from "@/lib/week";
import { Check } from "./Shop";
import { Icon, type IconName } from "./icons";
import { summary } from "./Recipes";
import { BrandBar, Button, EmptyState, Group, Notice, Row, Sheet } from "./ui";

// Dinners are planned by number for the next shop, not by day (Nov 3): the Meals tab is this week's dinners, in any
// order, and planning asks how many of each.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;
const NOTHING_ELSE = "Nothing else fits. Add recipes, or pick one";
const COUNT_NAMES: Record<Kind, string> = { quick: "Quick dinners", regular: "Regular dinners", kids: "Kids' dinners", dessert: "Desserts", side: "Sides", breakfast: "Breakfasts" };
const ONE_NAME: Record<Kind, string> = { quick: "A quick dinner", regular: "A regular dinner", kids: "A kids' dinner", dessert: "A dessert", side: "A side", breakfast: "A breakfast" };

export function contextFor(p: PlanData, recipes: Recipe[], trips = { traderJoes: p.trips.traderJoes, costco: p.trips.costco }): Context {
  return { recipes, lastMade: p.lastMade, people: p.people, trips, freezer: p.freezer ?? [], today: dateIn(0) };
}

// ---- Meals (tab)

/** The Meals tab: this week's dinners, by kind; then Plan, for the next shop. */
export function MealsScreen({ plan, recipes, error, note, onNote, onPlan, onDish, onAddOne }: {
  plan: PlanData | null; recipes: Recipe[]; error: string | null;
  /** A note after saving ("Added 6 things to the grocery list."); tapping it puts it away. */
  note: string | null; onNote: () => void;
  onPlan: () => void; onDish: (d: Dish) => void; onAddOne: () => void;
}) {
  const dishes = plan?.dishes ?? [];
  const empty = plan && !dishes.length;
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
                  return <Row key={d.id} title={mealName(d.recipe, recipes)} subtitle={r ? summary(r, false, false) || undefined : undefined} accessory="chevron" onClick={() => onDish(d)} />;
                })}
              </Group>
            );
          })}
          <Group>
            {!dishes.length && <Row title="No dinners this week" />}
            <Row icon="plus" title="Add one more" subtitle="A dinner, a dessert, a side or a breakfast" accessory="chevron" onClick={onAddOne} />
          </Group>
          <Button variant="secondary" className="w-full" icon="calendar" onClick={onPlan}>Plan</Button>
        </>
      )}
    </div>
  );
}

// ---- One dinner (tap a row)

/** Cook it, swap it for something else of the same kind, pick one, or take it off. Nothing is ticked off as made
 * (Nov 3): the food is in the kitchen, and the next plan replaces the week. */
export function DishSheet({ plan, d, recipes, onChange, onRemove, onOpen, onClose }: {
  plan: PlanData; d: Dish; recipes: Recipe[];
  onChange: (recipe: string, pinned: boolean) => Promise<string | null>; onRemove: () => Promise<string | null>;
  onOpen: (id: string) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]); // shown here already: Something else never brings one back
  const [nothing, setNothing] = useState(false);
  const [pin, setPin] = useState(false);
  const recipe = recipes.find((r) => r.id === d.recipe);
  async function run(p: Promise<string | null>, close: boolean) {
    setBusy(true); setProblem(null);
    const bad = await p;
    setBusy(false);
    if (!bad && close) return onClose();
    setProblem(bad);
  }
  function another() {
    if (busy) return;
    const next = somethingElse(d.kind, d.recipe, plan.dishes.map((x) => x.recipe), contextFor(plan, recipes), skipped);
    setNothing(!next);
    if (!next) return;
    setSkipped([...skipped, d.recipe]);
    run(onChange(next.recipe.id, false), false);
  }
  const status = busy ? <Notice tone="info">Saving…</Notice> : problem && <Notice>{problem}</Notice>;
  return (
    <Sheet label={mealName(d.recipe, recipes)} title={mealName(d.recipe, recipes)} onClose={onClose}>
      <div className="space-y-5 pb-2">
        {!pin && status}
        <p className="t-sub text-center text-muted">{[KIND_NAMES[d.kind], recipe && recipe.minutes && `${recipe.minutes} min`].filter(Boolean).join(" · ")}</p>
        <Group>
          {recipe && <Row icon="pot" title="Cook" subtitle="The recipe" accessory="chevron" onClick={() => { onClose(); onOpen(recipe.id); }} />}
          <Row icon="refresh" title="Something else" subtitle={nothing ? NOTHING_ELSE : `Another ${KIND_NAMES[d.kind].toLowerCase()} one`} onClick={another} />
          <Row icon="book" title="Pick one" subtitle="From your recipes, or type one" accessory="chevron" onClick={() => setPin(true)} />
          <Row icon="close" title="Remove" subtitle="Not making it after all" onClick={() => !busy && run(onRemove(), true)} />
        </Group>
      </div>
      {pin && <PinSheet kind={d.kind} recipes={recipes} status={status} onPick={async (id) => { await run(onChange(id, true), false); setPin(false); }} onClose={() => setPin(false)} />}
    </Sheet>
  );
}

/** Pick one she already knows: from her recipes of that kind (or any, searching), or typed ("Dinner with G&G"). */
function PinSheet({ kind, recipes, status, onPick, onClose }: { kind: Kind; recipes: Recipe[]; status?: ReactNode; onPick: (recipe: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const found = useMemo(() => (q.trim() ? searchRecipes(recipes, q) : recipes.filter((r) => r.active && kindOf(r) === kind).sort((a, b) => a.name.localeCompare(b.name))).slice(0, 30), [q, recipes, kind]);
  return (
    <Sheet label="Pick one" title={`Pick ${ONE_NAME[kind].toLowerCase()}`} onClose={onClose}>
      <div className="space-y-4 pb-2">
        {status}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe, or type one" aria-label="Find a recipe"
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Group>
          {q.trim() && <Row icon="pencil" title={`“${q.trim()}”`} subtitle="Use these words" onClick={() => onPick(q.trim().slice(0, 80))} />}
          {found.map((r) => <Row key={r.id} title={r.name} subtitle={summary(r)} onClick={() => onPick(r.id)} />)}
          {!q.trim() && !found.length && <Row title="No recipes of this kind yet" subtitle="Type one, or add recipes" />}
        </Group>
      </div>
    </Sheet>
  );
}

// ---- Add one more (any time)

/** One more of any kind for this week, the best that fits, in one tap. */
export function AddOneSheet({ plan, recipes, onAdd, onClose }: { plan: PlanData; recipes: Recipe[]; onAdd: (dishes: NewDish[]) => Promise<string | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pin, setPin] = useState<Kind | null>(null);
  const ctx = contextFor(plan, recipes);
  const planned = plan.dishes.map((d) => d.recipe);
  async function add(dishes: NewDish[]) {
    if (busy) return;
    setBusy(true); setProblem(null);
    const bad = await onAdd(dishes);
    if (!bad) return onClose();
    setProblem(bad); setBusy(false);
  }
  const status = busy ? <Notice tone="info">Saving…</Notice> : problem && <Notice>{problem}</Notice>;
  return (
    <Sheet label="Add one more" title="Add one more" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {!pin && status}
        <Group>
          {KINDS.map((k) => {
            const top = pickMany({ [k]: 1 }, planned, ctx)[0];
            return <Row key={k} title={ONE_NAME[k]} subtitle={top ? mealName(top.recipe, recipes) : NOTHING_ELSE} accessory="chevron"
              onClick={() => (top ? add([{ kind: k, recipe: top.recipe, pinned: false }]) : setPin(k))} />;
          })}
        </Group>
      </div>
      {pin && <PinSheet kind={pin} recipes={recipes} status={status} onPick={(id) => add([{ kind: pin, recipe: id, pinned: true }])} onClose={() => setPin(null)} />}
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
function RoundButton({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} onClick={onClick} className="glass flex size-9 shrink-0 items-center justify-center rounded-full text-accent transition active:scale-90">
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
  const [none, setNone] = useState<Kind | null>(null); // the kind "One more" had nothing more for
  const [found, setFound] = useState<Partial<Record<Kind, number>>>({}); // how many of each fit, when they were picked
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ctx = contextFor(plan, recipes, trips);
  const ids = () => [...plan.dishes.map((d) => d.recipe), ...picks.map((p) => p.recipe)];
  const seq = useRef(0); // tells picks apart, even two of the same
  const keyed = (c: Choice, pinned = false): Picked => ({ ...c, key: String(seq.current++), pinned, skipped: [], nothing: false });

  function toPicks() {
    // This week's dinners count as just made: picked again only when nothing else fits.
    const all = pickMany(counts, [], { ...ctx, lastMade: { ...ctx.lastMade, ...Object.fromEntries(plan.dishes.map((d) => [d.recipe, ctx.today])) } });
    setPicks(all.map((c) => keyed(c)));
    setFound(Object.fromEntries(KINDS.map((k) => [k, all.filter((c) => c.kind === k).length])));
    setNone(null);
    setPage(1);
  }
  const setPick = (key: string, change: Partial<Picked>) => setPicks((ps) => ps.map((p) => (p.key === key ? { ...p, ...change } : p)));
  function another(p: Picked) {
    const next = somethingElse(p.kind, p.recipe, ids(), ctx, p.skipped);
    if (!next) return setPick(p.key, { nothing: true });
    setPick(p.key, { recipe: next.recipe.id, why: next.why, pinned: false, skipped: [...p.skipped, p.recipe], nothing: false });
  }
  function oneMore(kind: Kind) {
    const [c] = pickMany({ [kind]: 1 }, ids(), ctx);
    setNone(c ? null : kind);
    if (c) setPicks((ps) => [...ps, keyed(c)]);
  }

  const last = 1;
  async function save() {
    setBusy(true); setProblem(null);
    const p = await onSave(picks.map((x) => ({ kind: x.kind, recipe: x.recipe, pinned: x.pinned })), counts);
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
          {(["quick", "regular", "kids"] as const).map((k) => <CountRow key={k} title={COUNT_NAMES[k]} subtitle={k === "kids" ? "For nights the kids eat separately" : undefined} n={counts[k]} onChange={(n) => set(k, n)} />)}
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
          <Group key={k} header={KIND_NAMES[k]} aside={<button className="t-foot font-semibold text-accent" onClick={() => oneMore(k)}>One more</button>}>
            {picks.filter((p) => p.kind === k).map((p) => {
              const r = recipes.find((x) => x.id === p.recipe);
              return (
                <div key={p.key} className="flex items-center gap-2 px-4 py-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setPinFor({ key: p.key })}>
                    <span className="block t-body font-semibold">{mealName(p.recipe, recipes)}</span>
                    <span className="mt-0.5 block t-foot text-muted">{p.nothing ? NOTHING_ELSE : p.pinned ? "You picked this" : p.why || (r ? summary(r) : "")}</span>
                  </button>
                  <RoundButton icon="refresh" label={`Something else instead of ${mealName(p.recipe, recipes)}`} onClick={() => another(p)} />
                  <RoundButton icon="close" label={`Remove ${mealName(p.recipe, recipes)}`} onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} />
                </div>
              );
            })}
            {!picks.some((p) => p.kind === k) && <Row title="Nothing fits" subtitle="Add recipes, or pick one" accessory="chevron" onClick={() => setPinFor({ kind: k })} />}
            {none === k && picks.some((p) => p.kind === k) && <Row title={NOTHING_ELSE} accessory="chevron" onClick={() => setPinFor({ kind: k })} />}
            {none !== k && picks.some((p) => p.kind === k) && (found[k] ?? 0) < counts[k] && (
              <Row title={`Only ${found[k] ?? 0} of ${counts[k]} fit`} subtitle="Add recipes, or pick one" accessory="chevron" onClick={() => setPinFor({ kind: k })} />
            )}
          </Group>
        ))}
        <p className="t-sub px-1 text-muted">Tap one to pick it yourself.</p>
        <div className="space-y-2">
          <p className="t-foot px-1 font-semibold text-muted">One more of</p>
          <div className="flex flex-wrap gap-2">{KINDS.map((k) => <Chip key={k} onClick={() => oneMore(k)}>{KIND_NAMES[k]}</Chip>)}</div>
          {none && !shown.includes(none) && <Notice tone="info">{NOTHING_ELSE}</Notice>}
        </div>
      </div>
    );
  }
  const pinKind = pinFor ? ("kind" in pinFor ? pinFor.kind : picks.find((p) => p.key === pinFor.key)?.kind) : undefined;
  return (
    <Sheet label="Plan" title={["How many", "Dinners"][page]} onClose={onClose} footer={footer} page={String(page)} pager={{ index: page, total: 2 }}>
      <div className="pb-2">{body}</div>
      {pinFor && pinKind && (
        <PinSheet kind={pinKind} recipes={recipes} onClose={() => setPinFor(null)} onPick={(recipe) => {
          if ("key" in pinFor) setPick(pinFor.key, { recipe, pinned: true, why: "", nothing: false });
          else setPicks((ps) => [...ps, keyed({ kind: pinFor.kind, recipe, why: "" }, true)]);
          setNone(null); setPinFor(null);
        }} />
      )}
    </Sheet>
  );
}
