# Simmer UI and UX test plan

Every screen and flow, what to do and what should happen. Run it at phone width (390 × 844) in light and dark, and
again in the helper's side panel for Lists → Safeway. **L** = can run on a local copy (sample data from `data/*.csv`,
no Sheet, no Safeway). **R** = needs the real Sheet, the helper and Safeway; never check out.

## 1. Getting in

| # | Do | Expect | Where |
|---|----|--------|-------|
| 1.1 | Open Simmer fresh | Passcode screen: icon, "Household passcode", Get started, "You only need to do this once." | L |
| 1.2 | Get started with the box empty | Button stays disabled or says what's missing; no crash | L |
| 1.3 | Wrong passcode | A plain message ("That passcode didn't work" or similar); the box keeps focus | L |
| 1.4 | Right passcode | Opens on Meals; reload stays signed in | L |
| 1.5 | Settings (top-right) | Opens; every line is plain words; closes by tapping outside or Escape | L |

## 2. Bottom bar and moving around

| # | Do | Expect | Where |
|---|----|--------|-------|
| 2.1 | Tap Recipes · Meals · Stock · Lists | Each opens, the tapped one is highlighted, the order is Recipes · Meals · Stock · Lists | L |
| 2.2 | Back/forward in the browser | Moves between tabs or leaves; never a blank screen | L |
| 2.3 | Reload on each tab | Same tab comes back with its content | L |
| 2.4 | Keyboard: Tab through the bar | Every tab reachable, visible focus ring | L |

## 3. Recipes

| # | Do | Expect | Where |
|---|----|--------|-------|
| 3.1 | Open Recipes | "Add recipes" on top, recipes grouped Quick / Regular, each with effort · minutes · make ahead | L |
| 3.2 | Add recipes → From a link → paste a recipe page → Read it | "Reading the page…", then the edit form filled in (name, quick/regular, minutes, serves, ingredients, steps) | R |
| 3.3 | Add recipes → From a link with something that isn't a link | Plain message, nothing saved | L |
| 3.4 | Add recipes → Type it in → three ideas, one per line | "Found 3", each ticked, Save 3 adds them | R |
| 3.5 | Type it in → a whole recipe | One recipe with its ingredients | R |
| 3.6 | Open a recipe | Name, line (effort · minutes · make ahead · serves), Add to the list, Quick/Regular switch, ingredients by Fresh / From the pantry, numbered steps, Find it by, Where it's from, Stop suggesting this | L |
| 3.7 | Switch Quick ↔ Regular on a recipe | Saved; the list header moves it to the other group | L |
| 3.8 | Add to the list from a recipe | Fresh things go on Lists; things already in Stock are only highlighted there | L |
| 3.9 | Edit (pencil) a recipe, change the name, save | New name everywhere (Recipes, Meals) | L |
| 3.10 | Stop suggesting this | Recipe stays in the collection but planning never picks it | L |
| 3.11 | A recipe with no ingredients (typed idea) | Says so plainly and offers to add them; doesn't look broken | L |

## 4. Meals and planning

| # | Do | Expect | Where |
|---|----|--------|-------|
| 4.1 | Meals with nothing planned | "Nothing planned", "Say how many dinners and lunches…", Plan | L |
| 4.2 | Plan → How many | Counters for quick, regular and kids' dinners, desserts, sides, breakfasts, and lunches per kid; each starts at last time's number and never below what's planned; "N planned already" under a kind with dinners waiting; footer "These are totals…" | L |
| 4.3 | Trips toggles | Trader Joe's and Costco, with last trip dates | L |
| 4.4 | Next → Dinners | Only what's missing to reach each number is picked; fits its kind, no repeats; "Only N of M fit" when short (no fill-in from another kind) | L |
| 4.5 | Something else / One more / remove | A different recipe; when none is left, says so; One more adds one of that kind | L |
| 4.6 | Tap a pick | Picker sheet; a picked one shows "You picked this" | L |
| 4.7 | Next → Lunches → tap a part | Swaps to another of that kid's options; remove a lunch | L |
| 4.8 | Save | Sheet closes; "Added N things to the grocery list." N matches Lists; Lists and Stock update without a reload | L |
| 4.9 | Meals after saving | Dinners to make by kind (no "Quick"/"Regular" word under the kind header), each kid's lunches "N planned", no tick boxes, "Planning again replaces the lunches." | L |
| 4.10 | Plan again with the same numbers | Nothing new picked for kinds already full; lunches replaced, not added | L |
| 4.11 | Tap a dinner | Cook / Something else / Made it / Remove | L |
| 4.12 | Made it | Comes off; not suggested again for a while | L |
| 4.13 | Add one more | One of any kind, or a lunch for one kid, in one tap | L |

