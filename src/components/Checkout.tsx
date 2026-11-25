"use client";
// Shop → Check out (Sam, Nov 13: "ordering lives where you check out"). The first time, a short set-up right here, in
// order: Face ID and the limit per order, then Turn on ordering (asking first); the pickup store and card come from
// Safeway and are remembered at the first approval (Sam, Nov 14).
// Once set up: the cart and Simmer's estimate (as Shop's Safeway heading shows them), ordering's switch, limit, store
// and card, and a test run (docs/CHECKOUT.md phase 2, Nov 13): opening the sheet reads Safeway's pickup days and free
// times at once (Sam, Nov 24: "skip get ready button"), a time picked (with the bags) gets ready with it, reading
// Safeway's checkout, and changing the bags reads it again. Only while this checkout's fingerprint hasn't passed one,
// "Test run · $X" (Sam, Nov 24: "We only need the test run button if it's required") approves those figures with Face
// ID and goes through Safeway's checkout again, stopping one press short; once it passes, Safeway is read again at once
// with the same time and bags (a new reading, its own id) and lands on Place order, no time picked again. Place order
// (phase 3) asks first, then Face ID approves exactly the reading shown (its preparedId, Nov 19), and the helper places
// it once.
import { useNote } from "@/lib/feedback";
import { useContext, useEffect, useRef, useState } from "react";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, errorText, faceIdAnswer, type OrderResult, type ReadyView, type RunResult, type TimesView } from "@/lib/client";
import { money } from "@/lib/shop";
import { afterReadAgain, afterTestRun, dayAfterGone, readyButtons, stopButtons, timesRanOut } from "@/lib/checkout-sheet";
import { waitWords, type CheckoutWait } from "@/lib/steps";
import { usePrepared, useOrdering } from "./Ordering";
import { Alert, Button, ConfirmSheet, Group, Held, Row, Segmented, Sheet, StartPlan } from "./ui";

/** Bags for this order (Nov 16, Sam: "user chooses bags"): picked with the time; the last choice comes back next time. */
type Bags = "own" | "store";
const BAGS: { value: Bags; label: string }[] = [{ value: "own", label: "Bring my own" }, { value: "store", label: "Safeway's bags" }];
const BAGS_KEY = "sm.bags";
const lastBags = (): Bags => { try { return localStorage.getItem(BAGS_KEY) === "store" ? "store" : "own"; } catch { return "own"; } };
const bagsWords = (own: boolean | null | undefined) => (own === true ? "Bring my own" : own === false ? "Safeway's bags" : "Couldn't be read");

/** `times`: the reading is of the pickup times, not Safeway's checkout with a time (the words say which). */
type Run = { stage: "idle" } | { stage: "reading"; times?: boolean } | { stage: "times"; times: TimesView; loading?: string; picked?: boolean } | { stage: "ready"; view: ReadyView; tested?: boolean } | { stage: "running"; view: ReadyView } | { stage: "done"; view: ReadyView; result: RunResult }
  | { stage: "ordering"; view: ReadyView } | { stage: "ordered"; view: ReadyView; result: OrderResult };
const cents = (c: number | null) => (c === null ? "Couldn't be read" : `$${(c / 100).toFixed(2)}`);

