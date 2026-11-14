"use client";
// Ordering from Simmer (docs/CHECKOUT.md): its settings and Face ID, used in two places (Sam, Nov 13: "ordering lives
// where you check out"). Shop → Check out (Checkout.tsx) sets the limit, the pickup store and the card's last 4 digits;
// Settings keeps a small Ordering group, the on/off switch and Face ID. Both use `useOrdering`, so the flows are one.
//
// Off with a $0 limit until the household changes it. Turning on, raising the limit, or changing the store or card
// needs a Face ID check on a phone already set up, sent with the change (the server refuses it otherwise); turning off
// and lowering the limit need nothing. Every tap shows at once and saves behind it; a change that fails goes back and
// the alert says why. Turning on asks first.
//
// Face ID (Nov 12): each phone that will place orders sets it up, once. Once one phone has it, another is added only
// when a phone with Face ID approves it: the new phone asks and shows a code, the other shows "Approve a new phone"
// with the same code, and the new phone then taps to set up (no waiting or checking in the background: the household
// taps when it's approved).
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, approveWithFaceId, errorText, faceIdAnswer, setUpFaceId, type CheckoutSettings, type Choices } from "@/lib/client";
import { needsFaceId } from "@/lib/checkout-rules";
import { Alert, Button, ConfirmSheet, Group, Held, Row } from "./ui";

const OFF: CheckoutSettings = { on: false, limitCents: 0, store: "", card: "" };
export const dollars = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
/** A new phone's request is good for 5 minutes on the server (src/lib/passkeys.ts). */
const ADD_MS = 5 * 60_000;
/**
 * This phone's request to be added (Nov 12): the token goes back with its set-up. Kept for this visit, outside the
 * component, so closing and reopening Settings or Check out keeps it; never saved, as it's only good for 5 minutes anyway.
 */
type MyAdd = { token: string; code: string; at: number };
let myAdd: MyAdd | null = null;
const FIELD = "w-full rounded-2xl bg-card px-4 py-3 text-base outline-none ring-accent focus:ring-2";
type Problem = { title: string; message: string };
const NO_FACE_ID: Problem = { title: "Set up Face ID first", message: "Face ID on a phone is needed to change that. Set it up first." };

/**
 * What a Face ID prompt needs, fetched before the tap: Safari shows Face ID only straight from a tap, so it's fetched
 * when the question opens and is ready by the time its button is tapped. A challenge is good for 2 minutes; an older
 * one is fetched again at the tap (which may lose Safari's tap, and then the alert says Face ID was cancelled).
 */
export function usePrepared<T>() {
  const ref = useRef<{ at: number; fetch: () => Promise<T>; ready: T | null; wait: Promise<unknown> } | null>(null);
  return useMemo(() => {
    const start = (fetch: () => Promise<T>) => {
      const p: NonNullable<typeof ref.current> = { at: Date.now(), fetch, ready: null, wait: Promise.resolve() };
      p.wait = fetch().then((r) => { p.ready = r; });
      ref.current = p;
      return p;
    };
    return {
      /** Starts fetching; `onFail` hears a refusal while this is still the one wanted. */
      prepare(fetch: () => Promise<T>, onFail?: (e: unknown) => void) {
        const p = start(fetch);
        p.wait.catch((e) => { if (ref.current === p) { ref.current = null; onFail?.(e); } });
      },
      async take(): Promise<T> {
        let p = ref.current;
        if (!p) throw new Error("That didn't go through. Try again.");
        if (Date.now() - p.at > 100_000) p = start(p.fetch);
        if (!p.ready) await p.wait;
        return p.ready!;
      },
      clear() { ref.current = null; },
    };
  }, []);
}