## 5. Lists

| # | Do | Expect | Where |
|---|----|--------|-------|
| 5.1 | Lists → All | Every store's rows, grouped by store; "0 of N got"; Clear | L |
| 5.2 | Each store tab | Only that store's rows; empty store says "Nothing for <store>" | L |
| 5.3 | Add something on a store tab | Row appears on that store with a guessed section; same thing twice joins one row with counts added | L |
| 5.3a | Rows from recipes | Amounts show only pounds and plain counts ("1½ lb", "8"); no spoons, cups, cloves or can sizes; cart lines hide "Need 2" when one carton of 18 covers it | L |
| 5.4 | ⋯ on a row → Get it at another store | Row moves; next time the same item goes there | L |
| 5.5 | Tick a Trader Joe's / Costco row | Checked; "n of N got" moves | L |
| 5.6 | Clear | Confirms first, then clears with Undo; Undo brings everything back | L |
| 5.6b | Done shopping | Asks first ("Done at Trader Joe's? 6 things come off the list."); Cancel leaves everything; no Undo after | L |
| 5.7 | Water, salt, spices from a recipe | Never on a list (salt/spices are highlighted in Stock) | L |

## 6. Lists → Safeway (the cart)

| # | Do | Expect | Where |
|---|----|--------|-------|
| 6.1 | Safeway with known products | "Same as last time" with product, picture, "Need …" (weights and counts only, never spoons or cups), Add; "Auto-fill N" | R |
| 6.2 | Auto-fill | Each row spins, then moves to In the cart; header "n in the cart · $total" | R |
| 6.3 | Find on a "To find" row | Choices sheet: "k of N", item name, amount, search box, products with Add; wide screens show a grid that fits | R |
| 6.4 | Add in the sheet | Becomes − n +; grid doesn't reorder; "Next: <item>" appears | R |
| 6.5 | Skip / Next | Moves to the next item still to find | R |
| 6.6 | − / + in In the cart | Quantity changes in Simmer and on Safeway's cart page | R |
| 6.7 | Compare with Safeway's cart page | Same products and quantities; total matches | R |
| 6.8 | Safeway cart emptied without ordering | Simmer's cart empties; the list rows stay (to add again); the Safeway tab visits Purchases → Online, then the cart again | R |
| 6.8b | Order placed on Safeway, then Lists → Safeway in the panel | The cart's rows come off the Safeway list by themselves; the cart starts empty (never seen yet: the first real order shows whether Purchases reads right) | R |
| 6.9 | "Ordered? Take the cart off the list" | The cart's rows come off the Safeway list; the cart starts empty | R |
| 6.10 | Helper not running (two minutes or more) | "Can't reach Safeway right now…"; the cart greyed with − / + off; Add, Find, Auto-fill off; rows tick like Trader Joe's, then Done shopping; all back once it checks in | L |
| 6.11 | Find from the phone with Chrome idle | The search starts within a couple of seconds (a push wakes the helper), not up to half a minute | R |

## 7. Stock

| # | Do | Expect | Where |
|---|----|--------|-------|
| 7.1 | Open Stock | Sections Fresh · Pantry · Freezer · Household; each row a filled circle (have) | L |
| 7.2 | With a planned week | The week's pantry items highlighted with the amount the meals need | L |
| 7.3 | Tap a row | Out: goes on its store's list ("On the list · Safeway"); tap again: have | L |
| 7.4 | Add something | New row, checked, in a guessed section | L |
| 7.5 | ⋯ → Move to … / Remove from Stock | Moves; Remove has Undo | L |

## 8. Everywhere

| # | Do | Expect | Where |
|---|----|--------|-------|
| 8.1 | No technical words on any screen | No "error", "API", "sheet", "job", "server", device names | L |
| 8.2 | Dark and light | Every screen readable in both; no white flashes | L |
| 8.3 | 320 px wide | No sideways scrolling; long product names wrap or clamp | L |
| 8.4 | Slow or failing connection | Screens keep what they had and say so; nothing shows as empty that isn't | L |
| 8.5 | Console | No errors while using any screen | L |
| 8.6 | Screen reader names | Buttons with only icons have names (⋯, −, +, trash) | L |
