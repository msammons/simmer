"use client";
// Settings → Ordering (docs/CHECKOUT.md, Nov 12): ordering from Simmer is off, with a $0 limit, until the household
// changes it here; the pickup store and the card's last 4 digits are set once, and Safeway showing anything else stops
// an order. Every tap shows at once and saves behind it; turning it on asks first. Face ID (Nov 12): each phone that
// will place orders sets it up here, once; the server checks it, single use, before an order (src/lib/passkeys.ts).
// Once one phone has it, another is added only when a phone with Face ID approves it (Sam, Nov 12): the new phone asks
// and shows a code, the other shows "Approve a new phone" with the same code, and the new phone then taps to set up
// (no waiting or checking in the background: the household taps when it's approved).
import { useEffect, useRef, useState } from "react";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, approveWithFaceId, errorText, setUpFaceId, type CheckoutSettings } from "@/lib/client";
import { Alert, Button, ConfirmSheet, Group, Row, Sheet } from "./ui";

const OFF: CheckoutSettings = { on: false, limitCents: 0, store: "", card: "" };
const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
/** A new phone's request is good for 5 minutes on the server (src/lib/passkeys.ts). */
const ADD_MS = 5 * 60_000;
/**
 * This phone's request to be added (Nov 12): the token goes back with its set-up. Kept for this visit, outside the
 * component, so closing and reopening Settings keeps it; never saved, as it's only good for 5 minutes anyway.
 */
type MyAdd = { token: string; code: string; at: number };
let myAdd: MyAdd | null = null;
/** What Face ID needs, fetched before the tap: setting up here, or approving a new phone (with the code it's for). */
type Ready = { options: PublicKeyCredentialCreationOptionsJSON } | { options: PublicKeyCredentialRequestOptionsJSON; code: string };
type Prepared = { at: number; ready: Ready | null; fetch: () => Promise<Ready>; wait: Promise<unknown> };
const FIELD = "w-full rounded-2xl bg-card px-4 py-3 text-base outline-none ring-accent focus:ring-2";

