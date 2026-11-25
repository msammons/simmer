# Simmer UI and UX test plan

Every screen and flow, what to do and what should happen. Run it at phone width (390 × 844) in light and dark, and
again in the helper's side panel for Shop. Brought up to date Nov 19 (the Nov 18-19 changes: one Add meal row, List
groups, Shop's Find and cart, Face ID, test runs). **L** = can run on a local copy (sample data from `data/*.csv`, no
Redis, no Safeway). **R** = needs the real data, the helper and Safeway; **never place a real order** (docs/CHECKOUT.md).

## 1. Getting in

| # | Do | Expect | Where |
|---|----|--------|-------|
| 1.1 | Open Simmer fresh | Passcode screen: the lockup, "Household passcode", Get started, "You only need to do this once." | L |
| 1.2 | Get started with the box empty | The button stays disabled; no crash | L |
| 1.3 | Wrong passcode | An alert over the page, "That passcode didn't work" and "Check it and try again."; the box keeps its place | L |
| 1.4 | Right passcode | Opens on Meals; reload stays signed in | L |
| 1.5 | Settings (gear, top right) | Opens a sheet: first "Hold the Settings button on any screen to send feedback." (muted), then Ordering and Safeway sign-in, then Look (one Theme row with the theme's name), and the release as YY.M.D at the end; no sign-out, no copy to a Sheet; closes by pulling down or tapping outside | L |
| 1.5a | Settings → Theme | The phone's own list of the themes (Simmer, Apricot, Blue, Indigo, Pink, Orange, Teal, Green); a pick recolours the app at once, the row shows its name and swatch, and it's kept after a reload | L |
| 1.6 | Change the passcode on the server, then tap anything | Everything closes and the passcode screen asks again | L |

## 2. Bottom bar and moving around

| # | Do | Expect | Where |
|---|----|--------|-------|
| 2.1 | Tap Recipes · Meals · List · Shop | Each opens, the tapped one is lit, the order is Recipes · Meals · List · Shop; a tab has no visible title | L |
| 2.2 | Open a recipe, then swipe right or tap the round back button | Back to the tab; the back button names the screen below; tapping a tab starts that tab fresh | L |
| 2.3 | Reload on each tab | The same tab comes back with its content; with no connection, the last copy shows and nothing says it's empty | L |
| 2.4 | Leave the app in the background, come back | The list, plan and cart reload (no waiting on a timer); a newer build reloads only on a screen at rest | L |
| 2.5 | Keyboard: Tab through the bar | Every tab reachable, visible focus ring | L |

## 3. Recipes

| # | Do | Expect | Where |
|---|----|--------|-------|
| 3.1 | Open Recipes | "Add recipe" first (grey + and grey words), then From the freezer, Favorites, Quick, Regular, Kids' dinners; six each, then "All N" and "Fewer" | L |
| 3.2 | No recipes yet | "No recipes yet" with an Add recipe button | L |
| 3.3 | Add recipe | A sheet: From a link, From a photo, From my files, Type it in | L |
| 3.4 | From a link → paste a recipe page | The shimmer while it reads, then the edit form filled in (name, Quick or Regular, minutes, serves, ingredients, steps) | R |
| 3.5 | From a link with something that isn't a link | An alert in plain words, nothing saved | L |
| 3.6 | Type it in → three ideas, one per line | "Found 3", each ticked, one that's already in the collection says so, Save adds the ticked ones; a twin asks Replace it or Keep both | R |
| 3.7 | Type it in → a whole recipe | One recipe with its ingredients | R |
| 3.8 | Open a recipe | Name, one line (effort · minutes · make ahead · serves), Add to the plan (or "On the plan." when it is), ingredients by Fresh / Freezer / Pantry, numbered steps, Notes, Tags, Where it's from (a photo's source says Photo) | L |
| 3.9 | An ingredient's ⋯ | Move to Fresh, Freezer or Pantry; the one it's in is greyed | L |
| 3.10 | Add to the plan | A sheet "Which day?" with the next 14 days, each showing what's already on it; tap one: the sheet closes, the dinner is on that day on Meals, and its groceries wait on the List (nothing goes on a list by itself) | L |
| 3.11 | Edit (pencil), change the name, save | The new name everywhere (Recipes, Meals) | L |
| 3.12 | Edit → Delete | Asks "Delete X?" (Delete in red, Cancel); it comes off the collection and off the plan, with what only it needed on the list | L |
| 3.13 | A recipe with no ingredients | "No ingredients yet" with Add them; doesn't look broken | L |

