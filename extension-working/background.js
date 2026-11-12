// The helper's background: does Simmer's Safeway jobs (safeway.js). No timers (26.11.11, Matt: "timer based updates
// feel wrong"): it looks for jobs when Simmer pushes it one, when Chrome starts, and when the panel opens, works until
// none are left, and stops. The phone and the panel both queue jobs in Simmer (which pushes), so both get the same
// thing done the same way. When a job's done it tells an open panel, so the panel shows it at once.
import { runJob, simmer, sleep, store, WrongPasscode } from "./safeway.js";

const VERSION = chrome.runtime.getManifest().version;
/** Whether version `a` is newer than `b`, every part compared (26.11.10.1 is newer than 26.11.10). */
const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.alarms.clear("jobs").catch(() => {}); // the half-minute alarm of 1.x
chrome.runtime.onStartup.addListener(() => check());
chrome.runtime.onInstalled.addListener(() => check());
// A push from Simmer (1.3, Nov 3): a job was just queued. It carries nothing; it only says to look now.
self.addEventListener("push", (e) => { e.waitUntil(check()); });
// The panel opening (it also says which window jobs should use, kept for the session).
chrome.runtime.onMessage.addListener((m) => { if (m?.type === "simmer:check") check(); });

/** The window the panel's open in (jobs use a Safeway tab there, never brought forward), or null. */
const panelWindow = async () => (await chrome.storage.session.get("panelWindow")).panelWindow ?? null;

let running = false, subscribing = 0;
let pace = { pause: 1500 };

async function check() {
  if (running || !(await store.get("address", "")) || !(await store.get("passcode", ""))) return;
  running = true;
  try {
    for (;;) {
      const r = await simmer("POST", { op: "next", version: VERSION, panel: Boolean(await panelWindow()) }, "/api/safeway/jobs");
      const job = r?.job;
      if (r?.settings) pace = { ...pace, ...r.settings }; // Simmer's pace, even with nothing to do (1.2 on)
      // A newer helper in Simmer: reload, which picks up newer files if they're already in this folder (release-helper).
      // Once per version, so files that aren't there yet can't make it reload over and over.
      if (r?.version && newer(r.version, VERSION) && (await store.get("reloadedFor", "")) !== r.version) {
        await store.set("reloadedFor", r.version);
        // A job taken in the same breath goes back, for the reloaded helper to take (Nov 12: one was lost this way).
        if (job) await simmer("POST", { op: "again", id: job.id }, "/api/safeway/jobs").catch(() => {});
        chrome.runtime.reload();
        return;
      }
      // Subscribe when Simmer has none made with its key, or when this Chrome's isn't the one Simmer has: Chrome drops an
      // extension's subscription when it reloads (Nov 12: after the update to 26.11.12.1, the phone couldn't wake it).
      if (r?.push?.key && (!r.push.have || (await self.registration.pushManager.getSubscription())?.endpoint !== r.push.at)) subscribe(r.push.key);
      if (!job) break; // nothing left: stop until the next push, Chrome starting, or the panel opening
      pace = { ...pace, ...job.settings };
      const out = await runJob(job, await panelWindow()).catch((e) => ({ ok: false, error: "failed", why: String(e) }));
      await simmer("POST", out.ok ? { op: "done", id: job.id, result: out.result } : { op: "failed", id: job.id, error: out.error }, "/api/safeway/jobs").catch(() => {});
      chrome.runtime.sendMessage({ type: "simmer:done" }).catch(() => {}); // an open panel shows it at once
      await sleep(pace.pause);
    }
  } catch (e) {
    if (!(e instanceof WrongPasscode)) console.error("Safeway jobs", e);
  } finally {
    running = false;
  }
}

/**
 * Gives Simmer a way to wake this helper: a push subscription made with Simmer's public key (silent pushes need no
 * notification from Chrome 121; the "notifications" permission is still required for push in an extension). A
 * subscription made with another key is replaced. Tried at most every ten minutes.
 */
async function subscribe(key) {
  if (Date.now() - subscribing < 600_000) return;
  subscribing = Date.now();
  try {
    const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    const pm = self.registration.pushManager;
    let sub = await pm.getSubscription();
    const same = (k) => k && new Uint8Array(k).length === raw.length && new Uint8Array(k).every((x, i) => x === raw[i]);
    if (sub && !same(sub.options?.applicationServerKey)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    sub ??= await pm.subscribe({ userVisibleOnly: false, applicationServerKey: raw });
    await simmer("POST", { op: "push", key, subscription: sub.toJSON() }, "/api/safeway/jobs");
  } catch (e) {
    console.error("Simmer can't wake this helper", e);
    // Said to Simmer too (Nov 12), so it shows in Simmer's logs: without it, jobs from the phone wait for the panel.
    await simmer("POST", { op: "note", what: `can't subscribe for wake-ups: ${String(e?.message ?? e)}` }, "/api/safeway/jobs").catch(() => {});
  }
}

// For the end-to-end check (scripts/extension-test.mjs), which can't wait for the alarm.
self.simmerCheck = check;
