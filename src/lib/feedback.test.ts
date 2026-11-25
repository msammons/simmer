// Feedback from the long press on Settings (Sam, Nov 24): what the phone notes about where it is (the registry), what
// the server keeps (cleaned, newest first, the newest 500), the route, and the read-only script's lines.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => { void fn(); } }));

import { resetKv } from "./kv";
import { resetLockout } from "./ops/lockout";
import { addNote, dropNote, KEEP_ALERTS, noteAlert, placeNow, popupDetail, resetNotes, startsHold } from "./feedback";
import { feedbackOf, hide, KEEP_FEEDBACK, latestFeedback, MAX_TEXT, recordFeedback } from "./ops/feedback";
import * as route from "@/app/api/feedback/route";
import { describe as describeEntry } from "../../scripts/feedback.mjs";

const post = (b: unknown, passcode = "right-one") => new Request("http://x/api/feedback", { method: "POST", body: JSON.stringify(b), headers: { "x-passcode": passcode, "x-real-ip": "1.2.3.4", "content-type": "application/json" } });
const server = { live: "26.11.24", helper: "1.2.3", helperSeen: "", ordering: "off in Settings, off on the server" };

beforeEach(() => { process.env.HOUSEHOLD_PASSCODE = "right-one"; resetKv(); resetLockout(); resetNotes(); });

describe("what's on screen", () => {
  it("tells the tab, the screens over it, the sheets and pop-ups in the order they opened, and the state", () => {
    addNote({ kind: "tab", name: "Recipes", detail: "" });
    addNote({ kind: "state", name: "Safeway", detail: "signed in; cart 3 (2 products)" });
    addNote({ kind: "screen", name: "Recipe", detail: "Tacos" });
    const pick = addNote({ kind: "sheet", name: "Which day", detail: "Tacos" });
    addNote({ kind: "popup", name: "Take it off?", detail: "Tacos comes off Tuesday." });
    addNote({ kind: "state", name: "Shop", detail: "" }); // nothing to say: left out
    expect(placeNow()).toEqual({
      tab: "Recipes",
      screens: ["Recipe: Tacos"],
      sheets: [{ name: "Which day", detail: "Tacos" }, { name: "Pop-up: Take it off?", detail: "Tacos comes off Tuesday." }],
      state: { Safeway: "signed in; cart 3 (2 products)" },
      alerts: [],
    });
    dropNote(pick);
    expect(placeNow().sheets.map((s) => s.name)).toEqual(["Pop-up: Take it off?"]);
  });

  it("keeps the last five alerts, each once in a row", () => {
    for (let i = 0; i < KEEP_ALERTS + 2; i++) noteAlert(`Problem ${i}`, "Try again.");
    noteAlert(`Problem ${KEEP_ALERTS + 1}`, "Try again.");
    noteAlert("A headline", { not: "a string" });
    expect(placeNow().alerts).toEqual([...Array.from({ length: KEEP_ALERTS - 1 }, (_, n) => `Problem ${n + 3}: Try again.`), "A headline"]);
  });
});

describe("what's kept", () => {
  it("takes out the passcode and card-like numbers, cuts every field short, and drops what it doesn't know", () => {
    expect(hide("code right-one, card 4111 1111 1111 1111, order 123456")).toBe("code [passcode], card [number], order 123456");
    const f = feedbackOf({
      text: "  Find\r\nshowed nothing  ", release: "26.11.24", tab: "Shop", screens: ["a".repeat(500)], online: false,
      sheets: [{ name: "Safeway's choices", detail: "milk" }, { detail: "no name" }, "junk"], state: { Shop: "showing All", "": "x", n: 5 },
      alerts: ["x", 3], theme: "simmer, dark", viewport: "390x844", userAgent: "UA", passcode: "right-one", card: "4111",
    });
    expect(f).toEqual({
      text: "Find\nshowed nothing", release: "26.11.24", tab: "Shop", screens: ["a".repeat(120)], online: false,
      sheets: [{ name: "Safeway's choices", detail: "milk" }], state: { Shop: "showing All" },
      alerts: ["x"], theme: "simmer, dark", viewport: "390x844", userAgent: "UA",
    });
    expect(feedbackOf({ text: "x".repeat(MAX_TEXT + 50) }).text).toHaveLength(MAX_TEXT);
    expect(() => feedbackOf({ text: "   " })).toThrow("Write something first.");
    expect(() => feedbackOf(null)).toThrow();
  });

  it("keeps the newest 500, newest first", async () => {
    for (let i = 0; i < KEEP_FEEDBACK + 3; i++) await recordFeedback(feedbackOf({ text: `note ${i}` }), server, `2026-11-24T00:00:${String(i % 60).padStart(2, "0")}Z`);
    const all = await latestFeedback(1000);
    expect(all).toHaveLength(KEEP_FEEDBACK);
    expect(all[0].text).toBe(`note ${KEEP_FEEDBACK + 2}`);
    expect(all.at(-1)!.text).toBe("note 3");
  });
});

