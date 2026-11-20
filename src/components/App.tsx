"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityScreen, PhoneNote, usePanelActivity } from "./Activity";
import { type RecipeSection, api, applyTheme, AuthError, framed, LockedError, passcodeFromPanel, SIGNED_OUT, store, tellPanelSignedOut, type Draft, type Frozen, type Ingredient, type Item, type Kind, type Kitchen, type ListChange, type ListState, type Section, type Store, type NewDish, type PlanChange, type PlanData, type Recipe, type Theme } from "@/lib/client";
import { onProblem, stores, usePlan, useRecipes, useStore } from "@/lib/app-data";
import { PasscodeScreen } from "./PasscodeScreen";
import { SafewayHost } from "./Safeway";
import { ShopScreen, type ShopActions } from "./Shop";
import { StockScreen, type StockActions } from "./Stock";
import { AddMealSheet, MealsScreen, PickDaySheet } from "./Week";
import { kindOf } from "@/lib/week";
import { known, norm, parseEntry, parseIngredient } from "@/lib/words";
import { AddRecipesSheet, type AddStep, EditSheet, RecipeScreen, RecipesScreen } from "./Recipes";
import { Alert, Contained, OpenSettings, Splash, TabBar, type TabDef, scrollAppTo } from "./ui";

// Settings (with ordering) loads on its own, after the app is up (see `preload`), not with the first screen. A load that
// fails (offline) is said in the shared alert, with Try again, and is tried afresh next time.
type SettingsSheetType = typeof import("./Settings").SettingsSheet;
let settingsChunk: Promise<SettingsSheetType> | null = null;
const loadSettings = () => (settingsChunk ??= import("./Settings").then((m) => m.SettingsSheet, (e) => { settingsChunk = null; throw e; }));
/** The rarely opened sheets (Settings, Check out), fetched once the app is showing so their first tap is instant. */
const preload = () => { loadSettings().catch(() => { /* offline: tried again when Settings is opened */ }); };
const NO_SETTINGS = { title: "Couldn't open Settings", message: "No connection. Check your signal and try again." };

/** Recipes, with what's in the freezer (only this tab and List read it), so a freezer change doesn't redraw the app. */
function RecipesTab({ planFreezer, ...props }: Omit<React.ComponentProps<typeof RecipesScreen>, "freezer"> & { planFreezer?: Frozen[] }) {
  const freezer = useStore<Kitchen, Frozen[] | undefined>("kitchens", (k) => k?.freezer);
  return <RecipesScreen {...props} freezer={freezer ?? planFreezer ?? []} />;
}

type Tab = "recipes" | "week" | "stock" | "shop";
/**
 * Where you are: a tab at the bottom of a stack of screens opened from it (a recipe). Back pops one; a tab starts a new
 * stack. The tab lit is the stack's first; the back button names the screen below.
 */
type Screen = { kind: Tab } | { kind: "recipe"; id: string };
// Recipes · Meals · Stock · Shop (Sam, Nov 2; Lists became Shop, Nov 12); Simmer still opens on Meals (Oct 31).
const TABS: TabDef<Tab>[] = [{ id: "recipes", label: "Recipes", icon: "book" }, { id: "week", label: "Meals", icon: "pot" }, { id: "stock", label: "List", icon: "list" }, { id: "shop", label: "Shop", icon: "cart" }];
const TAB_NAMES: Record<Tab, string> = { recipes: "Recipes", week: "Meals", stock: "List", shop: "Shop" };
const isTab = (v: unknown): v is Tab => typeof v === "string" && Object.hasOwn(TAB_NAMES, v);

