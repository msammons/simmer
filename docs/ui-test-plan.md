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
| 3.6 | Open a recipe | Name, line (effort · minutes · make ahead · serves), the buttons (3.8a), ingredients by Fresh / From the pantry, numbered steps, Find it by, Where it's from, Stop suggesting this | L |
| 3.7 | Switch Quick ↔ Regular on a recipe | Saved; the list header moves it to the other group | L |
| 3.8a | A recipe not on this week's plan | "Add to this week" (main button), then a quieter "Just add to the list"; Add to this week puts it on Meals under its own kind with its groceries, and says "Added Turkey chili. N things went on the list." | L |
| 3.8b | A recipe already planned | "One of this week's dinners…" and a quieter "Add to the list again"; no Add to this week | L |
| 3.8 | Add to the list from a recipe | Fresh things go on Lists; things already in Stock are only highlighted there | L |
| 3.9 | Edit (pencil) a recipe, change the name, save | New name everywhere (Recipes, Meals) | L |
| 3.10 | Stop suggesting this | Recipe stays in the collection but planning never picks it | L |
| 3.11 | A recipe with no ingredients (typed idea) | Says so plainly and offers to add them; doesn't look broken | L |

## 4. Meals and planning

| # | Do | Expect | Where |
|---|----|--------|-------|
| 4.1 | Meals with nothing planned | "Nothing planned", "Say how many dinners for the next shop…", Plan | L |
| 4.2 | Plan → How many | Counters for quick, regular and kids' dinners, desserts, sides, breakfasts (no lunches), starting at last time's numbers; with dinners planned, "Saving replaces this week's N dinners." | L |
| 4.3 | Trips toggles | Trader Joe's and Costco, with last trip dates | L |
| 4.4 | Next → Dinners | That many of each, fitting the kind, none of this week's again; "Only N of M fit" when short | L |
| 4.5 | Something else / One more / remove | A different recipe; when none is left, says so; One more adds one of that kind | L |
| 4.6 | Tap a pick | Picker sheet; a picked one shows "You picked this" | L |
| 4.7 | Save | Sheet closes; "Added N things to the grocery list." N matches Lists; Lists and Stock update without a reload | L |
| 4.8 | Meals after saving | "This week": dinners by kind (no "Quick"/"Regular" word under the header); no lunches; Plan | L |
| 4.9 | Plan again and save | This week's dinners are replaced by the new ones; the old ones aren't suggested again soon | L |
| 4.10 | Tap a dinner / its × | Tap opens the recipe (a typed meal has no recipe and says so); × asks "Take X off this week?" (Take it off / Cancel), no Undo after | L |
| 4.11 | Meals → Add a meal ("A recipe, or type one") | One sheet: a search box (not focused, so the keyboard doesn't cover the list), "Suggested" (the best quick and regular dinner for this week and anything the freezer lifts, each with its reason), then "All recipes" A–Z, each with its kind ("Quick dinner · 25 min") | L |
| 4.12 | Tap a recipe in Add a meal | Sheet closes; it's on Meals under its own kind (a dessert under Dessert); the note says "Added X. N things went on the list." (or "Its groceries were already on the list."); nothing else changes | L |
| 4.13 | A recipe already planned, in Add a meal | Greyed, "This week" on the right, can't be tapped | L |
| 4.14 | Type in Add a meal | Matching recipes, then "Add “<words>”" · "No recipe · counts as a quick dinner"; tapping it puts the words under Quick | L |
| 4.15 | Plan → Dinners → tap a pick → search a recipe of another kind | It moves under that recipe's own kind; typed words stay in the slot's kind | L |
| 4.16 | A recipe sharing a thing with one already on the list ("1 lb" + "1½ lb" ground turkey) | One row, amounts added up ("2½ lb"); different units keep the newer amount | L |

## 5. Lists

| # | Do | Expect | Where |
|---|----|--------|-------|
| 5.1 | Lists → All | Every store's rows, grouped by store; "0 of N got"; Clear | L |
| 5.2 | Each store tab | Only that store's rows; empty store says "Nothing for <store>" | L |
| 5.3 | Add something on a store tab | Row appears on that store with a guessed section; same thing twice joins one row with counts added | L |
| 5.3a | Rows from recipes | Amounts show only pounds and plain counts ("1½ lb", "8"); no spoons, cups, cloves or can sizes; cart lines hide "Need 2" when one carton of 18 covers it | L |
| 5.4 | ⋯ on a row → Get it at another store | Row moves; next time the same item goes there | L |
| 5.5 | Tick a Trader Joe's / Costco row | Checked; "n of N got" moves | L |
| 5.6 | Clear | Confirms first, then clears; no Undo | L |
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
| 7.1a | ⋯ on a Stock thing → Every week | "Every week" under its name; Done shopping at its store puts it back on that list (one row, not ticked); ⋯ → Not every week stops it | L |
| 7.2 | With a planned week | The week's pantry items highlighted with the amount the meals need | L |
| 7.3 | Tap a row | Out: goes on its store's list ("On the list · Safeway"); tap again: have | L |
| 7.4 | Add something | New row, checked, in a guessed section | L |
| 7.5 | ⋯ → Move to … / Remove from Stock | Moves; Remove asks first, no Undo | L |

## 8. Everywhere

| # | Do | Expect | Where |
|---|----|--------|-------|
| 8.1 | No technical words on any screen | No "error", "API", "sheet", "job", "server", device names | L |
| 8.2 | Dark and light | Every screen readable in both; no white flashes | L |
| 8.3 | 320 px wide | No sideways scrolling; long product names wrap or clamp | L |
| 8.4 | Slow or failing connection | Screens keep what they had and say so; nothing shows as empty that isn't | L |
| 8.5 | Console | No errors while using any screen | L |
| 8.6 | Screen reader names | Buttons with only icons have names (⋯, −, +, trash) | L |