## 4. Meals

| # | Do | Expect | Where |
|---|----|--------|-------|
| 4.1 | Open Meals | No heading; New plan in the top bar beside Settings when there are dinners or things on the list; seven days from today as "Wed, Nov 18" (dates, never Today or Tomorrow), each ending with one grey "Add meal" row after its meals; "Show more days" for fourteen; no Quick/Regular per day, no suggestions | L |
| 4.2 | Add meal on a day | A sheet titled with that day: "Find a recipe" (not focused), a pill for each kind with All first (Quick, Regular, Kids' dinners, Breakfast, Lunch, Desserts, Sides), and her recipes under each kind's heading, A to Z, names only | L |
| 4.3 | Tap a pill | Only that kind; the pill lit; All shows every kind again | L |
| 4.4 | Search there | Any recipe of the lit kind (or any, with All); no match: a grey "No recipe called …"; a kind with none: a grey "No recipes" | L |
| 4.5 | A recipe already on that day | Greyed, "Planned" on the right, can't be tapped (it can go on another day) | L |
| 4.6 | Pick a recipe | The sheet closes at once and the dinner shows on that day (no "Saving…", no note bar); a typed meal has no recipe and says so when tapped | L |
| 4.7 | Tap a dinner | Opens its recipe; a dinner that isn't Quick or Regular shows its kind (Kids', Dessert, Side…) on the right | L |
| 4.8 | A dinner's ⋯ → Move to another day | The day sheet; the dinner moves, groceries unchanged | L |
| 4.9 | A dinner's ⋯ → Take off the plan | Asks "Take X off the plan?" ("What only it needed comes off the list."; Take it off in red, Cancel); no Undo after | L |
| 4.10 | Dinners past the 7 or 14 days, or with no day | Under "Later" and "Not on a day" | L |
| 4.11 | New plan | Asks "Start a new plan?" (the N dinners stay on Meals, dimmed; ticked things come off; the Safeway cart stays; what wasn't bought named, Keep them first, Clear them, Cancel; one New plan button when everything was bought); then every dinner is dimmed and logged as made; Keep leaves the unbought things, Clear empties the list; Cancel changes nothing | L |
| 4.11a | Old meals | Past days with meals sit above today and Meals opens on today; a dimmed meal's ⋯ has only Switch back on, which undims it at once and puts its things on the list; a meal added to a past day goes on with its things | L |
| 4.12 | A save that fails | The dinner comes back off and an alert over the page says why (OK); nothing moves | L |
| 4.13 | Two recipes sharing a thing ("1 lb" + "1½ lb" ground turkey) | One List row, amounts added up ("2½ lb"); different units keep the newer amount | L |

## 5. List

| # | Do | Expect | Where |
|---|----|--------|-------|
| 5.1 | Open the List | An "Add item" field (grey + inside its right end), the list's own ⋯ above the list on the right, then Fresh · Pantry · Freezer · Household, A to Z; every row has its name, ✓ (Have) and a cart (Need), and its ⋯ | L |
| 5.2 | Tap the ✓ then the cart on a row | One lit at a time; the lit one tapped again clears it; Need puts it on its store's Shop list; Have checks it off every list | L |
| 5.3 | Type something new in Add item | Specialty / Common and Group pills appear under the field only now; Add puts it on the list as Need and brings it into view, lit for a moment; the keyboard's Done only closes the keyboard | L |
| 5.4 | Type something already kept but hidden | It's offered with "Need"; tapping it marks it Need instead of adding twice | L |
| 5.5 | A planned dinner's things | In their own sections with the name in the accent colour, how much all the planned dinners need under it, no asterisk, no tinted row; they wait there until Need (nothing is on Shop by itself) | L |
| 5.6 | A dinner's thing's ⋯ | Move to another section, Always keep on the list; no group, common or specialty options | L |
| 5.7 | A group (things put in one with Put in a group) | A tinted header row with its name in the usual colour and an arrow, a faint coloured outline around the group; shown from its first thing | L |
| 5.8 | Tap a group's name | Switches between all its items and only the ones in the cart (Need) or needed by a dinner; the arrow turns to show which | L |
| 5.9 | A group whose items all show anyway | Starts open; tapping its name closes it to the name alone | L |
| 5.10 | A group's ⋯ | Only Rename group and Remove group; Rename opens a small sheet; Remove asks "Remove the X group?" and the things stay kept | L |
| 5.11 | The list's own ⋯ | Show all groups (✓ when on): every kept thing and every group opened, specialty things too | L |
| 5.12 | A kept thing's ⋯ | Move to a section, Put in a group / Change group, Make common (always shows) / Make specialty (shows until bought), Remove from the list (asks, "You can add it again any time."; a Need or Have on it goes too, off Shop as well, and its Safeway cart line comes out; a dinner's part stays, with its line) | L |
| 5.13 | A specialty thing after the shop | Leaves the list once bought; Show all groups brings it back | L |
| 5.14 | Recipe lines on the list | No sizes or cuts ("large onion" is "onion", "diced" and "chopped" go; "diced tomatoes" stays whole); "red wine or balsamic vinegar" is one thing; "salt and black pepper" is two; cumin and ground cumin are one line; never tap water | L |
| 5.15 | Remove the last thing in a group, then Show all groups | The group stays (Nov 24): hidden normally, under Show all groups its header alone with no rows, in its section; Add item's Group pill and Put in a group list it; a new thing added into it lands in its section; only its ⋯ Remove group (asks first) takes it away | L |
| 5.16 | Something on Shop with no kept thing behind it (added on Shop, or a kept thing removed while it was Need) | It shows on the List too, in its section, Need lit; ✓ or the cart answer it there; its ⋯ moves it or offers Always keep on the list | L |
| 5.17 | A thing marked Need that's in the Safeway cart: tap its lit cart (or ✓) on the List | No question; it leaves Shop's list and its cart line comes out at once ("Changing the cart…" on Shop while it goes), no loose line left; with the helper not answering, the list change stays and the line shows as after any − that didn't go through, with the same alert | L |

