import { friendly } from "@/lib/friendly";
import { authorized, unauthorized } from "@/lib/auth";
import { answerOrder, askOrder, claimOrder, endOrder, loadOrder, reportOrder, startOrder, type OrderAnswer, type OrderLine, type OrderQuestion } from "@/lib/order";

const text = (s: unknown, max = 200) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const lines = (x: unknown): OrderLine[] => (Array.isArray(x) ? x.slice(0, 120) : []).map((l) => ({
  itemId: text(l?.itemId, 40), item: text(l?.item, 80), quantity: text(l?.quantity, 30),
  state: ["to do", "in cart", "skipped", "by hand"].includes(l?.state) ? l.state : "to do",
  ...(Number.isFinite(l?.qty) && { qty: Math.min(Math.max(Math.round(l.qty), 0), 99) }),
  ...(l?.name && { name: text(l.name, 160) }),
  ...(/^\d{1,20}$/.test(l?.productId ?? "") && { productId: l.productId }),
}));
const question = (q: { itemId?: unknown; item?: unknown; quantity?: unknown; options?: unknown } | null): OrderQuestion => ({
  itemId: text(q?.itemId, 40), item: text(q?.item, 80), quantity: text(q?.quantity, 30),
  options: (Array.isArray(q?.options) ? q.options.slice(0, 40) : []).filter((o) => /^\d{1,20}$/.test(o?.id ?? "")).map((o) => ({
    id: o.id, name: text(o.name, 160), price: text(o.price, 40), image: /^https:\/\//.test(o.image ?? "") ? text(o.image, 400) : "",
  })),
});
const answer = (a: { itemId?: unknown; pick?: { id?: unknown; name?: unknown }; skip?: unknown; search?: unknown } | null): OrderAnswer => ({
  itemId: text(a?.itemId, 40),
  ...(a?.pick && /^\d{1,20}$/.test(String(a.pick.id)) && { pick: { id: String(a.pick.id), name: text(a.pick.name, 160) } }),
  ...(a?.skip === true && { skip: true }),
  ...(text(a?.search, 80) && { search: text(a?.search, 80) }),
});

/** GET: the current Safeway order, or null. */
export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  try {
    return Response.json({ order: await loadOrder() }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}

/**
 * POST { op, ... }. From the phone: start {}, answer { id, answer }, stop { id }. From the Safeway helper: claim
 * { lines }, report { id, lines, note }, ask { id, question }, end { id, status, note }. Answers with the order.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  const b = await req.json().catch(() => null);
  const id = text(b?.id, 40);
  try {
    let order;
    switch (b?.op) {
      case "start": order = await startOrder(); break;
      case "claim": order = await claimOrder(lines(b.lines)); break;
      case "report": order = await reportOrder(id, lines(b.lines), text(b.note)); break;
      case "ask": order = await askOrder(id, question(b.question)); break;
      case "answer": order = await answerOrder(id, answer(b.answer)); break;
      case "stop": order = await endOrder(id, "stopped", "Stopped. What's in the cart stays there."); break;
      case "end": order = await endOrder(id, b.status === "done" ? "done" : "stopped", text(b.note)); break;
      default: return Response.json({ error: "Unknown change." }, { status: 400 });
    }
    return Response.json({ order }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: friendly(e) }, { status: 502 });
  }
}
