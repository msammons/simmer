// Ordering's settings rules that the phone needs too (Nov 13), kept free of server code so Settings and Check out can
// use them. checkout.ts uses and re-exports them; its tests cover them.

/** Ordering's settings. Off and $0 until the household changes them; anything missing or unreadable reads as off / $0. */
export type CheckoutSettings = { on: boolean; limitCents: number; store: string; card: string };

/**
 * Whether a change needs a Face ID check (Sam, Nov 13): turning ordering on, raising the limit, or changing the pickup
 * store or card. Turning off and lowering the limit only make ordering safer, so they need nothing. Callers compare
 * cleaned settings, and settings that couldn't be read count as off / $0, so a doubt means Face ID.
 */
export function needsFaceId(before: CheckoutSettings, after: CheckoutSettings): boolean {
  return (after.on && !before.on) || after.limitCents > before.limitCents || after.store !== before.store || after.card !== before.card;
}