## 6. Shop

| # | Do | Expect | Where |
|---|----|--------|-------|
| 6.1 | Open Shop | An "Add item" field, a filter under the top bar (All, Safeway, Trader Joe's, Costco), a line with Shop's ⋯ on the right, then each store that has things (Safeway, Trader Joe's, Costco); nothing at all says "Nothing to buy" | L |
| 6.2 | Each row | A round tick, the household's name, one small line (Safeway's product and "Need …", or the amount); every row the same height; long names wrap | L |
| 6.3 | Tick a row | Struck through (Show checked on) or hidden (off); nothing says "Saving…" | L |
| 6.4 | Shop's ⋯ | "Show checked" with a ✓ when on (remembered on this phone); "Mark the Safeway cart bought" only with something in the cart | L |
| 6.5 | A row's ⋯ | Pick another (Safeway rows with a product), Get it at Trader Joe's / Costco / Safeway; a thing in the cart can't move | L |
| 6.6 | Add item on Shop | The row appears on its store with a guessed section; the same thing twice joins one row | L |
| 6.7 | Safeway rows with known products | A + on each; an "Add favorites" button (no number, the same look as the row +) on the line above the list, just left of the ⋯ and centred with it and Check out, with more than one; at 375 and 390 wide the line fits whole (Check out with its cart picture, Add favorites, ⋯; no price on the line; status words cut short first); one tap puts them all in the cart and every row shows its count at once | R |
| 6.8 | A Safeway row with nothing remembered | A "Find" button; Find opens Safeway's choices in a sheet, one item at a time ("3 of 8"), each starting at the top of the sheet | R |
| 6.9 | Find | It searches when the item comes up and when Search is tapped, never on each letter typed; "Your favorite" first, then the best matches to her own words; wide screens show a grid | R |
| 6.10 | Add in Find | The Add becomes − n +; Skip becomes "Next: <item>" in place in the bar at the bottom (nothing moves under the finger); Skip goes on without adding; ‹ goes back | R |
| 6.10a | Scroll Find's results to the bottom, then tap the search field | The bar (‹, "3 of 8", Skip or Next) stays at the bottom of the sheet on a blurred backing while the results scroll, sits after the last product at the end (never over it), above the home indicator, and above the keyboard while typing; no Next or Skip at the top | L |
| 6.11 | − / + on a row or in Find for something already in the cart | The number changes at once; the change is made on Safeway's cart page first (not from a search page); quick taps go as one change; − at one takes it out | R |
| 6.12 | Compare with Safeway's cart page | Same products and quantities; the total on the Check out sheet matches (with "about" when weighed); no price beside Check out | R |
| 6.13 | Put something in the cart on Safeway's own site | It shows at the end of the Safeway group with its price and a − n + | R |
| 6.14 | Safeway cart emptied without ordering | Simmer's cart empties; the list rows stay; the helper visits Purchases → Online, then the cart again | R |
| 6.15 | Order placed on Safeway, then Shop | The cart's rows come off Safeway's list by themselves and the trip is recorded | R |
| 6.16 | Mark the Safeway cart bought | Asks "Mark the cart bought?"; the cart and what it was for come off at once | R |
| 6.17 | Helper not running (two minutes or more) | "Can't reach Safeway right now. Check things off in the store instead."; Safeway rows are a plain checklist (no +, Find or −); back once it checks in | L |
| 6.18 | Safeway signed out on the computer | The cart greyed, Check out greyed (its words never change) with "Signed out" in the small status line beside it; pressing it looks again ("Looking…" there); rows are a checklist; coming back after signing in reads the cart again | R |
| 6.19 | Find from the phone with Chrome idle | The search starts within a couple of seconds (a push wakes the helper) | R |

## 7. Ordering and Check out

Never press Place order for real. Everything here is **R**.

| # | Do | Expect | Where |
|---|----|--------|-------|
| 7.1 | Settings → Ordering | Face ID, Limit per order, Pickup store, Card, Order from Simmer (Off); a change that raises spending (turn on, higher limit, other store or card) asks for Face ID, turning off and lowering don't; with no Face ID set up, an alert says to set it up first | R |
| 7.2 | Face ID, first phone | "Set up Face ID?" then Face ID; the row says On | R |
| 7.3 | Face ID, a second phone | "Add this device?"; the row says "Waiting for approval" with a code; reload: it's still there; tapping too soon says "Not approved yet" instead of failing; the other phone shows "Approve a new device" with the same code and Face ID approves it; then "Set up Face ID now" | R |
| 7.4 | Check out after an approval made on another phone | "Set up Face ID on this phone" is offered | R |
| 7.5 | Shop → Check out (with something in the cart) | A sheet: Cart (how many things, the estimate); with ordering not set up, one plain line pointing to Settings → Ordering; the button is greyed while the cart is changing | R |
| 7.6 | Open Check out (set up) | Safeway's pickup days are read at once, no Get ready button and no explanatory lines; one tapped shows its free times (Flash is marked and priced); Bags: Bring my own or Safeway's bags; a time tapped reads Safeway's checkout at once (changing the bags reads it again): store, time, bags, card, items, total | R |
| 7.7 | Test run · $X (only while the helper's checkout fingerprint hasn't passed one) | Face ID, then goes through Safeway's checkout and stops one press short; nothing is ordered. Once it passes, Safeway is read again at once with the same time and bags (its steps said in place) and the sheet lands on Place order · $X, no time picked again and no Pick another time; if the time has gone by then, the times show again with an alert saying so; one that didn't pass says why, with Try again | R |
| 7.8 | Place order · $X | Shown only when the server allows it and the helper's checkout fingerprint has passed a test run, the helper counting only if it's the one Simmer ships; otherwise it isn't offered. With the fingerprint passed, the reading offers only Place order · $X (no Test run); with it passed and placing closed (the server's switch off, or the helper out of date), neither button shows and one short muted line says why, e.g. "The helper on the computer needs updating first." (Sam, Nov 24); with a button showing, no line | R |
| 7.8a | Watch the words through a whole checkout: opening, a day, a time, the bags, Test run, Place order | Something short is always said in place while anything is happening, never blank: the helper's steps as they come, and otherwise the wait's own words ("Reading pickup times…", "Reading that day's times…", "Reading Safeway's checkout…", "Checking with Face ID…" while Face ID is up and checked, "Starting the test run…", "Placing the order…", "Waiting for Safeway to confirm…"); when a wait ends its words go, none left from the step before; Shop's line beside Check out says "Looking…" (or the helper's step) while the cart is read, with something in the cart too | R |
| 7.9 | Change only a search or cart part of the helper | No new test run is needed; changing anything checkout runs makes Place order go away until a test run passes (docs/CHECKOUT.md) | R |
| 7.10 | Anything over the limit, or Safeway showing a different store or card | Refused with the reason, before anything is pressed | R |

