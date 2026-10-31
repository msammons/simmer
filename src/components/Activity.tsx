"use client";

// In the Safeway helper's panel, Simmer is the full app, but the phone can also send the computer things to do, and
// the panel's screens don't follow the phone. So the panel says when it's working for the phone: a note at the top
// while someone's using the panel, or, once nobody has touched it for a couple of minutes, the activity log in place
// of the app, until "Use Simmer here". Nothing is locked: the phone's taps go through either way.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Activity } from "@/lib/client";
import { BrandBar, Button, EmptyState, Group, Row } from "./ui";

/** How long the panel must sit untouched before the phone's work takes it over, and how often it checks. */
const IDLE = 120_000, EVERY = 6_000;

const live = (j: Activity) => j.status === "waiting" || j.status === "working";

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`;
}

function why(error: string): string {
  if (error === "not-answering" || error === "stuck") return "the computer didn't answer";
  if (error === "signed-out") return "Safeway isn't signed in";
  if (error === "not-found") return "it didn't come up on Safeway";
  if (error === "not-loaded") return "Safeway didn't load";
  return "Safeway didn't take it";
}

/** One line for a job, as it stands. */
export function describe(j: Activity): string {
  const what = j.what || "something";
  if (j.kind === "search") {
    if (j.status === "failed" || !j.signedIn) return `Couldn't search ${what}`;
    return live(j) ? `Searching ${what}` : `Searched ${what}`;
  }
  if (j.status === "failed") return `Couldn't change ${what}`;
  if (j.qty === 0) return live(j) ? `Taking ${what} out of the cart` : `Took ${what} out of the cart`;
  return live(j) ? `Putting ${what} in the cart · ${j.qty}` : `${what} · ${j.qty} in the cart`;
}

/** The panel's view of the computer's work: the log, whether it's showing, and the phone's task in progress. */
export function usePanelActivity(on: boolean) {
  const [jobs, setJobs] = useState<Activity[]>([]);
  const [log, setLog] = useState(false);
  const touched = useRef(0);
  // Only the phone's work asked for after this opens the log (after "Use Simmer here", only newer work).
  const since = useRef("");

  useEffect(() => {
    if (!on) return;
    touched.current = Date.now();
    since.current = new Date().toISOString();
    const touch = () => { touched.current = Date.now(); };
    const kinds = ["pointerdown", "keydown", "wheel"] as const;
    kinds.forEach((k) => window.addEventListener(k, touch, { passive: true }));
    return () => kinds.forEach((k) => window.removeEventListener(k, touch));
  }, [on]);

  useEffect(() => {
    if (!on) return;
    const ctl = new AbortController();
    const check = async () => {
      try {
        const r = await api.activity(ctl.signal);
        setJobs(r.jobs);
        const phone = r.jobs.some((j) => j.from === "app" && live(j) && j.created > since.current);
        if (phone && Date.now() - touched.current >= IDLE) setLog(true);
      } catch { /* the next check tries again */ }
    };
    check();
    const t = setInterval(check, EVERY);
    return () => { ctl.abort(); clearInterval(t); };
  }, [on]);

  const dismiss = useCallback(() => {
    since.current = new Date().toISOString();
    touched.current = Date.now();
    setLog(false);
  }, []);
  const phoneNow = on ? jobs.find((j) => j.from === "app" && live(j)) ?? null : null;
  return { jobs, log: on && log, phoneNow, open: useCallback(() => setLog(true), []), dismiss };
}

/** While someone's using the panel: the phone's task in progress, in a line at the top. Tapping it opens the log. */
export function PhoneNote({ job, onOpen }: { job: Activity; onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-live="polite"
      className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 mx-auto flex max-w-[26rem] items-center gap-2.5 rounded-full bg-card px-4 py-2.5 text-left t-sub shadow-[0_6px_24px_rgba(0,0,0,.14)]">
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
      <span className="min-w-0 flex-1 truncate"><span className="text-muted">For the phone: </span>{describe(job)}</span>
    </button>
  );
}

/** The panel taken over by the computer's work: what it's doing now, what it's done, and the way back to Simmer. */
export function ActivityScreen({ jobs, onUse }: { jobs: Activity[]; onUse: () => void }) {
  const now = jobs.find(live);
  const done = jobs.filter((j) => !live(j));
  return (
    <div role="dialog" aria-label="What the computer is doing" data-at-rest className="fixed inset-0 z-40 overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-md space-y-6 px-4 pb-[calc(env(safe-area-inset-bottom)+7rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <BrandBar />
        <div className="rounded-[1.375rem] bg-card px-5 py-4" aria-live="polite">
          <p className="flex items-center gap-2 t-foot text-muted">
            <span aria-hidden className={`size-2 rounded-full ${now ? "animate-pulse bg-accent" : "bg-muted/50"}`} />
            {now ? (now.from === "app" ? "Working for the phone" : "Working") : "Ready"}
          </p>
          <p className="mt-1 t-headline">{now ? describe(now) : "Nothing to do right now"}</p>
        </div>
        {done.length ? (
          <Group header="Recent">
            {done.map((j) => (
              <Row key={j.id} title={<span className={j.status === "failed" || (j.kind === "search" && !j.signedIn) ? "text-warn-ink" : ""}>{describe(j)}</span>}
                subtitle={[j.from === "app" ? "From the phone" : "From here", ago(j.updated), j.status === "failed" ? why(j.error) : j.kind === "search" && !j.signedIn ? why("signed-out") : ""].filter(Boolean).join(" · ")} />
            ))}
          </Group>
        ) : (
          !now && <EmptyState icon="bag" title="Nothing yet">Searches and cart changes show here as the computer does them.</EmptyState>
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-md px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        <Button onClick={onUse} className="w-full">Use Simmer here</Button>
      </div>
    </div>
  );
}
