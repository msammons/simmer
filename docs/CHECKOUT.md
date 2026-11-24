# Ordering from Simmer (Safeway pickup) — design and protections

Agreed with Sam, Nov 12 2026. This is the most sensitive thing Simmer does: it spends money. **No room for error.** Every
change to checkout code follows this file; if a change would weaken a rule here, it needs Sam's explicit yes first.

## Scope

Pickup only, at the household's usual store. Delivery may come later (a Pickup / Delivery switch and a tip row).
Safeway set to delivery, or signed in with Pickup not chosen, stops every checkout step before any press (Nov 23,
helper 26.11.23.4): "Safeway is set to delivery. Switch it to Pickup on Safeway, then try again."
Since helper 26.11.23.5 the helper switches Safeway to Pickup itself first, once per job (Sam, Nov 23, approving these
presses: "i want this process to be automated. ideally i never touch safeway while building testing or running"):
on Safeway's home page, the header's Delivery/Pickup button, the box's Pickup tab, and the "Select" of the one store
card whose street is the household's pickup store (the one checkout learned; Simmer sends it with each job). Each only
when exactly one fits; never Delivery, In Store or another store; a store already "Selected" isn't pressed; no store
known, no switch. Searches, cart reads, Adds, getting ready and test runs switch; placing never does (it stops as before,
on exactly what Face ID approved). Only if the switch doesn't take does Simmer show the words above.

