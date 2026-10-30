"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

// The app's building blocks. Screens use these rather than one-off styles, so every screen looks and behaves the same:
// pills for controls, 22px cards (inset grouped lists), 36px sheets, the t-* type scale, one line-icon set.

const PRESS = "transition active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100";

/** The app's scrolling area (the page itself never scrolls; see globals.css), and moving it. */
export const scroller = () => document.getElementById("scroller");
export function scrollAppTo(top: number, smooth = false) {
  scroller()?.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
}

/** Primary: tinted glass, one per screen. Secondary: clear glass. Plain: accent text. */
export function Button({ children, onClick, href, disabled, type = "button", variant = "primary", size = "lg", icon, className = "" }: {
  children: ReactNode; onClick?: () => void; href?: string; disabled?: boolean; type?: "button" | "submit";
  variant?: "primary" | "secondary" | "plain"; size?: "lg" | "md"; icon?: IconName; className?: string;
}) {
  const look = variant === "primary" ? "glass-tint text-on-accent disabled:shadow-none" : variant === "secondary" ? "glass text-accent" : "text-accent";
  const box = size === "lg" ? "h-[52px] px-6 t-headline" : "h-11 px-4 t-sub font-semibold";
  const cls = `inline-flex items-center justify-center gap-2 rounded-full ${box} ${look} ${PRESS} ${className}`;
  const inner = <>{icon && <Icon name={icon} className="size-5" strokeWidth={2} />}{children}</>;
  return href
    ? <a href={href} className={cls}>{inner}</a>
    : <button type={type} onClick={onClick} disabled={disabled} className={cls}>{inner}</button>;
}

