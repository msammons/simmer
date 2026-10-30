# Simmer for Safeway (the Chrome helper)

Fills the Safeway cart on safeway.com from Simmer's list, in a computer's Chrome where Robin is already signed in to
Safeway. It goes through the Safeway items one at a time: searches, adds what it's sure of, asks about the rest (every
product it found, the likeliest first, or look for something else, or skip), and ticks each item off in Simmer once Safeway shows it in the
cart. It never signs in and never checks out: when it's done, she opens the cart and checks out on Safeway as usual.

**Most of it lives in Simmer, so most changes need no update here.** At the start of every run the helper asks Simmer
(`/api/safeway/helper`) what to fill, what to search for, how to read Safeway's pages and how to go about it; for each
search it asks Simmer which product to take or what to ask. All of that is `src/lib/safeway-helper.mjs`, which ships
with Simmer. The helper itself only opens pages, reads them, presses Safeway's buttons and shows the questions. An
update here is needed only for a new kind of step (Chrome doesn't let a helper load code from elsewhere).

Why this shape: Safeway blocks automated browsers and has no way in for apps (see `docs/PLAN.md`, section 5). This runs
in her own Chrome, pressing Safeway's own buttons at a person's pace, so it looks to Safeway like what it is: her,
shopping, with help.

## Installing it (once per computer)

1. Copy this `extension` folder to the computer (or clone the repo there).
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and pick the
   folder.
3. Pin it: the puzzle-piece button in the toolbar, then the pin next to **Simmer for Safeway**.
4. Click the Simmer button. The panel opens beside the page and asks for the household passcode once.

To update it after a change in this folder (rare; see above): replace the folder's files, then press the reload arrow
on its card in `chrome://extensions`. Changes in Simmer reach it on its next run with nothing to do.

## Orders started on the phone

Leave Chrome open on the computer, signed in to Safeway, with the helper set up. In Simmer on the phone, *Fill my
Safeway cart* (Groceries tab) starts an order; every half minute the helper looks for one (`background.js`), fills the
cart in a Safeway tab behind whatever's in front, and asks on the phone through Simmer (`/api/safeway/order`) when it
isn't sure. Check out in the Safeway app.

## Using it

Sign in to Safeway in Chrome. Click the Simmer button, check the list, and press **Fill my Safeway cart**. Answer its
questions in the panel. At the end, **Open my Safeway cart**, pick a time, and check out.

## What it remembers

Which Safeway product was picked for each item, in Simmer's Safeway tab (through `/api/safeway`), so the next order
goes in without asking, on any computer. Picks an older version kept only on that computer go to Simmer on the next
run, and are then cleared there. The passcode and Simmer's
address stay on that computer only. The house's usual products in Simmer (Staples, `usual_product`) are used too: a
clear match goes in without asking.

Picking happens in the panel: it lists every product Safeway found, the likeliest first, with a box to look for
something else. Nothing needs doing on the Safeway page (if someone presses Add there anyway while it asks, that counts
as the pick). Every pick is remembered.

## When Safeway changes its pages

"In the cart" is read two ways: the product's Add button turns into a quantity, or the cart count at the top goes up.
If only the count moved (Safeway's sign on the product wasn't recognized), the panel offers **Copy what Safeway
showed** at the end: that product's part of the page, without pictures. Paste it into a session working on this
Simmer session to teach `PAGE` in `src/lib/safeway-helper.mjs` the new sign; once Simmer is updated, the helper reads
Safeway the new way on its next run. Safeway blocks automated browsers, so a session can't look itself.

## Files

- `manifest.json`, `background.js`: the helper itself; the toolbar button opens the panel, and the background fills
  orders started on the phone.
- `fill.js`: filling the cart, item by item, shared by the panel and the background.
- `panel.html`, `panel.css`, `panel.js`: the panel at the computer.
- `page.js`: what runs inside safeway.com: reads the products on screen, presses Add and +, using the page details
  Simmer sends (Safeway's search tiles, with links to product pages as a fallback).
- In Simmer, `src/lib/safeway-helper.mjs`: what to fill, which product to pick, and Safeway's page details, with tests
  (`safeway-helper.test.ts`, run by `npm test`).
- `../scripts/extension-test.mjs`: the whole flow against a stand-in Safeway page and a stand-in list
  (`node scripts/extension-test.mjs`). It can't tell whether the real Safeway pages still match.
