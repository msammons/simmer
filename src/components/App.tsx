"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, applyTheme, AuthError, dateIn, errorText, store, type Draft, type Effort, type Ingredient, type ListState, type Lunch, type Night, type Person, type Kitchen, type Recipe, type Theme, type WeekData } from "@/lib/client";
import { addDays } from "@/lib/time";
import { weekOf } from "@/lib/week";
import { PasscodeScreen } from "./PasscodeScreen";
import { SettingsSheet } from "./Settings";
import { GroceriesScreen, type ListActions } from "./Groceries";
import { NightSheet, PlanSheet, WeekScreen } from "./Week";
import { AddRecipesSheet, AddToListSheet, EditSheet, RecipeScreen, SearchScreen } from "./Recipes";
import { Notice, Splash, TabBar, type TabDef } from "./ui";

type Tab = "week" | "groceries";
type View = "boot" | "passcode" | Tab | "search" | "recipe";
const TABS: [TabDef<Tab>, TabDef<Tab>] = [{ id: "week", label: "This week", icon: "calendar" }, { id: "groceries", label: "Groceries", icon: "list" }];
/** Screens at rest: an update can reload the app on these without losing anything (see the update check below). */
const RESTING: View[] = ["passcode", "week", "groceries", "search", "recipe"];

/** Where to pick up after reloading into a new version (this tab only). */
const saveResume = (view: View) => { try { sessionStorage.setItem("sm.resume", view); } catch {} };
function takeResume(): View | null {
  try { const v = sessionStorage.getItem("sm.resume") as View | null; sessionStorage.removeItem("sm.resume"); return v; } catch { return null; }
}

