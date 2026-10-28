# Simmer for Safeway (the Chrome helper)

Fills the Safeway cart on safeway.com from Simmer's list, in a computer's Chrome where Robin is already signed in to
Safeway. It goes through the Safeway items one at a time: searches, adds what it's sure of, asks about the rest (three
likeliest products, or look for something else, or skip), and ticks each item off in Simmer once Safeway shows it in the
cart. It never signs in and never checks out: when it's done, she opens the cart and checks out on Safeway as usual.

Why this shape: Safeway blocks automated browsers and has no way in for apps (see `docs/PLAN.md`, section 5). This runs
in her own Chrome, pressing Safeway's own buttons at a person's pace, so it looks to Safeway like what it is: her,
shopping, with help.

## Installing it (once per computer)

1. Copy this `extension` folder to the computer (or clone the repo there).
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and pick the
   folder.
3. Pin it: the puzzle-piece button in the toolbar, then the pin next to **Simmer for Safeway**.
4. Click the Simmer button. The panel opens beside the page and asks for the household passcode once.

To update it after a change here: replace the folder's files, then press the reload arrow on its card in
`chrome://extensions`.

## Using it

Sign in to Safeway in Chrome. Click the Simmer button, check the list, and press **Fill my Safeway cart**. Answer its
questions in the panel. At the end, **Open my Safeway cart**, pick a time, and check out.

## What it remembers

Which Safeway product was picked for each item, in Simmer's Safeway tab (through `/api/safeway`), so the next order
goes in without asking, on any computer. Each pick is also kept on that computer (Chrome's storage for the helper) in
case Simmer can't be reached; picks only that computer has go to Simmer on the next fill. The passcode and Simmer's
address stay on that computer only. The house's usual products in Simmer (Staples, `usual_product`) are used too: a
clear match goes in without asking.

A pick can be made two ways while it asks: tap a product in the panel, or press Add on the Safeway page.

## Files

- `manifest.json`, `background.js`: the helper itself; the toolbar button opens the panel.
- `panel.html`, `panel.css`, `panel.js`: the panel, and the order of things.
- `page.js`: what runs inside safeway.com: reads the products on screen, presses Add and +. Safeway's pages aren't
  documented, so it finds products by their links (`/shop/product-details.<number>.html`) and their Add buttons. If
  Safeway changes its pages, this is the file to fix.
- `match.js`: which product to pick, with tests (`match.test.js`, run by `npm test`).
- `../scripts/extension-test.mjs`: the whole flow against a stand-in Safeway page and a stand-in list
  (`node scripts/extension-test.mjs`). It can't tell whether the real Safeway pages still match.
