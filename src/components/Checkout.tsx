"use client";
// Shop → Check out (Sam, Nov 13: "ordering lives where you check out"). The first time, a short set-up right here, in
// order: Face ID and the limit per order, then Turn on ordering (asking first); the pickup store and card come from
// Safeway and are remembered at the first approval (Sam, Nov 14).
// Once set up: the cart and Simmer's estimate (as Shop's Safeway heading shows them), ordering's switch, limit, store
// and card, and a test run (docs/CHECKOUT.md phase 2, Nov 13): Get ready lists Safeway's free pickup times this week, one
// is picked (Sam, Nov 14) and Safeway's checkout read with it, then "Test run · $X" approves those figures with Face ID and goes through Safeway's
// checkout again, stopping one press short, and says what it would have placed. Nothing here orders.
import { useEffect, useRef, useState } from "react";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, errorText, faceIdAnswer, type OrderResult, type ReadyView, type RunResult, type TimesView } from "@/lib/client";
import { money } from "@/lib/shop";
import { usePrepared, useOrdering } from "./Ordering";
import { Alert, Button, ConfirmSheet, Group, Held, Row, Sheet } from "./ui";

type Run = { stage: "idle" } | { stage: "reading" } | { stage: "times"; times: TimesView; loading?: string; picked?: boolean } | { stage: "ready"; view: ReadyView } | { stage: "running"; view: ReadyView } | { stage: "done"; view: ReadyView; result: RunResult }
  | { stage: "ordering"; view: ReadyView } | { stage: "ordered"; view: ReadyView; result: OrderResult };
const cents = (c: number | null) => (c === null ? "Couldn't be read" : `$${(c / 100).toFixed(2)}`);

