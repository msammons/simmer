// A read-only check of the helper on the real safeway.com, run by hand before a helper release (never scheduled):
//   node scripts/live-check.mjs [words to search] | pbcopy
// It prints a few lines to paste into the helper's own console on the Safeway computer, where Chrome is signed in to
// Safeway (steps in extension-working/README.md, "Before a release: the live check"). Pasted there, they open one
// Safeway tab behind, load one search and then the cart page, read each with the helper's own page reading (page.js,
// as released in that Chrome) and Simmer's page details, say whether they read right, and close the tab.
//
// It only reads. It uses two of page.js's actions, both reading only ("waitFor" products, as every search and cart read
// does), and refuses any other; it presses nothing (no Add, +, −, Checkout, nothing on the sign-in page), types nothing,
// queues no job in Simmer and sends nothing anywhere: what it read stays in that console. scripts/extension-test.mjs runs
// the same lines against its stand-in Safeway and checks nothing there was pressed.
import { PAGE, SETTINGS } from "../src/lib/safeway-helper.mjs";

/** The lines to paste, as one expression (it answers a summary, and prints what it read). */
export function liveCheck(query = "milk") {
  return `(async () => {
  // Simmer's live check (scripts/live-check.mjs): one Safeway search and the cart page, read with the helper's own page
  // reading. It only reads: it presses nothing, types nothing, and sends nothing anywhere.
  const PAGE = ${JSON.stringify(PAGE)};
  const SETTINGS = ${JSON.stringify(SETTINGS)};
  const QUERY = ${JSON.stringify(String(query))};
  const CART = { ...PAGE, ...(PAGE.cartItems ?? {}), noResults: PAGE.emptyCart || PAGE.noResults, onlyInCart: true };
  const { safewayPage } = await import(chrome.runtime.getURL("page.js"));
  // The one action used, and only to read: watching the page for its products, as the helper's search and cart reads do.
  const read = async (tabId, P) => {
    const arg = { until: "products", onlyInCart: P.onlyInCart === true, hold: SETTINGS.noResultsHold, outHold: SETTINGS.signedOutHold, ms: 25000 };
    if (arg.until !== "products") throw new Error("only reading");
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: safewayPage, args: ["waitFor", arg, P] });
    return r?.result ?? null;
  };
  const go = (tabId, url) => new Promise((done) => {
    const finish = () => { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); done(); };
    const on = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    const t = setTimeout(finish, 30000);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.update(tabId, { url });
  });
  const problems = [];
  // A product read whole. A search's has its picture; the cart page's may not (Simmer uses Safeway's picture for it).
  const product = (p, picture = true) => /^\\d{6,}$/.test(p.id) && p.name && !/\\.{3}|…/.test(p.name) && /^\\$\\d+\\.\\d\\d/.test(p.price) && (!picture || /^https:\\/\\//.test(p.image)) && (p.inCart ? p.qty >= 1 : p.qty === 0);
  const count = (r) => r.cartCount === null || (r.cartCount >= 0 && r.cartCount < 150);
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  let search = null, cart = null;
  try {
    await go(tab.id, PAGE.site + PAGE.searchPath + encodeURIComponent(QUERY));
    const s = await read(tab.id, PAGE);
    const sp = s?.page;
    if (!sp) problems.push("the search page didn't finish building");
    else {
      if (sp.signedIn !== true) problems.push("the search page reads signed out");
      if (sp.products.length < 2) problems.push("the search read " + sp.products.length + " products");
      const bad = sp.products.filter((p) => !product(p));
      if (bad.length) problems.push("search products not read whole: " + bad.map((p) => p.id + " " + p.name).join("; "));
      if (!count(sp)) problems.push("the search page's cart count reads " + sp.cartCount);
      search = { products: sp.products.length, inCart: sp.products.filter((p) => p.inCart).length, signedIn: sp.signedIn, cartCount: sp.cartCount };
      console.table(sp.products.map((p) => ({ id: p.id, name: p.name, price: p.price, inCart: p.inCart, qty: p.qty })));
    }
    await go(tab.id, PAGE.site + PAGE.cartPath);
    const c = await read(tab.id, CART);
    const cp = c?.page;
    if (!cp) problems.push("the cart page didn't finish building");
    else {
      const inCart = cp.products.filter((p) => p.inCart);
      if (cp.signedIn !== true) problems.push("the cart page reads signed out");
      if (c.held && inCart.length) problems.push("the cart reads empty with things in it");
      if (!c.held && !inCart.length) problems.push("the cart page read nothing in the cart and didn't say it's empty");
      const bad = inCart.filter((p) => !product(p, false));
      if (bad.length) problems.push("cart products not read whole: " + bad.map((p) => p.id + " " + p.name).join("; "));
      if (!count(cp)) problems.push("the cart page's cart count reads " + cp.cartCount);
      cart = { inCart: inCart.length, things: inCart.reduce((n, p) => n + p.qty, 0), empty: Boolean(c.held), signedIn: cp.signedIn, pastPurchases: cp.products.length - inCart.length };
      console.table(inCart.map((p) => ({ id: p.id, name: p.name, price: p.price, qty: p.qty })));
    }
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
  const ok = problems.length === 0;
  console.log(ok ? "Live check: the helper reads Safeway right." : "Live check found problems:\\n- " + problems.join("\\n- "));
  console.log("Compare with Safeway: the search for " + JSON.stringify(QUERY) + " and the cart above should match what Safeway shows.");
  return { ok, search, cart, problems };
})()`;
}

if (process.argv[1] === new URL(import.meta.url).pathname) console.log(liveCheck(process.argv.slice(2).join(" ") || "milk"));
