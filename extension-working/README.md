# Simmer (the Chrome helper)

Simmer's Shop tab (List · Find · Cart) searches Safeway and changes the Safeway cart, but Safeway can only be reached
from a real browser where Robin is signed in. This helper is that browser's hands: in Chrome on a computer, it does
Simmer's small Safeway jobs on safeway.com and reports back. It never signs in and never checks out.

## How it works (1.0; 1.2 adds the cart page; 1.3 the Purchases page and push)

- **Jobs.** Simmer queues a job (`/api/safeway/jobs`): `search` (a search's products with picture, name, price and
  whether each is in the cart), `setQty` (press Add / + / − on a product until the cart holds that many; 0 takes it
  out), `cart` (1.2: show Safeway's cart page in the Safeway tab, and read it), and `sample` / `snapshot` (a short
  account of a page, to learn how Safeway builds it; `on: "cart"` for the cart page). From Cart, `setQty` is done on
  Safeway's cart page first (where the product is listed), then by searching Simmer's words, other words, and the
  product's name. Long names Safeway shortens on screen ("…") are read whole from the product's buttons. A change from
  Find is made on the search page the Safeway tab is already showing when it's that search (1.2.5), with no reload.
  Safeway loads pictures as they're scrolled to, so a picture further down is read from its `data-src`; Safeway can
  say "No search results" for a moment while its page builds, so that only counts once it has held for a few seconds. The background
  (`background.js`) has no timers (26.11.11): it looks for jobs when Simmer pushes it one, when Chrome starts, and when
  the panel opens, works until none are left, and stops. It does each job in a Safeway tab (`safeway.js`): one
  already open (in the panel's window when it's open), or a new one behind; it's never brought to the front.
- **Did the order go through? (1.3)** When the cart page says "Your shopping cart is empty." and Simmer's copy of the
  cart had something in it, the helper opens Safeway's Purchases page (`PAGE.orders.path`), presses its **Online** tab,
  reads it, and goes back to the cart page. Simmer decides: an order listed with a date on or after the day the cart was
  last filled means it went through (the cart's things come off the Safeway list, the trip is recorded); "You have no
  orders placed within the last 90 days." means the cart only emptied (Simmer's copy empties, the list stays). The
  page's words are kept in the job's result, so the first real order shows whether `PAGE.orders` reads it right.
- **Woken by push (1.3).** When Simmer has VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` in
  Vercel), the helper subscribes to Web Push with Simmer's public key and sends Simmer the subscription (kept on the
  helper's check-in row); every queued job sends an empty push and the helper checks at once. Silent pushes need
  Chrome 121 or later and the `notifications` permission (Chrome requires it for push in an extension; nothing is ever
  shown). The push is how the helper hears of a job: without the keys, jobs wait until Chrome starts or the panel opens.
- **Not answering.** Simmer doesn't guess from when the helper last checked in. A job the helper doesn't pick up within
  20 seconds is given up, says so, and Lists turns the Safeway rows into a checklist for the rest of that visit.
- **Gets ready and test runs (26.11.13).** Asked for by Simmer's Check out: Checkout, Continue, Order info's Continue
  when it's there, the earliest free regular pickup time (or exactly the approved one, in a test run), the pickup step's
  Continue, then the final page read. Nothing presses Place Order; there's no code for it.
- **…and one pickup day (26.11.12.7).** On the checkout page, the look presses the first day not chosen yet, to see its
  windows, and reads them; never a time window. Order info's Continue is skipped when it's already done.
- **Notes the button's words before pressing (26.11.12.6).** Safeway's Continue turns into "Processing" once pressed.
- **…and Order info's Continue (26.11.12.5).** On the checkout page, the look presses the one button that says exactly
  "Continue", to open Pickup date & time, then reads; never Place Order.
- **…and Continue (26.11.12.4).** When Safeway's suggestions page comes after Checkout, the look presses its Continue
  (only that page, only a continue/checkout button, never an Add), and saves checkout-sounding buttons first.
- **The look presses Checkout (26.11.12.3).** Safeway's Checkout is a button, so the look presses that one button on the
  cart page (only a button whose words are all "checkout"/"safeway", only one), reads the review page, and stops.
- **Keeps its wake-up through updates (26.11.12.2).** Chrome drops the helper's push subscription when it reloads itself
  for a new version, so it now makes a new one whenever Chrome's isn't the one Simmer has; and a job it takes just as it
  reloads goes back for the reloaded helper.
- **A read-only look at checkout (26.11.12.1).** Asked for from Settings, it loads Safeway's cart and the checkout pages
  its links lead to, by address, and reads their words, links and buttons. It presses nothing and skips any link that sounds
  like ordering or paying (docs/CHECKOUT.md, phase 1).
- **Wakes from the panel, survives a closed window (26.11.12).** A job queued in the panel tells the helper at once (no
  wait for the push); a search whose panel window has closed uses any window; a failed wake-up subscription is reported
  to Simmer's logs.
- **Updates itself (26.11.11).** Each check-in, Simmer says which helper it ships. A helper older than that reloads
  itself once, which picks up the newer files if `node scripts/release-helper.mjs` has already put them in `extension/`.
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
older, Find and Cart say so and link the zip. Bump the version here whenever the helper's files change: the release date as
YY.M.D, no leading zeros (26.11.10; a second release that day 26.11.10.1), as every Morales app does since Nov 10.

1. Get the helper: Simmer serves it at `/simmer-helper-v<version>.zip` (now `/simmer-helper-v26.11.13.zip`), rebuilt from this folder on every deploy
   (`scripts/zip-helper.mjs`), so it always matches Simmer. Opening the zip gives a folder named **Simmer**.
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right). New install: **Load unpacked** and
   pick the folder. Update: put the new folder's contents in place of the old folder's, then press the reload arrow on
   **Simmer**'s card (it should say the version in `manifest.json`). Keeping the same folder keeps the setup.
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
`PAGE.cartItems`. Also unseen: whether the whole name of a shortened title is in the product's button labels, and (1.3) what an order
looks like on the Purchases page's Online tab: `PAGE.orders.entry` is a guess, and the first real order's words (in the
cart job's result) show what to put there. When
something doesn't match, a `sample` or `snapshot` job's text (kept in the Sheet's "Safeway jobs" tab) shows what
Safeway sent, to fix `PAGE` in Simmer.
