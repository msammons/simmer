// Runs inside Google's sign-in page (accounts.google.com), passed to chrome.scripting.executeScript, so it must not use
// anything from outside itself. Signing Sam in to Safeway through Google (Sam, Nov 24: "Yes build it"; docs/CHECKOUT.md):
// its one press is the account in Google's "Choose an account" list whose address is exactly the one Simmer sent. It
// never types, never reads or keeps a password or code, and presses nothing else. Google asking for anything more (a
// password, a code, an address, a consent screen, a check that it's a person) or no single account matching: nothing is
// pressed, and it says why. How Google's page is built comes from Simmer as `G` (`PAGE.google`).
//
// googlePage("choose", { email, ms, G }) → { pressed, why } — watches up to `ms` for the list or something more asked
// googlePage("why", { G }) → { why } — reads only: what Google's page is asking, or "" when it can't tell
export async function googlePage(action, arg) {
  const G = arg?.G;
  if (!G || location.host !== G.host) return { pressed: false, why: "not Google's page" };
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const shown = (sel) => [...document.querySelectorAll(sel)].filter(visible);
  const words = () => (document.body?.innerText ?? "").replace(/\s+/g, " ");
  const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

  /** What the page shows now: something more asked (`why`), the account to choose (`account`), or null (not yet). */
  function state() {
    if (shown(G.password).length) return { why: "password" };
    if (shown(G.captcha).length || new RegExp(G.captchaWords, "i").test(words())) return { why: "captcha" };
    const accounts = [...new Set(shown(G.account))].filter((e) => e.getAttribute("data-identifier"));
    if (accounts.length) {
      const mine = accounts.filter((e) => same(e.getAttribute("data-identifier"), arg.email));
      return mine.length === 1 && arg.email ? { account: mine[0] } : { why: mine.length ? "more than one account" : "account not listed" };
    }
    if (shown(G.fields).length) return { why: "asks for something typed" };
    return null;
  }

  // Still on the list after the press (Google didn't take it): said as such.
  if (action === "why") { try { const s = state(); return { why: s?.why ?? (s?.account ? "account press didn't take" : "") }; } catch { return { why: "" }; } }
  if (action !== "choose") return { pressed: false, why: "unknown" };

  // Google builds its page with its own script: watched as it changes, `ms` at most.
  const found = await new Promise((resolve) => {
    let done = false;
    const check = () => { if (done) return; let s = null; try { s = state(); } catch { s = null; } if (s) finish(s); };
    const seen = new MutationObserver(check);
    const limit = setTimeout(() => finish(null), Math.min(Number(arg.ms) || 10000, 30000));
    function finish(v) { if (done) return; done = true; seen.disconnect(); clearTimeout(limit); resolve(v); }
    seen.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    check();
  });
  // Nothing recognised in time: a page asking something not known here (a consent screen, "Verify it's you"…).
  if (!found) return { pressed: false, why: "asks for more" };
  if (!found.account) return { pressed: false, why: found.why };
  found.account.click();
  return { pressed: true };
}
