"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityScreen, PhoneNote, usePanelActivity } from "./Activity";
import { api, applyTheme, AuthError, errorText, framed, passcodeFromPanel, SIGNED_OUT, store, tellPanelSignedOut, type Draft, type Ingredient, type Item, type Kind, type ListState, type NewDish, type Person, type Kitchen, type PlanChange, type PlanData, type Recipe, type Theme } from "@/lib/client";
import { PasscodeScreen } from "./PasscodeScreen";
import { SettingsSheet } from "./Settings";
import { ListsScreen, type ListsActions, type Where } from "./Lists";
import { StockScreen, type StockActions } from "./Stock";
import { AddMealSheet, MealsScreen } from "./Week";
import { kindOf } from "@/lib/week";
import { AddRecipesSheet, AddToListSheet, EditSheet, RecipeScreen, RecipesScreen } from "./Recipes";
import { Alert, OpenSettings, Splash, TabBar, type TabDef, scrollAppTo } from "./ui";

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

/**
 * A reload that doesn't ask again within a few seconds (Nov 11: tab visits, coming back to the app and polls asked for
 * the same things over and over): one already on its way, or one that just answered, is enough. Changes reload directly.
 */
function useSettled(fn: () => Promise<unknown>, ms = 5_000) {
  const last = useRef(0);
  const busy = useRef<Promise<unknown> | null>(null);
  return useCallback(() => {
    if (busy.current) return busy.current;
    if (Date.now() - last.current < ms) return Promise.resolve();
    const p = fn().finally(() => { last.current = Date.now(); busy.current = null; });
    busy.current = p;
    return p;
  }, [fn, ms]);
}

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
  const [passError, setPassError] = useState<string | null>(null); // the passcode screen's problem: a wrong passcode
  // One problem at a time, shown over the page as the shared alert until OK (Nov 11: no bars that move the page).
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (browser ? store.theme() : "simmer"));
  const [settings, setSettings] = useState(false);
  const [list, setList] = useState<ListState | null>(() => (browser ? store.list() : null)); // last time's, for opening offline
  const [kitchen, setKitchen] = useState<Kitchen | null>(null);
  const me = ""; // "Who's using this?" is gone (Nov 3); added-by stays blank
  const [recipes, setRecipes] = useState<Recipe[] | null>(() => (browser ? store.recipes() : null)); // last time's, for opening offline
  const [sheet, setSheet] = useState<"add" | "edit" | "tolist" | null>(null);
  const [listing, setListing] = useState<string | null>(null); // the recipe going on the list from the Recipes tab
  // What was entered in a sheet whose save failed, so it opens again as it was: Edit's draft, or Add to the list's ticks.
  const [retry, setRetry] = useState<{ edit?: Draft; ticks?: number[] } | null>(null);
  // What's still to make and pack: last time's at first, for opening offline.
  const [plan, setPlan] = useState<PlanData | null>(() => (browser ? store.plan() : null));
  // The dinner sheet names its dinner rather than holding a copy, so it shows the plan as it is now.
  const [addingOne, setAddingOne] = useState<Kind | null>(null); // the kind being added to, from Meals
  const loaded = useRef(false); // the household has loaded from the server this session
  // Whether each is showing something (last time's copy or fresh): a failed read then says nothing.
  const listShowing = useRef(false), recipesShowing = useRef(false), planShowing = useRef(false);
  useEffect(() => { listShowing.current = list !== null; recipesShowing.current = recipes !== null; planShowing.current = plan !== null; }, [list, recipes, plan]);

  // The passcode was turned down (changed, or typed wrong): close everything and ask for it again. Any request can find
  // out, including ones running in the background, so the client announces it and this listens.
  const signOut = useCallback(() => {
    store.setPasscode(null);
    tellPanelSignedOut();
    setPassError("Wrong passcode.");
    setSettings(false); setSheet(null); setAddingOne(null); setProblem(null);
    setPhase("passcode");
  }, []);
  useEffect(() => {
    window.addEventListener(SIGNED_OUT, signOut);
    return () => window.removeEventListener(SIGNED_OUT, signOut);
  }, [signOut]);
  /** A change that didn't save: the alert says why. A turned-down passcode has already gone back to the passcode screen. */
  const didntSave = (message: string | null) => { if (message) setProblem({ title: "That didn't go through", message }); };
  const failed = (e: unknown) => { if (!(e instanceof AuthError)) didntSave(errorText(e)); };
  /**
   * A read that failed. With last time's copy showing, nothing is said (Nov 11: open with the last copy, and offline keep
   * showing it); with nothing to show, the alert says why.
   */
  const notLoaded = (showing: boolean) => (e: unknown) => {
    if (!(e instanceof AuthError) && !showing) setProblem({ title: "Something went wrong", message: errorText(e) });
  };

  const loadHousehold = useCallback(async () => {
    try {
      const h = await api.household();
      loaded.current = true;
      setPeople(h.people);
      store.setPeople(h.people);
      return true;
    } catch (e) {
      if (e instanceof AuthError) return false;
      // Offline or unreachable: the app opens with what's saved here, and each screen says so only if it has nothing.
      setPeople(store.people() ?? []);
      return true;
    }
  }, []);

  // The shared list: loaded when Lists or Stock opens, whenever the app comes back to
  // the front, so both phones see the same list. No background work: only while someone's looking.
  // Each change counts up; a refresh that started before the latest change is older than what's showing, so it's dropped
  // (otherwise a read answering just after a tap would undo the tap on screen until the change's own answer came).
  const listChanges = useRef(0);
  const refreshList = useCallback(async () => {
    const at = listChanges.current;
    try {
      const l = await api.list();
      if (at !== listChanges.current) return;
      setList(l);
      store.setList(l);
    } catch (e) {
      notLoaded(listShowing.current)(e);
    }
  }, []);
  const listNow = useSettled(refreshList);
  const kitchenNow = useSettled(useCallback(() => api.kitchen().then(setKitchen, () => {}), []), 30_000);
  const onShop = phase === "app" && (top.kind === "lists" || top.kind === "stock");
  useEffect(() => {
    if (!onShop) return;
    queueMicrotask(listNow);
    if (top.kind === "stock") kitchenNow(); // the freezer: only Stock shows it
    const visible = () => document.visibilityState === "visible";
    // No timer (Nov 11): the list loads when Lists or Stock opens, when the app comes back, and after changes.
    const back = () => { if (visible()) listNow(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- top.kind only decides the one kitchen read; onShop and visit restart it
  }, [onShop, visit, listNow, kitchenNow]);

  // The collection: loaded when Recipes, a recipe or the week opens (the week shows meal names), and after every change,
  // from the server's answer.
  const gotRecipes = useCallback((r: Recipe[]) => { setRecipes(r); store.setRecipes(r); }, []);
  const refreshRecipes = useCallback(async () => {
    try { gotRecipes((await api.recipes()).recipes); }
    catch (e) { notLoaded(recipesShowing.current)(e); }
  }, [gotRecipes]);
  const inRecipes = phase === "app" && top.kind !== "lists" && top.kind !== "stock";
  const recipesNow = useSettled(refreshRecipes, 15_000);
  useEffect(() => { if (inRecipes) queueMicrotask(recipesNow); }, [inRecipes, visit, recipesNow]);
  const recipeOf = (id: string) => recipes?.find((r) => r.id === id) ?? null;
  const open = top.kind === "recipe" ? recipeOf(top.id) : null;
  const toList = open ?? (listing ? recipeOf(listing) : null); // the add-to-list sheet's recipe: the page you're on, or a row on Recipes
  async function recipeChange(c: Parameters<typeof api.recipeChange>[0], show: (r: Recipe) => Recipe) {
    setRecipes((rs) => rs && rs.map((r) => (r.id === c.id ? show(r) : r)));
    try { gotRecipes((await api.recipeChange(c)).recipes); }
    catch (e) { failed(e); refreshRecipes(); }
  }
  const setActive = (r: Recipe, active: boolean) => recipeChange({ op: "active", id: r.id, active }, (x) => ({ ...x, active }));
  const problemOf = (e: unknown) => (e instanceof AuthError ? null : errorText(e));
  /**
   * Edit's Save: the sheet closes at once and the recipe shows the change (Nov 11: no "Saving…"); the ingredients follow
   * from the answer. A save that fails puts the recipe back and opens Edit again with what was typed, under the alert.
   */
  function saveEdit(r: Recipe, d: Draft) {
    setSheet(null);
    const { ingredients: _lines, ...rest } = d; void _lines;
    setRecipes((rs) => rs && rs.map((x) => (x.id === r.id ? { ...x, ...rest } : x)));
    api.saveRecipes([d]).then((res) => gotRecipes(res.recipes), (e) => {
      if (e instanceof AuthError) return;
      setRecipes((rs) => rs && rs.map((x) => (x.id === r.id ? r : x)));
      didntSave(errorText(e));
      setRetry({ edit: d });
      setSheet("edit");
    });
  }
  /**
   * Add to the list: the sheet closes at once and the things go on behind it; fresh things go on the list, the pantry
   * things with `check`, highlighted in Stock (Nov 3). One that fails opens the sheet again with the same ticks, under the alert.
   */
  function addToList(r: Recipe, buy: Ingredient[], pantry: Ingredient[], ticks: number[]) {
    setSheet(null); setListing(null);
    const line = (i: Ingredient, check: boolean) => ({ item: i.item, quantity: [i.quantity, i.unit].filter(Boolean).join(" "), ...(check && { check }) });
    change({ op: "many", items: [...buy.map((i) => line(i, false)), ...pantry.map((i) => line(i, true))], for: r.name, by: me }).then((problem) => {
      if (!problem) return;
      setRetry({ ticks });
      setListing(r.id);
      setSheet("tolist");
    });
  }

  // What's planned: loaded when Meals opens and whenever the app comes back to the front. Each change counts up, so an
  // answer that started before one of them doesn't put the old plan back.
  const planChanges = useRef(0);
  const refreshPlan = useCallback(async () => {
    const at = ++planChanges.current;
    try {
      const p = await api.plan();
      if (at !== planChanges.current) return;
      setPlan(p); store.setPlan(p);
    } catch (e) {
      notLoaded(planShowing.current)(e);
    }
  }, []);
  // A recipe's page reads it too: it offers "Add to this week" only when the recipe isn't planned.
  const onWeek = phase === "app" && (top.kind === "week" || top.kind === "recipe");
  const planNow = useSettled(refreshPlan);
  useEffect(() => {
    if (!onWeek) return;
    queueMicrotask(planNow);
    // Brought back to the front (an iPhone keeps the app open for days): the plan as it is now.
    const back = () => { if (document.visibilityState === "visible") planNow(); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [onWeek, visit, planNow]);
  /** The plan as the server answered it; when the grocery list changed with it, the list is read again for Lists and Stock. */
  function gotPlan(p: PlanData & { added: number; removed?: number }) {
    setPlan(p); store.setPlan(p);
    if (p.added || p.removed) refreshList();
  }
  // Count changes go one at a time, in order, so two never cross in the Sheet.
  const counting = useRef<Promise<unknown>>(Promise.resolve());
  /** How many of one dinner, sent once the taps stop (Meals); rejects on a problem, which shows on Meals. */
  function countMeal(d: { recipe: string; kind: Kind }, count: number): Promise<void> {
    const run = counting.current.then(async () => {
      ++planChanges.current;
      try { gotPlan(await api.planChange({ op: "count", recipe: d.recipe, kind: d.kind, count }, me)); }
      catch (e) { didntSave(problemOf(e)); refreshPlan(); throw e; }
    });
    counting.current = run.catch(() => {});
    return run;
  }
  /**
   * A dinner picked on Meals: shown at once, saved behind it, in turn with count changes (Nov 10: no "Saving…"). A save
   * that fails takes it back off and says so on Meals.
   */
  function quickAdd(d: NewDish) {
    const temp = { ...d, id: `adding-${Date.now()}`, added: "" };
    setPlan((p) => (p ? { ...p, dishes: [...p.dishes, temp] } : p));
    const run = counting.current.then(async () => {
      ++planChanges.current;
      try { gotPlan(await api.savePlan([d], [], null, me)); }
      catch (e) { didntSave(problemOf(e)); setPlan((p) => (p ? { ...p, dishes: p.dishes.filter((x) => x.id !== temp.id) } : p)); refreshPlan(); }
    });
    counting.current = run;
  }
  /** One planned thing changed (swapped or taken off). Taking off shows at once, before the answer. */
  async function changePlan(c: PlanChange): Promise<string | null> {
    if (c.op === "clear") setPlan((p) => (p ? { ...p, dishes: [] } : p));
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
      if (mine !== listChanges.current) return null; // a later change's answer is newer
      setList(l);
      store.setList(l);
      return null;
    } catch (e) {
      if (e instanceof AuthError) return null;
      didntSave(errorText(e));
      refreshList();
      return errorText(e);
    }
  }
  const lists: ListsActions = {
    add: (text, store) => change({ op: "add", text, by: me, ...(store && { store }) }),
    check: (it, checked) => change({ op: "check", id: it.id, checked }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, checked } : x)) })),
    move: (it, to) => change({ op: "move", id: it.id, store: to }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, store: to } : x)) })),
    done: (s, cart) => change({ op: "done", store: s, cart: Boolean(cart) }, (l) => ({ ...l, items: l.items.filter((x) => !(x.store === s && x.checked)) })),
    putBack: (items) => change({ op: "putBack", items }, (l) => ({ ...l, items: [...l.items, ...items.filter((x) => !l.items.some((y) => y.id === x.id))] })),
  };
  const stock: StockActions = {
    // Have | Need on any row (Nov 11). Its List row, if it has one, changes in place; a thing with none gets one: on the
    // list for Need (the usual amount alongside, not in front: "1 loaf bread" was filed as "loaf bread", Nov 3), or
    // marked Have. Unanswered again: a dinner's thing waits to be checked; anything else's row goes.
    answer: (r, ans) => {
      const it = r.item;
      if (it?.id.startsWith("new-")) return; // its save is on the way; the row answers again once it's back
      const mark = (check: boolean, have: boolean) => (l: ListState) => ({ ...l, items: l.items.map((x) => (x.id === it!.id ? { ...x, check, have } : x)) });
      if (it && ans === "need") return change({ op: "need", id: it.id }, mark(false, false));
      if (it && ans === "have") return change({ op: "haveIt", id: it.id }, mark(true, true));
      if (it && r.meal) return change({ op: "unneed", id: it.id }, mark(true, false));
      if (it) return change({ op: "remove", id: it.id }, (l) => ({ ...l, items: l.items.filter((x) => x.id !== it.id) }));
      if (ans === "check") return;
      // Shown at once (Nov 11, Matt: "a long lag tapping Have Need"): a stand-in row until the server's list comes back.
      const temp: Item = { id: `new-${Date.now()}`, item: r.name, quantity: r.staple?.quantity ?? "", store: r.store, section: r.section, for: "", addedBy: me, addedAt: "", checked: false, check: ans === "have", have: ans === "have" };
      const showNew = (l: ListState) => ({ ...l, items: [...l.items, temp] });
      if (ans === "need" && r.frozen) {
        const f = r.frozen;
        setKitchen((k) => k && { ...k, freezer: k.freezer.flatMap((x) => (x.id !== f.id ? [x] : Number(x.amount) > 1 ? [{ ...x, amount: String(Number(x.amount) - 1) }] : [])) });
        api.freezer({ op: "use", id: f.id }).then(setKitchen, failed);
      }
      change({ op: "add", text: r.name, by: me, store: r.store, section: r.section, ...(r.staple?.quantity && { amount: r.staple.quantity }), ...(ans === "have" && { have: true }) }, showNew);
    },
    keepAdd: (text, section) => change({ op: "keepAdd", text, ...(section && { section }) }),
    keepMove: (item, section) => change({ op: "keepMove", item, section }, (l) => ({ ...l, staples: l.staples.map((x) => (x.item === item ? { ...x, section } : x)) })),
    mealMove: (it, section) => change({ op: "move", id: it.id, section }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, section } : x)) })),
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
    // The helper's panel can stay open for days without being hidden: it also checks when it's clicked into (no timer).
    window.addEventListener("focus", check);
    return () => { document.removeEventListener("visibilitychange", check); window.removeEventListener("focus", check); };
  }, []);

  // A recipe that's gone (removed in the Sheet by hand) closes, back to the screen below.
  const gone = top.kind === "recipe" && !open && recipes !== null;
  useEffect(() => { if (gone) queueMicrotask(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st))); }, [gone]);

  function onTab(t: Tab) {
    scrollAppTo(0);
    setVisit((v) => v + 1);
    setStack([{ kind: t }]);
    setListsStart("all");
  }
  /** From Meals, a recipe that isn't there yet: the Recipes tab, with Add recipes open (Nov 10). */
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
  // Named for the screen below, as in every Morales app: "Back to Meals", "Back to Tacos".
  const backLabel = `Back to ${!below ? TAB_NAMES[root] : below.kind === "recipe" ? recipeOf(below.id)?.name ?? TAB_NAMES[root] : TAB_NAMES[below.kind]}`;
  // In the helper's panel: the computer's work for the phone (components/Activity.tsx).
  const panel = usePanelActivity(phase === "app" && framed());

  return (
    <div id="scroller" className="h-full overflow-y-auto overscroll-y-contain">
    <main className="mx-auto min-h-[calc(100%+1px)] w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      {phase === "boot" && <Splash />}
      {phase === "passcode" && (
        <PasscodeScreen error={passError} onClearError={() => setPassError(null)} onDone={async (code) => {
          setPassError(null);
          store.setPasscode(code);
          if (await loadHousehold()) { setStack([{ kind: "week" }]); setPhase("app"); }
        }} />
      )}
      <OpenSettings.Provider value={phase === "app" ? () => setSettings(true) : null}>
      {phase === "app" && top.kind === "week" && (
        <MealsScreen key={visit} plan={plan} recipes={recipes ?? []} dinnerGroceries={(list?.items ?? []).length}
          onOpen={(d) => openRecipe(d.recipe)} onAdd={(k) => setAddingOne(k)}
          onCount={countMeal}
          onNewPlan={() => { changePlan({ op: "clear" }).then(didntSave); }}
          onRemove={(d) => { changePlan({ op: "remove", id: d.id }).then(didntSave); }} />
      )}
      {phase === "app" && top.kind === "stock" && <StockScreen key={visit} list={list} kitchen={kitchen} act={stock} />}
      {phase === "app" && top.kind === "lists" && <ListsScreen key={visit} list={list} act={lists} start={listsStart} />}
      {phase === "app" && top.kind === "recipes" && (
        <RecipesScreen key={visit} freezer={kitchen?.freezer ?? plan?.freezer ?? []} recipes={recipes}
          onOpen={(r) => openRecipe(r.id)} onAdd={() => setSheet("add")} />
      )}
      {phase === "app" && open && (
        <RecipeScreen key={open.id} r={open} onBack={back} backLabel={backLabel} onEdit={() => setSheet("edit")}
          onActive={(a) => setActive(open, a)} onAddToList={() => setSheet("tolist")} planned={Boolean(plan?.dishes.some((d) => d.recipe === open.id))}
          onAddToWeek={kindOf(open) ? () => quickAdd({ kind: kindOf(open)!, recipe: open.id, pinned: true }) : undefined} />
      )}
      </OpenSettings.Provider>
      {panel.log ? <ActivityScreen jobs={panel.jobs} onUse={panel.dismiss} /> : panel.phoneNow && <PhoneNote job={panel.phoneNow} onOpen={panel.open} />}
      {addingOne && plan && <AddMealSheet kind={addingOne} plan={plan} recipes={recipes ?? []} onAdd={quickAdd} onClose={() => setAddingOne(null)} />}
      {sheet === "add" && <AddRecipesSheet recipes={recipes ?? []} onClose={() => setSheet(null)} onSaved={(all, saved) => {
        gotRecipes(all);
        setSheet(null);
        if (saved.length === 1) { const id = saved[0]; scrollAppTo(0); setStack((st) => [...(st[st.length - 1].kind === "recipe" ? st.slice(0, -1) : st), { kind: "recipe", id }]); }
        else onTab("recipes"); // several saved (her meal ideas): show the whole collection, where they now are
      }} />}
      {sheet === "edit" && open && <EditSheet key={open.id} r={open} initial={retry?.edit} onSave={(d) => { setRetry(null); saveEdit(open, d); }} onClose={() => { setSheet(null); setRetry(null); }} />}
      {sheet === "tolist" && toList && <AddToListSheet key={toList.id} r={toList} ticks={retry?.ticks} onAdd={(buy, pantry, ticks) => { setRetry(null); addToList(toList, buy, pantry, ticks); }} onClose={() => { setSheet(null); setListing(null); setRetry(null); }} />}
      {settings && (
        <SettingsSheet theme={theme} onTheme={(t) => { setTheme(t); store.setTheme(t); }} onClose={() => setSettings(false)} />
      )}
      {phase === "app" && (
        <TabBar tabs={TABS} active={root} onTab={onTab} />
      )}
      <Alert open={Boolean(problem)} title={problem?.title ?? ""} message={problem?.message ?? ""} onClose={() => setProblem(null)} />
    </main>
    </div>
  );
}
