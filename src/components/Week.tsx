"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { dateIn, type Counts, type Dish, type Kind, type Lunch, type NewDish, type NewLunch, type PlanData, type Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { KIND_NAMES, KINDS, kindOf, LUNCH_PARTS, MAX_COUNT, nextOption, pickMany, planLunches, somethingElse, weekNumber, type Choice, type Context } from "@/lib/week";
import { norm } from "@/lib/words";
import { Check } from "./Shop";
import { Icon, type IconName } from "./icons";
import { summary } from "./Recipes";
import { BrandBar, Button, EmptyState, Group, Notice, Row, Sheet } from "./ui";

// Meals and lunches are planned by number, not by day (Nov 3): the Meals tab is what's still to make and pack, in any
// order, and planning asks how many of each.

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;
const NOTHING_ELSE = "Nothing else fits. Add recipes, or pick one";
const COUNT_NAMES: Record<Kind, string> = { quick: "Quick dinners", regular: "Regular dinners", kids: "Kids' dinners", dessert: "Desserts", side: "Sides", breakfast: "Breakfasts" };
const ONE_NAME: Record<Kind, string> = { quick: "A quick dinner", regular: "A regular dinner", kids: "A kids' dinner", dessert: "A dessert", side: "A side", breakfast: "A breakfast" };

export function contextFor(p: PlanData, recipes: Recipe[], trips = { traderJoes: p.trips.traderJoes, costco: p.trips.costco }): Context {
  return { recipes, lastMade: p.lastMade, people: p.people, trips, freezer: p.freezer ?? [], today: dateIn(0) };
}
/** The boys who have lunch options (the Lunches tab). */
const lunchKids = (p: PlanData) => p.people.filter((x) => !x.isAdult && p.lunchOptions.some((o) => norm(o.kid) === norm(x.name))).map((x) => x.name);
const lunchLine = (l: Pick<Lunch, (typeof LUNCH_PARTS)[number]>) => [[l.main, l.fruit, l.side, l.treat].filter(Boolean).join(", "), l.snack && `Snack: ${l.snack}`].filter(Boolean).join(" · ");

// ---- Meals (tab)

/** The Meals tab: the dinners to make, by kind, and each boy's lunches to pack; then Plan, for more. */
export function MealsScreen({ plan, recipes, error, note, onNote, onPlan, onDish, onAddOne }: {
  plan: PlanData | null; recipes: Recipe[]; error: string | null;
  /** A note after saving ("Added 6 things to the grocery list."); tapping it puts it away. */
  note: string | null; onNote: () => void;
  onPlan: () => void; onDish: (d: Dish) => void; onAddOne: () => void;
}) {
  const dishes = plan?.dishes ?? [], lunches = plan?.lunches ?? [];
  const kids = [...new Set(lunches.map((l) => l.kid))];
  const empty = plan && !dishes.length && !lunches.length;
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Meals</h1>
      {error && <Notice>{error}</Notice>}
      {note && <Notice tone="info" onClick={onNote}>{note}</Notice>}
      {!plan ? null : empty ? (
        <EmptyState icon="pot" title="Nothing planned" action={<Button onClick={onPlan} icon="calendar">Plan</Button>}>
          Say how many dinners and lunches, and Simmer picks them from your recipes.
        </EmptyState>
      ) : (
        <>
          <h2 className="t-title px-1">Dinners to make</h2>
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
            {!dishes.length && <Row title="No dinners to make" />}
            <Row icon="plus" title="Add one more" subtitle="A dinner, a dessert, a side, a breakfast or a lunch" accessory="chevron" onClick={onAddOne} />
          </Group>
          {kids.map((k) => {
            const mine = lunches.filter((l) => l.kid === k);
            return (
              <Group key={k} header={`${k}'s lunches`} aside={<span className="t-foot text-muted">{mine.length} planned</span>}>
                {mine.map((l) => <Row key={l.id} title={lunchLine(l)} />)}
              </Group>
            );
          })}
          {kids.length > 0 && <p className="t-foot -mt-4 px-4 text-muted">Planning again replaces the lunches.</p>}
          <Button variant="secondary" className="w-full" icon="calendar" onClick={onPlan}>Plan</Button>
        </>
      )}
    </div>
  );
}

// ---- One dinner (tap a row)