## 8. Everywhere

| # | Do | Expect | Where |
|---|----|--------|-------|
| 8.1 | Read every screen | No technical words ("error", "API", "sheet", "tab", "job", "server") and no device names; no sentence speaks of Simmer in the third person ("Not sure the order went through") | L |
| 8.2 | Tap anything | The result shows at once (about 150 ms), saves behind it; no "Saving…", no disabled-while-saving, no spinner (first loads shimmer) | L |
| 8.3 | Anything risky (remove, take off, new plan, delete, mark bought, remove group) | Asks first in the same sheet, the action in red where it removes, then Cancel; never an Undo or toast; ticks and Have/Need never ask | L |
| 8.4 | A problem | One alert in the middle of the screen (headline, reason, OK); never a bar that moves the page | L |
| 8.5 | Nothing moves under the finger | No bars push the page; no row appears or vanishes around the control about to be tapped; fields and pickers are 16px or more (no auto-zoom) | L |
| 8.6 | Look for timers | With the app idle, the network shows no repeating requests; things load on open, return, change or push | L |
| 8.7 | Dark and light | Every screen readable in both; no white flashes | L |
| 8.8 | 320 px wide | No sideways scrolling; long names wrap or clamp; tap areas stay 44px or more | L |
| 8.9 | Slow or failing connection | Screens keep what they had and say so only if they have nothing; nothing shows as empty that isn't | L |
| 8.10 | Console | No errors while using any screen | L |
| 8.11 | Screen reader names | Buttons with only icons have names (⋯, −, +, Have, Need, Settings) | L |
| 8.12 | Hold Settings on any tab and keep holding | After about half a second Feedback appears in the middle of the screen while the finger is still down (not Settings): the title, "You held the Settings button, which opens this on any screen." under it, one box, Cancel and Send side by side, Send greyed until something's written; nothing behind it is dimmed or blurred, and a tap outside it does nothing (only Cancel and Send close it); no callout, selection or magnifier on the button | L |
| 8.13 | Let go after Feedback appears | The keyboard comes up in the box at once; the pop-up stays in view above it at 390 and 375 wide; nothing under the finger reacts | L |
| 8.13a | With a sheet open (Add meal, Find, Check out, Settings) or a confirm or alert up, hold where Settings is | Feedback appears over it; Cancel or Send leaves the sheet or pop-up exactly as it was; a short tap there still does what it did (closes the sheet, or opens Settings) | L |
| 8.14 | Write something, Send | Closes at once, no "Sending…"; with no connection, an alert says so and Feedback comes back with the words in it | L |
| 8.15 | Read it back: `node scripts/feedback.mjs <env file>` | The newest first: the words, the tab and screen, each open sheet and what it showed, Shop and Safeway's state, the helper, ordering on or off, recent alerts, theme, size, online | R |
