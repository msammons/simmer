// The Safeway helper's picks: for each item as written on the list, the exact Safeway product to add, so the helper
// (extension/) adds it without asking next time, on any computer. One row per item in the Safeway tab; people can fix
// or delete a row by hand. Without the Sheet (local dev) the picks live in memory.
import { appendRows, ensureTab, readTab, sheetsConfigured, updateRange } from "./google/sheets";
import { records } from "./parse";
import { norm } from "./words";

export type Pick = { item: string; id: string; name: string };

const TAB = "Safeway";
const HEADERS = ["item", "product_id", "product_name", "updated"];

let memory: Pick[] = [];

export async function loadPicks(): Promise<Pick[]> {
  if (!sheetsConfigured()) return [...memory];
  const rows = await readTab(TAB).catch(() => [] as string[][]);
  return records(rows).flatMap((r) => (r.get("item") && /^\d+$/.test(r.get("product_id")) ? [{ item: r.get("item"), id: r.get("product_id"), name: r.get("product_name") }] : []));
}

/** Saves the pick for an item, replacing the one before (the same item, however it's capitalized or pluralized). */
export async function savePick(p: Pick): Promise<void> {
  const n = norm(p.item);
  if (!sheetsConfigured()) {
    memory = [...memory.filter((m) => norm(m.item) !== n), p];
    return;
  }
  await ensureTab(TAB);
  const rows = await readTab(TAB).catch(() => [] as string[][]);
  const row = [p.item, p.id, p.name, new Date().toISOString().slice(0, 10)];
  const at = records(rows).find((r) => norm(r.get("item")) === n);
  if (at) await updateRange(`${TAB}!A${at.rowNumber}:D${at.rowNumber}`, [row]);
  else await appendRows(TAB, [...(rows.length ? [] : [HEADERS]), row]);
}