export function CheckoutSheet({ count, total, estimate, onClose }: { count: number; total: number; estimate: boolean; onClose: () => void }) {
  const o = useOrdering();
  // Set up in Settings → Ordering (Sam, Nov 14): Face ID, a limit, and ordering turned on. The store and card come
  // from Safeway at the first approval.
  const ready = o.faceIds > 0 && o.s.limitCents > 0 && o.s.on;

  return (
    <Sheet label="Check out" title="Check out" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {!o.loaded ? <Held /> : (
          <>
            <Group header="Cart">
              <Row icon="cart" title="In the cart" value={`${count} thing${count === 1 ? "" : "s"}`} />
              <Row icon="bag" title="Estimate" value={`${estimate ? "about " : ""}${money(total)}`} />
            </Group>
            {o.hereRow && <Group>{o.hereRow}</Group>}
            {ready ? <TestRun onClose={onClose} /> : <p className="px-4 t-sub text-muted">Set up ordering in Settings → Ordering: Face ID, a limit per order, then turn it on.</p>}
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
function TestRun({ onClose }: { onClose: () => void }) {
  const startPlan = useContext(StartPlan);
  const [run, setRun] = useState<Run>({ stage: "reading" });
  useNote("state", "Check out", `step: ${run.stage}${run.stage === "times" && run.loading ? `, ${run.loading}` : ""}`);
  const [problem, setProblem] = useState<string | null>(null);
  const check = usePrepared<PublicKeyCredentialRequestOptionsJSON>();
  const stop = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const offered = useRef<TimesView | null>(null); // the day and times last read, to go back to
  const pickedId = useRef<string | null>(null); // the time last picked, read again when the bags change or a test run passes
  const pickedOwn = useRef(true); // the bags it was read with
  const [confirming, setConfirming] = useState(false); // Place order's confirm sheet (docs/CHECKOUT.md)
  const [bags, setBagsState] = useState<Bags>(lastBags);
  // What's being waited for and the helper's step in it (Nov 23, Sam: "some sort of status message"; Nov 24: "status
  // messages don't always show"), said in place: every wait starts with `follow`, which drops the last wait's step, so
  // there's always words while busy and never a step left from an earlier wait.
  const [wait, setWait] = useState<{ on: CheckoutWait; step?: string }>({ on: "times" });
  const follow = (on: CheckoutWait) => setWait({ on });
  const stepTo = (step: string | undefined) => setWait((w) => ({ on: w.on, step }));
  const words = waitWords(wait.on, wait.step);
  const setBags = (b: Bags) => { setBagsState(b); try { localStorage.setItem(BAGS_KEY, b); } catch { /* kept for this order only */ } };
  // Opening the sheet reads the pickup times at once (Sam, Nov 24): no Get ready button. Closing it stops following.
  useEffect(() => {
    void getTimes();
    return () => { stop.current?.abort(); stop.current = null; busy.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** A step's end frees the sheet for the next only if it's still the one going (not one the sheet closing stopped). */
  const done = (ac: AbortController) => { if (stop.current === ac) busy.current = false; };

  /** Ready to approve: Face ID's check is fetched now, so it shows straight from the tap (Safari). */
  function showReady(view: ReadyView, tested = false) {
    // The one Bags control always agrees with the reading showing (review, Nov 24: a second Bags row could disagree).
    if (typeof view.bagsOwn === "boolean") setBagsState(view.bagsOwn ? "own" : "store");
    setRun({ stage: "ready", view, tested });
    if (!view.stops.length && view.totalCents !== null && view.preparedId) check.prepare(() => api.faceIdCheckOptions().then((r) => r.options));
  }

  /**
   * The pickup times (Sam, Nov 14: "let me pick", "picking a day first"), read on opening: Safeway's days and the day
   * showing's free times; a day tapped reads that day's times (the days stay, the times shimmer while they're read).
   */
  async function getTimes(day?: string) {
    if (busy.current) return;
    busy.current = true;
    const back = offered.current;
    setRun(day && back ? { stage: "times", times: { ...back, day, times: [] }, loading: day } : { stage: "reading", times: true });
    follow(day && back ? "day" : "times");
    const ac = (stop.current = new AbortController());
    try {
      let r = await api.checkoutTimes(undefined, day, ac.signal);
      while ("waiting" in r) { stepTo(r.step); r = await api.checkoutTimes(r.waiting, undefined, ac.signal, r.stepAt ?? ""); }
      offered.current = r;
      setRun({ stage: "times", times: r, picked: Boolean(day) });
    } catch (e) {
      if (ac.signal.aborted) return;
      setRun(back ? { stage: "times", times: back } : { stage: "idle" });
      setProblem(errorText(e));
    } finally {
      done(ac);
    }
  }

  /** Safeway's checkout read with a time and bags: a new reading, with its own id. */
  async function readWith(windowId: string, own: boolean, signal: AbortSignal): Promise<ReadyView> {
    let r = await api.checkoutPrepare(undefined, windowId, signal, own);
    while ("waiting" in r) { stepTo(r.step); r = await api.checkoutPrepare(r.waiting, undefined, signal, undefined, r.stepAt ?? ""); }
    return r;
  }

  /** A time picked (or the bags changed with one picked): getting ready, Safeway's checkout read with it, to approve. */
  async function pick(windowId: string, own = bags === "own") {
    if (busy.current) return;
    busy.current = true;
    pickedId.current = windowId;
    pickedOwn.current = own;
    setRun({ stage: "reading" });
    follow("read");
    const ac = (stop.current = new AbortController());
    let fresh: { day: string | undefined } | null = null; // the times to read again: the time went, or the list ran out
    try {
      const v = await readWith(windowId, own, ac.signal);
      if (afterReadAgain(v) === "times") { fresh = { day: dayAfterGone(v, offered.current?.day) }; setProblem(v.stops[0] ?? "That pickup time isn't offered any more. Pick another time."); }
      else showReady(v);
    } catch (e) {
      if (ac.signal.aborted) return;
      const why = errorText(e);
      // The times shown ran out (kept 10 minutes): read afresh, never the old ones, where every tap would be refused.
      if (timesRanOut(why)) fresh = { day: offered.current?.day };
      else setRun(offered.current ? { stage: "times", times: offered.current, picked: true } : { stage: "idle" });
      setProblem(why);
    } finally {
      done(ac);
    }
    if (fresh) void getTimes(fresh.day);
  }

  /**
   * The test run, offered only while one is required. One that passes reads Safeway again at once with the same time
   * and bags (Sam, Nov 24: "don't need to pick another time on a test"): a new reading with its own id, since the
   * approval it used is gone and each lasts 2 minutes, landing on Place order · $X. If that time has gone by then, the
   * times show again, read afresh, with an Alert saying so.
   */
  async function testRun(view: ReadyView) {
    if (busy.current) return;
    busy.current = true;
    setRun({ stage: "running", view });
    follow("faceid");
    const ac = (stop.current = new AbortController());
    let approved = false;
    let again = false; // passed, and Safeway is being read again
    let fresh: { day: string | undefined } | null = null; // the times to read again (the time went, or the list ran out)
    try {
      let options: PublicKeyCredentialRequestOptionsJSON;
      try { options = await check.take(); } finally { check.clear(); } // used once; the reading again prepares its own
      const answer = await faceIdAnswer(options);
      const a = await api.checkoutApprove(answer, view.preparedId);
      approved = true;
      if (!a.ok) { setRun({ stage: "done", view, result: a }); return; }
      follow("test");
      let r = await api.checkoutTestRun({ approvalId: a.approvalId }, ac.signal);
      while ("waiting" in r) { stepTo(r.step); r = await api.checkoutTestRun({ jobId: r.waiting, since: r.stepAt ?? "" }, ac.signal); }
      if (afterTestRun(r) === "show" || !pickedId.current) { setRun({ stage: "done", view, result: r }); return; }
      again = true;
      setRun({ stage: "reading" });
      follow("read");
      const own = typeof view.bagsOwn === "boolean" ? view.bagsOwn : pickedOwn.current;
      const v = await readWith(pickedId.current, own, ac.signal);
      if (afterReadAgain(v) === "times") { fresh = { day: dayAfterGone(v, offered.current?.day) }; setProblem(v.stops[0] ?? "That pickup time isn't offered any more. Pick another time."); }
      else showReady(v, true);
    } catch (e) {
      if (ac.signal.aborted) return;
      if (again) {
        // The test run passed but reading Safeway again didn't go through. The times shown ran out: read afresh, saying
        // so. Anything else: said under the figures tested, with Try again and Pick another time (review, Nov 24).
        const why = errorText(e);
        if (timesRanOut(why)) { fresh = { day: offered.current?.day }; setProblem(why); }
        else setRun({ stage: "done", view, result: { ok: false, reasons: ["The test run passed, but Safeway couldn't be read again.", why] } });
      } else {
        // Before the approval (Face ID cancelled, say), the figures still stand; after it, they've been used.
        if (approved) setRun({ stage: "idle" }); else showReady(view);
        setProblem(errorText(e));
      }
    } finally {
      done(ac);
    }
    if (fresh) void getTimes(fresh.day);
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
    follow("faceid");
    const ac = (stop.current = new AbortController());
    let approved = false;
    try {
      const answer = await faceIdAnswer(await check.take());
      const a = await api.checkoutApprove(answer, view.preparedId);
      approved = true;
      if (!a.ok) { setRun({ stage: "ordered", view, result: a }); return; }
      // Only what the sheet showed (Nov 19): a different total or time approved stops here, and the server checks again.
      if (a.totalCents !== view.totalCents || a.window !== view.window) {
        setRun({ stage: "ordered", view, result: { ok: false, reasons: ["What Face ID approved isn't what was shown. Nothing was ordered. Try again."] } });
        return;
      }
      const shown = { approvalId: a.approvalId, totalCents: view.totalCents, window: view.window };
      follow("place");
      let r = await api.checkoutPlace(shown, ac.signal);
      while ("waiting" in r) { stepTo(r.step); r = await api.checkoutPlace({ jobId: r.waiting, since: r.stepAt ?? "" }, ac.signal); }
      setRun({ stage: "ordered", view, result: r });
    } catch (e) {
      if (ac.signal.aborted) return;
      if (approved) setRun({ stage: "ordered", view, result: { ok: false, unsure: true, reasons: ["Not sure the order went through. Check Safeway before trying again."] } });
      else showReady(view);
      setProblem(errorText(e));
    } finally {
      check.clear();
      done(ac);
    }
  }

  const view = run.stage === "ready" || run.stage === "running" || run.stage === "done" || run.stage === "ordering" || run.stage === "ordered" ? run.view : null;
  const buttons = run.stage === "ready" ? readyButtons(run.view) : null;
  // Under what stopped it (review, Nov 24): each message names a control that's showing. A reading, a test run or placing
  // that stopped offers Pick another time (the times read afresh) and, unless the time itself went, Try again (the same
  // time and bags read again); "not sure the order went through" offers nothing.
  const stopped = run.stage === "ready" && run.view.stops.length ? run.view.stops
    : run.stage === "done" ? (run.result.ok ? [] : run.result.reasons)
    : run.stage === "ordered" && !run.result.ok ? run.result.reasons : null;
  const after = stopped && stopButtons(stopped, Boolean(pickedId.current), run.stage === "ordered" && !run.result.ok && run.result.unsure === true);
  /** The times again: as last read for a reading that's fine, read afresh after anything stopped (they may have lapsed). */
  const timesAgain = (fresh: boolean) => (!fresh && offered.current ? setRun({ stage: "times", times: offered.current, picked: true }) : getTimes(offered.current?.day));
  /** Bags changed: with a time picked and its reading showing, getting ready again with the new bags (Sam, Nov 24). */
  function changeBags(b: Bags) {
    setBags(b);
    if (run.stage === "ready" && pickedId.current) void pick(pickedId.current, b === "own");
  }
  return (
    <>
      {/* Bags (Nov 16): one control, with the time; with a reading showing it shows the reading's bags (review, Nov 24). */}
      {((run.stage === "times" && !run.loading) || run.stage === "ready") && (
        <div className="space-y-2">
          <p className="px-4 t-sub font-semibold text-muted">Bags</p>
          <Segmented label="Bags" value={bags} options={BAGS} onChange={changeBags} />
        </div>
      )}
      {run.stage === "reading" ? (run.times
        ? <Held groups={[5]} label="Reading pickup times" words={words} />
        : <Held groups={[5]} label="Reading Safeway's checkout" words={words} />) : run.stage === "times" ? <TimesList view={run.times} picked={Boolean(run.picked)} loading={run.loading} words={words}
        onDay={(d) => (d === offered.current?.day ? setRun({ stage: "times", times: offered.current, picked: true }) : getTimes(d))} onPick={pick} /> : (
      <Group header="Order">
        {view ? (
          <>
            <Row icon="home" title="Pickup store" value={view.store ? view.store.split(",")[0] : "Couldn't be read"} />
            <Row icon="clock" title="Pickup time" value={view.window || "None chosen"} />
            {/* With the Bags control above (a reading showing), its row would say it twice. */}
            {run.stage !== "ready" && <Row icon="bag" title="Bags" value={bagsWords(view.bagsOwn)} />}
            <Row icon="card" title="Card" value={view.card ? `•••• ${view.card}` : "Couldn't be read"} />
            <Row icon="bag" title="Items" value={view.items === null ? "Couldn't be read" : String(view.items)} />
            {view.feesCents ? <Row icon="bag" title="Taxes and fees" value={cents(view.feesCents)} /> : null}
            <Row icon="cart" title="Total" value={cents(view.totalCents)} />
          </>
        ) : <Row icon="refresh" title="Try again" onClick={() => getTimes()} />}
      </Group>
      )}
      {/* What stops ordering stays here. The "Check: …" notes are on Place order's confirm sheet only (Sam, Nov 24: get
          rid of the text above Place order); docs/CHECKOUT.md's highlights are unchanged there. */}
      {view && view.stops.length > 0 && (
        <div className="space-y-1 px-4">
          {view.stops.map((s) => <p key={s} className="t-sub text-alert">{s}</p>)}
        </div>
      )}
      {/* Place order when the server allows it; Test run only while one is required (Sam, Nov 24). */}
      {run.stage === "ready" && buttons?.place && (
        <Button className="w-full" disabled={!buttons.enabled} onClick={() => setConfirming(true)}>Place order · {cents(run.view.totalCents)}</Button>
      )}
      {/* Neither button (the test run passed but placing is closed): one muted line saying why, in the server's words (Sam, Nov 24). */}
      {run.stage === "ready" && buttons && !buttons.place && !buttons.test && run.view.orderWhy && <p className="px-4 t-sub text-muted">{run.view.orderWhy}</p>}
      {run.stage === "ready" && buttons?.test && (
        <Button className="w-full" disabled={!buttons.enabled} onClick={() => testRun(run.view)}>Test run · {cents(run.view.totalCents)}</Button>
      )}
      {run.stage === "ordering" && <Held groups={[1]} label="Placing the order" words={words} />}
      {run.stage === "ordered" && (
        <div className="space-y-1 px-4">
          {run.result.ok
            ? <><p className="t-body font-semibold">{run.result.ordered}</p>{run.result.number && <p className="t-sub text-muted">Safeway order {run.result.number}</p>}</>
            : run.result.reasons.map((r) => <p key={r} className="t-sub text-alert">{r}</p>)}
        </div>
      )}
      {/* After an order, New plan is offered here too (Sam, Nov 24; docs/PLAN.md 4.11): this sheet closes and New plan asks first, as from the top bar. */}
      {run.stage === "ordered" && run.result.ok && startPlan && <Button className="w-full" onClick={() => { onClose(); startPlan(); }}>New plan</Button>}
      {run.stage === "ready" && (
        <ConfirmSheet private open={confirming} title={`Place order · ${cents(run.view.totalCents)}?`} confirm="Place order"
          message={[`${run.view.store.split(",")[0]} · ${run.view.window} · •••• ${run.view.card}`, bagsWords(run.view.bagsOwn), ...run.view.highlights.map((h) => `Check: ${h}`)].join("\n")}
          onConfirm={() => placeIt(run.view)} onCancel={() => setConfirming(false)} />
      )}
      {run.stage === "running" && <Held groups={[1]} label="Test run going" words={words} />}
      {run.stage === "done" && (
        <div className="space-y-1 px-4">
          {run.result.ok ? <p className="t-body font-semibold">{run.result.would}</p> : run.result.reasons.map((r) => <p key={r} className="t-sub text-alert">{r}</p>)}
        </div>
      )}
      {/* A reading that's fine: Pick another time, except after a test run passed (Sam, Nov 24: it lands on Place order
          alone). Anything stopped: the controls its words name (stopButtons). */}
      {after ? (
        <>
          {after.tryAgain && <Button variant="plain" className="w-full" onClick={() => pick(pickedId.current!, pickedOwn.current)}>Try again</Button>}
          {after.pickTime && <Button variant="plain" className="w-full" onClick={() => timesAgain(true)}>Pick another time</Button>}
        </>
      ) : run.stage === "ready" && !run.tested && <Button variant="plain" className="w-full" onClick={() => timesAgain(false)}>Pick another time</Button>}
      <Alert private open={Boolean(problem)} title="That didn't go through" message={problem ?? ""} onClose={() => setProblem(null)} />
    </>
  );
}

/**
 * Pick a day, then a time, as on Safeway's site (Sam, Nov 14): first only the days; a day tapped shows its free times
 * (free ones, and Flash marked with its price), and a time tapped gets ready with it.
 */
function TimesList({ view, picked, loading, words, onDay, onPick }: { view: TimesView; picked: boolean; loading?: string; words: string; onDay: (key: string) => void; onPick: (id: string) => void }) {
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
      {loading ? <Held groups={[4]} label="Reading that day's times" words={words} /> : chosen && (
        <Group header="Pickup time">
          {view.times.length ? view.times.map((t) => <Row key={t.id} icon="clock" title={t.time} subtitle={t.flash ? "Flash" : undefined} value={t.price} onClick={() => onPick(t.id)} />)
            : <Row title="No times this day" />}
        </Group>
      )}
    </div>
  );
}
