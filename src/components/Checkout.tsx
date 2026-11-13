"use client";
// Shop → Check out (Sam, Nov 13: "ordering lives where you check out"). The first time, a short set-up right here, in
// order: Face ID, the limit per order, the pickup store, the card's last 4 digits, then Turn on ordering (asking first).
// Once set up: the cart and Simmer's estimate (as Shop's Safeway heading shows them), ordering's switch, limit, store
// and card, and a test run (docs/CHECKOUT.md phase 2, Nov 13): Get ready reads Safeway's checkout (the helper chooses
// the earliest free pickup time), then "Test run · $X" approves those figures with Face ID and goes through Safeway's
// checkout again, stopping one press short, and says what it would have placed. Nothing here orders.
import { useEffect, useRef, useState } from "react";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, errorText, faceIdAnswer, type ReadyView, type RunResult } from "@/lib/client";
import { money } from "@/lib/shop";
import { usePrepared, useOrdering } from "./Ordering";
import { Alert, Button, Group, Held, Row, Sheet } from "./ui";

type Run = { stage: "idle" } | { stage: "reading" } | { stage: "ready"; view: ReadyView } | { stage: "running"; view: ReadyView } | { stage: "done"; view: ReadyView; result: RunResult };
const cents = (c: number | null) => (c === null ? "Couldn't be read" : `$${(c / 100).toFixed(2)}`);

export function CheckoutSheet({ count, total, estimate, onClose }: { count: number; total: number; estimate: boolean; onClose: () => void }) {
  const o = useOrdering();
  const ready = o.faceIds > 0 && o.s.limitCents > 0 && Boolean(o.s.store) && Boolean(o.s.card);
  // Which view is decided once, when the settings arrive, so the set-up stays put while its last step is done and
  // ends with Turn on ordering rather than jumping away.
  const [firstTime, setFirstTime] = useState<boolean | null>(null);
  if (o.loaded && firstTime === null) setFirstTime(!ready);

  return (
    <Sheet label="Check out" title="Check out" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {firstTime === null ? <Held /> : firstTime ? (
          <>
            <Group header="Set up ordering" footer="Face ID comes first: each of the others needs it.">
              {o.faceIdRows}
              {o.limitRow}
              {o.storeRow}
              {o.cardRow}
            </Group>
            <Button className="w-full" disabled={!ready || o.s.on} onClick={o.turnOn}>{o.s.on ? "Ordering is on" : "Turn on ordering"}</Button>
          </>
        ) : (
          <>
            <Group header="Cart">
              <Row icon="cart" title="In the cart" value={`${count} thing${count === 1 ? "" : "s"}`} />
              <Row icon="bag" title="Simmer's estimate" value={`${estimate ? "about " : ""}${money(total)}`} />
            </Group>
            <Group header="Ordering" footer="Placing orders from here comes after a few test runs on Safeway.">
              {o.onOffRow}
              {o.limitRow}
              {o.storeRow}
              {o.cardRow}
            </Group>
            {ready && o.s.on ? <TestRun /> : <p className="px-4 t-sub text-muted">Turn on ordering for a test run.</p>}
          </>
        )}
      </div>
      {o.sheets}
    </Sheet>
  );
}

/**
 * The test run. Each step waits on the helper on the server, up to 20 s a request, and the sheet asks again only while
 * an answer says it's still going (no timers). Closing the sheet stops following it.
 */