/** Where to pick up after reloading into a new version (this tab only). */
const saveResume = (root: Tab) => { try { sessionStorage.setItem("sm.resume", root); } catch {} };
/** The first screen, and whether it's the one the address asked for (not a resume after reloading). */
function takeResume(): { tab: Tab; asked: boolean } {
  // The Safeway helper's panel opens Simmer on Shop (?open=shop); an older address's ?open=lists lands there too.
  const open = typeof location !== "undefined" ? new URLSearchParams(location.search).get("open") : null;
  const asked = open === "lists" ? "shop" : open;
  const first = { tab: isTab(asked) ? asked : "week" as Tab, asked: isTab(asked) };
  try {
    const saved = sessionStorage.getItem("sm.resume"), v = saved === "lists" ? "shop" : saved; // saved by a version before Shop
    sessionStorage.removeItem("sm.resume");
    return isTab(v) ? { tab: v, asked: false } : first;
  } catch { return first; }
}
/** Nothing would be lost by reloading now: no sheet open (the panel's activity log doesn't count) and nothing typed. */
const atRest = () => !document.querySelector('[role="dialog"]:not([data-at-rest])')
  && ![...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].some((el) => el.value);

/** Stand-in rows and recipes are told apart by their ids until the server's answer replaces them. */
let standIns = 0;
const standInId = (kind: "new" | "saving" | "adding") => `${kind}-${Date.now()}-${++standIns}`;
const isStandIn = (id: string) => id.startsWith("new-") || id.startsWith("saving-");
/** A list row shown at once for something just added, filed where Simmer would file it, until the server's list comes back. */
function standInItem(name: string, quantity: string, more: Partial<Item> = {}, store?: Store, section?: Section): Item {
  const f = known(name);
  return { id: standInId("new"), item: name, quantity, store: store ?? f?.store ?? "safeway", section: section ?? f?.section ?? "pantry", for: "", addedBy: "", addedAt: "", checked: false, check: false, ...more };
}
/** A recipe as it will be saved, shown at once (Nov 11: always responsive). */
const draftRecipe = (d: Draft, id: string, existing?: Recipe): Recipe => ({
  ...existing, ...d, id, active: d.active ?? existing?.active ?? true, addedAt: existing?.addedAt ?? "",
  ingredients: d.ingredients.map((l) => l.trim()).filter(Boolean).map(parseIngredient),
});