/** Ordering's settings and Face ID: the state, the rows each place shows, and the questions and alerts behind them. */
export function useOrdering() {
  const [loaded, setLoaded] = useState(false);
  const [s, setS] = useState<CheckoutSettings>(OFF);
  const [server, setServer] = useState(false);
  const [faceIds, setFaceIds] = useState(0);
  const [adding, setAdding] = useState<{ code: string } | null>(null);
  const [mine, setMine] = useState<MyAdd | null>(myAdd);
  const [sheet, setSheet] = useState<"setup" | "ask" | "approve" | "on" | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [approveCode, setApproveCode] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const setupOptions = usePrepared<PublicKeyCredentialCreationOptionsJSON>();
  const approveOptions = usePrepared<{ options: PublicKeyCredentialRequestOptionsJSON; code: string }>();
  const checkOptions = usePrepared<PublicKeyCredentialRequestOptionsJSON>();
  const busy = useRef(false);
  const fresh = mine && Date.now() - mine.at < ADD_MS ? mine : null;

  useEffect(() => {
    const ac = new AbortController();
    api.checkout(ac.signal).then((r) => { setS(r.settings); setServer(r.server); setFaceIds(r.faceId ?? 0); setAdding(r.adding ?? null); setLoaded(true); }).catch(() => {});
    return () => ac.abort();
  }, []);

  const keepMine = (m: MyAdd | null) => { myAdd = m; setMine(m); };

  // ---- settings

  /** A Face ID check, fetched when a question that may need it opens (there's nothing to check with no phone set up). */
  const prepareCheck = () => { if (faceIds) checkOptions.prepare(() => api.faceIdCheckOptions().then((r) => r.options)); };

  /** Shown at once and saved behind it, with Face ID first when the change needs it; a failure goes back. */
  async function save(next: CheckoutSettings) {
    if (busy.current) return;
    const before = s;
    const need = needsFaceId(before, next);
    if (need && !faceIds) { setProblem(NO_FACE_ID); return; }
    busy.current = true;
    setS(next);
    try {
      const faceId = need ? await faceIdAnswer(await checkOptions.take()) : undefined;
      const r = await api.saveCheckout(next, faceId);
      setS(r.settings); setServer(r.server);
    } catch (e) {
      setS(before);
      setProblem({ title: "That didn't go through", message: errorText(e) });
    } finally {
      checkOptions.clear();
      busy.current = false;
    }
  }

  function tapOnOff() {
    if (s.on) { void save({ ...s, on: false }); return; }
    if (!faceIds) { setProblem(NO_FACE_ID); return; }
    prepareCheck();
    setSheet("on");
  }
  function edit(f: Field) {
    // With no phone set up, only lowering a limit already set could go through; anything else says so at once.
    if (!faceIds && (f !== "limit" || !s.limitCents)) { setProblem(NO_FACE_ID); return; }
    if (f === "limit") prepareCheck(); // the store and card: once Safeway's choices show (reading can take a minute)
    setEditing(f);
  }

  // ---- Face ID: set up, ask to be added, approve a new phone

  function openSetup(token?: string) {
    if (busy.current) return;
    setupOptions.prepare(() => api.faceIdSetUpOptions(token).then((r) => r.options), (e) => {
      setSheet(null);
      if (myAdd && Date.now() - myAdd.at >= ADD_MS) keepMine(null);
      setProblem({ title: "Face ID wasn't set up", message: errorText(e) });
    });
    setSheet("setup");
  }
  function tapFaceId() {
    if (faceIds === 0) openSetup();
    else if (fresh) setUpAfterApproving();
    else setSheet("ask");
  }
  function setUpAfterApproving() {
    const token = myAdd?.token;
    if (!token) return; // still asking: the code (and this) come with the answer
    openSetup(token);
  }
  async function setUpFace() {
    setSheet(null);
    if (busy.current) return;
    busy.current = true;
    const before = faceIds;
    try {
      // Shown as soon as Face ID answers; the server's count follows, and a failure puts it back.
      const count = await setUpFaceId(await setupOptions.take(), () => setFaceIds(before + 1));
      setFaceIds(count);
      keepMine(null);
    } catch (e) {
      setFaceIds(before);
      setProblem({ title: "Face ID wasn't set up", message: errorText(e) });
    } finally {
      setupOptions.clear();
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
      setProblem({ title: "This phone wasn't added", message: errorText(e) });
    });
  }

  function openApprove(code: string) {
    if (busy.current) return;
    setApproveCode(code);
    approveOptions.prepare(() => api.faceIdApproveOptions().then((r) => { setApproveCode(r.code); return r; }), (e) => {
      setSheet(null);
      setAdding(null);
      setProblem({ title: "The new phone wasn't approved", message: errorText(e) });
    });
    setSheet("approve");
  }
  async function approve() {
    setSheet(null);
    if (busy.current) return;
    busy.current = true;
    const before = adding;
    try {
      await approveWithFaceId((await approveOptions.take()).options, () => setAdding(null));
    } catch (e) {
      setAdding(before);
      setProblem({ title: "The new phone wasn't approved", message: errorText(e) });
    } finally {
      approveOptions.clear();
      busy.current = false;
    }
  }

  // ---- what each place shows

  const onOffRow = <Row icon="cart" title="Order from Simmer" value={s.on ? "On" : "Off"} onClick={tapOnOff} />;
  const faceIdRows = (
    <>
      <Row icon="face" title="Face ID" value={faceIds === 0 ? "Set up" : faceIds === 1 ? "On" : `${faceIds} phones`} onClick={tapFaceId} />
      {fresh && <Row icon="face" title="Set up after approving" subtitle="Approve this phone on one with Face ID, then tap here." value={fresh.code} onClick={setUpAfterApproving} />}
      {adding && faceIds > 0 && adding.code !== fresh?.code && <Row icon="face" title="Approve a new phone" value={adding.code} onClick={() => openApprove(adding.code)} />}
    </>
  );
  const limitRow = <Row icon="sliders" title="Limit per order" value={dollars(s.limitCents)} onClick={() => edit("limit")} />;
  // Picked from what Safeway's checkout shows (Nov 14); the limit is typed. Each opens a page inside Check out.
  const storeRow = <Row icon="home" title="Pickup store" value={s.store ? s.store.split(",")[0] : "Not set"} onClick={() => edit("store")} />;
  const cardRow = <Row icon="card" title="Card" value={s.card ? `•••• ${s.card}` : "Not set"} onClick={() => edit("card")} />;

  const sheets = (
    <>
      <ConfirmSheet
        open={sheet === "on"}
        title="Turn on ordering?"
        message={`Orders still need Face ID, and nothing over ${dollars(s.limitCents)} goes through.`}
        confirm="Turn on"
        onConfirm={() => { setSheet(null); void save({ ...s, on: true }); }}
        onCancel={() => { setSheet(null); checkOptions.clear(); }}
      />
      <ConfirmSheet
        open={sheet === "setup"}
        title={faceIds ? "Set up Face ID here?" : "Set up Face ID?"}
        message={faceIds ? "Face ID on this phone will also be able to place orders." : "Face ID on this phone will be needed to place each order."}
        confirm="Set up"
        onConfirm={setUpFace}
        onCancel={() => { setSheet(null); setupOptions.clear(); }}
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
        onCancel={() => { setSheet(null); approveOptions.clear(); }}
      />
      <Alert open={Boolean(problem)} title={problem?.title ?? ""} message={problem?.message ?? ""} onClose={() => setProblem(null)} />
    </>
  );

  // One field at a time, shown in place of Check out's rows (Nov 14: a second sheet over Check out, pushed up by the
  // keyboard, looked broken).
  const editor = editing && (
    <FieldPage field={editing} value={s} onFound={prepareCheck} onSave={(v) => { setEditing(null); void save(v); }} onBack={() => { setEditing(null); checkOptions.clear(); }} />
  );

  return { loaded, s, server, faceIds, onOffRow, faceIdRows, limitRow, storeRow, cardRow, sheets, editor, turnOn: tapOnOff };
}

