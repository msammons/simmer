# Simmer (the Chrome helper)

Simmer's Shop tab searches Safeway (Find) and changes the Safeway cart, but Safeway can only be reached from a real
browser where Robin is signed in. This helper is that browser's hands: in Chrome on a computer, it does Simmer's small
Safeway jobs on safeway.com and reports back. It never signs in, and never types a card detail. It goes through checkout
only when Simmer's Check out asks (docs/CHECKOUT.md), and its one press that orders, Place Order, is made only for an
order Face ID approved, once, when the page says exactly what was approved.

## How it works (1.0; 1.2 adds the cart page; 1.3 the Purchases page and push; since 26.11.12 checkout)

- **Jobs.** Simmer queues a job (`/api/safeway/jobs`): `search` (a search's products with picture, name, price and
  whether each is in the cart), `setQty` (press Add / + / − on a product until the cart holds that many; 0 takes it
  out), `cart` (1.2: show Safeway's cart page in the Safeway tab, and read it), and `sample` / `snapshot` (a short
  account of a page, to learn how Safeway builds it; `on: "cart"` for the cart page). A `setQty` for something already in the
  cart is done on Safeway's cart page first (where the product is listed), then by searching Simmer's words, other words,
  and the product's name; Simmer asks for that from Shop's rows and from Find alike (Simmer, Nov 19: a − from the search page
  found nothing). A new Add is made on the search page the Safeway tab is already showing when it's that search (1.2.5),
  with no reload. Long names Safeway shortens on screen ("…") are read whole from the product's buttons.
  Safeway loads pictures as they're scrolled to, so a picture further down is read from its `data-src`; Safeway can
  say "No search results" for a moment while its page builds, so that only counts once it has held for a few seconds. The background
  (`background.js`) has no timers (26.11.11): it looks for jobs when Simmer pushes it one, when Chrome starts, and when
  the panel opens, works until none are left, and stops. It does each job in a Safeway tab (`safeway.js`): one
  already open (in the panel's window when it's open), or a new one behind; it's never brought to the front.
- **Places the order (26.11.14.7; waits for Place Order to turn on, 26.11.16; reads the confirmation once it fills in, 26.11.18.1).**
  A `checkoutPlace` job, only for an order Face ID approved: it reads Safeway's cart page first (exactly the approved
  products and counts), goes through checkout to exactly the approved time, waits (watching the page, 15 s at most) for
  Place Order to turn on, and presses it once, only when the page, read again right there, shows the approved total, item
  count, card, store, time and bags, no card detail asked for, exactly one enabled "Place Order", and the approval's 2
  minutes haven't run out. Then it reads the page it lands on (its order number or confirmation words, and the address the
  tab moved to) for Simmer to judge. It never presses again, whatever comes back.