describe("the route", () => {
  it("needs the passcode and some text, and keeps one entry with the place, the state and the server's side", async () => {
    expect((await route.POST(post({ text: "hi" }, "wrong"))).status).toBe(401);
    const empty = await route.POST(post({ text: "" }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Write something first." });
    expect(await latestFeedback()).toEqual([]);

    const res = await route.POST(post({ text: "The day was wrong", tab: "Meals", sheets: [{ name: "Add a meal", detail: "Tuesday" }], state: { Safeway: "signed out" } }));
    expect(res.status).toBe(200);
    const [e] = await latestFeedback();
    expect(e).toMatchObject({ text: "The day was wrong", tab: "Meals", sheets: [{ name: "Add a meal", detail: "Tuesday" }], state: { Safeway: "signed out" } });
    expect(e.server).toMatchObject({ helper: "never seen", ordering: "off in Settings, off on the server" });
    expect(Date.parse(e.at)).toBeGreaterThan(0);
  });
});

describe("the script", () => {
  it("prints an entry as a few lines, the text first", async () => {
    const e = await recordFeedback(feedbackOf({ text: "Two\nlines", release: "26.11.23", tab: "Shop", screens: [], sheets: [{ name: "Check out", detail: "" }], state: { Shop: "showing All" }, alerts: ["Couldn't add that"], theme: "simmer, light", viewport: "390x844", userAgent: "UA" }), server, "2026-11-24T10:00:00Z");
    expect(describeEntry(e).split("\n")).toEqual([
      "2026-11-24T10:00:00Z · 26.11.23 (live 26.11.24) · Shop",
      "  “ Two", "  “ lines",
      "  open: Check out",
      "  Shop: showing All",
      "  helper: 1.2.3 · ordering off in Settings, off on the server",
      "  recent alerts: Couldn't add that",
      "  online · simmer, light · 390x844 · UA",
    ]);
  });
});

// Review, Nov 24: holding Settings while Feedback was open opened a fresh, empty box over the words being typed.
describe("Feedback's hold", () => {
  const finger = { isPrimary: true, pointerType: "touch", button: 0 };
  it("starts on a primary press on Settings", () => {
    expect(startsHold(finger, true, false)).toBe(true);
    expect(startsHold(finger, false, false)).toBe(false);
    expect(startsHold({ ...finger, isPrimary: false }, true, false)).toBe(false);
    expect(startsHold({ isPrimary: true, pointerType: "mouse", button: 2 }, true, false)).toBe(false);
  });
  it("is ignored while Feedback (or its alert) is showing", () => {
    expect(startsHold(finger, true, true)).toBe(false);
  });
});

describe("ordering's pop-ups", () => {
  it("note only their title: a private pop-up's line (store, card, limit, a code) stays out", () => {
    expect(popupDetail("100 Main St · Fri 6–7 AM · •••• 4242", true)).toBe("");
    expect(popupDetail("Orders still need Face ID, and nothing over $50.00 goes through.", true)).toBe("");
    expect(popupDetail("You can add it again any time.")).toBe("You can add it again any time.");
  });
});

describe("ordering's alerts (Nov 24)", () => {
  beforeEach(() => resetNotes());
  it("are kept by their title alone: a new device's approval code never goes with feedback", () => {
    noteAlert("Not approved yet", "Approve 123456 on the device with Face ID, then come back here.", true);
    noteAlert("Couldn't send that", "No connection.");
    expect(placeNow().alerts).toEqual(["Not approved yet", "Couldn't send that: No connection."]);
  });
});
