"use client";
import { useEffect, useState } from "react";
import { store } from "@/lib/client";
import { BrandBar, Button } from "./ui";

// Each kind of wait the app has, with its title and a typical length in seconds (used until this phone has its own history).
// Add one per slow step (e.g. planning the week).
export type WaitKind = "week";
const TITLE: Record<WaitKind, string> = { week: "Planning your week" };
const TYPICAL: Record<WaitKind, number> = { week: 15 };

/** How long this kind of wait usually takes on this phone: the middle of the last few, or a typical time. */
export function estimateFor(kind: WaitKind) {
  const past = [...store.waits(kind)].sort((a, b) => a - b);
  return past.length ? Math.max(4, past[Math.floor(past.length / 2)]) : TYPICAL[kind];
}

/** A progress ring and a time estimate. The server doesn't report progress, so the ring follows the estimate and slows near the end. */
export function LoadingScreen({ kind, onCancel }: { kind: WaitKind; onCancel: () => void }) {
  const [estimate] = useState(() => estimateFor(kind));
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, []);
  // Eases toward full and never quite gets there, so a slow wait doesn't look stuck at 100%.
  const progress = 1 - Math.exp((-1.6 * elapsed) / estimate);
  const left = Math.ceil(estimate - elapsed);
  const line = left > 50 ? "About a minute" : left >= 10 ? `About ${Math.round(left / 5) * 5} seconds` : left > 2 ? "A few more seconds" : "Almost there";
  const r = 37, c = 2 * Math.PI * r;

  return (
    <>
    <BrandBar />
    <div className="flex min-h-[72dvh] flex-col items-center justify-center gap-6 text-center" aria-live="polite">
      <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static SVG; next/image adds nothing here */}
      <img src="/icon.svg" alt="" className="absolute inset-[22px] size-[68px] rounded-[16px]" />
      <svg viewBox="0 0 80 80" className="size-28 -rotate-90" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={TITLE[kind]}>
        <defs>
          <linearGradient id="ring" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--g1)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--g2)" }} />
            <stop offset="1" style={{ stopColor: "var(--g3)" }} />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--sunk)" strokeWidth="4" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="url(#ring)" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} className="transition-[stroke-dashoffset] duration-300 ease-linear" />
      </svg>
      </div>
      <div className="space-y-1">
        <p className="t-title">{TITLE[kind]}</p>
        <p className="t-sub text-muted">{line}</p>
      </div>
      {/* Shows after a moment: a quick wait doesn't need it, and a double tap on the button that started the wait can't hit it. */}
      <div className={`transition-opacity duration-300 ${elapsed >= 2 ? "opacity-100" : "pointer-events-none opacity-0"}`} aria-hidden={elapsed < 2}>
        <Button variant="plain" size="md" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
    </>
  );
}