- **Signed in with Pickup not chosen, and delivery, said as such (26.11.23.4).** Nov 23, after Sam signed in again
  Safeway had forgotten Pickup, sent every page home (the cart too, with a "Please Select Delivery or Pickup" box), and
  the helper said signed out. Safeway keeps a session note the page can read (`PAGE.session`: a cookie whose userType
  was "C", a signed-in customer, and preference "Dug", pickup; what it holds otherwise isn't seen). A search, cart read
  or Add sent home twice reads it: signed in with a choice that isn't pickup is `noPickup` ("no-pickup" for an Add),
  and the tab stays where Safeway put it, not on the sign-in page; Simmer says "Choose Pickup on Safeway". Missing,
  unreadable, or any other user: signed out, as before. Checkout (Simmer orders pickup only) stops, before any press,
  "no pickup chosen" when the cart is sent home that way, and "delivery" when the note names another choice or the
  checkout page names delivery and no pickup (it said "pickup times couldn't be reopened"). The mode is never switched
  by the helper. Shared with checkout, so this needs a test run.
- **Signed out when Safeway sends its pages home (26.11.23.3).** Nov 23, Safeway's sign-in ran out on the Mac: signed
  out, Safeway sends its cart address to its home page, which shows the name it remembers and no Sign In (its Sign In
  links and its Session Expired box are there, hidden, as on every page). 26.11.23.2 watched that page for the cart,
  opened the cart again, and said "didn't load", twice, about 47 s each. Now a search or cart read that lands on
  Safeway's home page or its sign-in page instead of the page asked for is told at once; it's opened once more (a real
  detour while signed in still gets its second try), and sent there again it's signed out, so the tab waits on the
  sign-in page as before. Shared with checkout (placing reads the cart the same way), so this needs a test run.
- **Hardened against a misbehaving Safeway (26.11.23.2).** Tested offline against saved copies of Safeway's real pages
  (`scripts/real-pages-test.mjs`) and against a stand-in Safeway that misbehaves on purpose (`scripts/extension-test.mjs`).
  What changed: a search or cart read answers the page exactly as the watch read it when it decided (products, "none"
  held, or Sign In held), and a page that never finishes building is "didn't load", never an empty search, an empty cart
  or a sign-out caught in passing; a page Safeway takes elsewhere while it builds is opened once more; a page load is
  waited for only once Chrome has started loading it (a load already under way finishing was taken as the new page);
  the cart count reads only short labels (the real cart page's whole-cart label held the store's street number); Add,
  + and − are told by their first words (a product named "… Plus" could make its Decrease look like +; one named "…
  Notes" lost its Add); a product further down whose buttons Safeway hasn't built yet is scrolled to; Safeway's boxes
  are read only in the words they show. And the helper tells Simmer which reports it still holds when it asks for work,
  so a job Chrome stopped it in the middle of is said at once ("lost", never done again) instead of after five minutes.
  Shared with checkout, so this needs a test run.
- **An Add Safeway won't take says why (26.11.23.1).** Nov 23, an Add on a real tile left it as it was for 10 s, twice, and the phone heard only 0. Safeway's search page keeps a "Session Expired" box and a "Sorry, we're having issues" box ready for an Add it won't take (`addProblem`): one that shows after the Add now ends the wait, Session Expired counts as signed out, and anything else comes to the phone in Safeway's own words (or "nothing changed on its page"). Nothing on the box is pressed. And a sign-out can be wrong (Safeway's own sign-in page sends a signed-in tab on to its home page): the first search, cart read or Add after the helper parks the tab on the sign-in page looks at Safeway once more, unless a field there has the focus; signed out again, the tab stays there until Sam signs in. That's shared with checkout, so this needs a test run.
- **Signed out only when it stays (26.11.23).** Safeway shows Sign In for a moment while a page builds, and right after the computer woke (Nov 21 and 23) one cart read said signed out, the helper opened the sign-in page, and the next read said signed in. Signed out now counts only once Sign In has stayed for 8 s (`signedOutHold`). Checkout reads the cart the same way, so this needs a test run.
- **Never stuck on one job (26.11.21).** Every step on the Safeway page has a time limit, and a page check that throws counts as "not yet", so one page that never answers can't hold the helper and leave every later job "not answering" (Nov 21: a cart read hung for 10 minutes).
- **Asks before pressing, keeps its reports, no pauses left (26.11.19).** Right before Place Order it asks Simmer
  "may I press?" (`press`), and presses only on a yes; Simmer then never calls that order failed. It holds to the earlier
  of the approval's deadline and the time Simmer said was left when it handed the job over. A report that can't be sent
  is kept and sent again at the next check. Every wait that looked again and again (products, the cart, the Purchases
  page, a quantity change, the bags switch, the total settling, the checkout look) now watches the page, its shadow layers
  too, at most every 50 ms, with one limit each; the checkout look follows the same events as Get ready. No pause between
  checkout jobs. Gone: the bags read-out, the unused Add action, and the "alarms" permission.
- **Tighter checkout fingerprint (26.11.18.2).** The cart read placing uses is no longer marked, page.js's marked actions come after every checkout action, and placing reports the address the tab moved to (`landed`).
- **A test run only when checkout changes (26.11.18.1).** Parts checkout never uses are marked `not-checkout`; a change anywhere else changes the checkout fingerprint and Simmer asks for a test run before ordering (docs/CHECKOUT.md).
- **Faster + and a full confirmation read (26.11.18.1).** A + from one no longer waits 3 s for a remove question; after Place Order the confirmation page is read once its words fill in.
- **A plain description (26.11.18).** Chrome shows "Finds groceries and fills your Safeway cart for Simmer."
- **Opens the sign-in page when signed out (26.11.17.1).** When Safeway says Sam is signed out, the Safeway tab goes to
  Safeway's sign-in page and waits there; jobs leave it alone until he has signed in. It never types or presses anything.
- **Opens its own window (26.11.17).** With Chrome running but every window closed, a job opens a Safeway window
  without taking the focus (until then each job failed with "No current window").
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
  20 seconds is given up, says so, and Shop turns the Safeway rows into a checklist for the rest of that visit.
- **Gets ready and test runs (26.11.13).** Asked for by Simmer's Check out: Checkout, Continue, Order info's Continue
  when it's there, the earliest free regular pickup time (or exactly the approved one, in a test run), the pickup step's
  Continue, then the final page read. Nothing in those presses Place Order (only placing does, above).
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

1. Get the helper: Simmer serves it at `/simmer-helper-v<version>.zip` (now `/simmer-helper-v26.11.23.4.zip`), rebuilt from this folder on every deploy
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
  (`node scripts/extension-test.mjs`), including a Safeway that misbehaves: slow pages, Sign In shown a moment or for
  good, a page that never stops changing or never finishes building, checks that throw, an Add answered by a box to
  choose from, an error box or a toast, the tab sent elsewhere mid-job, an empty cart listing past purchases, several
  jobs at once behind a slow one, and the helper stopped mid-job. It can't tell whether the real Safeway pages still match.
- `../scripts/real-pages-test.mjs`: page.js's reading against saved copies of Safeway's real pages, offline, on Sam's Mac
  only (they're in `safeway/`, never committed; without it the script skips). Save a new copy (Chrome's "Save Page As…,
  complete") of a search, the cart and the empty cart when Safeway changes, and run it.
- `../scripts/live-check.mjs`: the live check below.

## Before a release: the live check (by hand, read only)

The tests above can't see today's safeway.com. Before releasing a helper change, on the Safeway computer, with Chrome
signed in to Safeway and nobody using Simmer for a minute:

1. In this repo: `node scripts/live-check.mjs | pbcopy` (add words to search for instead of milk, if wanted).
2. In Chrome, open Simmer's side panel, right-click inside it, **Inspect**, then the **Console** tab. The first time,
   Chrome asks you to type `allow pasting` before it takes pasted code.
3. Paste and press Return. It opens one Safeway tab behind, loads the search and then the cart page, reads each with
   the helper's own reading, prints what it read, says "Live check: the helper reads Safeway right." or lists the
   problems, and closes the tab. Compare the two tables with what Safeway shows.

It presses nothing (no Add, +, −, Checkout, nothing on the sign-in page), types nothing, queues no job in Simmer and
sends nothing anywhere. If it says the page reads signed out, sign in to Safeway yourself and run it again.

## What's been seen on the real safeway.com, and what hasn't

Seen and working: searching, the cart page, pressing Add / + / −, checkout and its pickup times, test runs (Nov 14), and a
first real order (Nov 18). Not confirmed: what an order looks like on the Purchases page's Online tab (`PAGE.orders.entry`
is a guess, and the cart job's result keeps the page's words to fix it from), and whether the whole name of a shortened
title is always in the product's button labels. When something doesn't match, a `sample` or `snapshot` job's text (kept
with Simmer's "Safeway jobs" rows) shows what Safeway sent, to fix `PAGE` in Simmer.
