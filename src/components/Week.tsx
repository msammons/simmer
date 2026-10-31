"use client";
import { useMemo, useState, type ReactNode } from "react";
import { dateIn, hourNow, type Lunch, type Night, type Recipe, type WeekData } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { addDays } from "@/lib/time";
import { applyShape, choices, emptyNight, LUNCH_PARTS, nextOption, planLunches, suggestWeek, weekDates, type Context, type NightKind, type Shape } from "@/lib/week";
import { Check } from "./Shop";
import { Icon } from "./icons";
import { summary } from "./Recipes";
import { BrandBar, Button, EmptyState, Group, Notice, Row, Segmented, Sheet } from "./ui";

const KIND: Record<NightKind, string> = { quick: "Quick", regular: "Regular", skip: "Skip" };
const day = (date: string, style: "long" | "short" = "long") => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
const monthDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** A meal's name: the recipe's, or the free text she typed. */
export const mealName = (id: string, recipes: Recipe[]) => recipes.find((r) => r.id === id)?.name ?? id;

/** "Quick · Sam away · Kids separate". */
function nightLine(n: Night) {
  return [KIND[n.kind], ...n.away.map((a) => `${a} away`), n.split && "Kids separate"].filter(Boolean).join(" · ");
}

function contextFor(w: WeekData, recipes: Recipe[], trips = { traderJoes: w.trips.traderJoes, costco: w.trips.costco }): Context {
  return { recipes, lastMade: w.lastMade, people: w.people, trips, freezer: w.freezer ?? [] };
}

// ---- Meals (tab)

/**
 * The Meals tab: tonight, this week, and every week after it that's planned, as far ahead as anyone likes; then a way to
 * plan the next one.
 */