export default function App() {
  const [phase, setPhase] = useState<"boot" | "passcode" | "app">("boot");
  const [stack, setStack] = useState<Screen[]>([{ kind: "week" }]); // Simmer opens on Meals (Sam, Oct 31)
  const top = stack[stack.length - 1];
  const root = stack[0].kind as Tab;
  const [visit, setVisit] = useState(0); // a new one each tab tap, so the tab's screen opens fresh
  // Browser-only state read on the first client render; the server renders only the splash, so nothing mismatches.
  const browser = typeof window !== "undefined";
  const [passError, setPassError] = useState<string | null>(null); // the passcode screen's problem: a wrong passcode
  // One problem at a time, shown over the page as the shared alert until OK (Nov 11: no bars that move the page).
  const [problem, setProblem] = useState<{ title: string; message: string; retry?: () => void } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (browser ? store.theme() : "simmer"));
  const [settings, setSettings] = useState(false);
  const [SettingsSheet, setSettingsSheet] = useState<SettingsSheetType | null>(null);
  const openSettings = useCallback(function open() {
    loadSettings().then((C) => { setSettingsSheet(() => C); setSettings(true); }, () => setProblem({ ...NO_SETTINGS, retry: open }));
  }, []);
  const [sheet, setSheet] = useState<"add" | "edit" | null>(null);
  // What was entered in a sheet whose save failed, so it opens again as it was: Edit's draft, or Add recipes' step.
  const [retry, setRetry] = useState<{ edit?: Draft; add?: AddStep } | null>(null);
  // The dinner sheet names its dinner rather than holding a copy, so it shows the plan as it is now.
  const [addingOne, setAddingOne] = useState<{ kind: Kind | null; day: string } | null>(null); // the kind and day being added to, from Meals
  const [pickingDay, setPickingDay] = useState<Recipe | null>(null); // a recipe's Add to the plan, asking which day (Nov 16)
  const loaded = useRef(false); // the household has loaded from the server this session

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

  // The shared data, each kept in step with the server (lib/stores.ts): a change that didn't save, or a read with
  // nothing to show, comes here as the alert. App reads only the recipes and the plan; List and Shop read the list (and
  // the freezer) themselves, so a tick there doesn't redraw the app. The Safeway cart is kept by SafewayHost below,
  // across tab taps, so Shop's Add, Find and − n + stay put.
  const { lists, recipes: recipeList, plans, kitchens } = stores();
  useEffect(() => onProblem(setProblem), []);
  const recipes = useRecipes();
  const plan = usePlan();

  const loadHousehold = useCallback(async (): Promise<boolean | "locked"> => {
    try {
      await api.household();
      loaded.current = true;
      return true;
    } catch (e) {
      // Too many wrong passcodes from this address: said in the alert; the saved passcode stays.
      if (e instanceof LockedError) { setProblem({ title: "Try again soon", message: e.message }); return "locked"; }
      // Offline or unreachable: the app opens with what's saved here, and each screen says so only if it has nothing.
      return !(e instanceof AuthError);
    }
  }, []);

  // No timers (Nov 11): each screen's data is read when it opens and when the app comes back to the front (an iPhone
  // keeps the app open for days), and changes answer with the newest copy. Only while someone's looking.
  const on = phase === "app" ? top.kind : null;
  useEffect(() => {
    if (!on) return;
    const read = (opening: boolean) => {
      if (on === "shop" || on === "stock") void lists.settled(5_000);
      else void recipeList.settled(15_000);
      if (on === "week" || on === "recipe") void plans.settled(5_000);
      if (on === "stock" && opening) void kitchens.settled(30_000);
      // Shop reads the Safeway cart itself as it opens and comes back (Shop.tsx).
    };
    queueMicrotask(() => read(true));
    const back = () => { if (document.visibilityState === "visible") read(false); };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [on, visit, lists, recipeList, plans, kitchens]);
  const recipeOf = (id: string) => recipes?.find((r) => r.id === id) ?? null;
  const open = top.kind === "recipe" ? recipeOf(top.id) : null;

  /** An ingredient moved between Fresh and Pantry (Nov 16): every recipe with it shows the move at once; the list follows. */
  function moveIngredient(r: Recipe, item: string, section: RecipeSection) {
    const same = (i: Ingredient) => i.item.trim().toLowerCase() === item.trim().toLowerCase();
    recipeList.change(() => api.recipeChange({ op: "section", id: r.id, item, section }).then((a) => { void lists.refresh(); return a.recipes; }),
      (rs) => rs.map((x) => (x.ingredients.some(same) ? { ...x, ingredients: x.ingredients.map((i) => (same(i) ? { ...i, section } : i)) } : x)));
  }
  /**
   * Delete, from Edit (asked there first): the sheet closes, the recipe page goes back and the recipe is gone at once;
   * the plan and the list follow from the server. A delete that fails puts it back, with the alert.
   */
  function deleteRecipe(r: Recipe) {
    setSheet(null);
    if (isStandIn(r.id)) return;
    back();
    recipeList.change(() => api.recipeChange({ op: "delete", id: r.id }).then((a) => { void plans.refresh(); void lists.refresh(); return a.recipes; }),
      (rs) => rs.filter((x) => x.id !== r.id));
  }
  /**
   * Edit's Save: the sheet closes at once and the recipe shows the change (Nov 11: no "Saving…"); the ingredients follow
   * from the answer. A save that fails puts the recipe back and opens Edit again with what was typed, under the alert.
   */
  function saveEdit(r: Recipe, d: Draft) {
    setSheet(null);
    if (isStandIn(r.id)) return;
    recipeList.change(() => api.saveRecipes([d]).then((res) => res.recipes), (rs) => rs.map((x) => (x.id === r.id ? draftRecipe(d, r.id, x) : x)))
      .then((no) => { if (no && !(no.error instanceof AuthError)) { setRetry({ edit: d }); setSheet("edit"); } });
  }

  /**
   * Add recipes' Save: the sheet closes at once and the recipe shows straight away (one: its page; several: the
   * collection), as a stand-in until the server answers with its id. A save that fails takes the stand-ins off and opens
   * Add recipes again where it was, under the alert.
   */
  function saveNew(ds: Draft[], duplicates: "skip" | "replace" | undefined, step: AddStep) {
    setSheet(null);
    const twin = (d: Draft) => (recipes ?? []).find((r) => norm(r.name) === norm(d.name));
    const shown = ds.flatMap((d) => {
      const t = twin(d);
      if (t && duplicates === "skip") return [];
      return [t && duplicates === "replace" ? { replaces: t, r: draftRecipe(d, t.id, t) } : { replaces: null, r: draftRecipe(d, standInId("saving")) }];
    });
    const one = ds.length === 1 ? shown[0]?.r.id : undefined;
    if (one) { scrollAppTo(0); setStack((st) => [...(st[st.length - 1].kind === "recipe" ? st.slice(0, -1) : st), { kind: "recipe", id: one }]); }
    else onTab("recipes"); // several (her meal ideas): the whole collection, where they now are
    // The page open on a stand-in becomes the saved recipe's before the answer shows (Nov 19: switched after it, the page
    // saw its stand-in gone for a moment and closed).
    const follow = (saved: string[]) => { if (one && saved[0] && one !== saved[0]) setStack((st) => st.map((x) => (x.kind === "recipe" && x.id === one ? { kind: "recipe", id: saved[0] } : x))); };
    recipeList.change(() => api.saveRecipes(ds, duplicates).then((res) => { follow(res.saved); return res.recipes; }), (rs) => [
      ...rs.map((x) => shown.find((s) => s.replaces?.id === x.id)?.r ?? x),
      ...shown.filter((s) => !s.replaces).map((s) => s.r),
    ]).then((no) => {
      if (!no) return;
      if (no.error instanceof AuthError) return;
      if (one) setStack((st) => { const rest = st.filter((x) => !(x.kind === "recipe" && x.id === one)); return rest.length ? rest : [{ kind: "recipes" }]; });
      setRetry({ add: step });
      setSheet("add");
    });
  }

  /** The plan as the server answered it; when the grocery list changed with it, the list is read again for Shop and List. */
  const planned = (p: PlanData & { added: number; removed?: number }) => { if (p.added || p.removed) void lists.refresh(); return p; };
  /** A dinner picked on Meals: shown at once, saved behind it (Nov 10: no "Saving…"). One that fails comes back off. */
  function quickAdd(d: NewDish) {
    const temp = { ...d, id: standInId("adding"), added: "" };
    plans.change(() => api.savePlan([d], [], null, "").then(planned), (p) => ({ ...p, dishes: [...p.dishes, temp] }));
  }
  /** One planned thing changed (moved to another day, or taken off), or a new plan: shown at once, before the answer. */
  function changePlan(c: PlanChange) {
    const done = plans.change(() => api.planChange(c, "").then(planned), (p) => {
      if (c.op === "clear") return { ...p, dishes: [] };
      if (c.op === "made" || c.op === "remove") return { ...p, dishes: p.dishes.filter((d) => d.id !== c.id), lunches: p.lunches.filter((l) => l.id !== c.id) };
      if (c.op === "change" && "day" in c) return { ...p, dishes: p.dishes.map((d) => (d.id === c.id ? { ...d, day: c.day } : d)) };
      return p;
    });
    // A new plan empties the list too (what's in the Safeway cart comes back with the server's list), read in turn
    // once the plan's answer is in.
    if (c.op === "clear") lists.change(() => done.then(() => api.list()), (l) => ({ ...l, items: [] }));
  }

  // Made once (the stores never change), so List's and Shop's rows, given the same actions, aren't drawn again.
  const { shop, stock } = useMemo(() => {
    /** A change to the list: shown at once, then sent; the answer is the list as it is now (anyone else's changes too). */
    const change = (c: ListChange, show?: (l: ListState) => ListState) => lists.change(() => api.change(c), show);
    const shop: ShopActions = {
      // Shown at once as a stand-in row (Nov 11: always responsive); one already on the list adds up there, on the server.
      add: (text, store) => {
        const e = parseEntry(text), temp = standInItem(e.item, e.quantity, {}, store);
        return change({ op: "add", text, by: "", ...(store && { store }) }, (l) => (l.items.some((x) => !x.checked && !x.check && norm(x.item) === norm(e.item) && (!store || x.store === store))
          ? l : { ...l, items: [...l.items, temp] }));
      },
      check: (it, checked) => isStandIn(it.id) ? undefined : void change({ op: "check", id: it.id, checked }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, checked } : x)) })),
      move: (it, to) => isStandIn(it.id) ? undefined : void change({ op: "move", id: it.id, store: to }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, store: to } : x)) })),
      // `cart`: the ids in the Safeway cart, which come off as bought too.
      done: (s, cart) => change({ op: "done", store: s, cart: Boolean(cart) }, (l) => ({ ...l, items: l.items.filter((x) => !(x.store === s && x.checked) && !cart?.includes(x.id)) })),
    };
    const stock: StockActions = {
      // Have | Need on any row (Nov 11). Its List row, if it has one, changes in place; a thing with none gets one: on the
      // list for Need (the usual amount alongside, not in front: "1 loaf bread" was filed as "loaf bread", Nov 3), or
      // marked Have. Unanswered again: a dinner's thing waits to be checked; anything else's row goes.
      answer: (r, ans) => {
        const it = r.item;
        if (it && isStandIn(it.id)) return; // its save is on the way; the row answers again once it's back
        const mark = (check: boolean, have: boolean) => (l: ListState) => ({ ...l, items: l.items.map((x) => (x.id === it!.id ? { ...x, check, have } : x)) });
        if (it && ans === "need") return void change({ op: "need", id: it.id }, mark(false, false));
        if (it && ans === "have") return void change({ op: "haveIt", id: it.id }, mark(true, true));
        if (it && r.meal) return void change({ op: "unneed", id: it.id }, mark(true, false));
        if (it) return void change({ op: "remove", id: it.id }, (l) => ({ ...l, items: l.items.filter((x) => x.id !== it.id) }));
        if (ans === "check") return;
        // Shown at once (Nov 11, Sam: "a long lag tapping Have Need"): a stand-in row until the server's list comes back.
        const temp = standInItem(r.name, r.staple?.quantity ?? "", { check: ans === "have", have: ans === "have" }, r.store, r.section);
        if (ans === "need" && r.frozen) {
          const f = r.frozen;
          kitchens.change(() => api.freezer({ op: "use", id: f.id }), (k) => ({ ...k, freezer: k.freezer.flatMap((x) => (x.id !== f.id ? [x] : Number(x.amount) > 1 ? [{ ...x, amount: String(Number(x.amount) - 1) }] : [])) }));
        }
        void change({ op: "add", text: r.name, by: "", store: r.store, section: r.section, ...(r.staple?.quantity && { amount: r.staple.quantity }), ...(ans === "have" && { have: true }) }, (l) => ({ ...l, items: [...l.items, temp] }));
      },
      // Shown at once (Nov 11): the new thing's row, filed where Simmer would file it, until the server's list comes back.
      // Quick add (Nov 16): common or specialty, maybe in a group, and with need, a stand-in Need row at once.
      keepAdd: (text, section, more = {}) => {
        const f = known(text);
        const temp = standInItem(text, "", { check: false }, f?.store ?? "safeway", section ?? f?.section ?? "pantry");
        void change({ op: "keepAdd", text, ...(section && { section }), ...(more.kind && { kind: more.kind }), ...(more.group !== undefined && { group: more.group }), ...(more.need && { need: true, by: "" }) }, (l) => {
          const had = l.staples.find((x) => norm(x.item) === norm(text));
          const s = had
            ? { ...had, ...(more.kind && { kind: more.kind }), ...(more.group !== undefined && { group: more.group }) }
            : { item: text, store: temp.store, section: temp.section, quantity: "", product: "", kind: more.kind ?? "common" as const, group: more.group ?? "" };
          const staples = had ? l.staples.map((x) => (x === had ? s : x)) : [...l.staples, s];
          if (!more.need) return { ...l, staples };
          const row = l.items.find((x) => !x.checked && norm(x.item) === norm(text));
          const items = row ? l.items.map((x) => (x === row ? { ...x, check: false, have: false } : x)) : [...l.items, { ...temp, item: s.item, quantity: s.quantity, store: s.store, section: s.section }];
          return { ...l, staples, items };
        });
      },
      keepGroup: (from, to) => void change({ op: "keepGroup", from, to }, (l) => ({ ...l, staples: l.staples.map((x) => (x.group && norm(x.group) === norm(from) ? { ...x, group: to } : x)) })),
      keepSet: (item, c) => void change({ op: "keepSet", item, ...c }, (l) => ({ ...l, staples: l.staples.map((x) => (x.item === item ? { ...x, ...(c.kind && { kind: c.kind }), ...(c.group !== undefined && { group: c.group }) } : x)) })),
      keepMove: (item, section) => void change({ op: "keepMove", item, section }, (l) => ({ ...l, staples: l.staples.map((x) => (x.item === item ? { ...x, section } : x)) })),
      mealMove: (it, section) => void change({ op: "move", id: it.id, section }, (l) => ({ ...l, items: l.items.map((x) => (x.id === it.id ? { ...x, section } : x)) })),
      keepRemove: (st) => void change({ op: "keepRemove", item: st.item }, (l) => ({ ...l, staples: l.staples.filter((x) => x.item !== st.item) })),
    };
    return { shop, stock };
  }, [lists, kitchens]);

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
      // Turned down for a while (too many wrong passcodes here): the app opens with what's saved, as when offline.
      else loadHousehold().then((ok) => {
        if (!ok) return;
        setStack([{ kind: resume.tab }]);
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

  // Once the app is showing, the rarely opened sheets are fetched, so opening one never waits on the network.
  useEffect(() => { if (phase === "app") preload(); }, [phase]);

  // A recipe that's gone (removed in the Sheet by hand) closes, back to the screen below.
  const gone = top.kind === "recipe" && !open && recipes !== null;
  useEffect(() => { if (gone) queueMicrotask(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st))); }, [gone]);

  function onTab(t: Tab) {
    scrollAppTo(0);
    setVisit((v) => v + 1);
    setStack([{ kind: t }]);
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
  // Named for the screen below, as in every Morales app: "Back to Meals", "Back to Tacos".
  const backLabel = `Back to ${!below ? TAB_NAMES[root] : below.kind === "recipe" ? recipeOf(below.id)?.name ?? TAB_NAMES[root] : TAB_NAMES[below.kind]}`;
  // In the helper's panel: the computer's work for the phone (components/Activity.tsx).
  const panel = usePanelActivity(phase === "app" && framed());

  return (
    <SafewayHost>
    <div id="scroller" className="h-full overflow-y-auto overscroll-y-contain">
    <main className="mx-auto min-h-[calc(100%+1px)] w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      {phase === "boot" && <Splash />}
      {phase === "passcode" && (
        <PasscodeScreen error={passError} onClearError={() => setPassError(null)} onDone={async (code) => {
          setPassError(null);
          store.setPasscode(code);
          const ok = await loadHousehold();
          // Turned down for a while: the passcode typed isn't known to be right, so it isn't kept; the alert says why.
          if (ok === "locked") store.setPasscode(null);
          else if (ok) { setStack([{ kind: "week" }]); setPhase("app"); }
        }} />
      )}
      <OpenSettings.Provider value={phase === "app" ? openSettings : null}>
      {phase === "app" && top.kind === "week" && (
        <MealsScreen key={visit} plan={plan} recipes={recipes ?? []}
          onOpen={(d) => openRecipe(d.recipe)} onAdd={(kind, day) => setAddingOne({ kind, day })}
          onNewPlan={() => changePlan({ op: "clear" })}
          onRemove={(d) => changePlan({ op: "remove", id: d.id })}
          onMove={(d, day) => changePlan({ op: "change", id: d.id, day })} />
      )}
      {phase === "app" && top.kind === "stock" && <StockScreen key={visit} act={stock} />}
      {phase === "app" && top.kind === "shop" && <ShopScreen key={visit} act={shop} />}
      {phase === "app" && top.kind === "recipes" && (
        <RecipesTab key={visit} planFreezer={plan?.freezer} recipes={recipes}
          onOpen={(r) => openRecipe(r.id)} onAdd={() => setSheet("add")} />
      )}
      {phase === "app" && open && (
        <RecipeScreen key={open.id} r={open} onBack={back} backLabel={backLabel} onEdit={() => setSheet("edit")}
          planned={Boolean(plan?.dishes.some((d) => d.recipe === open.id))} onSection={isStandIn(open.id) ? undefined : (item, section) => moveIngredient(open, item, section)}
          onAddToWeek={kindOf(open) && !isStandIn(open.id) ? () => setPickingDay(open) : undefined} />
      )}
      </OpenSettings.Provider>
      {panel.log ? <ActivityScreen jobs={panel.jobs} onUse={panel.dismiss} /> : panel.phoneNow && <PhoneNote job={panel.phoneNow} onOpen={panel.open} />}
      {/* A sheet that fails to draw closes with the alert, never Next's error page. */}
      <Contained onError={() => { setSettings(false); setSheet(null); setAddingOne(null); setPickingDay(null); setProblem({ title: "Something went wrong", message: "That didn't open. Try again." }); }}>
      {pickingDay && kindOf(pickingDay) && <PickDaySheet name={pickingDay.name} dishes={plan?.dishes ?? []} recipes={recipes ?? []} onClose={() => setPickingDay(null)}
        onPick={(day) => { const r = pickingDay; setPickingDay(null); quickAdd({ kind: kindOf(r)!, recipe: r.id, pinned: true, day }); }} />}
      {addingOne && plan && <AddMealSheet kind={addingOne.kind} day={addingOne.day} plan={plan} recipes={recipes ?? []} onAdd={quickAdd} onClose={() => setAddingOne(null)} />}
      {sheet === "add" && <AddRecipesSheet recipes={recipes ?? []} initial={retry?.add} onClose={() => { setSheet(null); setRetry(null); }}
        onSave={(ds, duplicates, step) => { setRetry(null); saveNew(ds, duplicates, step); }} />}
      {sheet === "edit" && open && <EditSheet key={open.id} r={open} initial={retry?.edit} onSave={(d) => { setRetry(null); saveEdit(open, d); }} onDelete={() => deleteRecipe(open)} onClose={() => { setSheet(null); setRetry(null); }} />}
      {settings && SettingsSheet && (
        <SettingsSheet theme={theme} onTheme={(t) => { setTheme(t); store.setTheme(t); }} onClose={() => setSettings(false)} />
      )}
      </Contained>
      {phase === "app" && (
        <TabBar tabs={TABS} active={root} onTab={onTab} />
      )}
      <Alert open={Boolean(problem)} title={problem?.title ?? ""} message={problem?.message ?? ""} onClose={() => setProblem(null)}
        onRetry={problem?.retry && (() => { const again = problem.retry!; setProblem(null); again(); })} />
    </main>
    </div>
    </SafewayHost>
  );
}
