"use client";
// Feedback (Sam, Nov 24: "Long press on settings should open a feedback text box even if a sheet is open. It should
// record the current page or sheet and state of the app in general along with the feedback text.").
// The long press is watched on the whole page, by where the Settings button is, so it works with anything open over it:
// a sheet's dimmed area, a pop-up's, or the top corner of a tall sheet. Feedback appears while the finger is still down,
// once the hold reaches half a second (Sam, Nov 24): the one timer in the app, a gesture's threshold started on the
// press and cleared on release, a move or a cancel; nothing repeats. On the release the box takes the focus (iPhone
// raises the keyboard only for a focus inside a touch's own handler) and the tap that would follow is swallowed, so
// whatever is open stays exactly as it was. A shorter press is a tap as before (Settings, or the dimmed area closing
// its sheet). The place and the state are taken as Feedback appears (lib/feedback.ts); Send closes at once and saves
// behind it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, errorText } from "@/lib/client";
import { contextNow, startsHold, type FeedbackContext } from "@/lib/feedback";
import { Alert, Button, Dialog } from "./ui";

export const HOLD_MS = 500;
/** Under the title (Sam, Nov 24): how it opened, so a hold by accident explains itself. */
export const HOW = "You held the Settings button, which opens this on any screen.";
const SLOP = 10; // px a finger may drift before it's a drag, not a hold

/** The Settings button showing now, if any (BrandBar's, marked data-settings). */
function settingsBox(): DOMRect | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-settings]")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}
const inside = (r: DOMRect, x: number, y: number) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4;
/** Feedback's box, focused from the release's own handler so the keyboard comes up. */
const focusBox = () => document.querySelector<HTMLTextAreaElement>("[data-feedback-box]")?.focus({ preventScroll: true });

export function FeedbackHost({ active, theme }: { active: boolean; theme: string }) {
  const [open, setOpen] = useState<{ ctx: FeedbackContext; text: string } | null>(null);
  const [failed, setFailed] = useState<{ ctx: FeedbackContext; text: string; why: string } | null>(null);
  const themeNow = useRef(theme);
  useEffect(() => { themeNow.current = theme; }, [theme]);
  const showing = useRef(false); // Feedback, or its alert, is up: holds are ignored
  useEffect(() => { showing.current = Boolean(open || failed); }, [open, failed]);

  useEffect(() => {
    if (!active) return;
    let press: { id: number; x: number; y: number; hold: ReturnType<typeof setTimeout> } | null = null;
    let held = false; // the hold opened Feedback: the release focuses the box and makes no tap
    let swallow = false; // a click may still follow that release (a mouse)
    const stop = () => { if (press) clearTimeout(press.hold); press = null; };
    const down = (e: PointerEvent) => {
      stop();
      held = false; swallow = false;
      const r = settingsBox();
      // Not while Feedback is showing: a second hold would replace what's being typed with an empty box.
      if (!startsHold(e, Boolean(r && inside(r, e.clientX, e.clientY)), showing.current)) return;
      // The hold's threshold (Sam, Nov 24): one timeout for this press, cleared on release, move or cancel.
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, hold: setTimeout(() => {
        press = null;
        if (showing.current) return;
        held = true;
        setFailed(null);
        setOpen({ ctx: contextNow(themeNow.current), text: "" });
      }, HOLD_MS) };
    };
    const move = (e: PointerEvent) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) stop();
    };
    const up = (e: PointerEvent) => {
      stop();
      if (!held) return;
      held = false;
      swallow = true; // the tap that follows the release must not open Settings or close what's open
      e.preventDefault();
      focusBox();
    };
    const click = (e: MouseEvent) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } };
    // A finger lifted from a long press: the box takes the focus here too (a touch's own handler, so the keyboard comes
    // up), and no tap follows (no click, and no focus moved to what's now under the finger).
    const lift = (e: TouchEvent) => { if (swallow && e.cancelable) { e.preventDefault(); swallow = false; focusBox(); } };
    // A long press with a mouse or on Android asks for the page's menu; not over Settings.
    const menu = (e: MouseEvent) => { const r = settingsBox(); if (r && inside(r, e.clientX, e.clientY)) e.preventDefault(); };
    const opts = { capture: true } as const;
    window.addEventListener("pointerdown", down, opts);
    window.addEventListener("pointermove", move, opts);
    window.addEventListener("pointerup", up, opts);
    window.addEventListener("pointercancel", stop, opts);
    window.addEventListener("click", click, opts);
    window.addEventListener("touchend", lift, { capture: true, passive: false });
    window.addEventListener("contextmenu", menu, opts);
    return () => {
      stop();
      window.removeEventListener("pointerdown", down, opts);
      window.removeEventListener("pointermove", move, opts);
      window.removeEventListener("pointerup", up, opts);
      window.removeEventListener("pointercancel", stop, opts);
      window.removeEventListener("click", click, opts);
      window.removeEventListener("touchend", lift, opts);
      window.removeEventListener("contextmenu", menu, opts);
    };
  }, [active]);

  function send(ctx: FeedbackContext, text: string) {
    setOpen(null);
    api.feedback({ ...ctx, text }).catch((e) => setFailed({ ctx, text, why: errorText(e) }));
  }

  return (
    <>
      {open && <FeedbackPopup initial={open.text} onCancel={() => setOpen(null)} onSend={(text) => send(open.ctx, text)} />}
      {/* A send that failed: the alert, then the box again with what was written. */}
      <Alert open={Boolean(failed)} title="Couldn't send that" message={failed?.why ?? ""}
        onClose={() => { const f = failed; setFailed(null); if (f) setOpen({ ctx: f.ctx, text: f.text }); }} />
    </>
  );
}

/**
 * The pop-up (Sam, Nov 24: the app's own pop-up, not a sheet), over everything: the title, the box, Cancel and Send.
 * Nothing behind it fades ("so the user retains context"); a tap outside does nothing, so words are never lost by a slip.
 */
function FeedbackPopup({ initial, onSend, onCancel }: { initial: string; onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  const cancel = useRef(onCancel);
  useEffect(() => { cancel.current = onCancel; });
  // Focused as it appears where that's allowed (and after the alert's OK, a tap); on iPhone the release focuses it.
  useLayoutEffect(() => { box.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    // Escape closes Feedback only, never the sheet or pop-up under it (they listen further along).
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); cancel.current(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  const ready = text.trim().length > 0;
  return (
    <Dialog title="Feedback" message={HOW} above clear onDismiss={onCancel}>
      <textarea ref={box} data-feedback-box value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Feedback"
        placeholder="What happened, or what would be better?"
        className="block w-full resize-none rounded-[1rem] bg-sunk px-3.5 py-2.5 text-left text-[17px] leading-snug text-ink outline-none placeholder:text-muted" />
      {/* Side by side, as the phone's own two-button pop-ups, so it stays short above the keyboard. */}
      <div className="flex gap-2 pt-2">
        <Button variant="secondary" className="min-w-0 flex-1 !px-3" onClick={onCancel}>Cancel</Button>
        <Button className="min-w-0 flex-1 !px-3" disabled={!ready} onClick={() => onSend(text.trim())}>Send</Button>
      </div>
    </Dialog>
  );
}
