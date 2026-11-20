"use client";
// The shared data the phone shows (the list, the recipes, the plan, the freezer), each kept in step with the server
// (synced.ts), made once for the app. Screens subscribe to just what they show, so a tap on Shop or List re-renders that
// screen (and the one row it changed), not the whole app.
import { useSyncExternalStore } from "react";
import { api, AuthError, errorText, etagOf, type Kitchen, type ListState, type PlanData, type Recipe } from "./api";
import { store } from "./storage";
import { Synced, UNCHANGED } from "./synced";

type Problem = { title: string; message: string };
let report: (p: Problem) => void = () => {};
/** Where problems go: App shows them as the shared alert. */
export function onProblem(fn: (p: Problem) => void) {
  report = fn;
  return () => { if (report === fn) report = () => {}; };
}

// Every change shows at once and is saved behind it, in order; a change that didn't save comes off the screen, the
// alert says why, and the newest copy is read. A read that fails says nothing with last time's copy showing (Nov 11:
// offline, keep showing it); with nothing to show, the alert says why. A turned-down passcode has already gone back to
// the passcode screen.
const failed = (e: unknown) => { if (!(e instanceof AuthError)) report({ title: "That didn't go through", message: errorText(e) }); };
const notLoaded = (e: unknown, showing: boolean) => { if (!(e instanceof AuthError) && !showing) report({ title: "Something went wrong", message: errorText(e) }); };

function make() {
  return {
    // The shared list (last time's at first, for opening offline): read when Shop or List opens and when the app comes back.
    // Each read sends the ETag of the copy it has (kept with last time's copy too), and an answer of "nothing changed"
    // (Nov 19, ops/fresh.ts) keeps that copy, with nothing sent but the headers.
    lists: new Synced<ListState>(store.list(), { read: api.listSince, keep: store.setList, etagOf, failed, readFailed: notLoaded }, store.listEtag()),
    // The collection: read when Recipes, a recipe or Meals opens (Meals shows meal names).
    recipes: new Synced<Recipe[]>(store.recipes(), { read: (etag) => api.recipesSince(etag).then((r) => (r === UNCHANGED ? r : r.recipes)), keep: store.setRecipes, etagOf, failed, readFailed: notLoaded }, store.recipesEtag()),
    // What's planned: read when Meals or a recipe opens (a recipe offers Add to the plan only when it isn't planned).
    plans: new Synced<PlanData>(store.plan(), { read: api.planSince, keep: store.setPlan, etagOf, failed, readFailed: notLoaded }, store.planEtag()),
    // The freezer: only List shows it.
    kitchens: new Synced<Kitchen>(null, { read: api.kitchenSince, etagOf, failed }),
  };
}
export type Stores = ReturnType<typeof make>;
let made: Stores | null = null;
/** The stores, made the first time the app asks in the browser (last time's copies from this phone). */
export const stores = (): Stores => (made ??= make());

const browser = typeof window !== "undefined";
const never = () => () => {};
/**
 * A piece of one store, re-rendering only when that piece changes. `select` must give the same value for the same
 * data (a field, a count), never a new object. The server renders nothing from the stores.
 */
export function useStore<T, S>(which: keyof Stores, select: (v: T | null) => S): S {
  const s = browser ? (stores()[which] as unknown as Synced<T>) : null;
  return useSyncExternalStore(s ? s.subscribe : never, () => select(s ? s.get() : null), () => select(null));
}
const whole = <T,>(v: T | null) => v;
export const useList = () => useStore<ListState, ListState | null>("lists", whole);
export const useRecipes = () => useStore<Recipe[], Recipe[] | null>("recipes", whole);
export const usePlan = () => useStore<PlanData, PlanData | null>("plans", whole);
export const useKitchen = () => useStore<Kitchen, Kitchen | null>("kitchens", whole);