export function CheckoutSheet({ count, total, estimate, onClose }: { count: number; total: number; estimate: boolean; onClose: () => void }) {
  const o = useOrdering();
  // The store and card come from Safeway at the first approval (Sam, Nov 14), so set-up is Face ID and the limit.
  const ready = o.faceIds > 0 && o.s.limitCents > 0;
  // Which view is decided once, when the settings arrive, so the set-up stays put while its last step is done and
  // ends with Turn on ordering rather than jumping away.
  const [firstTime, setFirstTime] = useState<boolean | null>(null);
  if (o.loaded && firstTime === null) setFirstTime(!ready);

  return (
    <Sheet label="Check out" title="Check out" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {firstTime === null ? <Held /> : o.editor ? o.editor : firstTime ? (
          <>
            <Group header="Set up ordering">
              {o.faceIdRows}
              {o.limitRow}
            </Group>
            <Button className="w-full" disabled={!ready || o.s.on} onClick={o.turnOn}>{o.s.on ? "Ordering is on" : "Turn on ordering"}</Button>
          </>
        ) : (
          <>
            <Group header="Cart">
              <Row icon="cart" title="In the cart" value={`${count} thing${count === 1 ? "" : "s"}`} />
              <Row icon="bag" title="Simmer's estimate" value={`${estimate ? "about " : ""}${money(total)}`} />
            </Group>
            <Group header="Ordering">
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
  const offered = useRef<TimesView | null>(null); // the day and times last read, to go back to
  const [confirming, setConfirming] = useState(false); // Place order's confirm sheet (docs/CHECKOUT.md)
  useEffect(() => () => stop.current?.abort(), []);

  /** Ready to approve: Face ID's check is fetched now, so it shows straight from the tap (Safari). */
  function showReady(view: ReadyView) {
    setRun({ stage: "ready", view });
    if (!view.stops.length && view.totalCents !== null) check.prepare(() => api.faceIdCheckOptions().then((r) => r.options));
  }

  /**
   * Get ready (Sam, Nov 14: "let me pick", "picking a day first"): Safeway's days and the day showing's free times; a day
   * tapped reads that day's times (the days stay, the times shimmer while they're read).
   */
  async function getTimes(day?: string) {
    if (busy.current) return;
    busy.current = true;
    const back = offered.current;
    setRun(day && back ? { stage: "times", times: { ...back, day, times: [] }, loading: day } : { stage: "reading" });
    const ac = (stop.current = new AbortController());
    try {
      let r = await api.checkoutTimes(undefined, day, ac.signal);
      while ("waiting" in r) r = await api.checkoutTimes(r.waiting, undefined, ac.signal);
      offered.current = r;
      setRun({ stage: "times", times: r, picked: Boolean(day) });
    } catch (e) {
      if (ac.signal.aborted) return;
      setRun(back ? { stage: "times", times: back } : { stage: "idle" });
      setProblem(errorText(e));
    } finally {
      busy.current = false;
    }
  }

  /** A time picked: Safeway's checkout read with it, to approve. */
  async function pick(windowId: string) {
    if (busy.current) return;
    busy.current = true;
    setRun({ stage: "reading" });
    const ac = (stop.current = new AbortController());
    try {
      let r = await api.checkoutPrepare(undefined, windowId, ac.signal);
      while ("waiting" in r) r = await api.checkoutPrepare(r.waiting, undefined, ac.signal);
      showReady(r);
    } catch (e) {
      if (ac.signal.aborted) return;
      setRun(offered.current ? { stage: "times", times: offered.current } : { stage: "idle" });
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

  /**
   * Placing for real (phase 3, Sam, Nov 14): asked first on the confirm sheet (store, time, card, total, what to check),
   * then Face ID approves exactly those figures, then the helper places it once. Never retried: an unsure answer says to
   * check Safeway.
   */
  async function placeIt(view: ReadyView) {
    setConfirming(false);
    if (busy.current) return;
    busy.current = true;
    setRun({ stage: "ordering", view });
    const ac = (stop.current = new AbortController());
    let approved = false;
    try {
      const answer = await faceIdAnswer(await check.take());
      const a = await api.checkoutApprove(answer);
      approved = true;
      if (!a.ok) { setRun({ stage: "ordered", view, result: a }); return; }
      let r = await api.checkoutPlace({ approvalId: a.approvalId }, ac.signal);
      while ("waiting" in r) r = await api.checkoutPlace({ jobId: r.waiting }, ac.signal);
      setRun({ stage: "ordered", view, result: r });
    } catch (e) {
      if (ac.signal.aborted) return;
      if (approved) setRun({ stage: "ordered", view, result: { ok: false, unsure: true, reasons: ["Simmer isn't sure the order went through. Check Safeway before trying again."] } });
      else showReady(view);
      setProblem(errorText(e));
    } finally {
      check.clear();
      busy.current = false;
    }
  }

  const view = run.stage === "ready" || run.stage === "running" || run.stage === "done" || run.stage === "ordering" || run.stage === "ordered" ? run.view : null;
  return (
    <>
      {run.stage === "reading" ? <Held groups={[5]} label="Reading Safeway's checkout" /> : run.stage === "times" ? <TimesList view={run.times} picked={Boolean(run.picked)} loading={run.loading}
        onDay={(d) => (d === offered.current?.day ? setRun({ stage: "times", times: offered.current, picked: true }) : getTimes(d))} onPick={pick} /> : (
      <Group header="Test run" footer="A test run goes through Safeway's checkout for real and stops one step short. Nothing is ordered.">
        {view ? (
          <>
            <Row icon="home" title="Pickup store" subtitle={view.remember && view.store ? "Remembered once you approve" : undefined} value={view.store ? view.store.split(",")[0] : "Couldn't be read"} />
            <Row icon="clock" title="Pickup time" value={view.window || "None chosen"} />
            <Row icon="card" title="Card" subtitle={view.remember && view.card ? "Remembered once you approve" : undefined} value={view.card ? `•••• ${view.card}` : "Couldn't be read"} />
            <Row icon="bag" title="Items" value={view.items === null ? "Couldn't be read" : String(view.items)} />
            <Row icon="cart" title="Total" value={cents(view.totalCents)} />
          </>
        ) : <Row icon="refresh" title="Get ready" subtitle="Shows Safeway's pickup days and free times." onClick={() => getTimes()} />}
      </Group>
      )}
      {view && (view.stops.length > 0 || view.highlights.length > 0) && (
        <div className="space-y-1 px-4">
          {view.stops.map((s) => <p key={s} className="t-sub text-alert">{s}</p>)}
          {view.highlights.map((h) => <p key={h} className="t-sub text-muted">Check: {h}</p>)}
        </div>
      )}
      {run.stage === "ready" && run.view.canOrder && (
        <Button className="w-full" disabled={view!.stops.length > 0 || view!.totalCents === null} onClick={() => setConfirming(true)}>Place order · {cents(run.view.totalCents)}</Button>
      )}
      {run.stage === "ready" && (
        <Button className="w-full" variant={run.view.canOrder ? "secondary" : "primary"} disabled={view!.stops.length > 0 || view!.totalCents === null} onClick={() => testRun(run.view)}>Test run · {cents(run.view.totalCents)}</Button>
      )}
      {run.stage === "ready" && !run.view.canOrder && run.view.orderWhy && <p className="px-4 t-sub text-muted">{run.view.orderWhy}</p>}
      {run.stage === "ordering" && <Held groups={[1]} label="Placing the order" />}
      {run.stage === "ordered" && (
        <div className="space-y-1 px-4">
          {run.result.ok
            ? <><p className="t-body font-semibold">{run.result.ordered}</p>{run.result.number && <p className="t-sub text-muted">Safeway order {run.result.number}</p>}</>
            : run.result.reasons.map((r) => <p key={r} className="t-sub text-alert">{r}</p>)}
        </div>
      )}
      {run.stage === "ready" && (
        <ConfirmSheet open={confirming} title={`Place order · ${cents(run.view.totalCents)}?`} confirm="Place order"
          message={[`${run.view.store.split(",")[0]} · ${run.view.window} · •••• ${run.view.card}`, ...run.view.highlights.map((h) => `Check: ${h}`)].join("\n")}
          onConfirm={() => placeIt(run.view)} onCancel={() => setConfirming(false)} />
      )}
      {run.stage === "running" && <Held groups={[1]} label="Test run going" />}
      {run.stage === "done" && (
        <div className="space-y-1 px-4">
          {run.result.ok ? <p className="t-body font-semibold">{run.result.would}</p> : run.result.reasons.map((r) => <p key={r} className="t-sub text-alert">{r}</p>)}
        </div>
      )}
      {(run.stage === "ready" || run.stage === "done") && <Button variant="plain" className="w-full" onClick={() => (offered.current && run.stage === "ready" ? setRun({ stage: "times", times: offered.current, picked: true }) : getTimes())}>{run.stage === "ready" ? "Pick another time" : "Get ready again"}</Button>}
      <Alert open={Boolean(problem)} title="That didn't go through" message={problem ?? ""} onClose={() => setProblem(null)} />
    </>
  );
}

/**
 * Pick a day, then a time, as on Safeway's site (Sam, Nov 14): first only the days; a day tapped shows its free times
 * (only free ones; paid Flash times never show), and a time tapped gets ready with it.
 */
function TimesList({ view, picked, loading, onDay, onPick }: { view: TimesView; picked: boolean; loading?: string; onDay: (key: string) => void; onPick: (id: string) => void }) {
  const chosen = picked || loading ? (loading ?? view.day) : "";
  return (
    <div className="space-y-4">
      <Group header="Pickup day">
        <div role="radiogroup" aria-label="Pickup day" className="flex gap-2 overflow-x-auto p-3">
          {view.days.map((d) => (
            <button key={d.key} role="radio" aria-checked={d.key === chosen} onClick={() => onDay(d.key)}
              className={`shrink-0 rounded-full px-3.5 py-2 t-sub font-semibold whitespace-nowrap ${d.key === chosen ? "bg-accent text-on-accent" : "glass text-accent"}`}>{d.label}</button>
          ))}
        </div>
      </Group>
      {loading ? <Held groups={[4]} label="Reading that day's times" /> : chosen && (
        <Group header="Pickup time">
          {view.times.length ? view.times.map((t) => <Row key={t.id} icon="clock" title={t.time} accessory="chevron" onClick={() => onPick(t.id)} />)
            : <Row title="No free times this day" subtitle="Pick another day." />}
        </Group>
      )}
    </div>
  );
}
