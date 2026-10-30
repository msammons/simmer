// The panel beside the page: after a one-time setup (Simmer's address and the household passcode), it shows Simmer
// itself, opening on Shop, so the computer and the phone work the same. The passcode goes to Simmer by message, never
// in the address. Opening the panel also tells the background to check for Simmer's jobs every couple of seconds.
import { simmer, store, WrongPasscode } from "./safeway.js";

const app = document.getElementById("app");
const frame = document.getElementById("simmer");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The background keeps checking quickly while this is open (and knows which window to bring Safeway forward in).
const port = chrome.runtime.connect({ name: "panel" });
chrome.windows.getCurrent().then((w) => port.postMessage({ windowId: w.id })).catch(() => port.postMessage({ windowId: null }));
setInterval(() => port.postMessage({ ping: Date.now() }), 20_000);

function setup({ address = "", error = "", busy = false } = {}) {
  frame.hidden = true;
  frame.removeAttribute("src");
  app.hidden = false;
  app.innerHTML = `
    <header><img src="icon.png" alt="" width="28" height="28" /><span>Simmer</span></header>
    <h1>Welcome</h1>
    <p class="muted">Type Simmer's address and the household passcode, the same one Simmer asks for.</p>
    <form id="pc"><input id="address" placeholder="Simmer's address" aria-label="Simmer's address" autocomplete="off" value="${esc(address)}" ${address ? "" : "autofocus"} />
    <p></p><input id="code" type="password" placeholder="Passcode" autocomplete="off" aria-label="Passcode" ${address ? "autofocus" : ""} />
    ${error ? `<p class="warn">${esc(error)}</p>` : ""}
    <button class="btn primary" ${busy ? "disabled" : ""}>${busy ? "Checking…" : "Continue"}</button></form>`;
  app.querySelector("#pc").onsubmit = (e) => { e.preventDefault(); save(app.querySelector("#address").value, app.querySelector("#code").value); };
}

/** "simmer-x.vercel.app" or a full link → "https://simmer-x.vercel.app", or "" if it isn't one of the apps' addresses. */
function origin(typed) {
  try {
    const u = new URL(/^https?:\/\//i.test(typed.trim()) ? typed.trim() : `https://${typed.trim()}`);
    return u.hostname.endsWith(".vercel.app") ? `https://${u.hostname}` : "";
  } catch { return ""; }
}

async function save(typed, code) {
  const address = origin(typed);
  if (!address) return setup({ address: typed, error: "That address doesn't look right." });
  setup({ address, busy: true });
  await store.set("address", address);
  await store.set("passcode", code.trim());
  await open();
}

/** Shows Simmer, once the passcode's known to work (a dropped connection still shows it; Simmer says so itself). */
async function open() {
  const address = await store.get("address", "");
  if (!address || !(await store.get("passcode", ""))) return setup({ address });
  try { await simmer("GET", null, "/api/safeway/jobs"); }
  catch (e) { if (e instanceof WrongPasscode) return setup({ address, error: "Wrong passcode." }); }
  app.hidden = true;
  frame.hidden = false;
  frame.src = `${address}/?open=shop`;
  port.postMessage({ ready: true }); // set up: the background starts checking for jobs now
}

// Simmer, framed here, asks for the passcode when it starts, and says when the passcode was turned down.
window.addEventListener("message", async (e) => {
  const address = await store.get("address", "");
  if (e.source !== frame.contentWindow || e.origin !== address) return;
  if (e.data?.type === "simmer:ready") frame.contentWindow.postMessage({ type: "simmer:passcode", passcode: await store.get("passcode", "") }, address);
  if (e.data?.type === "simmer:signed-out") setup({ address, error: "Wrong passcode." });
});

open();