export default function App() {
  const [view, setView] = useState<View>("boot");
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
  const [searchText, setSearchText] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<Recipe[] | null>(() => (browser ? store.recipes() : null)); // last time's, for opening offline
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"add" | "edit" | "tolist" | null>(null);
  const [week, setWeek] = useState<WeekData | null>(() => (browser ? store.week() : null)); // last time's, for opening offline
  const [next, setNext] = useState<WeekData | null>(null);
  const [weekError, setWeekError] = useState<string | null>(null);
  const [planning, setPlanning] = useState<WeekData | null>(null);
  const [night, setNight] = useState<{ w: WeekData; n: Night } | null>(null);
  const [lastTab, setLastTab] = useState<Tab>("week"); // where the collapsed tab button in Search goes back to
  const loaded = useRef(false); // the household has loaded from the server this session

  const loadHousehold = useCallback(async () => {
    try {
      const h = await api.household();
      loaded.current = true;
      setPeople(h.people);
      store.setPeople(h.people);
      setError(h.stale ? "Couldn't refresh, so this uses the last copy." : null);
      return true;
    } catch (e) {
      if (e instanceof AuthError) { store.setPasscode(null); setError(e.message); setView("passcode"); return false; }
      setPeople(store.people() ?? []);
      setError(errorText(e));
      return true;
    }
  }, []);

  // The shared list: loaded when Groceries opens, then every 30 seconds while it's open and whenever the app comes back to
  // the front, so both phones see the same list. No background work: only while someone's looking.
  const refreshList = useCallback(async () => {
    try {
      const l = await api.list();
      setList(l);
      store.setList(l);
      setListError(null);
    } catch (e) {
      if (e instanceof AuthError) { store.setPasscode(null); setError(e.message); setView("passcode"); return; }
      setListError(errorText(e));
    }
  }, []);
  useEffect(() => {
    if (view !== "groceries") return;
    queueMicrotask(refreshList);
    api.kitchen().then(setKitchen, () => {});
    const visible = () => document.visibilityState === "visible";
    const t = setInterval(() => { if (visible()) refreshList(); }, 30_000);
    const back = () => { if (visible()) refreshList(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [view, refreshList]);

  // The collection: loaded when Search opens (it's small), and after every change, from the server's answer.
  const gotRecipes = useCallback((r: Recipe[]) => { setRecipes(r); store.setRecipes(r); setRecipesError(null); }, []);
  const refreshRecipes = useCallback(async () => {
    try { gotRecipes((await api.recipes()).recipes); }
    catch (e) {
      if (e instanceof AuthError) { store.setPasscode(null); setError(e.message); setView("passcode"); return; }
      setRecipesError(errorText(e));
    }
  }, [gotRecipes]);
  const inRecipes = view === "search" || view === "recipe" || view === "week"; // the week shows meal names
  useEffect(() => { if (inRecipes) queueMicrotask(refreshRecipes); }, [inRecipes, refreshRecipes]);
  const open = recipes?.find((r) => r.id === openId) ?? null;
  async function recipeChange(c: Parameters<typeof api.recipeChange>[0], show: (r: Recipe) => Recipe) {
    setRecipes((rs) => rs && rs.map((r) => (r.id === c.id ? show(r) : r)));
    try { gotRecipes((await api.recipeChange(c)).recipes); }
    catch (e) { setRecipesError(errorText(e)); refreshRecipes(); }
  }
  const setEffort = (r: Recipe, effort: Effort) => recipeChange({ op: "effort", id: r.id, effort }, (x) => ({ ...x, effort }));
  const setActive = (r: Recipe, active: boolean) => recipeChange({ op: "active", id: r.id, active }, (x) => ({ ...x, active }));
  async function saveEdit(d: Draft) {
    try { gotRecipes((await api.saveRecipes([d])).recipes); setSheet(null); }
    catch (e) { setRecipesError(errorText(e)); setSheet(null); }
  }
  function addToList(r: Recipe, items: Ingredient[]) {
    change({ op: "many", items: items.map((i) => ({ item: i.item, quantity: [i.quantity, i.unit].filter(Boolean).join(" ") })), for: r.name, by: me });
  }
  // The week: this one, and next week from Saturday on (for "Plan next week").
  const refreshWeek = useCallback(async () => {
    try {
      const today = dateIn(0);
      const [w, n] = await Promise.all([api.week(today), [6, 0].includes(new Date(`${today}T12:00:00Z`).getUTCDay()) ? api.week(addDays(weekOf(today), 7)) : Promise.resolve(null)]);
      setWeek(w); store.setWeek(w); setNext(n); setWeekError(null);
    } catch (e) {
      if (e instanceof AuthError) { store.setPasscode(null); setError(e.message); setView("passcode"); return; }
      setWeekError(errorText(e));
    }
  }, []);
  useEffect(() => { if (view === "week") queueMicrotask(refreshWeek); }, [view, refreshWeek]);
  /** A saved week comes back from the server as it is now; it replaces this week or next, whichever it is. */
  function gotWeek(w: WeekData) {
    if (week && w.monday === week.monday) { setWeek(w); store.setWeek(w); }
    else if (w.monday === weekOf(dateIn(0))) { setWeek(w); store.setWeek(w); }
    else setNext(w);
  }
  async function saveWeek(nights: Night[], lunches: Lunch[]) {
    try {
      const w = await api.saveWeek(nights, lunches, me);
      gotWeek(w);
      setPlanning(null);
      setWeekError(null);
      setWeekNote(w.added ? `Added ${w.added} thing${w.added === 1 ? "" : "s"} to the grocery list.` : null);
    } catch (e) { setWeekError(errorText(e)); setPlanning(null); }
  }
  const [weekNote, setWeekNote] = useState<string | null>(null);
  async function made(date: string, yes: boolean) {
    setWeek((w) => w && { ...w, nights: w.nights.map((n) => (n.date === date ? { ...n, made: yes ? "yes" : "no" } : n)), lastWeek: w.lastWeek.map((n) => (n.date === date ? { ...n, made: yes ? "yes" : "no" } : n)) });
    try { const w = await api.made(date, yes); if (w.monday === week?.monday) gotWeek(w); else refreshWeek(); }
    catch (e) { setWeekError(errorText(e)); }
  }
  function openRecipe(r: Recipe) { setOpenId(r.id); setView("recipe"); window.scrollTo(0, 0); }

  /** A change to the list: shown at once, then sent; the answer is the list as it is now (anyone else's changes too). */
  async function change(c: Parameters<typeof api.change>[0], show?: (l: ListState) => ListState) {
    if (show) setList((l) => (l ? show(l) : l));
    try {
      const l = await api.change(c);
      setList(l);
      store.setList(l);
      setListError(null);
    } catch (e) {
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
      // "Tuesday's turkey chili" → that night, in this week or next.
      const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      for (const w of [week, next]) {
        const n = w?.nights.find((x) => x.date >= dateIn(0) && x.meal && forWhat.toLowerCase().includes(`${dayName(x.date)}'s ${(recipes?.find((r) => r.id === x.meal)?.name ?? x.meal).toLowerCase()}`.toLowerCase()));
        if (w && n) { setView("week"); setLastTab("week"); setNight({ w, n }); return; }
      }
      setView("week"); setLastTab("week");
    },
    freeze: (text) => api.freezer({ op: "add", text }).then(setKitchen, (e) => setListError(errorText(e))),
    takeOut: (f) => {
      setKitchen((k) => k && { ...k, freezer: k.freezer.flatMap((x) => (x.id !== f.id ? [x] : Number(x.amount) > 1 ? [{ ...x, amount: String(Number(x.amount) - 1) }] : [])) });
      api.freezer({ op: "use", id: f.id }).then(setKitchen, (e) => setListError(errorText(e)));
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
    queueMicrotask(() => {
      if (!store.passcode()) setView("passcode");
      else loadHousehold().then((ok) => {
        if (!ok) return;
        const v = resume && resume !== "passcode" && RESTING.includes(resume) ? resume : "week";
        if (v === "week" || v === "groceries") setLastTab(v);
        setView(v);
      });
    });
    return () => window.removeEventListener("online", on);
  }, [loadHousehold]);

  // A new version shipped while the app sat open (an iPhone can keep it in memory for days): when it's next brought to the
  // front on a screen at rest, reload into the new version and come back to the same screen.
  const here = useRef(view);
  useEffect(() => { here.current = view; }, [view]);
  useEffect(() => {
    let checked = 0;
    const check = async () => {
      if (document.visibilityState !== "visible" || Date.now() - checked < 60_000) return;
      checked = Date.now();
      const build = await fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build as string, () => "");
      if (!build || build === process.env.NEXT_PUBLIC_BUILD || !RESTING.includes(here.current)) return;
      saveResume(here.current);
      window.location.reload();
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);



  const tab = view === "week" || view === "groceries" ? view : view === "search" ? "search" : null;
  // A recipe that's gone (removed in the Sheet by hand, or a stale resume) goes back to Search.
  const gone = view === "recipe" && !open && recipes !== null;
  useEffect(() => { if (gone) queueMicrotask(() => setView("search")); }, [gone]);
  function onTab(t: Tab | "search") {
    setError(null);
    window.scrollTo(0, 0);
    if (t !== "search") setLastTab(t);
    setView(t);
  }
  function search(q: string) {
    setSearchText(q);
    setRecent((r) => [q, ...r.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6));
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      {view === "boot" && <Splash />}
      {view === "passcode" && (
        <PasscodeScreen error={error} onDone={async (code) => {
          setError(null);
          store.setPasscode(code);
          if (await loadHousehold()) setView("week");
        }} />
      )}
      {view === "week" && (
        <>
          {weekNote && <div className="mb-4"><Notice tone="info" onClick={() => setWeekNote(null)}>{weekNote}</Notice></div>}
          <WeekScreen week={week} next={next} recipes={recipes ?? []} error={error ?? weekError} onSettings={() => setSettings(true)}
            onPlan={setPlanning} onNight={(w, n) => setNight({ w, n })} onMade={made}
            onOpen={(id) => { const r = recipes?.find((x) => x.id === id); if (r) openRecipe(r); }} />
        </>
      )}
      {planning && <PlanSheet w={planning} recipes={recipes ?? []} me={me} onSave={saveWeek} onClose={() => setPlanning(null)} />}
      {night && <NightSheet w={night.w} n={night.n} recipes={recipes ?? []} onSave={(nights) => saveWeek(nights, night.w.lunches)}
        onOpen={(id) => { const r = recipes?.find((x) => x.id === id); if (r) openRecipe(r); }} onClose={() => setNight(null)} />}
      {view === "groceries" && <GroceriesScreen list={list} kitchen={kitchen} error={listError} act={act} onSettings={() => setSettings(true)} />}
      {view === "search" && <SearchScreen freezer={kitchen?.freezer ?? week?.freezer ?? []} recipes={recipes} query={searchText} recent={recent} error={recipesError} onSearch={search} onOpen={openRecipe} onAdd={() => setSheet("add")} />}
      {view === "recipe" && open && (
        <RecipeScreen r={open} onBack={() => { setView("search"); }} onEdit={() => setSheet("edit")} onEffort={(e) => setEffort(open, e)} onActive={(a) => setActive(open, a)} onAddToList={() => setSheet("tolist")}
          tonight={(() => { const n = week?.nights.find((x) => x.date === dateIn(0)); return n && (n.meal === open.id || n.kidsMeal === open.id) ? { made: n.made === "yes" } : undefined; })()}
          onMade={() => made(dateIn(0), true)} />
      )}
      {sheet === "add" && <AddRecipesSheet recipes={recipes ?? []} onClose={() => setSheet(null)} onSaved={(all, saved) => {
        gotRecipes(all);
        setSheet(null);
        if (saved.length === 1) { setOpenId(saved[0]); setView("recipe"); window.scrollTo(0, 0); }
        else setSearchText(""); // several saved (her meal ideas): show the whole collection, where they now are
      }} />}
      {sheet === "edit" && open && <EditSheet r={open} onSave={saveEdit} onClose={() => setSheet(null)} />}
      {sheet === "tolist" && open && <AddToListSheet r={open} onAdd={(items) => addToList(open, items)} onClose={() => setSheet(null)} />}
      {settings && <SettingsSheet theme={theme} onTheme={(t) => { setTheme(t); store.setTheme(t); }} onClose={() => setSettings(false)} people={people} me={me} onMe={(n) => { setMe(n); store.setMe(n); }} />}
      {tab && (
        <TabBar
          tabs={TABS}
          active={tab}
          previous={lastTab}
          onTab={onTab}
          query={searchText}
          onQuery={setSearchText}
          onSubmit={search}
          searchLabel="Search recipes"
          searchPlaceholder="Find a recipe"
        />
      )}
    </main>
  );
}