/** Cook it, swap it for something else of the same kind, pick one, mark it made, or take it off. */
export function DishSheet({ plan, d, recipes, onChange, onMade, onRemove, onOpen, onClose }: {
  plan: PlanData; d: Dish; recipes: Recipe[];
  onChange: (recipe: string, pinned: boolean) => Promise<string | null>; onMade: () => Promise<string | null>; onRemove: () => Promise<string | null>;
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
          <Row icon="check" title="Made it" onClick={() => !busy && run(onMade(), true)} />
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

/** One more of any kind, the best that fits, in one tap; or a lunch for one of the boys. */
export function AddOneSheet({ plan, recipes, onAdd, onClose }: { plan: PlanData; recipes: Recipe[]; onAdd: (dishes: NewDish[], lunches: NewLunch[]) => Promise<string | null>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pin, setPin] = useState<Kind | null>(null);
  const ctx = contextFor(plan, recipes);
  const planned = plan.dishes.map((d) => d.recipe);
  async function add(dishes: NewDish[], lunches: NewLunch[] = []) {
    if (busy) return;
    setBusy(true); setProblem(null);
    const bad = await onAdd(dishes, lunches);
    if (!bad) return onClose();
    setProblem(bad); setBusy(false);
  }
  const status = busy ? <Notice tone="info">Saving…</Notice> : problem && <Notice>{problem}</Notice>;
  const kids = lunchKids(plan);
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
        {kids.length > 0 && (
          <Group>
            {kids.map((k) => {
              const [l] = planLunches([{ name: k, count: 1 }], plan.lunchOptions, { [k]: plan.lunches.filter((x) => x.kid === k).length }, weekNumber(dateIn(0)));
              return l && <Row key={k} title={`A lunch for ${k}`} subtitle={lunchLine(l)} accessory="chevron" onClick={() => add([], [l])} />;
            })}
          </Group>
        )}
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
 * Plan more: how many of each (starting from last time's numbers), then the picks (Something else, pick one, remove, one
 * more), then the lunches (tap a part to swap it). The numbers are totals (Nov 3): what's still to make counts, and
 * only what's missing is picked. Lunches aren't ticked off, so planning replaces them.
 */
export function PlanSheet({ plan, recipes, onSave, onClose }: { plan: PlanData; recipes: Recipe[]; onSave: (dishes: NewDish[], lunches: NewLunch[], counts: Counts) => Promise<string | null>; onClose: () => void }) {
  const kids = lunchKids(plan);
  const [page, setPage] = useState(0);
  // A total never starts below what's planned already (a dessert planned, last time's 0 would read as "none").
  const [counts, setCounts] = useState<Counts>(() => ({ ...plan.counts, ...Object.fromEntries(KINDS.map((k) => [k, Math.max(plan.counts[k], plan.dishes.filter((d) => d.kind === k).length)])), lunches: Object.fromEntries(kids.map((k) => [k, plan.counts.lunches[k] ?? 5])) }));
  const [trips, setTrips] = useState({ traderJoes: plan.trips.traderJoes, costco: plan.trips.costco });
  const [picks, setPicks] = useState<Picked[]>([]);
  const [lunches, setLunches] = useState<Lunch[]>([]);
  const [pinFor, setPinFor] = useState<{ key: string } | { kind: Kind } | null>(null);
  const [none, setNone] = useState<Kind | null>(null); // the kind "One more" had nothing more for
  const [found, setFound] = useState<Partial<Record<Kind, number>>>({}); // how many of each fit, when they were picked
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ctx = contextFor(plan, recipes, trips);
  const ids = () => [...plan.dishes.map((d) => d.recipe), ...picks.map((p) => p.recipe)];
  const seq = useRef(0); // tells picks apart, even two of the same
  const keyed = (c: Choice, pinned = false): Picked => ({ ...c, key: String(seq.current++), pinned, skipped: [], nothing: false });
  const waiting = (k: Kind) => plan.dishes.filter((d) => d.kind === k).length;
  const missing = (k: Kind) => Math.max(0, counts[k] - waiting(k));

  function toPicks() {
    const all = pickMany(Object.fromEntries(KINDS.map((k) => [k, missing(k)])), plan.dishes.map((d) => d.recipe), ctx);
    setPicks(all.map((c) => keyed(c)));
    setFound(Object.fromEntries(KINDS.map((k) => [k, all.filter((c) => c.kind === k).length])));
    const waitingLunches = Object.fromEntries(kids.map((k) => [k, plan.lunches.filter((l) => l.kid === k).length]));
    setLunches(planLunches(kids.map((k) => ({ name: k, count: counts.lunches[k] ?? 0 })), plan.lunchOptions, waitingLunches, weekNumber(dateIn(0))));
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

  const lunchPage = lunches.length > 0;
  const last = lunchPage ? 2 : 1;
  async function save() {
    setBusy(true); setProblem(null);
    const p = await onSave(picks.map((x) => ({ kind: x.kind, recipe: x.recipe, pinned: x.pinned })), lunches.map((l) => ({ kid: l.kid, ...Object.fromEntries(LUNCH_PARTS.map((p) => [p, l[p]])) }) as NewLunch), counts);
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
    const sub = (k: Kind, extra?: string) => [waiting(k) ? `${waiting(k)} planned already` : "", extra].filter(Boolean).join(" · ") || undefined;
    const since = (d: string) => (d ? `Last trip ${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : "No trip yet");
    body = (
      <div className="space-y-5">
        <Group header="Dinners" footer={plan.dishes.length ? "These are totals. Simmer adds only what's missing." : undefined}>
          {(["quick", "regular", "kids"] as const).map((k) => <CountRow key={k} title={COUNT_NAMES[k]} subtitle={sub(k, k === "kids" ? "For nights the kids eat separately" : undefined)} n={counts[k]} onChange={(n) => set(k, n)} />)}
        </Group>
        <Group header="Also">
          {(["dessert", "side", "breakfast"] as const).map((k) => <CountRow key={k} title={COUNT_NAMES[k]} subtitle={sub(k)} n={counts[k]} onChange={(n) => set(k, n)} />)}
        </Group>
        {kids.length > 0 && (
          <Group header="Lunches">
            {kids.map((k) => {
              const w = plan.lunches.filter((l) => l.kid === k).length;
              return <CountRow key={k} title={k} subtitle={w ? `Replaces the ${w} planned now` : undefined} n={counts.lunches[k] ?? 0} onChange={(n) => setCounts({ ...counts, lunches: { ...counts.lunches, [k]: n } })} />;
            })}
          </Group>
        )}
        <Group header="Trips" footer="Meals that need Trader Joe's or Costco are only picked when there's a trip.">
          <Row lead={<Check on={trips.traderJoes} />} title="Trader Joe's trip" subtitle={since(plan.trips.lastTraderJoes)} role="checkbox" checked={trips.traderJoes} onClick={() => setTrips({ ...trips, traderJoes: !trips.traderJoes })} />
          <Row lead={<Check on={trips.costco} />} title="Costco trip" subtitle={since(plan.trips.lastCostco)} role="checkbox" checked={trips.costco} onClick={() => setTrips({ ...trips, costco: !trips.costco })} />
        </Group>
      </div>
    );
  } else if (page === 1) {
    const shown = KINDS.filter((k) => picks.some((p) => p.kind === k) || missing(k) > 0);
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
            {none !== k && picks.some((p) => p.kind === k) && (found[k] ?? 0) < missing(k) && (
              <Row title={`Only ${found[k] ?? 0} of ${missing(k)} fit`} subtitle="Add recipes, or pick one" accessory="chevron" onClick={() => setPinFor({ kind: k })} />
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
  } else {
    body = (
      <div className="space-y-5">
        <p className="t-sub px-1 text-muted">Tap a part of a lunch to swap it for another of their options.</p>
        {kids.filter((k) => lunches.some((l) => l.kid === k)).map((k) => (
          <Group key={k} header={`${k}'s lunches`}>
            {lunches.filter((l) => l.kid === k).map((l) => (
              <div key={l.id} className="flex items-start gap-2 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                  {LUNCH_PARTS.filter((p) => l[p]).map((p) => (
                    <Chip key={p} onClick={() => setLunches((ls) => ls.map((x) => (x.id === l.id ? { ...x, [p]: nextOption(x, p, plan.lunchOptions) } : x)))}>{p === "snack" ? `Snack: ${l[p]}` : l[p]}</Chip>
                  ))}
                </div>
                <RoundButton icon="close" label={`Remove this lunch for ${k}`} onClick={() => setLunches((ls) => ls.filter((x) => x.id !== l.id))} />
              </div>
            ))}
          </Group>
        ))}
      </div>
    );
  }
  const pinKind = pinFor ? ("kind" in pinFor ? pinFor.kind : picks.find((p) => p.key === pinFor.key)?.kind) : undefined;
  return (
    <Sheet label="Plan" title={["How many", "Dinners", "Lunches"][page]} onClose={onClose} footer={footer} page={String(page)} pager={{ index: page, total: page === 0 ? (kids.some((k) => (counts.lunches[k] ?? 0) > 0) ? 3 : 2) : last + 1 }}>
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
