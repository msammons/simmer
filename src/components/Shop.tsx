"use client";
import { type Store } from "@/lib/client";

export const STORE_NAMES: Record<Store, string> = { safeway: "Safeway", "trader-joes": "Trader Joe's", costco: "Costco" };

/** A round check, filled when the item's in the cart. */
export function Check({ on }: { on: boolean }) {
  return (
    <span className={`flex size-6 items-center justify-center rounded-full border-2 ${on ? "border-accent bg-accent text-on-accent" : "border-muted/50"}`} aria-hidden>
      {on && <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 12l5 5 9-10" /></svg>}
    </span>
  );
}
