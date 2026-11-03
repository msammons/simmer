// The helper's background: does Simmer's Safeway jobs (safeway.js). Every half minute it checks for jobs; once there's
// activity, or while the panel is open, it checks every couple of seconds until a few minutes pass with nothing. The
// phone and the panel both queue jobs in Simmer, so both get the same thing done the same way. From 1.3, Simmer also
// sends a push when it queues a job, and the push starts a check at once (the half-minute alarm stays as the backstop).
import { runJob, simmer, sleep, store, WrongPasscode } from "./safeway.js";

const VERSION = chrome.runtime.getManifest().version;
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.alarms.create("jobs", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "jobs") check(); });
chrome.runtime.onStartup.addListener(() => check());
chrome.runtime.onInstalled.addListener(() => check());
// A push from Simmer (1.3, Nov 3): a job was just queued. It carries nothing; it only says to look now, and to keep
// looking quickly for a little while in case the job isn't in Simmer's copy yet.
self.addEventListener("push", (e) => { wakeUntil = Date.now() + 20_000; e.waitUntil(check()); });

// Open panels, each with its window: jobs use a Safeway tab in a window where the panel is open (never brought forward).
const panels = new Map();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return;
  panels.set(port, null);
  port.onMessage.addListener((m) => { if (m?.windowId != null) panels.set(port, m.windowId); check(); });
  port.onDisconnect.addListener(() => panels.delete(port));
});
const panelWindow = () => [...panels.values()].find((w) => w != null) ?? null;

let running = false, lastJob = 0, wakeUntil = 0, subscribing = 0;
let pace = { fastPoll: 2000, idleAfter: 180_000, pause: 1500 };

async function check() {
  if (running || !(await store.get("address", "")) || !(await store.get("passcode", ""))) return;
  running = true;
  try {
    for (;;) {
      const r = await simmer("POST", { op: "next", version: VERSION, panel: panels.size > 0 }, "/api/safeway/jobs");
      const job = r?.job;
      if (r?.settings) pace = { ...pace, ...r.settings }; // Simmer's pace, even with nothing to do (1.2 on)
      if (r?.push?.key && !r.push.have) subscribe(r.push.key);
      if (job) {
        pace = { ...pace, ...job.settings };
        lastJob = Date.now();
        const out = await runJob(job, panelWindow()).catch((e) => ({ ok: false, error: "failed", why: String(e) }));
        await simmer("POST", out.ok ? { op: "done", id: job.id, result: out.result } : { op: "failed", id: job.id, error: out.error }, "/api/safeway/jobs").catch(() => {});
        lastJob = Date.now();
        await sleep(pace.pause);
        continue;
      }
      if (!panels.size && Date.now() - lastJob > pace.idleAfter && Date.now() > wakeUntil) break;
      await sleep(pace.fastPoll);
      await store.get("address", ""); // keeps the background awake between checks
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
  }
}

// For the end-to-end check (scripts/extension-test.mjs), which can't wait for the alarm.
self.simmerCheck = check;
