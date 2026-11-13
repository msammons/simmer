# Ordering from Simmer (Safeway pickup) — design and protections

Agreed with Sam, Nov 12 2026. This is the most sensitive thing Simmer does: it spends money. **No room for error.** Every
change to checkout code follows this file; if a change would weaken a rule here, it needs Sam's explicit yes first.

## Scope

Pickup only, at the household's usual store. Delivery may come later (a Pickup / Delivery switch and a tip row).

## The flow

1. Shop → Safeway heading → **Check out** (only with something in the cart and the helper reachable, and only when
   ordering is turned on in Settings).
2. A sheet: what Simmer knows at once (how many things; anything on the list not in the cart, tap to go back), then what
   the helper reads from Safeway's checkout: the pickup store, the windows (earliest free one chosen), substitutions,
   the card, the total. Shimmer while it reads.
3. **Place order · $128.40** → Face ID → the confirm sheet (store, window, card, total; unusual items highlighted) →
   the helper places it → "Ordered · pickup Thu 4–5 pm · $128.40", with Safeway's change/cancel cutoff and a link.
   The cart comes off the list as bought.
4. Checking in on arrival stays in Safeway's own app.

## Protections (all required)

**Turning it on**
- Off by default: a Settings switch, plus a server switch (`CHECKOUT_ENABLED`) that can stop it with no release.
- A spending limit per order, set in Settings. Over it: refused before the helper touches Safeway. It starts at $0
  (Sam, Nov 12), so no order can go through until someone in the household raises it; a missing or unreadable limit
  counts as $0.
- The pickup store and the card's last 4 digits are set once in Settings. Safeway showing a different store or card: stop.

**Each order**
- Face ID (a passkey) on the phone to place it.
- The approval is fixed at the tap: every product and count, the store, the window, the card's last 4, the total. The
  helper checks Safeway's final page against all of it; any difference (a cent, an item) stops it, and Simmer shows the
  new figures to approve again.
- Weighed items (Sam, Nov 12): the charge after picking may come in up to 10% over the approved total, and never more
  than $5 over. Simmer reads the charge from Safeway's order history and flags anything beyond that.
- The cart freezes at the tap: any cart change after it cancels the approval.
- The approval expires after 2 minutes.
- Single use, never retried. If the helper loses track after the click, it reads Safeway's order history to find out;
  it never clicks again. Worst case: "Simmer isn't sure; check Safeway". Never a double order.
- Safeway asking for a security code or any card detail on the final page: stop. Simmer and the helper never type one.
- The helper presses only Safeway's Place order button, found by its exact words on the final page; nothing else. Not
  where expected: stop.
- Unusual things are highlighted on the confirm sheet: a count of 5 or more, one item over $30, a total more than 15%
  above Simmer's estimate (tunable).
- Only a helper version that has passed a dry run on this account can place orders (an update needs a new dry run).
- A record of every attempt (what was approved, what Safeway showed, what was pressed, the order number), kept even
  when it fails.

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
   removing all and starting over skips the approval). Still to build: the helper's prepare and dry-run jobs, the Check out
   sheet, the approval, and dry runs on the account. No code presses Place Order.
3. Turning on real orders, after dry runs match.