function TestRun() {
  const [run, setRun] = useState<Run>({ stage: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const check = usePrepared<PublicKeyCredentialRequestOptionsJSON>();
  const stop = useRef<AbortController | null>(null);
  const busy = useRef(false);
  useEffect(() => () => stop.current?.abort(), []);

  /** Ready to approve: Face ID's check is fetched now, so it shows straight from the tap (Safari). */
  function showReady(view: ReadyView) {
    setRun({ stage: "ready", view });
    if (!view.stops.length && view.totalCents !== null) check.prepare(() => api.faceIdCheckOptions().then((r) => r.options));
  }

  async function getReady() {
    if (busy.current) return;
    busy.current = true;
    setRun({ stage: "reading" });
    const ac = (stop.current = new AbortController());
    try {
      let r = await api.checkoutPrepare(undefined, ac.signal);
      while ("waiting" in r) r = await api.checkoutPrepare(r.waiting, ac.signal);
      showReady(r);
    } catch (e) {
      if (ac.signal.aborted) return;
      setRun({ stage: "idle" });
      setProblem(errorText(e));
    } finally {
      busy.current = false;
    }
  }

  async function testRun(view: ReadyView) {
    if (busy.current) return;
    busy.current = true;
    setRun({ stage: "running", view });
    const ac = (stop.current = new AbortController());
    let approved = false;
    try {
      const answer = await faceIdAnswer(await check.take());
      const a = await api.checkoutApprove(answer);
      approved = true;
      if (!a.ok) { setRun({ stage: "done", view, result: a }); return; }
      let r = await api.checkoutTestRun({ approvalId: a.approvalId }, ac.signal);
      while ("waiting" in r) r = await api.checkoutTestRun({ jobId: r.waiting }, ac.signal);
      setRun({ stage: "done", view, result: r });
    } catch (e) {
      if (ac.signal.aborted) return;
      // Before the approval (Face ID cancelled, say), the figures still stand; after it, they've been used.
      if (approved) setRun({ stage: "idle" }); else showReady(view);
      setProblem(errorText(e));
    } finally {
      check.clear();
      busy.current = false;
    }
  }

  const view = run.stage === "ready" || run.stage === "running" || run.stage === "done" ? run.view : null;
  return (
    <>
      {run.stage === "reading" ? <Held groups={[5]} label="Reading Safeway's checkout" /> : (
      <Group header="Test run" footer="A test run goes through Safeway's checkout for real and stops one step short. Nothing is ordered.">
        {view ? (
          <>
            <Row icon="home" title="Pickup store" value={view.store || "Couldn't be read"} />
            <Row icon="clock" title="Pickup time" value={view.window || "None chosen"} />
            <Row icon="card" title="Card" value={view.card ? `•••• ${view.card}` : "Couldn't be read"} />
            <Row icon="bag" title="Items" value={view.items === null ? "Couldn't be read" : String(view.items)} />
            <Row icon="cart" title="Total" value={cents(view.totalCents)} />
          </>
        ) : <Row icon="refresh" title="Get ready" subtitle="Reads Safeway's checkout and picks the earliest free pickup time." onClick={getReady} />}
      </Group>
      )}
      {view && (view.stops.length > 0 || view.highlights.length > 0) && (
        <div className="space-y-1 px-4">
          {view.stops.map((s) => <p key={s} className="t-sub text-alert">{s}</p>)}
          {view.highlights.map((h) => <p key={h} className="t-sub text-muted">Check: {h}</p>)}
        </div>
      )}
      {run.stage === "ready" && (
        <Button className="w-full" disabled={view!.stops.length > 0 || view!.totalCents === null} onClick={() => testRun(run.view)}>Test run · {cents(run.view.totalCents)}</Button>
      )}
      {run.stage === "running" && <Held groups={[1]} label="Test run going" />}
      {run.stage === "done" && (
        <div className="space-y-1 px-4">
          {run.result.ok ? <p className="t-body font-semibold">{run.result.would}</p> : run.result.reasons.map((r) => <p key={r} className="t-sub text-alert">{r}</p>)}
        </div>
      )}
      {(run.stage === "ready" || run.stage === "done") && <Button variant="plain" className="w-full" onClick={getReady}>Get ready again</Button>}
      <Alert open={Boolean(problem)} title="That didn't go through" message={problem ?? ""} onClose={() => setProblem(null)} />
    </>
  );
}