/** The brand: the app icon and "Simmer" in SF Pro Rounded. sm in every screen's top bar; md on the splash and sign-in. */
export function Brand({ size = "sm" }: { size?: "sm" | "md" }) {
  const s = { sm: ["size-7 rounded-[8px]", "text-[19px]", "gap-2"], md: ["size-20 rounded-[1.4rem]", "text-[36px]", "gap-4 flex-col"] }[size];
  return (
    <span className={`inline-flex items-center ${s[2]}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing here */}
      <img src="/icon.svg" alt="" className={`${s[0]} shadow-[0_4px_14px_color-mix(in_srgb,var(--g2)_30%,transparent)]`} />
      <span className={`font-brand font-extrabold leading-none tracking-[-0.03em] text-ink ${s[1]}`}>Simmer</span>
    </span>
  );
}

export function Splash() {
  return (
    <div className="flex min-h-[85dvh] animate-[fade_.4s_ease-out] flex-col items-center justify-center gap-4">
      <Brand size="md" />
    </div>
  );
}

/** A round glass button with one icon: back, settings, small actions. */
export function IconButton({ icon, label, onClick, href, tone = "ink" }: { icon: IconName; label: string; onClick?: () => void; href?: string; tone?: "ink" | "accent" }) {
  const cls = `glass flex size-11 shrink-0 items-center justify-center rounded-full ${tone === "accent" ? "text-accent" : "text-ink"} ${PRESS}`;
  return href
    ? <a href={href} aria-label={label} className={cls}><Icon name={icon} strokeWidth={2} /></a>
    : <button onClick={onClick} aria-label={label} className={cls}><Icon name={icon} strokeWidth={2} /></button>;
}

/**
 * The top of every screen, identical everywhere so nothing jumps between pages: a bar that stays put while the page
 * scrolls, with the Simmer lockup at the left and Settings at the right, then one large title in the same
 * place and size on every screen, with an optional line under it. On screens you drill into, a round back button sits
 * just before the title (swiping right also goes back), so the lockup never moves.
 */
export function TopBar({ title, subtitle, onBack, backLabel = "Back", trailing }: {
  title: ReactNode; subtitle?: ReactNode; onBack?: () => void; backLabel?: string; trailing?: ReactNode;
}) {
  return (
    <>
      <BrandBar trailing={trailing} />
      <header className="space-y-1 pt-3">
        <div className="flex items-center gap-2.5">
          {onBack && <BackButton onBack={onBack} label={backLabel} className="self-start mt-[3px]" />}
          <h1 className="min-w-0 text-[32px] font-bold leading-[1.15] tracking-tight">{title}</h1>
        </div>
        {subtitle && <p className="t-sub text-muted">{subtitle}</p>}
      </header>
    </>
  );
}

/** The round back button at the start of a screen's title; its label names the screen it goes back to. */
function BackButton({ onBack, label, className = "" }: { onBack: () => void; label: string; className?: string }) {
  return (
    <button onClick={onBack} aria-label={label} className={`glass -ml-1 flex size-9 shrink-0 items-center justify-center rounded-full text-ink transition active:scale-90 ${className}`}>
      <Icon name="left" className="size-[18px]" strokeWidth={2.4} />
    </button>
  );
}

/** Opens Settings; set by the app so every screen's top bar has the same Settings button at the right. */
export const OpenSettings = createContext<(() => void) | null>(null);

/** The bar at the top of every screen: the Simmer lockup at the left; at the right, at most one action, then Settings. */
export function BrandBar({ trailing }: { trailing?: ReactNode }) {
  const settings = useContext(OpenSettings);
  return (
    <div className="sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-10 flex h-11 items-center justify-between">
      {/* Scroll edge: content passing under the bar blurs and fades, as under iOS bars. */}
      <span aria-hidden className="pointer-events-none absolute -inset-x-4 -bottom-3 -top-[calc(env(safe-area-inset-top)+0.5rem)] -z-10 bg-bg/70 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_55%,transparent)]" />
      <Brand />
      <div className="flex gap-2">{trailing}{settings && <IconButton icon="sliders" label="Settings" onClick={settings} />}</div>
    </div>
  );
}

/** When a list has nothing in it: an icon, a line, a sentence, and optionally one way forward. */
export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[1.375rem] bg-card px-6 py-10 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-accent/12 text-accent"><Icon name={icon} className="size-7" /></span>
      <p className="t-headline">{title}</p>
      {children && <p className="t-sub text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** An inset grouped list (iOS settings style), with an optional small header and footer. */
export function Group({ header, footer, children, aside }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-1.5">
      {(header || aside) && (
        <div className="flex items-baseline justify-between px-4">
          <h2 className="t-foot font-semibold text-muted">{header}</h2>
          {aside}
        </div>
      )}
      <div className="divide-y divide-line overflow-hidden rounded-[1.375rem] bg-card [&>*]:border-line">{children}</div>
      {footer && <p className="px-4 t-foot text-muted">{footer}</p>}
    </section>
  );
}

/** A tinted round badge holding an icon, used at the start of rows and cards. */
export function IconBadge({ icon, size = "md" }: { icon: IconName; size?: "md" | "lg" }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-accent/12 text-accent ${size === "lg" ? "size-11" : "size-9"}`}>
      <Icon name={icon} className={size === "lg" ? "size-[22px]" : "size-5"} />
    </span>
  );
}