export function WeekScreen({ weeks, recipes, me, error, note, onNote, onPlan, onNight, onMade, onOpen }: {
  /** This week, then the following weeks while planned, then the first that isn't. */
  weeks: WeekData[]; recipes: Recipe[]; me: string; error: string | null;
  /** A note after saving ("Added 6 things to the grocery list."); tapping it puts it away. */
  note: string | null; onNote: () => void;
  onPlan: (w: WeekData) => void; onNight: (w: WeekData, n: Night) => void; onMade: (date: string, made: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const today = dateIn(0);
  const week = weeks[0] ?? null;
  const ahead = weeks.slice(1).filter((w) => w.planned);
  const toPlan = weeks.slice(1).find((w) => !w.planned);
  const weekName = (w: WeekData) => (w.monday === addDays(week?.monday ?? "", 7) ? "Next week" : monthDay(w.monday));
  const change = (w: WeekData) => <button className="t-foot font-semibold text-accent" onClick={() => onPlan(w)}>Change</button>;
  const name = (id: string) => mealName(id, recipes);
  // The most recent planned night that's past and not yet answered, within the last three days.
  const ask = week && [...week.nights, ...(week.lastWeek ?? [])].filter((n) => n.date < today && n.date >= addDays(today, -3) && n.meal && n.kind !== "skip" && !n.made).sort((a, b) => b.date.localeCompare(a.date))[0];
  const tonight = week?.nights.find((n) => n.date === today);
  const schoolMorning = hourNow() < 10 ? (week?.lunches ?? []).filter((l) => l.date === today && !l.noSchool) : [];
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Meals</h1>
      {error && <Notice>{error}</Notice>}
      {note && <Notice tone="info" onClick={onNote}>{note}</Notice>}
      {ask && (
        <div className="glass space-y-3 rounded-[22px] p-4">
          <p className="t-body">Did you make the {name(ask.meal).toLowerCase()} {ask.date === addDays(today, -1) ? "last night" : `on ${day(ask.date)}`}?</p>
          <div className="flex gap-2">
            <Button size="md" onClick={() => onMade(ask.date, true)}>Yes</Button>
            <Button size="md" variant="secondary" onClick={() => onMade(ask.date, false)}>No, we had something else</Button>
          </div>
        </div>
      )}
      {schoolMorning.length > 0 && (
        <Group header="Today's lunches">
          {schoolMorning.map((l) => <Row key={l.kid} title={l.kid} subtitle={lunchLine(l)} />)}
        </Group>
      )}
      {!week ? null : !week.planned ? (
        <EmptyState icon="pot" title="Nothing planned this week" action={<Button onClick={() => onPlan(week)} icon="calendar">Plan this week</Button>}>
          Say which nights are quick and which are regular, and Simmer fills in dinners from your recipes.
        </EmptyState>
      ) : (
        <>
          {tonight && tonight.kind !== "skip" && tonight.meal && (
            <Group header="Tonight">
              <Row title={<span className="t-title">{name(tonight.meal)}</span>} subtitle={[nightLine(tonight), tonight.split && tonight.kidsMeal && `Kids: ${name(tonight.kidsMeal)}`].filter(Boolean).join(" · ")}
                accessory="chevron" onClick={() => (recipes.some((r) => r.id === tonight.meal) ? onOpen(tonight.meal) : onNight(week, tonight))} />
            </Group>
          )}
          <WeekGroup header="This week" aside={change(week)} w={week} recipes={recipes} me={me} today={today} onNight={onNight} />
        </>
      )}
      {ahead.map((w) => <WeekGroup key={w.monday} header={weekName(w)} aside={change(w)} w={w} recipes={recipes} me={me} today={today} onNight={onNight} />)}
      {toPlan && (
        <Button variant={week?.planned ? "primary" : "secondary"} className="w-full" icon="calendar" onClick={() => onPlan(toPlan)}>
          {weekName(toPlan) === "Next week" ? "Plan next week" : `Plan the week of ${monthDay(toPlan.monday)}`}
        </Button>
      )}
    </div>
  );
}

const lunchLine = (l: Lunch) => l.schoolLunch ? `School lunch${l.snack ? ` · Snack: ${l.snack}` : ""}` : [[l.main, l.fruit, l.side, l.treat].filter(Boolean).join(", "), l.snack && `Snack: ${l.snack}`].filter(Boolean).join(" · ");

/** A week's nights. "Robin planned" shows only for nights someone else planned, not the person using this phone. */
function WeekGroup({ header, aside, w, recipes, me, today, onNight }: { header: string; aside?: ReactNode; w: WeekData; recipes: Recipe[]; me: string; today: string; onNight: (w: WeekData, n: Night) => void }) {
  return (
    <Group header={header} aside={aside}>
      {w.nights.map((n) => (
        <Row key={n.date}
          title={<span className={n.date < today ? "text-muted" : ""}>{n.kind === "skip" && !n.meal ? "Skip" : n.meal ? mealName(n.meal, recipes) : "Not picked yet"}</span>}
          subtitle={[n.date === today ? "Tonight" : day(n.date), n.kind !== "skip" && nightLine(n), n.split && n.kidsMeal && `Kids: ${mealName(n.kidsMeal, recipes)}`, n.made === "yes" && "Made", n.plannedBy && n.plannedBy !== me && `${n.plannedBy} planned`].filter(Boolean).join(" · ")}
          value={n.pinned ? <span aria-label="Pinned" className="text-accent">●</span> : undefined}
          accessory="chevron" onClick={() => onNight(w, n)} />
      ))}
    </Group>
  );
}

// ---- One night (tap a row)

export function NightSheet({ w, n, recipes, onSave, onOpen, onClose }: {
  w: WeekData; n: Night; recipes: Recipe[]; onSave: (nights: Night[]) => Promise<string | null>; onOpen: (id: string) => void; onClose: () => void;
}) {
  const [swap, setSwap] = useState<number | null>(null);
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const at = w.nights.findIndex((x) => x.date === n.date);
  // Closes once saved; if the save fails, the sheet (and the ideas or pick it came from) stays open to try again.
  async function put(change: Partial<Night>) {
    if (busy) return;
    setBusy(true); setProblem(null);
    const p = await onSave(w.nights.map((x, i) => (i === at ? { ...x, ...change } : x)));
    if (!p) return onClose();
    setProblem(p); setBusy(false);
  }
  const status = busy ? <Notice tone="info">Saving…</Notice> : problem && <Notice>{problem}</Notice>;
  const recipe = recipes.find((r) => r.id === n.meal);
  const ctx = contextFor(w, recipes);
  const kind: NightKind = n.kind === "skip" ? "regular" : n.kind;
  const ideas = swap === null ? [] : choices(w.nights.map((x, i) => (i === at ? { ...x, kind, meal: "" } : x)), at, ctx, swap);
  return (
    <Sheet label={day(n.date)} title={`${day(n.date)}${n.meal ? `: ${mealName(n.meal, recipes)}` : ""}`} onClose={onClose}>
      <div className="space-y-5 pb-2">
        {!pin && status}
        {swap !== null ? (
          <>
            <Group header={`${KIND[kind]} ideas`}>
              {ideas.map((o) => <Row key={o.recipe.id} title={o.recipe.name} subtitle={o.why || summary(o.recipe)} accessory="chevron" onClick={() => put({ meal: o.recipe.id, kind, pinned: false, made: "" })} />)}
              {!ideas.length && <Row title="No more ideas for this night" subtitle="Add recipes from Recipes" />}
            </Group>
            <Button variant="secondary" className="w-full" icon="refresh" onClick={() => setSwap(swap + 1)}>Something else</Button>
          </>
        ) : (
          <Group>
            {recipe && <Row icon="pot" title="Cook" subtitle="The recipe" accessory="chevron" onClick={() => { onClose(); onOpen(recipe.id); }} />}
            <Row icon="refresh" title="Swap" subtitle="Three ideas that fit this night" accessory="chevron" onClick={() => setSwap(0)} />
            <Row icon="book" title={n.pinned ? "Pick something else" : "Pick a meal"} subtitle="From your recipes, or type one" accessory="chevron" onClick={() => setPin(true)} />
            {n.meal && <Row icon="check" title={n.made === "yes" ? "Made" : "Made it"} onClick={n.made === "yes" ? undefined : () => put({ made: "yes" })} />}
            {n.meal && <Row icon="close" title="Clear this night" onClick={() => put({ meal: "", kidsMeal: "", pinned: false, made: "" })} />}
          </Group>
        )}
      </div>
      {pin && <PinSheet kind={kind} recipes={recipes} status={status} onPick={(meal) => put({ meal, pinned: true, kind: n.kind === "skip" ? "regular" : n.kind })} onClose={() => setPin(false)} />}
    </Sheet>
  );
}

/** Pin a meal she already knows: from her recipes, or typed ("Dinner with G&G"). */
function PinSheet({ kind, recipes, status, onPick, onClose }: { kind: NightKind; recipes: Recipe[]; status?: React.ReactNode; onPick: (meal: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const found = useMemo(() => (q.trim() ? searchRecipes(recipes, q) : recipes.filter((r) => r.active && r.for !== "kids" && (kind === "skip" || r.effort === kind)).sort((a, b) => a.name.localeCompare(b.name))).slice(0, 30), [q, recipes, kind]);
  return (
    <Sheet label="Pick a meal" title="Pick a meal" onClose={onClose}>
      <div className="space-y-4 pb-2">
        {status}
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a recipe, or type a meal" aria-label="Find a recipe"
          className="h-[52px] w-full rounded-full bg-card px-5 text-base outline-none ring-accent focus:ring-2" />
        <Group>
          {q.trim() && <Row icon="pencil" title={`“${q.trim()}”`} subtitle="Use these words as the meal" onClick={() => onPick(q.trim().slice(0, 80))} />}
          {found.map((r) => <Row key={r.id} title={r.name} subtitle={summary(r)} onClick={() => onPick(r.id)} />)}
          {!q.trim() && !found.length && <Row title="No recipes for this kind of night yet" />}
        </Group>
      </div>
    </Sheet>
  );
}

// ---- Plan the week (sheet)

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={onClick}
      className={`t-foot h-8 rounded-full px-3 font-semibold transition active:scale-[0.97] ${on ? "bg-accent text-on-accent" : "bg-sunk text-ink"}`}>{children}</button>
  );
}

const PAGES = ["The nights", "This week's trips", "Dinners", "Lunches"] as const;

export function PlanSheet({ w, recipes, me, onSave, onClose }: { w: WeekData; recipes: Recipe[]; me: string; onSave: (nights: Night[], lunches: Lunch[]) => Promise<string | null>; onClose: () => void }) {
  const dates = weekDates(w.monday);
  const [page, setPage] = useState(0);
  const [nights, setNights] = useState<Night[]>(() => (w.planned ? w.nights : applyShape(dates.map((d) => emptyNight(d)), "2-quick-3-regular")));
  const [trips, setTrips] = useState({ traderJoes: w.trips.traderJoes, costco: w.trips.costco });
  const [seeds, setSeeds] = useState<Record<string, number>>({});
  const kids = w.people.filter((p) => !p.isAdult && w.lunchOptions.some((o) => o.kid.toLowerCase() === p.name.toLowerCase()));
  const [noSchool, setNoSchool] = useState<string[]>(() => [...new Set(w.lunches.filter((l) => l.noSchool).map((l) => l.date))]);
  const [lunches, setLunches] = useState<Lunch[]>(() => (w.lunches.length ? w.lunches : planLunches(w.monday, kids, w.lunchOptions)));
  const [pinAt, setPinAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const adults = w.people.filter((p) => p.isAdult);
  const ctx = contextFor(w, recipes, trips);
  const today = dateIn(0);
  const ahead = (n: Night) => n.date >= today;
  const set = (i: number, change: Partial<Night>) => setNights((ns) => ns.map((n, j) => (j === i ? { ...n, ...change } : n)));

  /** Going to the dinners page: picks that no longer fit their night are dropped, then the open nights are filled. */
  function toDinners() {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const fit = nights.map((n) => {
      if (n.pinned || n.made) return n;
      const r = byId.get(n.meal);
      const keep = n.kind !== "skip" && (!r || r.effort === n.kind);
      return { ...n, meal: keep ? n.meal : "", kidsMeal: n.split ? n.kidsMeal : "" };
    });
    // Nights already past are left as they were: nothing is suggested for them.
    setNights(suggestWeek(fit, ctx, today));
    setPage(2);
  }
  function another(i: number) {
    const s = (seeds[nights[i].date] ?? 0) + 1;
    setSeeds({ ...seeds, [nights[i].date]: s });
    const cleared = nights.map((n, j) => (j === i ? { ...n, meal: "" } : n));
    set(i, { meal: choices(cleared, i, ctx, s)[0]?.recipe.id ?? "" });
  }
  function dayOff(date: string) {
    const off = noSchool.includes(date) ? noSchool.filter((d) => d !== date) : [...noSchool, date];
    setNoSchool(off);
    const fresh = planLunches(w.monday, kids, w.lunchOptions, off);
    setLunches((ls) => ls.map((l) => (l.date === date ? fresh.find((f) => f.date === date && f.kid === l.kid) ?? l : l)));
  }

  const last = kids.length && dates.slice(0, 5).some((d) => d >= today) ? 3 : 2;
  // Closes once saved; if the save fails, everything planned stays here, the problem shows above the button, and it can be tried again.
  async function save() {
    setBusy(true); setProblem(null);
    const p = await onSave(nights.map((n) => ({ ...n, plannedBy: n.plannedBy || me })), lunches);
    if (!p) return onClose();
    setProblem(p); setBusy(false);
  }
  const footer = (
    <div className="space-y-3">
      {problem && page === last && <Notice>{problem}</Notice>}
      <div className="flex gap-2">
        {page > 0 && <Button variant="secondary" onClick={() => setPage(page - 1)}>Back</Button>}
        {page < last
          ? <Button className="flex-1" onClick={() => (page === 1 ? toDinners() : setPage(page + 1))}>Next</Button>
          : <Button className="flex-1" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save the week"}</Button>}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (page === 0) {
    const shape = (s: Shape) => setNights(applyShape(nights, s, w.lastWeek));
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Chip on={false} onClick={() => shape("2-quick-3-regular")}>Weeknights 2 quick, 3 regular</Chip>
          <Chip on={false} onClick={() => shape("all-quick")}>All quick</Chip>
          {w.lastWeek.length > 0 && <Chip on={false} onClick={() => shape("last-week")}>Same as last week</Chip>}
        </div>
        {nights.map((n, i) => ahead(n) && (
          <Group key={n.date} header={`${day(n.date)} ${monthDay(n.date).split(" ")[1]}`}
            aside={<button className="t-foot font-semibold text-accent" onClick={() => (n.pinned ? set(i, { pinned: false, meal: "" }) : setPinAt(i))}>{n.pinned ? `${mealName(n.meal, recipes)} ✕` : "Pick a meal"}</button>}>
            <div className="space-y-3 p-3">
              <Segmented label={`${day(n.date)}: how long`} value={n.kind} onChange={(kind) => set(i, { kind })} options={[{ value: "quick", label: "Quick" }, { value: "regular", label: "Regular" }, { value: "skip", label: "Skip" }]} />
              {n.kind !== "skip" && (
                <div className="flex flex-wrap gap-2">
                  {adults.map((a) => <Chip key={a.name} on={n.away.includes(a.name)} onClick={() => set(i, { away: n.away.includes(a.name) ? n.away.filter((x) => x !== a.name) : [...n.away, a.name] })}>{a.name}&apos;s away</Chip>)}
                  <Chip on={n.split} onClick={() => set(i, { split: !n.split, kidsMeal: "" })}>Kids separate</Chip>
                </div>
              )}
            </div>
          </Group>
        ))}
      </div>
    );
  } else if (page === 1) {
    const since = (d: string) => (d ? `Last trip ${monthDay(d)}` : "No trip yet");
    body = (
      <Group footer="Meals that need Trader Joe's or Costco are only suggested when there's a trip.">
        <Row lead={<Check on={trips.traderJoes} />} title="Trader Joe's trip this week" subtitle={since(w.trips.lastTraderJoes)} role="checkbox" checked={trips.traderJoes} onClick={() => setTrips({ ...trips, traderJoes: !trips.traderJoes })} />
        <Row lead={<Check on={trips.costco} />} title="Costco this week" subtitle={since(w.trips.lastCostco)} role="checkbox" checked={trips.costco} onClick={() => setTrips({ ...trips, costco: !trips.costco })} />
      </Group>
    );
  } else if (page === 2) {
    body = (
      <div className="space-y-4">
        {nights.map((n, i) => {
          if (n.kind === "skip" || !ahead(n)) return null;
          const opts = n.pinned || n.made ? [] : choices(nights.map((x, j) => (j === i ? { ...x, meal: "" } : x)), i, ctx, seeds[n.date] ?? 0);
          const pick = recipes.find((r) => r.id === n.meal);
          const why = opts.find((o) => o.recipe.id === n.meal)?.why;
          const kidsOpts = n.split ? choices(nights.map((x, j) => (j === i ? { ...x, kidsMeal: "" } : x)), i, ctx, 0, true) : [];
          return (
            <Group key={n.date} header={`${day(n.date)} · ${nightLine(n)}`} aside={!n.pinned && !n.made ? <button className="t-foot font-semibold text-accent" onClick={() => another(i)}>Something else</button> : undefined}>
              <Row lead={n.pinned ? <Icon name="check" className="size-5 text-accent" /> : undefined} title={<span className="font-semibold">{n.meal ? mealName(n.meal, recipes) : "Nothing fits this night"}</span>}
                subtitle={n.pinned ? "Pinned" : why || (pick ? summary(pick) : "Add more recipes, or pick a meal")} />
              {opts.filter((o) => o.recipe.id !== n.meal).slice(0, 2).map((o) => (
                <Row key={o.recipe.id} title={<span className="text-muted">{o.recipe.name}</span>} subtitle={o.why || summary(o.recipe)} value="Swap" onClick={() => set(i, { meal: o.recipe.id })} />
              ))}
              {n.split && (
                <Row title={`Kids: ${n.kidsMeal ? mealName(n.kidsMeal, recipes) : "nothing yet"}`} subtitle={kidsOpts.length > 1 ? "Tap for another" : "Add kids' dinners from Recipes"}
                  onClick={kidsOpts.length ? () => { const ids = kidsOpts.map((o) => o.recipe.id); set(i, { kidsMeal: ids[(ids.indexOf(n.kidsMeal) + 1) % ids.length] }); } : undefined} />
              )}
            </Group>
          );
        })}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <p className="t-sub px-1 text-muted">Tap a part of a lunch to swap it for another of their options.</p>
        {dates.slice(0, 5).filter((d) => d >= today).map((date) => (
          <Group key={date} header={day(date)} aside={<button className="t-foot font-semibold text-accent" onClick={() => dayOff(date)}>{noSchool.includes(date) ? "School day" : "No school"}</button>}>
            {noSchool.includes(date) ? <Row title="No school" subtitle="No lunches this day" /> : lunches.filter((l) => l.date === date).map((l) => (
              <div key={l.kid} className="space-y-2 px-4 py-3">
                <p className="t-headline">{l.kid}{l.schoolLunch && <span className="t-sub font-normal text-muted"> · School lunch</span>}</p>
                <div className="flex flex-wrap gap-2">
                  {LUNCH_PARTS.filter((p) => l[p]).map((p) => (
                    <Chip key={p} on={false} onClick={() => setLunches((ls) => ls.map((x) => (x === l ? { ...x, [p]: nextOption(x, p, w.lunchOptions) } : x)))}>{p === "snack" ? `Snack: ${l[p]}` : l[p]}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </Group>
        ))}
      </div>
    );
  }
  return (
    <Sheet label="Plan the week" title={PAGES[page]} onClose={onClose} footer={footer} page={String(page)} pager={{ index: page, total: last + 1 }}>
      <div className="pb-2">
        <p className="t-sub mb-3 text-center text-muted">{monthDay(w.monday)}</p>
        {body}
      </div>
      {pinAt !== null && <PinSheet kind={nights[pinAt].kind} recipes={recipes} onPick={(meal) => { set(pinAt, { meal, pinned: true, kind: nights[pinAt].kind === "skip" ? "regular" : nights[pinAt].kind }); setPinAt(null); }} onClose={() => setPinAt(null)} />}
    </Sheet>
  );
}
