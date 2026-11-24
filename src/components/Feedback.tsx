"use client";
// Feedback (Sam, Nov 24: "Long press on settings should open a feedback text box even if a sheet is open. It should
// record the current page or sheet and state of the app in general along with the feedback text.").
// The long press is watched on the whole page, by where the Settings button is, so it works with anything open over it:
// a sheet's dimmed area, a pop-up's, or the top corner of a tall sheet. A hold of half a second or more without moving,
// timed from press to release (no timer), opens Feedback on release and swallows the tap that would follow, so whatever
// is open stays exactly as it was; a shorter press is a tap as before (Settings, or the dimmed area closing its sheet).
// The place and the state are taken at the press (lib/feedback.ts); Send closes at once and saves behind it.
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "@/lib/client";
import { contextNow, type FeedbackContext } from "@/lib/feedback";
import { Alert, Button, Sheet } from "./ui";

export const HOLD_MS = 500;
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

/**
 * Focuses a hidden field during the press itself, so the keyboard comes up when Feedback's box takes the focus a moment
 * later (iPhone shows the keyboard only for a focus that comes from a touch). The box removes it once it has the focus.
 */
function primeKeyboard() {
  const f = document.createElement("input");
  f.setAttribute("aria-hidden", "true");
  f.dataset.feedbackPrime = "";
  f.tabIndex = -1;
  f.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none";
  document.body.appendChild(f);
  f.focus({ preventScroll: true });
}

export function FeedbackHost({ active, theme }: { active: boolean; theme: string }) {
  const [open, setOpen] = useState<{ ctx: FeedbackContext; text: string } | null>(null);
  const [failed, setFailed] = useState<{ ctx: FeedbackContext; text: string; why: string } | null>(null);
  const themeNow = useRef(theme);
  useEffect(() => { themeNow.current = theme; }, [theme]);

  useEffect(() => {
    if (!active) return;
    let press: { id: number; x: number; y: number; t: number } | null = null;
    let swallow = false;
    const down = (e: PointerEvent) => {
      swallow = false;
      press = null;
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const r = settingsBox();
      if (r && inside(r, e.clientX, e.clientY)) press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    };
    const move = (e: PointerEvent) => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) press = null;
    };
    const up = (e: PointerEvent) => {
      const p = press;
      press = null;
      if (!p || e.pointerId !== p.id || e.timeStamp - p.t < HOLD_MS) return;
      swallow = true; // the tap that follows the release must not open Settings or close a sheet
      e.preventDefault();
      primeKeyboard();
      setFailed(null);
      setOpen({ ctx: contextNow(themeNow.current), text: "" });
    };
    const cancel = () => { press = null; };
    const click = (e: MouseEvent) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } };
    // A finger lifted from a long press: no tap at all follows (no click, and no focus moved to what's now under it).
    const lift = (e: TouchEvent) => { if (swallow && e.cancelable) { e.preventDefault(); swallow = false; } };
    // A long press with a mouse or on Android asks for the page's menu; not over Settings.
    const menu = (e: MouseEvent) => { const r = settingsBox(); if (r && inside(r, e.clientX, e.clientY)) e.preventDefault(); };
    const opts = { capture: true } as const;
    window.addEventListener("pointerdown", down, opts);
    window.addEventListener("pointermove", move, opts);
    window.addEventListener("pointerup", up, opts);
    window.addEventListener("pointercancel", cancel, opts);
    window.addEventListener("click", click, opts);
    window.addEventListener("touchend", lift, { capture: true, passive: false });
    window.addEventListener("contextmenu", menu, opts);
    return () => {
      window.removeEventListener("pointerdown", down, opts);
      window.removeEventListener("pointermove", move, opts);
      window.removeEventListener("pointerup", up, opts);
      window.removeEventListener("pointercancel", cancel, opts);
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
      {open && <FeedbackSheet initial={open.text} onCancel={() => setOpen(null)} onSend={(text) => send(open.ctx, text)} />}
      {/* A send that failed: the alert, then the box again with what was written. */}
      <Alert open={Boolean(failed)} title="Couldn't send that" message={failed?.why ?? ""}
        onClose={() => { const f = failed; setFailed(null); if (f) setOpen({ ctx: f.ctx, text: f.text }); }} />
    </>
  );
}

function FeedbackSheet({ initial, onSend, onCancel }: { initial: string; onSend: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const box = useRef<HTMLTextAreaElement>(null);
  const cancel = useRef(onCancel);
  useEffect(() => { cancel.current = onCancel; });
  useEffect(() => {
    box.current?.focus({ preventScroll: true });
    document.querySelectorAll("[data-feedback-prime]").forEach((f) => f.remove());
    // Escape closes Feedback only, never the sheet or pop-up under it (they listen further along).
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); cancel.current(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  const ready = text.trim().length > 0;
  return (
    <Sheet label="Feedback" title="Feedback" above onClose={onCancel}
      footer={(
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button className="flex-1" disabled={!ready} onClick={() => onSend(text.trim())}>Send</Button>
        </div>
      )}>
      <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="Feedback"
        placeholder="What happened, or what would be better?"
        className="block w-full resize-none rounded-[1.375rem] bg-card px-4 py-3 text-[17px] leading-snug text-ink outline-none placeholder:text-muted" />
    </Sheet>
  );
}