/** One row of a Group. With onClick or href it's a button; accessory "chevron" for drill-in, "check" for a picked choice. */
export function Row({ icon, lead, title, subtitle, value, accessory, onClick, href, role, checked }: {
  icon?: IconName; lead?: ReactNode; title: ReactNode; subtitle?: ReactNode; value?: ReactNode;
  accessory?: "chevron" | "check" | "external" | ReactNode; onClick?: () => void; href?: string;
  role?: "radio" | "checkbox"; checked?: boolean;
}) {
  const inner = (
    <>
      {icon ? <IconBadge icon={icon} /> : lead && <span className="flex size-9 shrink-0 items-center justify-center">{lead}</span>}
      <span className="min-w-0 flex-1">
        <span className="block t-body">{title}</span>
        {subtitle && <span className="mt-0.5 block t-foot text-muted">{subtitle}</span>}
      </span>
      {/* A value on a row you can tap reads as the action ("Directions", "Try again"); otherwise it's information. */}
      {value && <span className={`shrink-0 t-sub ${href || onClick ? "text-accent" : "text-muted"}`}>{value}</span>}
      {accessory === "chevron" ? <Icon name="right" className="size-4 text-muted/70" strokeWidth={2.2} />
        : accessory === "external" ? <Icon name="external" className="size-4 text-muted/70" strokeWidth={2.2} />
        : accessory === "check" ? <Icon name="check" className={`size-5 text-accent ${checked ? "" : "invisible"}`} strokeWidth={2.4} />
        : accessory}
    </>
  );
  const cls = "flex w-full items-center gap-3 px-4 py-3 text-left";
  if (href) return <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={`${cls} active:bg-sunk`}>{inner}</a>;
  if (onClick) return <button onClick={onClick} role={role} aria-checked={role ? Boolean(checked) : undefined} className={`${cls} active:bg-sunk`}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

/** A message in the flow of a screen: warn for problems, info for notes. */
export function Notice({ children, tone = "warn", onClick }: { children: ReactNode; tone?: "warn" | "info"; onClick?: () => void }) {
  const cls = `flex w-full items-start gap-2.5 rounded-[1.375rem] px-4 py-3 text-left t-sub ${tone === "warn" ? "bg-warn-bg text-warn-ink" : "bg-card text-ink"}`;
  const inner = <><Icon name="info" className="mt-px size-[18px]" />{<span className="min-w-0 flex-1">{children}</span>}</>;
  return onClick ? <button onClick={onClick} className={cls}>{inner}</button> : <div role={tone === "warn" ? "alert" : undefined} className={cls}>{inner}</div>;
}

/** Pick one, iOS-style. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-full bg-sunk p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-2 py-1.5 t-sub font-medium transition ${value === o.value ? "glass text-ink" : "text-muted"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The floating tab bar, as in current iOS: two tabs in a glass capsule, and Search as its own round button.
 * Tapping Search turns that button into a search field (keyboard up at once) and shrinks the tabs to one round button
 * for the tab you came from; tapping that goes back. The bar rides above the keyboard.
 */
export type TabDef<T extends string> = { id: T; label: string; icon: IconName; dot?: boolean };
/** The tabs at the bottom of every screen once signed in, the one you're in lit. */
export function TabBar<T extends string>({ tabs, active, onTab }: { tabs: TabDef<T>[]; active: T | null; onTab: (t: T) => void }) {
  return (
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <span aria-hidden className="absolute inset-x-0 -top-6 bottom-0 -z-10 bg-bg/60 backdrop-blur-md [mask-image:linear-gradient(to_top,black_50%,transparent)]" />
      <div className="glass pointer-events-auto mx-auto flex h-[58px] max-w-md gap-1 rounded-full p-1">
        {tabs.map(({ id, label, icon, dot }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            aria-current={active === id ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 t-cap font-medium transition active:scale-95 ${active === id ? "bg-accent/12 text-accent" : "text-muted"}`}
          >
            <Icon name={icon} className="size-6" />
            {label}
            {dot && <span className="absolute right-[calc(50%-18px)] top-1.5 size-2 rounded-full bg-alert ring-2 ring-card" aria-label="new" />}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** How far the on-screen keyboard covers the page, from the visual viewport (0 when it's down). */
const KEYBOARD_PX = 120; // smaller gaps are the toolbar or the scroll bounce, not a keyboard
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // The visible area also shifts while scrolling (Safari's toolbar collapsing, the bounce at the ends), so only count
    // it while someone is typing and the gap is keyboard-sized; otherwise the bar would jump around on scroll.
    const update = () => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      const gap = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      setInset(typing && gap > KEYBOARD_PX ? gap : 0);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    return () => {
      vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update);
      window.removeEventListener("focusin", update); window.removeEventListener("focusout", update);
    };
  }, []);
  return inset;
}

type Gesture = { x: number; y: number; t: number; axis: "x" | "y" | null; ok: boolean };
const SWIPE_PX = 70; // how far a horizontal swipe must travel
const CLOSE_PX = 110; // how far a sheet must be pulled down to close

/** Elements that scroll sideways or take typing keep their own touches. */
const ownsTouch = (el: EventTarget | null) => el instanceof Element && Boolean(el.closest("[data-noswipe], input, textarea, select"));

/**
 * Sideways swipes on the whole screen: the content follows the finger, and a long enough swipe calls
 * onRight (usually "back") or onLeft. Vertical scrolling is untouched.
 */
export function useSwipe(target: React.RefObject<HTMLElement | null>, handlers: { onLeft?: () => void; onRight?: () => void }) {
  const h = useRef(handlers);
  useEffect(() => { h.current = handlers; });
  const enabled = Boolean(handlers.onLeft || handlers.onRight);
  useEffect(() => {
    if (!enabled) return;
    let g: Gesture | null = null;
    const el = () => target.current;
    const reset = (animate: boolean) => {
      const e = el();
      if (!e) return;
      e.style.transition = animate ? "transform .2s ease-out" : "";
      e.style.transform = "";
    };
    const start = (ev: TouchEvent) => {
      // A sheet handles its own swipes; the screen behind it shouldn't go back too.
      if (ev.touches.length !== 1 || ownsTouch(ev.target) || (ev.target instanceof Element && ev.target.closest('[role="dialog"]'))) { g = null; return; }
      const t = ev.touches[0];
      g = { x: t.clientX, y: t.clientY, t: Date.now(), axis: null, ok: true };
    };
    const move = (ev: TouchEvent) => {
      if (!g) return;
      const t = ev.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.axis && Math.hypot(dx, dy) > 10) g.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
      if (g.axis !== "x") return;
      const allowed = (dx > 0 && h.current.onRight) || (dx < 0 && h.current.onLeft);
      const e = el();
      if (e) { e.style.transition = ""; e.style.transform = `translateX(${allowed ? dx * 0.6 : dx * 0.1}px)`; }
    };
    const end = (ev: TouchEvent) => {
      if (!g || g.axis !== "x") { g = null; return; }
      const dx = ev.changedTouches[0].clientX - g.x;
      const fast = Math.abs(dx) > 40 && Date.now() - g.t < 250;
      g = null;
      reset(true);
      if (dx > SWIPE_PX || (fast && dx > 0)) h.current.onRight?.();
      else if (dx < -SWIPE_PX || (fast && dx < 0)) h.current.onLeft?.();
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    const cancel = () => { g = null; reset(true); };
    window.addEventListener("touchcancel", cancel);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", cancel);
    };
  }, [enabled, target]);
}

/**
 * A sheet that slides up over the current screen, like an iOS sheet: one grabber, no close button. Close it by pulling it down
 * (from the grabber, or anywhere once its content is scrolled to the top), tapping the dimmed area, or pressing Escape.
 * With onPrev/onNext, swiping sideways moves between items, and page dots under the grabber show where you are.
 */
export function Sheet({ children, onClose, label, title, footer, onPrev, onNext, page, pager }: {
  children: ReactNode; onClose: () => void; label: string; footer?: ReactNode; onPrev?: () => void; onNext?: () => void;
  title?: ReactNode; // a centered heading under the grabber, for picker sheets
  page?: string; // changes when the sheet shows a different item: scroll back to its top
  pager?: { index: number; total: number };
}) {
  // Once per open: re-running on every new onClose would save "hidden" as the value to restore.
  const close = useRef(onClose);
  const nav = useRef({ onPrev, onNext });
  useEffect(() => { close.current = onClose; nav.current = { onPrev, onNext }; });
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardInset(); // a sheet with a text field rides above the keyboard, like the tab bar
  useEffect(() => { body.current?.scrollTo(0, 0); }, [page]);
  useEffect(() => {
    const behind = scroller(), prev = behind?.style.overflow ?? "";
    if (behind) behind.style.overflow = "hidden"; // the list behind shouldn't scroll
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", esc);
    return () => { if (behind) behind.style.overflow = prev; window.removeEventListener("keydown", esc); };
  }, []);
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    let g: (Gesture & { fromTop: boolean }) | null = null;
    const set = (tf: string, animate: boolean) => { p.style.transition = animate ? "transform .22s cubic-bezier(.2,.8,.2,1)" : ""; p.style.transform = tf; };
    const start = (ev: TouchEvent) => {
      if (ev.touches.length !== 1) return;
      const t = ev.touches[0];
      // A pull only counts as "close" when the content can't scroll up any further.
      const fromTop = (body.current?.scrollTop ?? 0) <= 0 || (ev.target instanceof Element && Boolean(ev.target.closest("[data-handle]")));
      g = { x: t.clientX, y: t.clientY, t: Date.now(), axis: null, ok: !ownsTouch(ev.target), fromTop };
    };
    const move = (ev: TouchEvent) => {
      if (!g || !g.ok) return;
      const t = ev.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.axis && Math.hypot(dx, dy) > 10) g.axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
      if (g.axis === "y" && g.fromTop && dy > 0) {
        ev.preventDefault(); // pull the sheet, not the page
        set(`translateY(${dy}px)`, false);
      } else if (g.axis === "x" && (nav.current.onPrev || nav.current.onNext)) {
        ev.preventDefault();
        const allowed = (dx > 0 && nav.current.onPrev) || (dx < 0 && nav.current.onNext);
        set(`translateX(${allowed ? dx * 0.5 : dx * 0.1}px)`, false);
      }
    };
    const end = (ev: TouchEvent) => {
      if (!g) return;
      const t = ev.changedTouches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      const fast = Date.now() - g.t < 250;
      const gesture = g;
      g = null;
      if (gesture.axis === "y" && gesture.fromTop && (dy > CLOSE_PX || (fast && dy > 50))) {
        set("translateY(100%)", true);
        setTimeout(() => close.current(), 180);
        return;
      }
      set("", true);
      if (gesture.axis === "x") {
        if ((dx > SWIPE_PX || (fast && dx > 40)) && nav.current.onPrev) nav.current.onPrev();
        else if ((dx < -SWIPE_PX || (fast && dx < -40)) && nav.current.onNext) nav.current.onNext();
      }
    };
    p.addEventListener("touchstart", start, { passive: true });
    p.addEventListener("touchmove", move, { passive: false });
    p.addEventListener("touchend", end);
    p.addEventListener("touchcancel", end);
    return () => {
      p.removeEventListener("touchstart", start);
      p.removeEventListener("touchmove", move);
      p.removeEventListener("touchend", end);
      p.removeEventListener("touchcancel", end);
    };
  }, []);
  return (
    <div className="fixed inset-0 z-20 flex items-end" role="dialog" aria-modal="true" aria-label={label}>
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 animate-[fade_.2s_ease-out] bg-black/25" />
      {/* Floats a little off the screen edges, with rounded corners all round, like iOS sheets. */}
      <div ref={panel} style={keyboard ? { marginBottom: keyboard + 8, maxHeight: `calc(100dvh - env(safe-area-inset-top) - ${keyboard + 24}px)` } : undefined} className="relative mx-auto mb-[max(0.5rem,env(safe-area-inset-bottom))] flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-md animate-[rise_.35s_cubic-bezier(.2,.9,.25,1)] flex-col overflow-hidden rounded-[2.25rem] border-[0.5px] border-white/40 bg-bg/90 shadow-2xl backdrop-blur-2xl will-change-transform dark:border-white/10">
        <div data-handle className="flex cursor-grab flex-col items-center gap-2 pb-3 pt-2">
          <span className="h-[5px] w-9 rounded-full bg-muted/40" />
          {pager && pager.total > 1 && <Dots {...pager} />}
          {title && <h2 className="t-headline">{title}</h2>}
        </div>
        <div ref={body} className="overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
        {footer && <div className="px-4 pb-4 pt-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Page dots, iOS-style. Past 9 items they'd crowd, so it says "4 of 12" instead. */
function Dots({ index, total }: { index: number; total: number }) {
  if (total > 9) return <span className="text-[11px] tabular-nums text-muted" aria-label={`${index + 1} of ${total}`}>{index + 1} of {total}</span>;
  return (
    <span className="flex gap-1.5" aria-label={`${index + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`size-1.5 rounded-full transition-colors ${i === index ? "bg-ink" : "bg-muted/35"}`} />
      ))}
    </span>
  );
}
