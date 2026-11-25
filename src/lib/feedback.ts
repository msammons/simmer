// Feedback (Sam, Nov 24: "Long press on settings should open a feedback text box even if a sheet is open. It should
// record the current page or sheet and state of the app in general along with the feedback text."). What's on screen
// is kept in a small registry: each tab, screen, sheet and pop-up adds one note (a name and a one-line detail) while
// it's showing, so a new sheet is one line (`useNote`, or nothing at all: every Sheet and Dialog notes itself). The
// recent alerts are kept beside it. Nothing here is sent until Send; the server adds its own side (ops/feedback.ts).
import { useEffect, useState } from "react";

/** A tab, a screen pushed on it (a recipe), a sheet, a pop-up (a confirm or an alert), or a piece of state (Shop's filter). */
export type NoteKind = "tab" | "screen" | "sheet" | "popup" | "state";
export type Note = { kind: NoteKind; name: string; detail: string };

/** What the phone sends with the text: the place and the state at the moment of the long press. */
export type FeedbackContext = {
  release: string;
  tab: string;
  screens: string[];
  sheets: { name: string; detail: string }[];
  state: Record<string, string>;
  alerts: string[];
  online: boolean;
  theme: string;
  viewport: string;
  userAgent: string;
};

const notes = new Map<number, Note>(); // by when each was added, so stacked sheets keep their order
let added = 0;
const alerts: string[] = []; // newest last
export const KEEP_ALERTS = 5;

/** Adds a note and answers its key (for `dropNote`); outside React (tests) and inside `useNote`. */
export function addNote(n: Note): number { notes.set(++added, n); return added; }
export function dropNote(key: number) { notes.delete(key); }

/** An alert's words as it's shown, kept as one of the last five. */
export function noteAlert(title: string, message?: unknown) {
  const text = [title, typeof message === "string" ? message : ""].filter(Boolean).join(": ").replace(/\s+/g, " ").trim().slice(0, 200);
  if (!text || alerts[alerts.length - 1] === text) return;
  alerts.push(text);
  if (alerts.length > KEEP_ALERTS) alerts.splice(0, alerts.length - KEEP_ALERTS);
}

/** For tests: empties the registry and the alerts. */
export function resetNotes() { notes.clear(); alerts.length = 0; }

/** This note on the registry while the component is showing, kept up to date as its name or detail changes. */
export function useNote(kind: NoteKind, name: string, detail = "") {
  // Its place in the order is fixed when it first shows, so a detail that changes never moves it after a later sheet.
  const [key] = useState(nextKey);
  useEffect(() => {
    notes.set(key, { kind, name, detail });
    return () => { notes.delete(key); };
  }, [key, kind, name, detail]);
}
const nextKey = () => ++added;

/** The registry as the feedback entry tells it: the tab, the screens over it, every sheet and pop-up in order, the state, the alerts. */
export function placeNow(): Pick<FeedbackContext, "tab" | "screens" | "sheets" | "state" | "alerts"> {
  const all = [...notes.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
  const state: Record<string, string> = {};
  for (const n of all) if (n.kind === "state" && n.detail) state[n.name] = n.detail;
  return {
    tab: all.find((n) => n.kind === "tab")?.name ?? "",
    screens: all.filter((n) => n.kind === "screen").map((n) => (n.detail ? `${n.name}: ${n.detail}` : n.name)),
    sheets: all.filter((n) => n.kind === "sheet" || n.kind === "popup").map((n) => ({ name: n.kind === "popup" ? `Pop-up: ${n.name}` : n.name, detail: n.detail })),
    state,
    alerts: [...alerts],
  };
}

/**
 * What a pop-up notes beside its title: its line, unless it's `private` (Nov 24: ordering's pop-ups, whose lines name the
 * store, card, limit or a code, which feedback never carries).
 */
export const popupDetail = (message: unknown, hidden?: boolean) => (!hidden && typeof message === "string" ? message : "");

/**
 * Whether a press starts Feedback's hold: a primary press (a mouse's main button) on the Settings button, and only while
 * Feedback (or its "Couldn't send that" alert) isn't already showing (review, Nov 24: holding Settings again opened a
 * fresh, empty box over the words being typed).
 */
export const startsHold = (p: { isPrimary: boolean; pointerType: string; button: number }, onSettings: boolean, showing: boolean) =>
  !showing && onSettings && p.isPrimary && !(p.pointerType === "mouse" && p.button !== 0);

/** Everything the phone knows at the moment of the long press (browser only). */
export function contextNow(theme: string): FeedbackContext {
  const dark = typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  return {
    ...placeNow(),
    release: process.env.NEXT_PUBLIC_VERSION ?? "",
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    theme: `${theme}, ${dark ? "dark" : "light"}`,
    viewport: typeof window === "undefined" ? "" : `${window.innerWidth}x${window.innerHeight}`,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  };
}
