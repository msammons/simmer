"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, applyTheme, AuthError, dateIn, errorText, framed, passcodeFromPanel, SIGNED_OUT, store, tellPanelSignedOut, type Draft, type Effort, type Ingredient, type ListState, type Lunch, type Night, type Person, type Kitchen, type Recipe, type Theme, type WeekData } from "@/lib/client";
import { addDays } from "@/lib/time";
import { PasscodeScreen } from "./PasscodeScreen";
import { SettingsSheet } from "./Settings";
import { ListScreen, ShopScreen, type ListActions } from "./Shop";
import { NightSheet, PlanSheet, WeekScreen } from "./Week";
import { AddRecipesSheet, AddToListSheet, EditSheet, RecipeScreen, RecipesScreen } from "./Recipes";
import { OpenSettings, Splash, TabBar, type TabDef, scrollAppTo } from "./ui";

type Tab = "week" | "list" | "shop" | "recipes";
/**
 * Where you are: a tab at the bottom of a stack of screens opened from it (a recipe). Back pops one; a tab starts a new
 * stack. The tab lit is the stack's first; the back button names the screen below.
 */
type Screen = { kind: Tab } | { kind: "recipe"; id: string };
// Recipes first (Matt, Oct 30); Simmer still opens on Meals.
const TABS: TabDef<Tab>[] = [{ id: "recipes", label: "Recipes", icon: "book" }, { id: "week", label: "Meals", icon: "pot" }, { id: "list", label: "List", icon: "list" }, { id: "shop", label: "Shop", icon: "bag" }];
const TAB_NAMES: Record<Tab, string> = { week: "Meals", list: "List", shop: "Shop", recipes: "Recipes" };
const isTab = (v: unknown): v is Tab => typeof v === "string" && Object.hasOwn(TAB_NAMES, v);

/** Where to pick up after reloading into a new version (this tab only). */
const saveResume = (root: Tab) => { try { sessionStorage.setItem("sm.resume", root); } catch {} };
function takeResume(): Tab {
  // The Safeway helper's panel opens Simmer on Shop (?open=shop).
  const asked = typeof location !== "undefined" ? new URLSearchParams(location.search).get("open") : null;
  try { const v = sessionStorage.getItem("sm.resume"); sessionStorage.removeItem("sm.resume"); return isTab(v) ? v : isTab(asked) ? asked : "week"; } catch { return isTab(asked) ? asked : "week"; }
}
/** Nothing would be lost by reloading now: no sheet open and nothing typed. */
const atRest = () => !document.querySelector('[role="dialog"]')
  && ![...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].some((el) => el.value);

