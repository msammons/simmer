"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, applyTheme, AuthError, errorText, store, type Draft, type Effort, type Ingredient, type ListState, type Person, type Recipe, type Theme } from "@/lib/client";
import { PasscodeScreen } from "./PasscodeScreen";
import { LoadingScreen, type WaitKind } from "./LoadingScreen";
import { SettingsSheet } from "./Settings";
import { GroceriesScreen, type ListActions } from "./Groceries";
import { WeekScreen } from "./Screens";
import { AddRecipesSheet, AddToListSheet, EditSheet, RecipeScreen, SearchScreen } from "./Recipes";
import { Splash, TabBar, type TabDef } from "./ui";

type Tab = "week" | "groceries";
type View = "boot" | "passcode" | "loading" | Tab | "search" | "recipe";
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
  const [me, setMe] = useState(() => (browser ? store.me() : ""));
  const [waitKind, setWaitKind] = useState<WaitKind>("week");
  const [searchText, setSearchText] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [recipes, setRecipes] = useState<Recipe[] | null>(() => (browser ? store.recipes() : null)); // last time's, for opening offline
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"add" | "edit" | "tolist" | null>(null);
  const [lastTab, setLastTab] = useState<Tab>("week"); // where the collapsed tab button in Search goes back to
  const loaded = useRef(false); // the household has loaded from the server this session
  const inflight = useRef<AbortController | null>(null); // the wait on the loading screen, so Cancel can stop it
  const cancelTo = useRef<View>("week");

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
  const inRecipes = view === "search" || view === "recipe";
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
    done: (s) => change({ op: "done", store: s }, (l) => ({ ...l, items: l.items.filter((x) => !(x.store === s && x.checked)) })),
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
  // front on a screen at rest, reload into the new version and come back to the same screen. Mid-wait it waits for next time.
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

  /**
   * Runs a slow request behind the loading screen: one at a time (a double tap starts one), with Cancel going back to
   * `back`, and a late answer after Cancel ignored. Records how long it took for next time's estimate.
   */
  async function wait<T>(kind: WaitKind, back: View, work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    if (inflight.current) return null;
    const ctl = new AbortController();
    inflight.current = ctl;
    cancelTo.current = back;
    setError(null);
    setWaitKind(kind);
    setView("loading");
    const t0 = Date.now();
    try {
      const res = await work(ctl.signal);
      store.addWait(kind, (Date.now() - t0) / 1000);
      return res;
    } catch (e) {
      if (ctl.signal.aborted) return null;
      if (e instanceof AuthError) { store.setPasscode(null); setError(e.message); setView("passcode"); return null; }
      setError(errorText(e));
      setView(back);
      return null;
    } finally {
      if (inflight.current === ctl) inflight.current = null;
    }
  }
  void wait; // used by the first real feature (e.g. planning the week)

  function cancelWait() {
    inflight.current?.abort();
    inflight.current = null;
    setView(cancelTo.current);
  }

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
      {view === "loading" && <LoadingScreen key={waitKind} kind={waitKind} onCancel={cancelWait} />}
      {view === "week" && <WeekScreen people={people} error={error} onSettings={() => setSettings(true)} />}
      {view === "groceries" && <GroceriesScreen list={list} error={listError} act={act} onSettings={() => setSettings(true)} />}
      {view === "search" && <SearchScreen recipes={recipes} query={searchText} recent={recent} error={recipesError} onSearch={search} onOpen={openRecipe} onAdd={() => setSheet("add")} />}
      {view === "recipe" && open && (
        <RecipeScreen r={open} onBack={() => { setView("search"); }} onEdit={() => setSheet("edit")} onEffort={(e) => setEffort(open, e)} onActive={(a) => setActive(open, a)} onAddToList={() => setSheet("tolist")} />
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
