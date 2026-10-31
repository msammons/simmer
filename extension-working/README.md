# Simmer (the Chrome helper)

Simmer's Shop tab (List · Find · Cart) searches Safeway and changes the Safeway cart, but Safeway can only be reached
from a real browser where Robin is signed in. This helper is that browser's hands: in Chrome on a computer, it does
Simmer's small Safeway jobs on safeway.com and reports back. It never signs in and never checks out.

## How it works (1.0; 1.2 adds the cart page)

- **Jobs.** Simmer queues a job (`/api/safeway/jobs`): `search` (a search's products with picture, name, price and
  whether each is in the cart), `setQty` (press Add / + / − on a product until the cart holds that many; 0 takes it
  out), `cart` (1.2: show Safeway's cart page in the Safeway tab, and read it), and `sample` / `snapshot` (a short
  account of a page, to learn how Safeway builds it; `on: "cart"` for the cart page). From Cart, `setQty` is done on
  Safeway's cart page first (where the product is listed), then by searching Simmer's words, other words, and the
  product's name. Long names Safeway shortens on screen ("…") are read whole from the product's buttons. The background
  (`background.js`) checks for jobs every half minute; once there's activity, or while the panel is open, it checks
  every couple of seconds until a few minutes pass with nothing. It does each job in a Safeway tab (`safeway.js`): one
  already open (in the panel's window when it's open), or a new one behind; it's never brought to the front.
- **The panel is Simmer.** After the one-time setup (Simmer's address and the household passcode, kept on this computer
  only), the panel shows Simmer itself, opening on Shop. The passcode goes to Simmer by message, never in the address.
  So the computer and the phone are the same experience, and both go through the same jobs.
- **Most of it lives in Simmer.** Every job carries Simmer's page details (`PAGE` in `src/lib/safeway-helper.mjs`) and
  pace (`SETTINGS`), so a Safeway redesign or a change of pace is a Simmer deploy. What to search for, which product is
  the usual, the cart, the picks (with pictures) and every word on screen are Simmer's. Only a new kind of job needs
  the helper reloaded.

Why this shape: Safeway blocks automated browsers and has no way in for apps (see `docs/PLAN.md`, section 5). This runs
in her own Chrome, pressing Safeway's own buttons at a person's pace.

## Where it lives

The code is edited here, in `extension-working/`. Chrome never loads this folder. On the Safeway computer (Sam's Mac,
where this repo is checked out) Chrome loads `extension/` next to it: git ignores that folder, and
`node scripts/release-helper.mjs` fills it with `extension-working/` as released on origin/main. So switching branches
or a half-done edit never reaches the helper in use. After a helper change ships, run the script and press reload on
Simmer in `chrome://extensions`. Other computers use the zip below.

## Installing or updating it (once per computer)

Simmer knows the version it ships (`extension-working/manifest.json`) and the one that last checked in; when the computer's is
older, Find and Cart say so and link the zip. Bump the version here whenever the helper's files change.

1. Get the helper: Simmer serves it at `/simmer-helper.zip`, rebuilt from this folder on every deploy
   (`scripts/zip-helper.mjs`), so it always matches Simmer. Opening the zip gives a folder named **Simmer**.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right). New install: **Load unpacked** and
   pick the folder. Update: put the new folder's contents in place of the old folder's, then press the reload arrow on
   **Simmer**'s card (it should say 1.2.0). Keeping the same folder keeps the setup.
3. Pin it (the puzzle-piece button, then the pin), click the Simmer button, and type Simmer's address and the passcode
   (once).
4. Sign in to Safeway in that Chrome, and leave Chrome open. Simmer's Find then works from the phone too.

## Files

- `manifest.json`, `background.js`: the helper; the toolbar button opens the panel, and the background does the jobs.
- `safeway.js`: doing one job in a Safeway tab.
- `page.js`: what runs inside safeway.com: reads the products on screen, presses Add / + / −, using Simmer's page details.
- `panel.html`, `panel.css`, `panel.js`: setup, then Simmer in a frame.
- `../scripts/extension-test.mjs`: the whole thing against a real local Simmer and a stand-in Safeway
  (`node scripts/extension-test.mjs`). It can't tell whether the real Safeway pages still match.

## Not yet tried on the real safeway.com

Whether Safeway's search fills in a tab nobody's looking at; whether − at one removes the product without a
confirmation step; the − / + buttons' labels on the real page (read from Safeway's code, not pressed); and anything
about the cart page (1.2): its address (`PAGE.cartPath`), whether its products read like search tiles, and its
buttons. If they don't, cart changes fall back to searching, and a `sample` job with `on: "cart"` shows what to put in
`PAGE.cartItems`. Also unseen: whether the whole name of a shortened title is in the product's button labels. When
something doesn't match, a `sample` or `snapshot` job's text (kept in the Sheet's "Safeway jobs" tab) shows what
Safeway sent, to fix `PAGE` in Simmer.
