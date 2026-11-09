"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityScreen, PhoneNote, usePanelActivity } from "./Activity";
import { api, applyTheme, AuthError, errorText, framed, passcodeFromPanel, SIGNED_OUT, store, tellPanelSignedOut, type Draft, type Ingredient, type Counts, type ListState, type NewDish, type Person, type Kitchen, type PlanChange, type PlanData, type Recipe, type Theme } from "@/lib/client";
import { PasscodeScreen } from "./PasscodeScreen";
import { SettingsSheet } from "./Settings";
import { STORE_NAMES } from "./Shop";
import { norm } from "@/lib/words";
import { ListsScreen, type ListsActions, type Where } from "./Lists";
import { StockScreen, type StockActions } from "./Stock";
import { AddOneSheet, MealsScreen, PlanSheet } from "./Week";
import { AddRecipesSheet, AddToListSheet, EditSheet, RecipeScreen, RecipesScreen } from "./Recipes";
import { OpenSettings, Splash, TabBar, type TabDef, scrollAppTo } from "./ui";

type Tab = "recipes" | "week" | "stock" | "lists";
/**
 * Where you are: a tab at the bottom of a stack of screens opened from it (a recipe). Back pops one; a tab starts a new
 * stack. The tab lit is the stack's first; the back button names the screen below.
 */
type Screen = { kind: Tab } | { kind: "recipe"; id: string };
// Recipes · Meals · Stock · Lists (Matt, Nov 2); Simmer still opens on Meals (Oct 31).
const TABS: TabDef<Tab>[] = [{ id: "recipes", label: "Recipes", icon: "book" }, { id: "week", label: "Meals", icon: "pot" }, { id: "stock", label: "Stock", icon: "home" }, { id: "lists", label: "Lists", icon: "list" }];
const TAB_NAMES: Record<Tab, string> = { recipes: "Recipes", week: "Meals", stock: "Stock", lists: "Lists" };
const isTab = (v: unknown): v is Tab => typeof v === "string" && Object.hasOwn(TAB_NAMES, v);

/** Where to pick up after reloading into a new version (this tab only). */
const saveResume = (root: Tab) => { try { sessionStorage.setItem("sm.resume", root); } catch {} };
/** The first screen, and whether it's the one the address asked for (not a resume after reloading). */
function takeResume(): { tab: Tab; asked: boolean } {
  // The Safeway helper's panel opens Simmer on Shop (?open=shop): Lists, on Safeway.
  const open = typeof location !== "undefined" ? new URLSearchParams(location.search).get("open") : null;
  const asked = open === "shop" ? "lists" : open;
  const first = { tab: isTab(asked) ? asked : "week" as Tab, asked: isTab(asked) };
  try { const v = sessionStorage.getItem("sm.resume"); sessionStorage.removeItem("sm.resume"); return isTab(v) ? { tab: v, asked: false } : first; } catch { return first; }
}
/** Nothing would be lost by reloading now: no sheet open (the panel's activity log doesn't count) and nothing typed. */
const atRest = () => !document.querySelector('[role="dialog"]:not([data-at-rest])')
  && ![...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].some((el) => el.value);

