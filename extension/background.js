// Clicking Simmer's button in the toolbar opens the panel beside the page.
// In the background, while Chrome is open: every half minute, look for a Safeway order started from Simmer (on a
// phone), and fill the cart for it in a Safeway tab behind, asking Simmer whenever it isn't sure and waiting for the
// answer there. The cart is the same one the Safeway app shows, so checkout happens on the phone.
import { fillCart, simmer, sleep, start, store } from "./fill.js";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const ORDER = "/api/safeway/order";
let running = false;

chrome.alarms.create("order", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "order") checkOrder(); });
chrome.runtime.onStartup.addListener(() => checkOrder());
chrome.runtime.onInstalled.addListener(() => checkOrder());

const order = () => simmer("GET", null, ORDER).then((r) => r.order ?? null);
const post = (body) => simmer("POST", body, ORDER).then((r) => r.order ?? null);

/** Takes a waiting order, or carries on with one this computer took before Chrome let the background sleep. */
async function checkOrder() {
  if (running || !(await store.get("address", "")) || !(await store.get("passcode", ""))) return;
  running = true;
  try {
    let o = await order().catch(() => null);
    if (!o) return;
    const onList = await start();
    let items;
    if (o.status === "waiting") {
      o = await post({ op: "claim", lines: onList.map((it) => ({ itemId: it.id, item: it.item, quantity: it.quantity, state: "to do" })) });
      if (o?.status !== "filling") return;
      await store.set("orderId", o.id);
      items = onList;
    } else if ((o.status === "filling" || o.status === "asking") && o.id === (await store.get("orderId", ""))) {
      const left = new Set(o.lines.filter((l) => l.state === "to do").map((l) => l.itemId));
      items = onList.filter((it) => left.has(it.id));
    } else return;
    await run(o, items);
  } catch (e) {
    console.error("Safeway order", e);
  } finally {
    running = false;
  }
}

async function run(o, items) {
  const lines = o.lines;
  let stopped = false, note = "";
  const line = (it) => lines.find((l) => l.itemId === it.id);
  const report = () => post({ op: "report", id: o.id, lines, note }).then((x) => { if (x?.status === "stopped" || x?.status === "done") stopped = true; }).catch(() => {});
  const ui = {
    at: () => {},
    note: (text) => { note = text; return report(); },
    stopped: () => stopped,
    result: (i, r) => {
      const l = line(items[i]);
      if (l) Object.assign(l, r.ok ? { state: "in cart", qty: r.qty, name: r.name, ...(r.id && { productId: r.id }) } : r.skipped ? { state: "skipped" } : { state: "by hand", ...(r.id && { productId: r.id }) });
      note = "";
      return report();
    },
    // Asks on the phone, through Simmer, and waits for the answer there (checking every few seconds).
    ask: async (item, options) => {
      await post({ op: "ask", id: o.id, question: { itemId: item.id, item: item.item, quantity: item.quantity, options: options.map((p) => ({ id: p.id, name: p.name, price: p.price, image: p.image })) } });
      for (;;) {
        await sleep(2500);
        await store.get("orderId", ""); // keeps the background awake while it waits
        const now = await order().catch(() => null);
        if (!now || now.id !== o.id || now.status === "stopped" || now.status === "done") { stopped = true; return "skip"; }
        const a = now.answer;
        if (now.status === "filling" && a?.itemId === item.id) {
          if (a.skip) return "skip";
          if (a.search) return { search: a.search };
          if (a.pick) return options.find((p) => p.id === a.pick.id) ?? { id: a.pick.id, name: a.pick.name };
        }
      }
    },
  };
  const { halted } = await fillCart({ items, ui, active: false });
  await post({ op: "end", id: o.id, status: halted && !stopped ? "stopped" : "done", note: stopped ? "" : halted }).catch(() => {});
}

// For the end-to-end check (scripts/extension-test.mjs), which can't wait for the alarm.
self.simmerCheckOrder = checkOrder;
