// The Google account the helper signs in to Safeway with when it finds Safeway signed out (Sam, Nov 24: "i want the
// email to be set in settings"; docs/CHECKOUT.md). Kept in the "Safeway sign-in" tab as one row, never in this public
// code. Saved empty, the helper never tries. Never saved at all: the address set in Vercel (SAFEWAY_GOOGLE), which
// is how version 1 shipped.
import { readTab, writeTab } from "./store";

const TAB = "Safeway sign-in";

/** An email address as it's kept: trimmed, lower case, 120 characters at most; anything that isn't one reads as "". */
export function cleanAccount(s: unknown): string {
  const t = typeof s === "string" ? s.trim().toLowerCase() : "";
  return t.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : "";
}

/** The account to sign in with ("" for none), and whether it was set in Settings. */
export async function loadAccount(): Promise<{ account: string; set: boolean }> {
  try {
    const row = (await readTab(TAB))[1];
    if (row) return { account: cleanAccount(row[0]), set: true };
  } catch { /* unreadable: as never saved */ }
  return { account: cleanAccount(process.env.SAFEWAY_GOOGLE), set: false };
}

/** Saves the account ("" turns signing in off) and answers what was kept. */
export async function saveAccount(s: unknown): Promise<string> {
  const account = cleanAccount(s);
  await writeTab(TAB, [["account"], [account]]);
  return account;
}