export default function App() {
  const [phase, setPhase] = useState<"boot" | "passcode" | "app">("boot");
  const [stack, setStack] = useState<Screen[]>([{ kind: "week" }]);
  const top = stack[stack.length - 1];
  const root = stack[0].kind as Tab;
  const [visit, setVisit] = useState(0); // a new one each tab tap, so the tab's screen opens fresh
  const [shopAt, setShopAt] = useState<string | null>(null); // the list item Shop's Find opens on, from the List tab
  // Browser-only state read on the first client render; the server renders only the splash, so nothing mismatches.
  const browser = typeof window !== "undefined";
  const [people, setPeople] = useState<Person[]>(() => (browser ? store.people() ?? [] : [])); // last time's, for opening offline
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (browser ? store.theme() : "simmer"));
  const [settings, setSettings] = useState(false);
  const [list, setList] = useState<ListState | null>(() => (browser ? store.list() : null)); // last time's, for opening offline
  const [listError, setListError] = useState<string | null>(null);
  const [kitchen, setKitchen] = useState<Kitchen | null>(null);
  const [me, setMe] = useState(() => (browser ? store.me() : ""));
  const [recipes, setRecipes] = useState<Recipe[] | null>(() => (browser ? store.recipes() : null)); // last time's, for opening offline
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"add" | "edit" | "tolist" | null>(null);
  // This week first, then the weeks after it that are planned, then the first one that isn't (to plan it). This week is
  // last time's at first, for opening offline.
  const [weeks, setWeeks] = useState<WeekData[]>(() => { const w = browser ? store.week() : null; return w ? [w] : []; });
  const week = weeks[0] ?? null;
  const [weekError, setWeekError] = useState<string | null>(null);
  const [weekNote, setWeekNote] = useState<string | null>(null);
  // Open sheets name their week (and night) rather than holding a copy, so they show the plan as it is now.
  const [planningFor, setPlanningFor] = useState<string | null>(null);
  const [nightAt, setNightAt] = useState<{ monday: string; date: string } | null>(null);
  const weekBy = (monday: string) => weeks.find((w) => w.monday === monday) ?? null;
  const planning = planningFor ? weekBy(planningFor) : null;
  const nightWeek = nightAt ? weekBy(nightAt.monday) : null;
  const night = nightAt && nightWeek?.nights.find((n) => n.date === nightAt.date);
  const loaded = useRef(false); // the household has loaded from the server this session

  // The passcode was turned down (changed, or typed wrong): close everything and ask for it again. Any request can find
  // out, including ones running in the background, so the client announces it and this listens.
  const signOut = useCallback(() => {
    store.setPasscode(null);
    tellPanelSignedOut();
    setError("Wrong passcode.");
    setSettings(false); setSheet(null); setPlanningFor(null); setNightAt(null);
    setListError(null); setRecipesError(null); setWeekError(null); setWeekNote(null);
    setPhase("passcode");
  }, []);
  useEffect(() => {
    window.addEventListener(SIGNED_OUT, signOut);
    return () => window.removeEventListener(SIGNED_OUT, signOut);
  }, [signOut]);
  /** An error for a notice; a turned-down passcode has already gone back to the passcode screen. */
  const failed = (show: (m: string) => void) => (e: unknown) => { if (!(e instanceof AuthError)) show(errorText(e)); };

  const loadHousehold = useCallback(async () => {
    try {
      const h = await api.household();
      loaded.current = true;
      setPeople(h.people);
      store.setPeople(h.people);
      setError(h.stale ? "Couldn't refresh, so this uses the last copy." : null);
      return true;
    } catch (e) {
      if (e instanceof AuthError) return false;
      setPeople(store.people() ?? []);
      setError(errorText(e));
      return true;
    }
  }, []);

  // The shared list: loaded when Shop opens, then every 30 seconds while it's open and whenever the app comes back to
  // the front, so both phones see the same list. No background work: only while someone's looking.
  const refreshList = useCallback(async () => {
    try {
      const l = await api.list();
      setList(l);
      store.setList(l);
      setListError(null);
    } catch (e) {
      if (!(e instanceof AuthError)) setListError(errorText(e));
    }
  }, []);
  const onShop = phase === "app" && (top.kind === "list" || top.kind === "shop");
  useEffect(() => {
    if (!onShop) return;
    queueMicrotask(refreshList);
    api.kitchen().then(setKitchen, () => {});
    const visible = () => document.visibilityState === "visible";
    const t = setInterval(() => { if (visible()) refreshList(); }, 30_000);
    const back = () => { if (visible()) refreshList(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [onShop, visit, refreshList]);

  // The collection: loaded when Recipes, a recipe or the week opens (the week shows meal names), and after every change,
  // from the server's answer.
  const gotRecipes = useCallback((r: Recipe[]) => { setRecipes(r); store.setRecipes(r); setRecipesError(null); }, []);
  const refreshRecipes = useCallback(async () => {
    try { gotRecipes((await api.recipes()).recipes); }
    catch (e) { if (!(e instanceof AuthError)) setRecipesError(errorText(e)); }
  }, [gotRecipes]);
  const inRecipes = phase === "app" && top.kind !== "list" && top.kind !== "shop";
  useEffect(() => { if (inRecipes) queueMicrotask(refreshRecipes); }, [inRecipes, visit, refreshRecipes]);
  const recipeOf = (id: string) => recipes?.find((r) => r.id === id) ?? null;
  const open = top.kind === "recipe" ? recipeOf(top.id) : null;
  async function recipeChange(c: Parameters<typeof api.recipeChange>[0], show: (r: Recipe) => Recipe) {
    setRecipes((rs) => rs && rs.map((r) => (r.id === c.id ? show(r) : r)));
    try { gotRecipes((await api.recipeChange(c)).recipes); }
    catch (e) { failed(setRecipesError)(e); refreshRecipes(); }
  }
  const setEffort = (r: Recipe, effort: Effort) => recipeChange({ op: "effort", id: r.id, effort }, (x) => ({ ...x, effort }));
  const setActive = (r: Recipe, active: boolean) => recipeChange({ op: "active", id: r.id, active }, (x) => ({ ...x, active }));
  async function saveEdit(d: Draft) {
    try { gotRecipes((await api.saveRecipes([d])).recipes); }
    catch (e) { failed(setRecipesError)(e); }
    setSheet(null);
  }
  function addToList(r: Recipe, items: Ingredient[]) {
    change({ op: "many", items: items.map((i) => ({ item: i.item, quantity: [i.quantity, i.unit].filter(Boolean).join(" ") })), for: r.name, by: me });
  }

  /**
   * The weeks: this one, then each following week while it's planned, up to and including the first that isn't (so it
   * can be planned), as far ahead as anyone has planned. Loading this week also puts on the list the groceries of nights
   * planned long ago that are now close.
   */
  const refreshWeek = useCallback(async () => {
    try {
      const w = await api.week(dateIn(0));
      const all: WeekData[] = [w];
      // Four weeks at a time, for at most half a year ahead.
      for (let ahead = 1; ahead <= 26; ahead += 4) {
        const batch = await Promise.all([0, 1, 2, 3].map((k) => api.week(addDays(w.monday, 7 * (ahead + k)))));
        const stop = batch.findIndex((x) => !x.planned);
        all.push(...(stop < 0 ? batch : batch.slice(0, stop + 1)));
        if (stop >= 0) break;
      }
      setWeeks(all); store.setWeek(w); setWeekError(null);
      if (w.added) setWeekNote(`Added ${w.added} thing${w.added === 1 ? "" : "s"} to the grocery list for the coming days.`);
    } catch (e) {
      if (!(e instanceof AuthError)) setWeekError(errorText(e));
    }
  }, []);
  const onWeek = phase === "app" && top.kind === "week";
  useEffect(() => { if (onWeek) queueMicrotask(refreshWeek); }, [onWeek, visit, refreshWeek]);
  async function saveWeek(nights: Night[], lunches: Lunch[]) {
    try {
      const w = await api.saveWeek(nights, lunches, me);
      setWeeks((all) => all.map((x) => (x.monday === w.monday ? w : x)));
      setWeekError(null);
      refreshWeek(); // a newly planned week brings the one after it, to plan next
      setWeekNote(w.added ? `Added ${w.added} thing${w.added === 1 ? "" : "s"} to the grocery list.` : null);
    } catch (e) { failed(setWeekError)(e); }
    setPlanningFor(null);
  }
  async function made(date: string, yes: boolean) {
    const mark = (n: Night) => (n.date === date ? { ...n, made: yes ? "yes" as const : "no" as const } : n);
    setWeeks((all) => all.map((w, i) => (i ? w : { ...w, nights: w.nights.map(mark), lastWeek: w.lastWeek.map(mark) })));
    try { const w = await api.made(date, yes); setWeeks((all) => all.map((x) => (x.monday === w.monday ? w : x))); if (w.monday === week?.monday) store.setWeek(w); }
    catch (e) { failed(setWeekError)(e); }
  }

  /** A change to the list: shown at once, then sent; the answer is the list as it is now (anyone else's changes too). */
  async function change(c: Parameters<typeof api.change>[0], show?: (l: ListState) => ListState) {
    if (show) setList((l) => (l ? show(l) : l));
    try {
      const l = await api.change(c);
      setList(l);
      store.setList(l);
      setListError(null);
    } catch (e) {
      if (e instanceof AuthError) return;
      setListError(errorText(e));
      refreshList();
    }
  }
  const act: ListActions = {
    add: (text, filing) => change({ op: "add", text, by: me, ...filing }),
    check: (it, checked) => change({ op: "check", id: it.id, checked }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, checked } : x)) })),
    move: (it, to) => change({ op: "move", id: it.id, ...to }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, ...to } : x)) })),
    remove: (it) => change({ op: "remove", id: it.id }, (l) => ({ ...l, items: l.items.filter((x) => x.id !== it.id) })),
    need: (it) => change({ op: "need", id: it.id }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, check: false } : x)) })),
    have: () => change({ op: "have" }, (l) => ({ ...l, items: l.items.filter((x) => !(x.check && !x.checked)) })),
    swapFor: (forWhat) => {
      // "Tuesday's turkey chili" → that night, in the weeks planned.
      const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      onTab("week");
      for (const w of weeks) {
        const n = w?.nights.find((x) => x.date >= dateIn(0) && x.meal && forWhat.toLowerCase().includes(`${dayName(x.date)}'s ${(recipeOf(x.meal)?.name ?? x.meal).toLowerCase()}`.toLowerCase()));
        if (w && n) { setNightAt({ monday: w.monday, date: n.date }); return; }
      }
    },
    freeze: (text) => api.freezer({ op: "add", text }).then(setKitchen, failed(setListError)),
    takeOut: (f) => {
      setKitchen((k) => k && { ...k, freezer: k.freezer.flatMap((x) => (x.id !== f.id ? [x] : Number(x.amount) > 1 ? [{ ...x, amount: String(Number(x.amount) - 1) }] : [])) });
      api.freezer({ op: "use", id: f.id }).then(setKitchen, failed(setListError));
    },
    done: (s) => change({ op: "done", store: s }, (l) => ({ ...l, items: l.items.filter((x) => !(x.store === s && x.checked)) })).then(() => api.kitchen().then(setKitchen, () => {})),
  };

  // Boot reads browser-only state (localStorage), which only exists after mount.
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    applyTheme(store.theme()); // layout.tsx already set it; this also matches the browser bar color
    // When the connection comes back after opening offline, load the household.
    const on = () => { if (!loaded.current && store.passcode()) loadHousehold(); };
    window.addEventListener("online", on);
    // Started from a microtask: the first screen comes from storage and the network, not from this effect directly.
    const resume = takeResume();
    queueMicrotask(async () => {
      if (framed() && !store.passcode()) await passcodeFromPanel();
      if (!store.passcode()) setPhase("passcode");
      else loadHousehold().then((ok) => {
        if (!ok) return;
        setStack([{ kind: resume }]);
        setPhase("app");
      });
    });
    return () => window.removeEventListener("online", on);
  }, [loadHousehold]);

  // A new version shipped while the app sat open (an iPhone can keep it in memory for days): when it's next brought to the
  // front on a screen at rest (a tab's first screen, or the passcode, with nothing open or typed), reload into the new
  // version and come back to the same tab.
  const here = useRef({ resting: false, root: "week" as Tab });
  useEffect(() => { here.current = { resting: phase === "passcode" || (phase === "app" && stack.length === 1), root: stack[0].kind as Tab }; }, [phase, stack]);
  useEffect(() => {
    let checked = 0;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - checked < 60_000) return;
      checked = Date.now();
      const build = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build as string, () => "");
      if (!build || build === process.env.NEXT_PUBLIC_BUILD || !here.current.resting || !atRest()) return;
      saveResume(here.current.root);
      window.location.reload();
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);

  // A recipe that's gone (removed in the Sheet by hand) closes, back to the screen below.
  const gone = top.kind === "recipe" && !open && recipes !== null;
  useEffect(() => { if (gone) queueMicrotask(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st))); }, [gone]);

  function onTab(t: Tab) {
    setError(null);
    scrollAppTo(0);
    setVisit((v) => v + 1);
    setStack([{ kind: t }]);
    setShopAt(null);
  }
  /** Shop's Find, on a list item when there's one. */
  function openFind(id?: string) {
    onTab("shop");
    setShopAt(id ?? null);
  }
  function back() {
    scrollAppTo(0);
    setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
  }
  /** A recipe's page, on top of where you are; from a recipe, it takes that recipe's place. */
  function openRecipe(id: string) {
    if (!recipeOf(id) || (top.kind === "recipe" && top.id === id)) return;
    scrollAppTo(0);
    setStack((st) => [...(st[st.length - 1].kind === "recipe" ? st.slice(0, -1) : st), { kind: "recipe", id }]);
  }
  const below = stack[stack.length - 2];
  const backLabel = !below ? "Back" : below.kind === "recipe" ? recipeOf(below.id)?.name ?? "Back" : TAB_NAMES[below.kind];
  const tonight = week?.nights.find((x) => x.date === dateIn(0));

  return (
    <div id="scroller" className="h-full overflow-y-auto overscroll-y-contain">
    <main className="mx-auto min-h-[calc(100%+1px)] w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      {phase === "boot" && <Splash />}
      {phase === "passcode" && (
        <PasscodeScreen error={error} onDone={async (code) => {
          setError(null);
          store.setPasscode(code);
          if (await loadHousehold()) { setStack([{ kind: "week" }]); setPhase("app"); }
        }} />
      )}
      <OpenSettings.Provider value={phase === "app" ? () => setSettings(true) : null}>
      {phase === "app" && top.kind === "week" && (
        <WeekScreen key={visit} weeks={weeks} recipes={recipes ?? []} me={me} error={error ?? weekError} note={weekNote} onNote={() => setWeekNote(null)}
          onPlan={(w) => setPlanningFor(w.monday)} onNight={(w, n) => setNightAt({ monday: w.monday, date: n.date })} onMade={made} onOpen={openRecipe} />
      )}
      {phase === "app" && top.kind === "list" && <ListScreen key={visit} list={list} kitchen={kitchen} error={error ?? listError} act={act} onFind={openFind} />}
      {phase === "app" && top.kind === "shop" && <ShopScreen key={visit} list={list} error={error ?? listError} act={act} startAt={shopAt} onList={() => onTab("list")} />}
      {phase === "app" && top.kind === "recipes" && (
        <RecipesScreen key={visit} freezer={kitchen?.freezer ?? week?.freezer ?? []} recipes={recipes} error={error ?? recipesError}
          onOpen={(r) => openRecipe(r.id)} onAdd={() => setSheet("add")} />
      )}
      {phase === "app" && open && (
        <RecipeScreen key={open.id} r={open} error={error ?? recipesError} onBack={back} backLabel={backLabel} onEdit={() => setSheet("edit")}
          onEffort={(e) => setEffort(open, e)} onActive={(a) => setActive(open, a)} onAddToList={() => setSheet("tolist")}
          tonight={tonight && (tonight.meal === open.id || tonight.kidsMeal === open.id) ? { made: tonight.made === "yes" } : undefined}
          onMade={() => made(dateIn(0), true)} />
      )}
      </OpenSettings.Provider>
      {planning && <PlanSheet key={planning.monday} w={planning} recipes={recipes ?? []} me={me} onSave={saveWeek} onClose={() => setPlanningFor(null)} />}
      {night && nightWeek && (
        <NightSheet key={`${nightWeek.monday}|${night.date}`} w={nightWeek} n={night} recipes={recipes ?? []} onSave={(nights) => saveWeek(nights, nightWeek.lunches)}
          onOpen={openRecipe} onClose={() => setNightAt(null)} />
      )}
      {sheet === "add" && <AddRecipesSheet recipes={recipes ?? []} onClose={() => setSheet(null)} onSaved={(all, saved) => {
        gotRecipes(all);
        setSheet(null);
        if (saved.length === 1) { const id = saved[0]; scrollAppTo(0); setStack((st) => [...(st[st.length - 1].kind === "recipe" ? st.slice(0, -1) : st), { kind: "recipe", id }]); }
        else onTab("recipes"); // several saved (her meal ideas): show the whole collection, where they now are
      }} />}
      {sheet === "edit" && open && <EditSheet key={open.id} r={open} onSave={saveEdit} onClose={() => setSheet(null)} />}
      {sheet === "tolist" && open && <AddToListSheet key={open.id} r={open} onAdd={(items) => addToList(open, items)} onClose={() => setSheet(null)} />}
      {settings && (
        <SettingsSheet theme={theme} onTheme={(t) => { setTheme(t); store.setTheme(t); }} onAddRecipes={() => { setSettings(false); setSheet("add"); }} onClose={() => setSettings(false)}
          people={people} me={me} onMe={(n) => { setMe(n); store.setMe(n); }} />
      )}
      {phase === "app" && (
        <TabBar tabs={TABS} active={root} onTab={onTab} />
      )}
    </main>
    </div>
  );
}