Signing in through Google (helper 26.11.24.2; Sam, Nov 24, asked directly about exactly these presses: "Yes build it").
When a search, cart read or Add finds Safeway signed out, the helper signs Sam in once per job: on Safeway's sign-in
page, its one "Sign in with Google" (its one Sign In first, only if that box isn't showing); Safeway's own page then
takes the tab to its sign-in service and on to Google in the same tab; on accounts.google.com, the one account in
"Choose an account" whose address is exactly the one Simmer sends (set in Settings → Safeway sign-in, Sam, Nov 24: "i
want the email to be set in settings"; never saved there, the address in Vercel, SAFEWAY_GOOGLE; empty, never tried). Each press only when exactly one fits. It never types, reads or keeps a password or code. Google asking for
anything more (a password, a code, anything typed, a consent screen, a check that it's a person) or that account not
listed exactly once: nothing pressed there, and the tab waits on Safeway's sign-in page as before ("Signed out"). Never
in getting ready, test runs or placing: those stop "signed out" as before. Version 1 signs in as Sam only.

Progress (Nov 23, helper 26.11.24, Sam: "some sort of status message saying what the app is doing as it goes"): as it
works a checkout job the helper tells Simmer which step it's at (a short key and its time: the cart, Checkout, the
pickup times, a day, the time, the bags, reading the order, checking before Place Order, waiting for the confirmation).
These are read-only messages to Simmer, sent without waiting and dropped if they fail: they add no presses, change no
job's status, and nothing in checkout waits on them or decides by them. The phone shows them as words in place.

## The flow

1. Shop → **Check out**, on the line above the list (it opens only with something in the Safeway cart: greyed with an
   empty cart, while a cart change is on its way or the cart is being read; greyed too when Safeway was last seen
   signed out, when it was signed in with Pickup not chosen (Nov 23), and when the computer isn't answering, a press
   looking again). The button always reads "Check out" (Sam, Nov 24): its state shows by colour only, and the words
   ("Signed out", "Choose Pickup on Safeway", "Not connected", "Looking…" while it reads, "Still signed out" and the
   like when it ends the same, the helper's step while the cart is read) are a small status line beside it, in
   place, so the line never moves (no price on that line, Sam, Nov 24; the total is on the sheet). Until ordering is
   set up and on in Settings → Ordering, the sheet says so and offers nothing else.
2. A sheet: what Simmer knows at once (how many things in the cart and Simmer's estimate), then
   Safeway's pickup days and the day showing's free times, as on its site (Sam, Nov 14: "let me pick", then "picking a
   day first": reading every day was slow), read as the sheet opens (Sam, Nov 24: "skip get ready button": there's no
   Get ready button, and the sheet carries no explanatory lines); tapping another day has the helper press that one tile and read it. Only
   free times, plus Flash shown with its price (Sam, Nov 16: "offer flash but show it", his yes to this change); never
   another paid time; the helper chooses none. Free Express times count as well as Regular (Sam,
   Nov 14: "why would i not use express times?"; today's first three were Express, and the Regular-only rule hid them).
   A Flash time is chosen only when it's the one she tapped, with its price on the row; Getting ready stops unless
   Safeway's final page shows Flash with the same ready time and price; its price is in the total she approves; and
   Place Order checks the day, then "Ready by <time> Slot type FLASH price $<price>" exactly once, before pressing.
   Bags (Nov 16, Sam: "user chooses bags", his yes to setting it): she picks Bring my own or Safeway's bags with the
   time. Safeway shows one switch, "Bring your own bag" (on for her own; seen with a real cart Nov 16). Getting ready,
   test runs and placing press it only on the checkout page, only when there's exactly one, once, and only when it
   isn't already as picked; it's read back before the total is read. Getting ready stops if Safeway's bags aren't the
   ones picked, the test run if they changed, and Place Order isn't pressed unless the switch is as approved.
   Each day shows five times and a "More times" button; the helper may press it (Nov 14, to match the site): only on the
   checkout page, only a button reading exactly "More times", only one, once per day read. It shows more times only. With one picked, what
   the helper reads from Safeway's checkout with it: the pickup store, the time, the card, the total. Tapping a time is
   getting ready: the reading starts at once, its steps said in place, and lands on Place order · $X when the server
   allows placing, or on Test run · $X while the helper's checkout fingerprint hasn't passed a test run (Sam, Nov 24:
   "We only need the test run button if it's required"). The sheet only stops offering Test run once it isn't needed;
   every check on the server is unchanged, and placing still needs a passed test run (phase 3). When neither shows (the
   test run passed but placing is closed: the server's switch off, or the helper out of date), one short muted line
   says why in the server's own words, e.g. "The helper on the computer needs updating first." (Sam, Nov 24); with a
   button showing, no line.
   Changing the bags while a reading shows gets ready again with the same time (Pick another time goes back to the
   times); every reading has its own id, and Face ID approves only the one showing. Getting ready takes
   only a time Simmer just offered, and stops if Safeway's chosen time isn't the one picked. Shimmer while it reads.
   A test run that passes doesn't ask for the time again (Sam, Nov 24: "don't need to pick another time on a test"):
   the sheet gets ready again at once with the same time and bags, the same getting ready as a tap, so a new reading
   with its own id (the approval the test run used is gone, and nothing from it is reused), and lands on Place order ·
   $X. That reading is approved like any other: Face ID approves exactly it, within its 2 minutes, with the cart
   unchanged, and every check before the press is made again. If Safeway no longer offers that time by then (or the
   time is no longer one Simmer just offered), the times are read again and an alert says so. A test run that didn't
   pass says why, with Try again (the same time and bags read again); there's no Pick another time after a test run.
3. **Place order · $128.40** → the confirm sheet (store, time, card, bags, total; unusual items highlighted) → Face ID
   approves exactly the reading shown → the helper places it → "Ordered · pickup Thu 4–5 pm · $128.40", with Safeway's
   order number when its page shows one. The cart comes off the list as bought.
4. Checking in on arrival stays in Safeway's own app.

## Protections (all required)

**Turning it on**
- Off by default: a switch (Settings → Ordering), plus a server switch (`CHECKOUT_ENABLED`) that can stop it with no release.
- A spending limit per order, set in Settings → Ordering. Over it: refused before the helper touches Safeway. It starts at $0
  (Sam, Nov 12), so no order can go through until someone in the household raises it; a missing or unreadable limit
  counts as $0.
- The pickup store and the card's last 4 digits come from Safeway's checkout the first time (Sam, Nov 14: picking them
  in Simmer only confirmed what Safeway had): shown on the sheet, checked to be readable, and remembered once that
  first approval is made with Face ID. After that, Safeway showing a different store or card: stop. They can also be
  picked in Settings → Ordering from what Safeway shows (Face ID). To pick up elsewhere, the store is changed on
  Safeway first, then picked again in Simmer.

**Each order**
- Face ID (a passkey) on the phone to place it.
- Turning ordering on, raising the limit, or changing the store or card needs Face ID too (Sam, Nov 13; all of them in
  Settings → Ordering since Nov 14); turning off and lowering the limit don't. With no phone set up, those
  changes are refused.
- The approval is fixed at the tap: every product and count, the store, the window, the card's last 4, the total. The
  helper checks Safeway's final page against all of it; any difference (a cent, an item) stops it, and Simmer shows the
  new figures to approve again. Face ID approves only the reading the phone showed (each Get ready has its own id, Nov
  19), and placing is refused, by the phone and the server, unless the approved total and time are the ones shown.
- Weighed items (Sam, Nov 12): the charge after picking may come in up to 10% over the approved total, and never more
  than $5 over. Simmer reads the charge from Safeway's order history and flags anything beyond that.
- The cart freezes at the tap: any cart change after it cancels the approval.
- The approval expires after 2 minutes.
- Single use, never retried. If the helper loses track after the click, it reads Safeway's order history to find out;
  it never clicks again. Worst case: "Not sure the order went through. Check Safeway before trying again." Never a
  double order.
- Safeway asking for a security code or any card detail on the final page: stop. Simmer and the helper never type one.
- The helper presses only Safeway's Place order button, found by its exact words on the final page; nothing else. Not
  where expected: stop.
- Unusual things are highlighted on the confirm sheet: a count of 5 or more, one item over $30, a total more than 15%
  above Simmer's estimate (tunable).
- Only a helper whose checkout fingerprint (phase 3 below) has passed a dry run on this account, run by the helper
  Simmer ships, can place orders (an update that changes anything checkout runs needs a new dry run).
- No checking out while the cart is changing (Nov 16, Sam): Check out is greyed while a change is on its way to
  Safeway or the cart is being read, and every checkout step on the server refuses while a quantity change is waiting
  or being made.
- A record of every attempt (what was approved, what Safeway showed, what was pressed, the order number), kept even
  when it fails. Since Nov 19 each entry is added on its own in one step (a Redis list; the newest 5,000 kept, with Copy
  to Google Sheet exporting them), so two at once can't lose one.

**Testing**
- Automated tests never touch Safeway: they run against saved copies of Safeway's checkout pages, including broken ones
  (a changed total, a missing button, a page that stalls, a different card or store).
- Dry runs: every step for real on the account, stopping one press short ("would place $128.40, Thu 4–5 pm"). Several
  before the real button is turned on.
- No one but the household places a real order, and only by their own tap. The first real one: a small cart, with the
  Mac in view.
- An independent adversarial review of the checkout code before it ships.

## Phases

1. **Look** (done Nov 12; the Settings row is gone, the helper job stays for dry runs; the last look was done in the
   household's own Chrome, with the same limits): a helper job that loads Safeway's cart page and saves what it shows. Safeway's Checkout is a button,
   so the look presses that one button (Sam, Nov 12: "Checkout only"): only on the cart page, only a button whose every
   word is "checkout" or "safeway", only when there's exactly one, once. It then reads the review page and stops: no
   further press, and no link followed (one could choose a pickup time). Started from a temporary Settings row ("Look
   at Safeway's checkout"), removed afterwards.

   Checkout led to a suggestions page ("Got everything you need?", the cart address plus `/dnf`), so the look may also
   press that page's Continue (Sam, Nov 12: "Continue only"): only on that page, only a button whose every word is
   "continue", "to", "checkout" or "safeway" and that says continue or checkout, only one, once; never an Add or a coupon.

   Then, to see the pickup windows, the checkout page's Order info **Continue** (Sam, Nov 12): only on that page, only a
   button that says exactly "Continue", only one, once. It may save the household's contact details on Safeway.

   What Safeway's checkout page showed (Nov 12, after Checkout and Continue): one page, `/erums/checkout?cartId=…`, in
   steps. **Order info** (name, email, phone, pickup store) with its own Continue; **Pickup date & time** (closed until
   order info is done, so the windows weren't seen yet); **Payment** with the saved card's last 4 and a **"Confirm CVV"**
   box; bring-your-own-bags (already chosen); a **Place Order** button (those exact words); an order summary (items,
   "Est. taxes and fees", the under-$30 fee, sales tax); a donation round-up and fixed amounts ($1/$3/$5/custom) that must
   never be touched; a promo code box; and "Estimated total", which Safeway says may differ from the final charge.
   The card's security code was asked for because the saved card needed fixing; Sam fixed it on Safeway (Nov 12) and it
   is no longer asked. Simmer and the helper never hold card details: if the final page ever asks for a security code
   (or any card detail), the helper stops and Simmer says to finish on Safeway.

   After Order info's Continue (Nov 12): **Schedule pickup time** shows two weeks of days, today chosen, and a slot
   already filled in: "Ready by 9:05 PM", **slot type FLASH, price $3.95**. So Safeway's default is a paid Flash slot;
   ordering must choose a free window itself and check the slot price on the final page is $0 (or what was approved).
   The day's windows (seen Nov 12 in the household's Chrome, pressing one day tile, "a day only"): day tiles are
   `.date-tile[role=button]` labelled "select slots for FRIDAY Nov, 13"; the chosen one has `date-is-active`. Windows
   are radio buttons (`input[type=radio][name=slot]`), shown as "6 AM - 7 AM price Free", their ids carrying store,
   day, date, REGULAR or FLASH, DUG (pickup) and the times. Five show at first, with a "More times" expander (not
   opened). Late in the evening today offered only a paid FLASH slot ($3.95). The pickup Continue and Place Order stay
   off until a window is chosen. The card now shows its new last 4 and asks for no security code. So the picker: the
   earliest window priced "Free" (REGULAR), today or later; never FLASH or a priced slot unless approved. The pickup step's own Continue was turned off with no
   window chosen, so nothing more was pressed.

   Once a time is chosen (seen Nov 14, the first test run), Safeway folds the pickup step into one line with a **"Pickup
   date & time Edit"** button, and the day tiles and times leave the page; a second pass (the test run, or Get ready
   again) then found nothing to choose. So the helper may press that Edit (Sam, Nov 14): only on the checkout page, only a
   button that reads exactly "Pickup date & time Edit", only when there's exactly one, only when no times are showing,
   once per run. It reopens the times and commits to nothing; never another Edit (order info, payment, gift).

   What the cart page showed (Nov 12): pickup at the usual store, an earliest "Flash pickup" time, per-item "Substitute
   with best match", a $3.95 fee under $30, and weighed items priced "approx" (chicken by the pound). The final page's
   total is an estimate when the cart has weighed items; the approval is checked against it to the cent, and the
   allowance below covers the charge after picking.
2. The sheet, the protections and dry runs, built to match what the look found. Done so far (Nov 12): the rules as
   plain code with tests (`src/lib/checkout.ts`: reading the final page, everything that stops an order, the
   weighed-items allowance, the highlights), tested against copies of Safeway's page with stand-in details; a figure
   that appears twice on the page counts as unreadable; the pinned store must begin Safeway's address; and Settings →
   Ordering (off, $0, store, card; turning it on asks first; every change recorded). Then: the window picker (the
   earliest free REGULAR window; never FLASH, a priced one, or one whose price can't be read) and the helper's window
   reading and choosing (only the radio with the exact id Simmer chose, only when its words say "price Free", only on
   the checkout page), tested against copies; and Face ID on the household's phones (Settings → Ordering), checked by
   the server, single use, expiring in 2 minutes. Adding a phone (Sam, Nov 12: "existing phone approves"): the first
   phone sets up with the passcode; after that a new phone asks, both show a 6-digit code, an existing phone approves
   with Face ID (bound to that request), and the new phone sets up within 5 minutes, once. Removing phones isn't built;
   when it is, removing needs Face ID too, and the last phone can't be removed by passcode alone (outside review: else
   removing all and starting over skips the approval). The helper's prepare and dry-run jobs, the Check out sheet, the
   approval and dry runs on the account followed (Nov 13–14, below); Place Order is pressed only by placing (phase 3).

   First test run that matched (Nov 14, helper 26.11.14.2): Get ready chose Sat 6–7 PM (free, REGULAR), read the store,
   card, 4 items and $30.96; Face ID approved those; the test run went through Safeway's checkout again (reopening the
   folded pickup times with their Edit), found the same figures, and stopped short: "Would place $30.96 · Sat 6–7 PM".
   Before it: the store and card are now taken from Safeway, checkout's jobs wake the helper, a failed job keeps its
   reason, and Shop reads Safeway's cart on open (Simmer's copy had said 6 things to Safeway's 4).

   Then (Nov 14, helper 26.11.14.4, Sam: "race conditions imply timers and not events, which are super fragile"): the
   helper's checkout steps no longer pause a guessed number of seconds for Safeway's page. Each waits for what it needs to
   see (the cart's Checkout, the checkout page, the times, the pressed day's own times, the pickup Continue turning on,
   the pickup step folding once done), watching the page change, with one limit to give up; moving between pages waits
   on Chrome's own events. The wake-up subscription has its own record, so a check-in can't put an old one back.

   Test runs that matched on the account (Nov 14): Sat 6–7 PM, Sun 6–7 AM, and Sun 6–7 AM again with helper 26.11.14.6
   (days first, Express and More times); Get ready also matched with a free Express time (Sat 5–6 PM). Each read 4
   items and $30.96 on both passes and stopped one press short.
3. Turning on real orders, after dry runs match. Built Nov 14 (Sam: "Build it"), helper 26.11.14.7, still behind the
   server's switch (`CHECKOUT_ENABLED`, off until Sam turns it on):
   - **Place order · $X** shows (Test run then isn't offered, Sam, Nov 24) only when the server allows it and this helper version has passed a
     test run on the account, kept by the helper's checkout fingerprint (Sam, Nov 18): a hash of the helper's
     code, its manifest (without its version number: Sam, Nov 19, "I don't want constant test runs") and the page details
     Simmer sends it (`src/lib/safeway-helper.mjs`), with only the parts marked
     `not-checkout` (whole marker lines; a test pins what each part may hold and that they come after every checkout
     action) (searching, adding, quantities, the Purchases page, samples) left out,
     so an update that touches anything checkout runs, or anything it shares, needs a new test run, and a search or cart
     fix doesn't. `scripts/checkout-print.mjs` writes it; a test fails if it's stale. A test run counts only when the
     helper that ran it is the one Simmer ships (outside review, Nov 18). Every order is still checked
     against what was approved (cart, total, store, card, time, bags) right before the press, and stops on any difference. Tapping it asks first (store, time, card,
     total, highlights), then Face ID approves exactly those figures.
   - The approval is taken out in one step (single use), must be within 2 minutes and the cart unchanged, and every stop
     is checked again before the helper is asked.
   - The helper reads Safeway's own cart page first: exactly the approved products and counts, else it stops. Then the
     same way as a test run to the final page with exactly the approved time. Then the one press, made in the page only
     when, read again right there, it shows the approved total once, the item count, the card's last 4 and no other
     card, the store, the pickup day and time, no card detail asked for, and exactly one enabled "Place Order".
   - Pressed at most once. A placing job is never handed out twice: one the helper had taken when it reloaded, or hands
     back, is marked unsure instead. Pressed with no clear answer, or lost: "Not sure the order went through. Check
     Safeway before trying again." Never retried.
   - Ordered: Safeway's order number when the page shows it, the cart comes off the Safeway list as bought, every step
     recorded.
   - Outside review (Codex, Nov 14), all six fixed: the helper checks the 2-minute deadline itself right before the
     press; the final page must show the item count with its subtotal; the store, time and card are checked in the
     lines where Safeway shows the chosen ones, each exactly once; "ordered" only when Safeway's page says so (an order
     number or its confirmation words, whether or not the page moved; since Nov 18 also Safeway's confirmation address
     with its order number, only when Chrome reports the tab moved to exactly that address after the press, so a placed
     order whose page hadn't filled in isn't "not sure"); an order is marked going before the helper is
     asked, and no other order starts until it's reported (or 30 minutes pass when unsure); a placing job is claimed in
     one step only one helper can win. Known gap: a cart change made on Safeway during the ~30 s of checkout, to other
     products with the same count, subtotal and total, would not be noticed.
   - Robin's run (Nov 15): both Place order tries stopped, nothing ordered ("place order turned off": Safeway keeps
     the button off a moment after the pickup time is set). Helper 26.11.16 waits for it to turn on (15 s at most, else
     stops); and a step that finds the tab already on Safeway's checkout page reloads it there instead of starting over
     from the cart (placing still reads the cart page first).
   - Nov 19 (helper 26.11.19, outside review): right before the press the helper asks Simmer "may I press?"; only a
     placing job it's still working on, within the approval's deadline by Simmer's clock, moves to pressing, in one step,
     and nothing marks a pressing job failed or not answering after that (no yes, no press). The helper holds to the
     earlier of the approval's deadline and the time Simmer said was left when it handed the job over. A placing job it
     took but hasn't pressed counts as stuck only a minute after the approval ran out. What an order came to is worked out
     and kept when the helper reports (recorded first, then the cart off the list, then the next order allowed), whether
     or not a phone is following; a late report replaces "not sure". The helper keeps a report it couldn't send and sends
     it again. Jobs are one Redis key each, every status change made only from the status read; taking a job is one step
     only one helper can win, for every kind. Every helper wait now watches the page or Chrome's events, with one limit.
     Stopped because Safeway's cart wasn't the approved one: "Safeway's cart isn't what you approved. Nothing was ordered."
   - Review, Nov 19: once Simmer has said yes to "may I press?", the time is kept with the job, and the order is "nothing
     was ordered" only when Safeway's page gave the helper a reason not to press, read before any click; a press whose
     answer was lost (the click can end the helper's script as Safeway's next page starts) is reported as unknown, and
     any other answer is "not sure". A press reported for a job that was never let press is never taken as an order.
     Test runs and placing are handed only to the helper Simmer ships. "May I press?" gives up after 10 s (no press). An
     order's report is tried three times within a few seconds before it waits for the next check. Every way a placing
     job ends (reported, handed back, lost in a reload, given up) has its outcome worked out and recorded at once, and
     following a job Simmer no longer has says "not sure" and records it. A report that arrives twice at once is acted
     on once. Each record entry's detail is kept to 4,000 characters, and Copy to Google Sheet reads the record in pages.
   - Not built yet: reading Safeway's order history after an unsure answer, and the weighed-items charge check (10%,
     $5) against what's charged. Removing phones isn't built, so there's no way around the Face ID approval.
