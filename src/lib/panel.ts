"use client";
// Inside the Safeway helper's panel, Simmer runs in a frame and the helper hands it the passcode by message (never in
// the address). It's kept for this visit only.

let framedPasscode: string | null = null;
let panelOrigin = "";
export const framed = () => typeof window !== "undefined" && window.parent !== window;
/** The passcode the panel handed over, this visit. */
export const panelPasscode = () => framedPasscode;
export const setPanelPasscode = (p: string | null) => { framedPasscode = p; };

/**
 * Framed in the helper's panel: ask the panel for the passcode and wait for it (a moment at most). Only a message from
 * the frame's own parent, and only from a Chrome helper's page, is taken.
 */
export function passcodeFromPanel(ms = 3000): Promise<string | null> {
  if (!framed()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (v: string | null) => { window.removeEventListener("message", on); clearTimeout(t); resolve(v); };
    const on = (e: MessageEvent) => {
      if (e.source !== window.parent || !/^chrome-extension:\/\/[a-p]{32}$/.test(e.origin)) return;
      if (e.data?.type === "simmer:passcode" && typeof e.data.passcode === "string") { panelOrigin = e.origin; framedPasscode = e.data.passcode; done(e.data.passcode); }
    };
    const t = setTimeout(() => done(null), ms);
    window.addEventListener("message", on);
    window.parent.postMessage({ type: "simmer:ready" }, "*"); // carries nothing private
  });
}
/** Framed: tell the panel the passcode was turned down, so it asks for it again itself. */
export function tellPanelSignedOut() {
  if (framed() && panelOrigin) window.parent.postMessage({ type: "simmer:signed-out" }, panelOrigin);
}
/** Framed: tell the panel a job was queued from here, so the helper looks at once. */
export function tellPanelQueued() {
  if (framed() && panelOrigin) window.parent.postMessage({ type: "simmer:queued" }, panelOrigin);
}