export function OrderingSettings() {
  const [s, setS] = useState<CheckoutSettings>(OFF);
  const [server, setServer] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [faceIds, setFaceIds] = useState(0);
  const [adding, setAdding] = useState<{ code: string } | null>(null);
  const [mine, setMine] = useState<MyAdd | null>(myAdd);
  const [sheet, setSheet] = useState<"setup" | "ask" | "approve" | null>(null);
  const [approveCode, setApproveCode] = useState("");
  const [faceProblem, setFaceProblem] = useState<{ title: string; message: string } | null>(null);
  // Safari shows Face ID only straight from a tap, so what the phone needs is fetched when the question opens and is
  // ready by the time its button is tapped (a challenge is good for 2 minutes; an older one is fetched again).
  const prepared = useRef<Prepared | null>(null);
  const busy = useRef(false);
  const fresh = mine && Date.now() - mine.at < ADD_MS ? mine : null;

  useEffect(() => {
    const ac = new AbortController();
    api.checkout(ac.signal).then((r) => { setS(r.settings); setServer(r.server); setFaceIds(r.faceId ?? 0); setAdding(r.adding ?? null); }).catch(() => {});
    return () => ac.abort();
  }, []);

  const keepMine = (m: MyAdd | null) => { myAdd = m; setMine(m); };

  /** Opens a question and fetches what its Face ID needs; if that's refused, the question closes and the alert says why. */
  function open(which: "setup" | "approve", fetch: () => Promise<Ready>, title: string) {
    if (busy.current) return;
    const p: Prepared = { at: Date.now(), fetch, ready: null, wait: Promise.resolve() };
    p.wait = fetch().then((r) => { p.ready = r; if ("code" in r) setApproveCode(r.code); });
    p.wait.catch((e) => {
      if (prepared.current !== p) return;
      prepared.current = null;
      setSheet(null);
      if (which === "setup" && myAdd && Date.now() - myAdd.at >= ADD_MS) keepMine(null);
      if (which === "approve") setAdding(null);
      setFaceProblem({ title, message: errorText(e) });
    });
    prepared.current = p;
    setSheet(which);
  }

  /** What's ready for the tap (fetched again when older than 100 s, which may lose Safari's tap). */
  async function ready() {
    let p = prepared.current;
    if (!p) throw new Error("That didn't go through. Try again.");
    if (Date.now() - p.at > 100_000) { const f = p.fetch; p = { at: Date.now(), fetch: f, ready: null, wait: f().then((r) => { p!.ready = r; }) }; prepared.current = p; }
    if (!p.ready) await p.wait;
    return p.ready!;
  }

  function tapFaceId() {
    if (faceIds === 0) open("setup", () => api.faceIdSetUpOptions(), "Face ID wasn't set up");
    else if (fresh) setUpAfterApproving();
    else setSheet("ask");
  }
  function setUpAfterApproving() {
    const token = myAdd?.token;
    if (!token) return; // still asking: the code (and this) come with the answer
    open("setup", () => api.faceIdSetUpOptions(token), "Face ID wasn't set up");
  }

  async function setUpFace() {
    setSheet(null);
    if (busy.current) return;
    busy.current = true;
    const before = faceIds;
    try {
      const r = await ready();
      if ("code" in r) throw new Error("That didn't go through. Try again.");
      // Shown as soon as Face ID answers; the server's count follows, and a failure puts it back.
      const count = await setUpFaceId(r.options, () => setFaceIds(before + 1));
      setFaceIds(count);
      keepMine(null);
    } catch (e) {
      setFaceIds(before);
      setFaceProblem({ title: "Face ID wasn't set up", message: errorText(e) });
    } finally {
      prepared.current = null;
      busy.current = false;
    }
  }

  /** A new phone asks to be added: the row with its code shows at once, the code fills in when the answer comes. */
  function askToAdd() {
    setSheet(null);
    if (busy.current) return;
    const asked: MyAdd = { token: "", code: "", at: Date.now() };
    keepMine(asked);
    api.faceIdAsk().then((r) => { if (myAdd === asked) keepMine({ ...r, at: asked.at }); }).catch((e) => {
      if (myAdd === asked) keepMine(null);
      setFaceProblem({ title: "This phone wasn't added", message: errorText(e) });
    });
  }

  async function approve() {
    setSheet(null);
    if (busy.current) return;
    busy.current = true;
    const before = adding;
    try {
      const r = await ready();
      if (!("code" in r)) throw new Error("That didn't go through. Try again.");
      await approveWithFaceId(r.options, () => setAdding(null));
    } catch (e) {
      setAdding(before);
      setFaceProblem({ title: "The new phone wasn't approved", message: errorText(e) });
    } finally {
      prepared.current = null;
      busy.current = false;
    }
  }

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
        <Row icon="face" title="Face ID" value={faceIds === 0 ? "Set up" : faceIds === 1 ? "On" : `${faceIds} phones`} onClick={tapFaceId} />
        {fresh && <Row icon="face" title="Set up after approving" subtitle="Approve this phone on one with Face ID, then tap here." value={fresh.code} onClick={setUpAfterApproving} />}
        {adding && faceIds > 0 && adding.code !== fresh?.code && (
          <Row icon="face" title="Approve a new phone" value={adding.code} onClick={() => { setApproveCode(adding.code); open("approve", () => api.faceIdApproveOptions(), "The new phone wasn't approved"); }} />
        )}
      </Group>
      <ConfirmSheet
        open={asking}
        title="Turn on ordering?"
        message={`Orders still need Face ID, and nothing over ${dollars(s.limitCents)} goes through.`}
        confirm="Turn on"
        onConfirm={() => { setAsking(false); save({ ...s, on: true }); }}
        onCancel={() => setAsking(false)}
      />
      <ConfirmSheet
        open={sheet === "setup"}
        title={faceIds ? "Set up Face ID here?" : "Set up Face ID?"}
        message={faceIds ? "Face ID on this phone will also be able to place orders." : "Face ID on this phone will be needed to place each order."}
        confirm="Set up"
        onConfirm={setUpFace}
        onCancel={() => { setSheet(null); prepared.current = null; }}
      />
      <ConfirmSheet
        open={sheet === "ask"}
        title="Add this phone?"
        message="A phone that already has Face ID will need to approve it."
        confirm="Add this phone"
        onConfirm={askToAdd}
        onCancel={() => setSheet(null)}
      />
      <ConfirmSheet
        open={sheet === "approve"}
        title="Approve a new phone?"
        message={`Check the new phone shows ${approveCode}. Face ID here approves it.`}
        confirm="Approve"
        onConfirm={approve}
        onCancel={() => { setSheet(null); prepared.current = null; }}
      />
      {editing && <OrderingEditor value={s} onSave={(v) => { setEditing(false); save(v); }} onClose={() => setEditing(false)} />}
      <Alert open={Boolean(problem)} title="That didn't go through" message={problem ?? ""} onClose={() => setProblem(null)} />
      <Alert open={Boolean(faceProblem)} title={faceProblem?.title ?? ""} message={faceProblem?.message ?? ""} onClose={() => setFaceProblem(null)} />
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