export default function App() {
  const [phase, setPhase] = useState<"boot" | "passcode" | "app">("boot");
  const [stack, setStack] = useState<Screen[]>([{ kind: "week" }]); // Simmer opens on Meals (Matt, Oct 31)
  const top = stack[stack.length - 1];
  const root = stack[0].kind as Tab;
  const [visit, setVisit] = useState(0); // a new one each tab tap, so the tab's screen opens fresh
  const [listsStart, setListsStart] = useState<Where>("all"); // the store Lists opens on: Safeway in the helper's panel
  // Browser-only state read on the first client render; the server renders only the splash, so nothing mismatches.
  const browser = typeof window !== "undefined";
  const [, setPeople] = useState<Person[]>(() => (browser ? store.people() ?? [] : [])); // last time's; only Settings read it, until "Who's using this?" went (Nov 3)
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (browser ? store.theme() : "simmer"));
  const [settings, setSettings] = useState(false);
  const [list, setList] = useState<ListState | null>(() => (browser ? store.list() : null)); // last time's, for opening offline
  const [listError, setListError] = useState<string | null>(null);
  const [kitchen, setKitchen] = useState<Kitchen | null>(null);
  const me = ""; // "Who's using this?" is gone (Nov 3); added-by stays blank
  const [recipes, setRecipes] = useState<Recipe[] | null>(() => (browser ? store.recipes() : null)); // last time's, for opening offline
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"add" | "edit" | "tolist" | null>(null);
  const [listing, setListing] = useState<string | null>(null); // the recipe going on the list from the Recipes tab
  // What's still to make and pack: last time's at first, for opening offline.
  const [plan, setPlan] = useState<PlanData | null>(() => (browser ? store.plan() : null));
  const [weekError, setWeekError] = useState<string | null>(null);
  const [weekNote, setWeekNote] = useState<string | null>(null);
  // The dinner sheet names its dinner rather than holding a copy, so it shows the plan as it is now.
  const [planning, setPlanning] = useState(false);
  const [addingOne, setAddingOne] = useState(false);
  const loaded = useRef(false); // the household has loaded from the server this session

  // The passcode was turned down (changed, or typed wrong): close everything and ask for it again. Any request can find
  // out, including ones running in the background, so the client announces it and this listens.
  const signOut = useCallback(() => {
    store.setPasscode(null);
    tellPanelSignedOut();
    setError("Wrong passcode.");
    setSettings(false); setSheet(null); setPlanning(false); setAddingOne(false);
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
  // Each change counts up; a refresh that started before the latest change is older than what's showing, so it's dropped
  // (otherwise a poll answering just after a tap would undo the tap on screen until the change's own answer came).
  const listChanges = useRef(0);
  const lastAnswer = useRef<ListState | null>(null); // the latest answer to a change (for "Added 4 to Safeway")
  const refreshList = useCallback(async () => {
    const at = listChanges.current;
    try {
      const l = await api.list();
      if (at !== listChanges.current) return;
      setList(l);
      store.setList(l);
      setListError(null);
    } catch (e) {
      if (!(e instanceof AuthError)) setListError(errorText(e));
    }
  }, []);
  const onShop = phase === "app" && (top.kind === "lists" || top.kind === "stock");
  useEffect(() => {
    if (!onShop) return;
    queueMicrotask(refreshList);
    if (top.kind === "stock") api.kitchen().then(setKitchen, () => {}); // the freezer: only Stock shows it
    const visible = () => document.visibilityState === "visible";
    const t = setInterval(() => { if (visible()) refreshList(); }, 30_000);
    const back = () => { if (visible()) refreshList(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- top.kind only decides the one kitchen read; onShop and visit restart it
  }, [onShop, visit, refreshList]);

  // The collection: loaded when Recipes, a recipe or the week opens (the week shows meal names), and after every change,
  // from the server's answer.
  const gotRecipes = useCallback((r: Recipe[]) => { setRecipes(r); store.setRecipes(r); setRecipesError(null); }, []);
  const refreshRecipes = useCallback(async () => {
    try { gotRecipes((await api.recipes()).recipes); }
    catch (e) { if (!(e instanceof AuthError)) setRecipesError(errorText(e)); }
  }, [gotRecipes]);
  const inRecipes = phase === "app" && top.kind !== "lists" && top.kind !== "stock";
  useEffect(() => { if (inRecipes) queueMicrotask(refreshRecipes); }, [inRecipes, visit, refreshRecipes]);
  const recipeOf = (id: string) => recipes?.find((r) => r.id === id) ?? null;
  const open = top.kind === "recipe" ? recipeOf(top.id) : null;
  const toList = open ?? (listing ? recipeOf(listing) : null); // the add-to-list sheet's recipe: the page you're on, or a row on Recipes
  async function recipeChange(c: Parameters<typeof api.recipeChange>[0], show: (r: Recipe) => Recipe) {
    setRecipes((rs) => rs && rs.map((r) => (r.id === c.id ? show(r) : r)));
    try { gotRecipes((await api.recipeChange(c)).recipes); }
    catch (e) { failed(setRecipesError)(e); refreshRecipes(); }
  }
  const setActive = (r: Recipe, active: boolean) => recipeChange({ op: "active", id: r.id, active }, (x) => ({ ...x, active }));
  // Saves from a sheet answer with the problem, if any, so the sheet stays open with what was entered and says what went
  // wrong; on success (null) the sheet closes itself. A turned-down passcode has already closed everything, so it answers null.
  const problemOf = (e: unknown) => (e instanceof AuthError ? null : errorText(e));
  async function saveEdit(d: Draft): Promise<string | null> {
    try { gotRecipes((await api.saveRecipes([d])).recipes); }
    catch (e) { return problemOf(e); }
    return null;
  }
  // Fresh things go on the list; the pantry things go with `check`, highlighted in Stock (Nov 3). The note says where the fresh ones landed.
  async function addToList(r: Recipe, buy: Ingredient[], pantry: Ingredient[]): Promise<{ problem: string | null; note?: string }> {
    const line = (i: Ingredient, check: boolean) => ({ item: i.item, quantity: [i.quantity, i.unit].filter(Boolean).join(" "), ...(check && { check }) });
    const problem = await change({ op: "many", items: [...buy.map((i) => line(i, false)), ...pantry.map((i) => line(i, true))], for: r.name, by: me });
    if (problem) return { problem };
    const names = new Set(buy.map((i) => norm(i.item)));
    const landed = (lastAnswer.current?.items ?? []).filter((x) => !x.check && !x.checked && names.has(norm(x.item)));
    const stores = [...new Set(landed.map((x) => x.store))];
    if (!landed.length) return { problem: null };
    return { problem: null, note: `Added ${landed.length} to ${stores.length === 1 ? STORE_NAMES[stores[0]] : "the list"}` };
  }

  // What's planned: loaded when Meals opens and whenever the app comes back to the front. Each change counts up, so an
  // answer that started before one of them doesn't put the old plan back.
  const planChanges = useRef(0);
  const refreshPlan = useCallback(async () => {
    const at = ++planChanges.current;
    try {
      const p = await api.plan();
      if (at !== planChanges.current) return;
      setPlan(p); store.setPlan(p); setWeekError(null);
    } catch (e) {
      if (!(e instanceof AuthError)) setWeekError(errorText(e));
    }
  }, []);
  const onWeek = phase === "app" && top.kind === "week";
  useEffect(() => {
    if (!onWeek) return;
    queueMicrotask(refreshPlan);
    // Brought back to the front (an iPhone keeps the app open for days): the plan as it is now.
    const back = () => { if (document.visibilityState === "visible") refreshPlan(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [onWeek, visit, refreshPlan]);
  /** The plan as the server answered it, and a note for what went on the grocery list. */
  function gotPlan(p: PlanData & { added: number }) {
    setPlan(p); store.setPlan(p); setWeekError(null);
    setWeekNote(p.added ? `Added ${p.added} thing${p.added === 1 ? "" : "s"} to the grocery list.` : null);
    if (p.added) refreshList(); // the new things show on Lists and Stock right away
  }
  /** The next shop's dinners (the plan sheet, with counts) or one more for this week (no counts); the sheet closes itself
   * on success (null) and shows the problem otherwise. */
  async function savePlan(dishes: NewDish[], counts: Counts | null): Promise<string | null> {
    try {
      ++planChanges.current;
      gotPlan(await api.savePlan(dishes, [], counts, me));
      return null;
    } catch (e) { return problemOf(e); }
  }
  /** One planned thing changed. Made comes off at once, before the answer. */
  async function changePlan(c: PlanChange): Promise<string | null> {
    if (c.op === "made" || c.op === "remove") setPlan((p) => (p ? { ...p, dishes: p.dishes.filter((d) => d.id !== c.id), lunches: p.lunches.filter((l) => l.id !== c.id) } : p));
    try {
      ++planChanges.current;
      gotPlan(await api.planChange(c, me));
      return null;
    } catch (e) { refreshPlan(); return problemOf(e); }
  }

  /** A change to the list: shown at once, then sent; the answer is the list as it is now (anyone else's changes too). */
  async function change(c: Parameters<typeof api.change>[0], show?: (l: ListState) => ListState): Promise<string | null> {
    const mine = ++listChanges.current;
    if (show) setList((l) => (l ? show(l) : l));
    try {
      const l = await api.change(c);
      lastAnswer.current = l;
      if (mine !== listChanges.current) return null; // a later change's answer is newer
      setList(l);
      store.setList(l);
      setListError(null);
      return null;
    } catch (e) {
      if (e instanceof AuthError) return null;
      setListError(errorText(e));
      refreshList();
      return errorText(e);
    }
  }
  const lists: ListsActions = {
    add: (text, store) => change({ op: "add", text, by: me, ...(store && { store }) }),
    check: (it, checked) => change({ op: "check", id: it.id, checked }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, checked } : x)) })),
    move: (it, to) => change({ op: "move", id: it.id, store: to }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, store: to } : x)) })),
    done: (s, cart) => change({ op: "done", store: s, cart: Boolean(cart) }, (l) => ({ ...l, items: l.items.filter((x) => !(x.store === s && x.checked)) })),
    clear: async (ids) => {
      const mine = ++listChanges.current;
      setList((l) => l && { ...l, items: l.items.filter((x) => !ids.includes(x.id)) });
      try {
        const l = await api.change({ op: "clear", ids });
        if (mine === listChanges.current) { setList(l); store.setList(l); setListError(null); }
        return l.cleared ?? [];
      } catch (e) { failed(setListError)(e); refreshList(); return null; }
    },
    putBack: (items) => change({ op: "putBack", items }, (l) => ({ ...l, items: [...l.items, ...items.filter((x) => !l.items.some((y) => y.id === x.id))] })),
  };
  const stock: StockActions = {
    // The usual amount goes alongside, not in front: "1 loaf bread" filed as "loaf bread", which Stock never matched (Nov 3).
    out: (name, s, section, amount) => change({ op: "add", text: name, by: me, store: s, section, ...(amount && { amount }) }),
    have: (it) => change({ op: "remove", id: it.id }, (l) => ({ ...l, items: l.items.filter((x) => x.id !== it.id) })),
    need: (it) => change({ op: "need", id: it.id }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, check: false } : x)) })),
    takeOut: (f) => {
      setKitchen((k) => k && { ...k, freezer: k.freezer.flatMap((x) => (x.id !== f.id ? [x] : Number(x.amount) > 1 ? [{ ...x, amount: String(Number(x.amount) - 1) }] : [])) });
      api.freezer({ op: "use", id: f.id }).then(setKitchen, failed(setListError));
    },
    keepAdd: (text, section) => change({ op: "keepAdd", text, ...(section && { section }) }),
    keepMove: (item, section) => change({ op: "keepMove", item, section }, (l) => ({ ...l, staples: l.staples.map((x) => (x.item === item ? { ...x, section } : x)) })),
    keepWeekly: (item, weekly) => change({ op: "keepWeekly", item, weekly }, (l) => ({ ...l, staples: l.staples.map((x) => (x.item === item ? { ...x, weekly } : x)) })),
    keepRemove: (st) => change({ op: "keepRemove", item: st.item }, (l) => ({ ...l, staples: l.staples.filter((x) => x.item !== st.item) })),
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
        setStack([{ kind: resume.tab }]);
        // The helper's panel opens Lists on Safeway, the list that's also the cart.
        if (resume.asked && resume.tab === "lists") setListsStart("safeway");
        setPhase("app");
      });
    });
    return () => window.removeEventListener("online", on);
  }, [loadHousehold]);

  // A new version shipped while the app sat open (an iPhone can keep it in memory for days): when it's next brought to the
  // front (or, in the helper's panel, every few minutes) on a screen at rest (a tab's first screen, or the passcode, with nothing open or typed), reload into the new
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
    // The helper's panel can stay open for days without ever being hidden, so it also checks every few minutes.
    const every = framed() ? setInterval(check, 5 * 60_000) : undefined;
    return () => { document.removeEventListener("visibilitychange", check); clearInterval(every); };
  }, []);

  // A recipe that's gone (removed in the Sheet by hand) closes, back to the screen below.
  const gone = top.kind === "recipe" && !open && recipes !== null;
  useEffect(() => { if (gone) queueMicrotask(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st))); }, [gone]);

  function onTab(t: Tab) {
    setError(null);
    scrollAppTo(0);
    setVisit((v) => v + 1);
    setStack([{ kind: t }]);
    setListsStart("all");
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
  // In the helper's panel: the computer's work for the phone (components/Activity.tsx).
  const panel = usePanelActivity(phase === "app" && framed());

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
        <MealsScreen key={visit} plan={plan} recipes={recipes ?? []} error={error ?? weekError} note={weekNote} onNote={() => setWeekNote(null)}
          onPlan={() => setPlanning(true)} onOpen={(d) => openRecipe(d.recipe)} onAddOne={() => setAddingOne(true)}
          onRemove={(d) => { setWeekNote(null); changePlan({ op: "remove", id: d.id }).then((p) => { if (p) setWeekError(p); }); }} />
      )}
      {phase === "app" && top.kind === "stock" && <StockScreen key={visit} list={list} kitchen={kitchen} error={error ?? listError} act={stock} />}
      {phase === "app" && top.kind === "lists" && <ListsScreen key={visit} list={list} error={error ?? listError} act={lists} start={listsStart} />}
      {phase === "app" && top.kind === "recipes" && (
        <RecipesScreen key={visit} freezer={kitchen?.freezer ?? plan?.freezer ?? []} recipes={recipes} error={error ?? recipesError}
          onOpen={(r) => openRecipe(r.id)} onAdd={() => setSheet("add")} />
      )}
      {phase === "app" && open && (
        <RecipeScreen key={open.id} r={open} error={error ?? recipesError} onBack={back} backLabel={backLabel} onEdit={() => setSheet("edit")}
          onActive={(a) => setActive(open, a)} onAddToList={() => setSheet("tolist")} planned={Boolean(plan?.dishes.some((d) => d.recipe === open.id))} />
      )}
      </OpenSettings.Provider>
      {panel.log ? <ActivityScreen jobs={panel.jobs} onUse={panel.dismiss} /> : panel.phoneNow && <PhoneNote job={panel.phoneNow} onOpen={panel.open} />}
      {planning && plan && <PlanSheet plan={plan} recipes={recipes ?? []} onSave={savePlan} onClose={() => setPlanning(false)} />}
      {addingOne && plan && <AddOneSheet plan={plan} recipes={recipes ?? []} onAdd={(d) => savePlan(d, null)} onClose={() => setAddingOne(false)} />}
      {sheet === "add" && <AddRecipesSheet recipes={recipes ?? []} onClose={() => setSheet(null)} onSaved={(all, saved) => {
        gotRecipes(all);
        setSheet(null);
        if (saved.length === 1) { const id = saved[0]; scrollAppTo(0); setStack((st) => [...(st[st.length - 1].kind === "recipe" ? st.slice(0, -1) : st), { kind: "recipe", id }]); }
        else onTab("recipes"); // several saved (her meal ideas): show the whole collection, where they now are
      }} />}
      {sheet === "edit" && open && <EditSheet key={open.id} r={open} onSave={saveEdit} onClose={() => setSheet(null)} />}
      {sheet === "tolist" && toList && <AddToListSheet key={toList.id} r={toList} onAdd={(buy, pantry) => addToList(toList, buy, pantry)} onClose={() => { setSheet(null); setListing(null); }} />}
      {settings && (
        <SettingsSheet theme={theme} onTheme={(t) => { setTheme(t); store.setTheme(t); }} onClose={() => setSettings(false)} />
      )}
      {phase === "app" && (
        <TabBar tabs={TABS} active={root} onTab={onTab} />
      )}
    </main>
    </div>
  );
}
