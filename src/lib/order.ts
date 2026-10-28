// A Safeway order started from Simmer and filled by the Safeway helper (extension/) in Chrome on a computer that's
// left on. Simmer keeps the one current order in the "Safeway order" tab: the phone starts it and answers questions,
// the helper picks it up, fills the cart, reports each item, and asks when it isn't sure. Without the Sheet (local dev)
// it lives in memory.
import { ensureTab, readTab, sheetsConfigured, updateRange } from "./google/sheets";
import { records } from "./parse";

/**
 * waiting: started, nothing's picked it up yet. filling: the helper is at it. asking: it needs an answer. done or
 * stopped: over (note says why it stopped).
 */
export type OrderStatus = "waiting" | "filling" | "asking" | "done" | "stopped";
export type OrderOption = { id: string; name: string; price: string; image: string };
export type OrderQuestion = { itemId: string; item: string; quantity: string; options: OrderOption[] };
export type OrderAnswer = { itemId: string; pick?: { id: string; name: string }; skip?: boolean; search?: string };
export type OrderLine = { itemId: string; item: string; quantity: string; state: "to do" | "in cart" | "skipped" | "by hand"; qty?: number; name?: string; productId?: string };
export type Order = {
  id: string; status: OrderStatus; started: string; updated: string; note: string;
  lines: OrderLine[]; question: OrderQuestion | null; answer: OrderAnswer | null;
};

const TAB = "Safeway order";
const HEADERS = ["id", "status", "started", "updated", "note", "lines", "question", "answer"];
let memory: Order | null = null;

const json = <T>(s: string, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };

export async function loadOrder(): Promise<Order | null> {
  if (!sheetsConfigured()) return memory;
  const r = records(await readTab(TAB).catch(() => [] as string[][]))[0];
  if (!r?.get("id")) return null;
  return {
    id: r.get("id"), status: (r.get("status") || "waiting") as OrderStatus, started: r.get("started"), updated: r.get("updated"), note: r.get("note"),
    lines: json(r.get("lines"), []), question: json(r.get("question"), null), answer: json(r.get("answer"), null),
  };
}

async function save(o: Order): Promise<Order> {
  o = { ...o, updated: new Date().toISOString() };
  if (!sheetsConfigured()) { memory = o; return o; }
  // Written in place (headers and one row), so the order is never missing while it's being written.
  await ensureTab(TAB);
  await updateRange(`${TAB}!A1:H2`, [HEADERS, [o.id, o.status, o.started, o.updated, o.note, JSON.stringify(o.lines), o.question ? JSON.stringify(o.question) : "", o.answer ? JSON.stringify(o.answer) : ""]]);
  return o;
}

export const isOpen = (o: Order | null) => Boolean(o && (o.status === "waiting" || o.status === "filling" || o.status === "asking"));

/** The phone: start an order (or keep the one already going). */
export async function startOrder(): Promise<Order> {
  const now = await loadOrder();
  if (now && isOpen(now)) return now;
  const at = new Date().toISOString();
  return save({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, status: "waiting", started: at, updated: at, note: "", lines: [], question: null, answer: null });
}

/** The helper: take a waiting order, with the items it's about to fill. Null if there's none to take. */
export async function claimOrder(lines: OrderLine[]): Promise<Order | null> {
  const o = await loadOrder();
  if (!o || o.status !== "waiting") return null;
  return save({ ...o, status: "filling", lines, note: "" });
}

/** The helper: how the items stand, and what it's doing now. */
export async function reportOrder(id: string, lines: OrderLine[], note: string): Promise<Order | null> {
  const o = await loadOrder();
  if (!o || o.id !== id || !isOpen(o)) return o;
  return save({ ...o, lines, note, status: o.status === "asking" ? "asking" : "filling" });
}

/** The helper: ask which product. */
export async function askOrder(id: string, question: OrderQuestion): Promise<Order | null> {
  const o = await loadOrder();
  if (!o || o.id !== id || !isOpen(o)) return o;
  return save({ ...o, status: "asking", question, answer: null });
}

/** The phone: answer the question. */
export async function answerOrder(id: string, answer: OrderAnswer): Promise<Order | null> {
  const o = await loadOrder();
  if (!o || o.id !== id || o.status !== "asking" || o.question?.itemId !== answer.itemId) return o;
  return save({ ...o, status: "filling", question: null, answer });
}

/** Either side: the order's over, done or stopped (with why). */
export async function endOrder(id: string, status: "done" | "stopped", note = ""): Promise<Order | null> {
  const o = await loadOrder();
  if (!o || o.id !== id || !isOpen(o)) return o;
  return save({ ...o, status, note, question: null });
}

/** For tests. */
export const resetOrder = () => { memory = null; };