/** Settings → Ordering (Nov 13): the on/off switch and Face ID; the limit, store and card are set in Shop → Check out. */
export function OrderingSettings() {
  const o = useOrdering();
  return (
    <>
      <Group header="Ordering" footer={o.server ? "Pickup orders from Shop. The limit, pickup store and card are under Check out there." : "Ordering from Simmer isn't available yet."}>
        {o.onOffRow}
        {o.faceIdRows}
      </Group>
      {o.sheets}
    </>
  );
}

type Field = "limit" | "store" | "card";
const FIELDS: Record<Field, string> = { limit: "Limit per order", store: "Pickup store", card: "Card" };

/**
 * What Safeway's checkout shows, read once a visit (the store and card come from the same look, so the second one
 * opened shows at once). The look only reads: it presses Checkout and the Continues on the way, never a pickup time or
 * Place Order (docs/CHECKOUT.md phase 1).
 */
let looked: Promise<Choices> | null = null;
function lookAtSafeway(): Promise<Choices> {
  looked ??= (async () => {
    let r = await api.checkoutLook();
    while ("waiting" in r) r = await api.checkoutLook(r.waiting);
    return r;
  })().catch((e) => { looked = null; throw e; });
  return looked;
}

/** One setting, in place of Check out's rows: the limit typed, the store and card picked from what Safeway shows. */
function FieldPage({ field, value, onFound, onSave, onBack }: { field: Field; value: CheckoutSettings; onFound: () => void; onSave: (v: CheckoutSettings) => void; onBack: () => void }) {
  return (
    <div className="space-y-5">
      {field === "limit" ? <LimitField value={value} onSave={onSave} /> : <PickField field={field} value={value} onFound={onFound} onSave={onSave} />}
      <Button variant="secondary" className="w-full" onClick={onBack}>Back</Button>
    </div>
  );
}

