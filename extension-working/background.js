// The helper's background: does Simmer's Safeway jobs (safeway.js). Every half minute it checks for jobs; once there's
// activity, or while the panel is open, it checks every couple of seconds until a few minutes pass with nothing. The
// phone and the panel both queue jobs in Simmer, so both get the same thing done the same way.
import { runJob, simmer, sleep, store, WrongPasscode } from "./safeway.js";

const VERSION = chrome.runtime.getManifest().version;
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.alarms.create("jobs", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "jobs") check(); });
chrome.runtime.onStartup.addListener(() => check());
chrome.runtime.onInstalled.addListener(() => check());

// Open panels, each with its window: jobs use a Safeway tab in a window where the panel is open (never brought forward).
const panels = new Map();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return;
  panels.set(port, null);
  port.onMessage.addListener((m) => { if (m?.windowId != null) panels.set(port, m.windowId); check(); });
  port.onDisconnect.addListener(() => panels.delete(port));
});
const panelWindow = () => [...panels.values()].find((w) => w != null) ?? null;

let running = false, lastJob = 0;
let pace = { fastPoll: 2000, idleAfter: 180_000, pause: 1500 };

async function check() {
  if (running || !(await store.get("address", "")) || !(await store.get("passcode", ""))) return;
  running = true;
  try {
    for (;;) {
      const r = await simmer("POST", { op: "next", version: VERSION, panel: panels.size > 0 }, "/api/safeway/jobs");
      const job = r?.job;
      if (r?.settings) pace = { ...pace, ...r.settings }; // Simmer's pace, even with nothing to do (1.2 on)
      if (job) {
        pace = { ...pace, ...job.settings };
        lastJob = Date.now();
        const out = await runJob(job, panelWindow()).catch((e) => ({ ok: false, error: "failed", why: String(e) }));
        await simmer("POST", out.ok ? { op: "done", id: job.id, result: out.result } : { op: "failed", id: job.id, error: out.error }, "/api/safeway/jobs").catch(() => {});
        lastJob = Date.now();
        await sleep(pace.pause);
        continue;
      }
      if (!panels.size && Date.now() - lastJob > pace.idleAfter) break;
      await sleep(pace.fastPoll);
      await store.get("address", ""); // keeps the background awake between checks
    }
  } catch (e) {
    if (!(e instanceof WrongPasscode)) console.error("Safeway jobs", e);
  } finally {
    running = false;
  }
}

// For the end-to-end check (scripts/extension-test.mjs), which can't wait for the alarm.
self.simmerCheck = check;
