"use client";
// Settings → Ordering (docs/CHECKOUT.md, Nov 12): ordering from Simmer is off, with a $0 limit, until the household
// changes it here; the pickup store and the card's last 4 digits are set once, and Safeway showing anything else stops
// an order. Every tap shows at once and saves behind it; turning it on asks first.
import { useEffect, useState } from "react";
import { api, errorText, type CheckoutSettings } from "@/lib/client";
import { Alert, Button, ConfirmSheet, Group, Row, Sheet } from "./ui";

const OFF: CheckoutSettings = { on: false, limitCents: 0, store: "", card: "" };
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const FIELD = "w-full rounded-2xl bg-card px-4 py-3 text-base outline-none ring-accent focus:ring-2";

export function OrderingSettings() {
  const [s, setS] = useState<CheckoutSettings>(OFF);
  const [server, setServer] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    api.checkout(ac.signal).then((r) => { setS(r.settings); setServer(r.server); }).catch(() => {});
    return () => ac.abort();
  }, []);

  function save(next: CheckoutSettings) {
    const before = s;
    setS(next);
    api.saveCheckout(next).then((r) => { setS(r.settings); setServer(r.server); }).catch((e) => { setS(before); setProblem(errorText(e)); });
  }

  return (
    <>
      <Group header="Ordering" footer={server ? "Pickup orders from Shop. Each one needs Face ID, and nothing over the limit goes through." : "Ordering from Simmer isn't available yet."}>
        <Row icon="cart" title="Order from Simmer" value={s.on ? "On" : "Off"} onClick={() => (s.on ? save({ ...s, on: false }) : setAsking(true))} />
        <Row icon="sliders" title="Limit per order" value={dollars(s.limitCents)} onClick={() => setEditing(true)} />
        <Row icon="home" title="Pickup store" value={s.store || "Not set"} onClick={() => setEditing(true)} />
        <Row icon="card" title="Card" value={s.card ? `•••• ${s.card}` : "Not set"} onClick={() => setEditing(true)} />
      </Group>
      <ConfirmSheet
        open={asking}
        title="Turn on ordering?"
        message={`Orders still need Face ID, and nothing over ${dollars(s.limitCents)} goes through.`}
        confirm="Turn on"
        onConfirm={() => { setAsking(false); save({ ...s, on: true }); }}
        onCancel={() => setAsking(false)}
      />
      {editing && <OrderingEditor value={s} onSave={(v) => { setEditing(false); save(v); }} onClose={() => setEditing(false)} />}
      <Alert open={Boolean(problem)} title="That didn't go through" message={problem ?? ""} onClose={() => setProblem(null)} />
    </>
  );
}

function OrderingEditor({ value, onSave, onClose }: { value: CheckoutSettings; onSave: (v: CheckoutSettings) => void; onClose: () => void }) {
  const [limit, setLimit] = useState(value.limitCents ? (value.limitCents / 100).toFixed(2).replace(/\.00$/, "") : "0");
  const [store, setStore] = useState(value.store);
  const [card, setCard] = useState(value.card);
  const cents = /^\d{1,4}(\.\d{1,2})?$/.test(limit.trim()) ? Math.round(Number(limit.trim()) * 100) : null;
  const ok = cents !== null && cents <= 100_000 && (card === "" || /^\d{4}$/.test(card));
  return (
    <Sheet label="Ordering" title="Ordering" onClose={onClose}>
      <div className="space-y-4 pb-2">
        <label className="block space-y-1.5">
          <span className="t-foot px-4 uppercase tracking-wide text-muted">Limit per order</span>
          <input className={FIELD} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Limit per order in dollars" />
        </label>
        <label className="block space-y-1.5">
          <span className="t-foot px-4 uppercase tracking-wide text-muted">Pickup store</span>
          <input className={FIELD} value={store} onChange={(e) => setStore(e.target.value)} placeholder="Its street address, as Safeway shows it" aria-label="Pickup store" />
        </label>
        <label className="block space-y-1.5">
          <span className="t-foot px-4 uppercase tracking-wide text-muted">Card&rsquo;s last 4 digits</span>
          <input className={FIELD} inputMode="numeric" maxLength={4} value={card} onChange={(e) => setCard(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Card's last 4 digits" />
        </label>
        <Button className="w-full" disabled={!ok} onClick={() => onSave({ ...value, limitCents: cents ?? 0, store: store.trim(), card })}>Save</Button>
      </div>
    </Sheet>
  );
}