function LimitField({ value, onSave }: { value: CheckoutSettings; onSave: (v: CheckoutSettings) => void }) {
  const [text, setText] = useState((value.limitCents / 100).toFixed(2).replace(/\.00$/, ""));
  const t = text.trim();
  const cents = /^\d{1,4}(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
  const ok = cents !== null && cents <= 100_000;
  return (
    <Group header={FIELDS.limit} footer="Nothing over this goes through.">
      <div className="space-y-3 p-3">
        <input className={FIELD} inputMode="decimal" autoComplete="off" value={text} autoFocus onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Limit per order in dollars" />
        <Button className="w-full" disabled={!ok} onClick={() => onSave({ ...value, limitCents: cents ?? 0 })}>Save</Button>
      </div>
    </Group>
  );
}

function PickField({ field, value, onFound, onSave }: { field: "store" | "card"; value: CheckoutSettings; onFound: () => void; onSave: (v: CheckoutSettings) => void }) {
  const [found, setFound] = useState<Choices | null>(null);
  const [problem, setProblem] = useState("");
  const found0 = useRef(onFound);
  useEffect(() => {
    let live = true;
    lookAtSafeway().then((c) => { if (live) { setFound(c); found0.current(); } }, (e) => live && setProblem(errorText(e)));
    return () => { live = false; };
  }, []);
  const current = field === "store" ? value.store : value.card;
  const shown = (v: string) => (field === "card" ? `•••• ${v}` : v);
  const fromSafeway = found ? (field === "store" ? found.store : found.card) : "";
  const choices = [...new Set([fromSafeway, current].filter(Boolean))];
  const footer = field === "store"
    ? "Orders go to the store Safeway is set to. To pick up somewhere else, change the store on Safeway, then come back."
    : "Orders use the card Safeway has. To use another, change it on Safeway, then come back.";
  if (problem) return <Group header={FIELDS[field]} footer={footer}><Row title="Safeway couldn't be read" subtitle={problem} /></Group>;
  if (!found) return <Held groups={[2]} label="Reading Safeway's checkout" />;
  return (
    <Group header={FIELDS[field]} footer={footer}>
      {choices.length ? choices.map((c) => (
        <Row key={c} title={shown(c)} subtitle={c === fromSafeway ? "What Safeway shows" : "Saved before"} role="radio" checked={c === current} accessory={c === current ? "check" : undefined}
          onClick={() => { if (c !== current) onSave(field === "store" ? { ...value, store: c } : { ...value, card: c }); }} />
      )) : <Row title={field === "store" ? "Safeway didn't show a pickup store" : "Safeway didn't show a card"} subtitle="Check Safeway is signed in on the computer, with something in the cart." />}
    </Group>
  );
}
