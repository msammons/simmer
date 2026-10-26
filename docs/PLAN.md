# Simmer: design and feature plan

The plan for what Simmer does, how it looks, and the order it gets built. It comes from the conversation Matt and Marcela
had on Oct 25, 2026 about how dinner and groceries work in this house today, and what would help. Read
`docs/ARCHITECTURE.md` first: everything here is built on that foundation and follows its standing preferences.

Simmer is for **Marcela first**. She does almost all of the planning and ordering today, so every screen is judged by one
question: does this take less of her time and attention than what she does now? Matt is the second user (he adds to the
list, cooks some nights, and looks at the week).

---

## 1. What the conversation told us

### How planning works today

1. **She starts from time, not food.** For each night she asks "when do we get home?" Home by 5: something a bit more
   involved. Home after 6 or 6:30: it has to be simple. She has go-to rotations for each.
2. **The calendar can't be trusted to know.** Not everything is written down; some of it is just in her head. So the
   app shouldn't read the family calendar. She'd rather say what the week needs: *"two quick dinners and three medium or
   meal-prep dinners."* Later she put it as *"a quick meal on Monday, a regular meal for the other four days."*
3. **Sometimes she already knows one night.** *"I want to make chili on Wednesday because I have time."* She wants to
   pin that and get ideas for the other nights, not have the whole week filled in at random.
4. **Then ingredients.** She checks what's on hand, writes a grocery list, and orders. The list isn't only dinner: it's
   kid lunches, breakfasts (very consistent), snacks, eggs, milk, yogurt.
5. **Staples are added the moment they run low.** She notices and adds them to her list right away. Matt does too.
   Both want **one shared list** that either of them can add to.
6. **Fresh almost always needs buying; the pantry usually doesn't.** She'd like the list split into *fresh* and
   *pantry*, so she can skim the pantry part and focus on fresh.
7. **The freezer is a second pantry for protein:** chicken thighs, chicken nuggets (fast dinners; Matt is a little
   burned out on them), salmon, ground beef, sirloin steak strips, shrimp. Things get forgotten in there ("I forgot
   about the shrimp", "I forgot about the steak strips"). Ground meat she usually buys fresh when she wants it.

### The stores, and their rhythm

| Store | How often | When | How | What it's for |
| --- | --- | --- | --- | --- |
| Safeway | Weekly | Tuesday (moving from Monday: pottery is Monday, and shelves are bare after Sunday) | Almost always online | Most things |
| Trader Joe's | About every two weeks | Wednesday about 8:30, after school drop-off (empty and fully stocked) | In person | Snacks for the boys, the meatballs, salad dressings; some meals depend on it |
| Costco | About once a month (she has to go for her medication anyway) | Whenever | In person | Bulk protein for the freezer, toilet paper, coffee, big staples |

Delivery from the other stores (through a service like Instacart) costs extra and isn't wanted now.

### What hurts

- **Safeway online ordering is clunky and slow**: type each item, pick the right product, make sure you actually hit
  add to cart. Sometimes she thought she added something and hadn't, and it didn't come.
- **Out of stock breaks a meal**: when an ingredient for a planned meal isn't there, she needs another trip or a new plan.
- **Meal ruts and forgotten favorites**: "I used to make that, I forgot about it." Some of the rotation is seasonal.
- **Recipes are scattered**: favorite websites, screenshots from social media, PDFs downloaded from social media
  people, documents in her Drive, and physical recipes (cards, the spice cookbook).
- **Unpacking groceries takes forever.** (Not an app problem, but see the idea in section 4.9.)

### What they agreed

- **Aligned:** say how many quick and regular dinners the week needs instead of syncing a calendar.
- **Aligned:** the app becomes the shared grocery list.
- **Needs more work:** automating Safeway ordering. Matt's action item is to find out whether it can be done. The answer
  is in section 5.
- **The two killer features**, in their words: Safeway ordering that saves the clicking, and a recipe collection that's
  easy to look through, search and pick from.
- **Expectations:** "We'll do a couple of revisions." It's one of the more complicated apps. That's fine: ship the core
  early and improve it with her.

---

## 2. Principles for Simmer

1. **The week's shape is the input; meals are the output.** Quick and regular nights, plus any pinned meals. Everything
   else is a suggestion she can take, swap or ignore.
2. **Suggest, never decide.** Nothing is "planned" until she says so. Suggestions come in small sets (three per night),
   never a wall of options.
3. **Her collection, her words.** Recipes are hers (or ones she chose to keep). The app never pads the collection with
   generic recipes. Labels use her language: *quick*, *regular*, *make-ahead*.
4. **Remember so she doesn't have to.** Last made, what's in the freezer, which store has what, when the next Trader
   Joe's or Costco trip is. Forgotten favorites come back on their own.
5. **Every list is shared and live.** Matt and Marcela see the same list. Adding takes one tap and a few words.
6. **Fewer taps than today, or it doesn't ship.** Counted against her current routine, not against other apps.
7. **She never has to leave Simmer.** Planning, the list, recipes, importing and ordering all happen inside Simmer. No
   working with another app open beside it, no copying and pasting between apps. Where another service is involved
   (Safeway), Simmer does the work and shows her the result.
8. **Review before anything is final.** When Simmer fills a Safeway cart, she reviews it in Simmer before the order is
   placed.
9. **The foundation's rules hold**: the Sheet is the data store, code owns facts and the model writes words, no
   background jobs, no maintenance screens, no technical words or device names on screen, names swapped for roles before
   anything goes to the model.

---

## 3. The data (Sheet tabs)

The Sheet stays the place where data is managed: Marcela or Matt can fix anything by hand, and the app reads it
forgivingly (headers in any order, a bad row skipped and reported, never fatal). New tabs, added to `TABS` in
`lib/data.ts` with a sample CSV in `data/`:

### Recipes

One row per recipe in the collection.

| Column | Example | Notes |
| --- | --- | --- |
| `id` | `chili-1` | Stable; made by the app when a recipe is added |
| `name` | Turkey chili | |
| `effort` | quick / regular / make-ahead | Guessed on import, she corrects it. Drives planning |
| `minutes` | 45 | Total time, if known |
| `serves` | 4 | |
| `protein` | ground turkey | For variety and freezer matching |
| `ingredients` | one per line: `1 lb ground turkey` | Quantity, unit, item; parsed by code |
| `steps` | one per line | Optional: many family recipes are "you know how" |
| `store` | trader-joes | Set when a meal depends on one store (the meatballs) |
| `season` | fall, winter | Optional; lets cold-weather meals come back in fall |
| `kid_ok` | yes / some / no | Whether both boys usually eat it |
| `tags` | tacos, one-pan, salad | Free words for search |
| `source` | URL, Drive file name, "photo", "Marcela" | Where it came from |
| `rating` | 1 to 3 | How much they like it; optional |
| `notes` | Double the spice for Matt | |
| `active` | yes / no | "No" keeps it but stops suggesting it |

### Plan

One row per planned night. The app writes it; she can edit by hand.

`date, meal (recipe id or free text), effort, pinned (yes/no), cook (optional), made (yes/no), notes`

`made` matters: it's how "last made" stays true. Asking "did you make this?" the next day is one tap (section 4.2).

### Made

A log the app appends to when a meal is marked made: `date, recipe id`. Recency and "forgotten favorite" come from here.

### List (the shared grocery list)

`item, quantity, store, section (fresh/pantry/freezer/household), for (recipe id, "lunches", "breakfast", or blank),
added_by, added_at, checked (yes/no), checked_at`

Rows are never deleted by the app while a trip is in progress; checked rows are cleared when the trip is finished.

### Staples

Things the house always keeps: `item, store, section, usual_quantity, usual_product, every (optional: weekly, every two
weeks)`. Breakfast items, lunch items, snacks, coffee, toilet paper. Adding a staple to the list is one tap from here,
and `usual_product` is the exact Safeway product she buys ("Lucerne 2% milk, half gallon"), which Simmer uses when it
fills the cart (section 5). Most of these can be learned from her past Safeway orders rather than typed.

### Freezer

`item, amount, added (date), store`: chicken thighs, nuggets, salmon, ground beef, steak strips, shrimp. Planning
favors meals that use what's here, and the oldest first.

### Ingredients

The app's memory of how to file an ingredient: `name, section (fresh/pantry/freezer), store, aisle (optional),
usual_product`. The model guesses a new ingredient's section and store the first time; after that it's a fact from this
tab, so the same ingredient always lands in the same place. She can fix any row.

### Profile (exists)

Gains household rules for planning, written as plain sentences the app turns into settings where it can:
`household, rule, Safeway on Tuesdays`, `household, rule, Trader Joe's every other Wednesday`, `household, rule, Costco
once a month`, plus people's likes and dislikes (Felix: no mushrooms), which planning respects.

---

## 4. Features

Each feature lists what it does, how it looks, and what's decided by code versus the model.

### 4.1 Recipe collection (the "database")

**What it does.** Every recipe she cares about in one place: searchable, sorted, and remembered.

- **Browse** from the Search tab: her collection grouped as *Quick*, *Regular*, *Make-ahead*, with *Not made in a while*
  and *Favorites* at the top.
- **Search** by name, ingredient ("shrimp"), tag ("tacos"), store ("Trader Joe's") or how long ("quick").
- **Recipe screen:** name, effort and minutes, last made ("Made 3 weeks ago" / "Not made since spring"), ingredients
  grouped fresh and pantry, steps if there are any, notes. Actions: *Plan this* (pick a night), *Add ingredients to the
  list*, *Edit*.
- **Effort is guessed, then hers.** On import the model estimates quick, regular or make-ahead from the steps and times;
  she changes it with one tap and the change sticks.
- **Retire without deleting.** "Stop suggesting this" keeps it searchable but out of plans (`active = no`).

**Code vs model.** Search and sorting are code. Effort guesses and cleaning up ingredient lines are the model, checked by
code (a number of minutes is read from the recipe text, never invented).

### 4.2 Planning the week

**What it does.** She says what the week looks like; Simmer fills in the rest with meals from her collection.

The flow, from the This week tab:

1. **"Plan the week"** opens a sheet with the week's nights (which nights count is her choice: usually five).
2. For each night she taps **Quick** or **Regular** (or **Out / leftovers / skip**). A shortcut row at the top sets the
   common shapes in one tap: *"2 quick, 3 regular"*, *"All quick"*, *"Same as last week"*.
3. **Pin anything she already knows**: tap a night, pick "Chili" from her collection (or type a free-text meal like
   "dinner with G&G"). Pinned nights are never changed by suggestions.
4. **Store toggles** for the week: *Trader Joe's trip this week?* *Costco this week?* Simmer turns them on by itself
   when the rhythm says it's time (two weeks since the last Trader Joe's trip), and she can flip them.
5. **Suggest.** For each unpinned night, Simmer shows its best pick with two alternatives underneath. Tap to swap,
   or *"Something else"* for three more. Lock a pick with a tap.
6. **Done** saves the plan, and adds the ingredients to the list (section 4.3).

How suggestions are chosen (code, not the model, so they're predictable and explainable):

- **Fits the night:** effort matches. A quick night never gets a regular meal.
- **Not too recent:** nothing made in the last ~10 days, and no repeats within the week.
- **Variety:** not the same protein two nights running; not two pasta nights in a row.
- **Uses the freezer:** a meal that uses something in the freezer scores higher, the oldest item highest.
- **Store aware:** meals that depend on Trader Joe's only when there's a Trader Joe's trip this week.
- **Forgotten favorites:** a well-liked meal not made in a long time gets a lift, and says so ("You haven't made this
  since March").
- **Season:** fall meals come back in fall.
- **Kids:** respects dislikes in Profile (no mushrooms for Felix) unless the recipe notes a workaround.

The model's job is only the friendly words: a few words on why a pick is there ("Uses the salmon in the freezer"),
written from facts code hands it.

**The week screen** (This week tab) shows the nights as rows: day, the meal, and a small tag (Quick / Regular), with a pin
mark on pinned nights. Tap a night to swap, cook from the recipe, or mark it made. Tonight sits at the top.

**"Did you make it?"** The next time she opens the app after a planned night, a small notice asks *"Did you make the
chili last night?"* with *Yes* / *No, we had something else*. This keeps "last made" true, and costs one tap. (No
background reminders: it's asked while she's using the app.)

### 4.3 The shared grocery list

**What it does.** One list for the house: what the plan needs, what's run low, and what's needed for lunches and
breakfast, sorted by store and by fresh or pantry.

- **Add in a few words** from the Groceries tab: a field at the top ("eggs", "2 lemons", "TP"). Simmer files it in the
  right store and section from the Ingredients tab (or a quick model guess the first time).
- **Staples in one tap:** a *Running low?* row opens the Staples list: tap what's low.
- **From the plan:** when a week is planned, each meal's ingredients are added, **merged** with what's already there
  (two recipes needing onions makes "Onions: 3"), and tagged with the meal they're for.
- **Fresh vs pantry:** plan items arrive in two groups. **Fresh** goes on the list. **Pantry** goes into a short *Check
  you have these* group she can skim: tap any she's out of to move it onto the list, and the rest disappear when she's
  done. (Exactly her "I can skim the pantry" habit.)
- **Freezer aware:** if a meal needs salmon and salmon is in the freezer, it isn't added; it's marked to use from the
  freezer, and the freezer count goes down when the meal is made.
- **By store:** the list has a section per store (Safeway, Trader Joe's, Costco). Items that can come from anywhere go
  to Safeway unless she moves them. Trader Joe's items wait for the next Trader Joe's trip; a note says when ("Next
  Trader Joe's trip: Wednesday").
- **Lunches and breakfasts:** a weekly *Lunches and breakfast* staple group (the boys' lunch items, breakfast) she can
  add with one tap when she plans the week.
- **Shopping in person** (Trader Joe's, Costco): the store's section becomes a checklist, sorted roughly by where things
  are in the store (produce, dairy, frozen…). Checked items fall to the bottom.
- **Shared and live:** both adults see the same list. It refreshes when the app comes to the front and every 30 seconds
  while the Groceries tab is open, and changes are sent right away. (No background jobs, no push notifications.)

### 4.4 Out of stock

When an item for a planned meal didn't come (Safeway was out), she marks it *Didn't get it* on the list. Simmer then
offers, for that meal: *swap the meal* (with suggestions that use what she has), *move it to a Trader Joe's or Costco
trip*, or *keep it and pick it up*. The meal is flagged on the week screen until it's sorted.

### 4.5 Bringing recipes in (import)

**What it does.** Turns anything with a recipe in it into a recipe in her collection, and lets her choose what to keep.

Sources, all from one *Add recipes* sheet:

- **A link** to a recipe page (her favorite websites). Most recipe sites include structured recipe data; Simmer reads it
  directly and only uses the model when a page doesn't.
- **A file from her Drive**: a document or PDF, which may hold many recipes.
- **A screenshot** (from social media): picked from her photos.
- **A photo** of a physical recipe: a card, or a page of the spice cookbook, taken with the camera.
- **Typed or pasted text**: for the family recipes that live in her head.

Then, for every source:

1. Simmer reads it and shows **what it found**: one recipe, or for a PDF of thirty, a list of thirty names with a
   checkbox each. She ticks the ones she's made and likes. Nothing is added until she says so. (This is the "not a
   bunch of cluttery junk" rule from the conversation.)
2. Each chosen recipe is shown as it will be saved: name, effort guess, ingredients, steps. She can fix anything.
3. **Duplicates** are caught by name and ingredients ("You already have Turkey chili. Keep both, or replace?").
4. Saved to the Recipes tab with its source.

**Her existing master list of meal ideas** (the spreadsheet she mentioned) comes in the same way: many of those are
meal *ideas* rather than full recipes ("tacos", "salmon and broccoli"), so a recipe can be just a name, an effort and a
few ingredients. That's enough to plan with.

**Code vs model.** The model reads pictures and messy text into structured recipes (name, ingredients, steps, times),
returned as JSON and checked by code: quantities and minutes must appear in the source, ingredient lines must parse,
and anything it couldn't read is left blank for her rather than guessed.

### 4.6 The freezer

A small screen (from the Groceries tab) listing what's in the freezer, with *Add* (Costco run: "chicken thighs, 2
packs") and counts that go down when a meal that uses them is marked made. Planning uses it (section 4.2) so nothing
gets forgotten, and the oldest items are suggested first.

### 4.7 Store rhythm

From the Profile rules (Safeway Tuesdays, Trader Joe's every other Wednesday, Costco monthly) and the dates of the
last trips, Simmer knows what's coming and says it plainly on the Groceries tab: *"Safeway order: Tuesday"*, *"Trader
Joe's: this Wednesday"*, *"Costco: in about a week"*. It's a hint, never a schedule she has to keep. Finishing a trip
(*Done shopping*) records the date.

### 4.8 Cooking a meal

Tap tonight's meal: the recipe, large and readable, with ingredients first, steps after, and the screen kept awake while
it's open (where the browser allows). *Made it* at the bottom marks it made and updates the freezer.

### 4.9 Small helpers (later)

- **Put-away order.** Unpacking takes forever. When a Safeway order is in, the list can show what came grouped by where
  it goes (fridge, freezer, pantry, "for Wednesday's tacos"), and freezer items are added to the freezer list as she
  puts them away.
- **Leftovers.** A *Leftovers* night choice that remembers what's there.
- **"What can I make right now?"** From the freezer and a few things on hand, three quick meals from her collection.

---

## 5. Safeway ordering, without leaving Simmer

Matt's action item from the meeting, with two decisions made after it: **Marcela shouldn't have to jump between apps
to build the order**, and **checkout stays in the Safeway app.** So the goal is Simmer filling her Safeway cart itself
and showing her what it did. When the cart is right, she opens the Safeway app once, picks her pickup or delivery time,
and checks out there as she does today. That's the only step outside Simmer, and it's the one she already likes doing
in Safeway.

### What's possible

Safeway has **no public way for an app to fill a cart**: no developer program, no official interface. Safeway's own
app has a shopping assistant that adds a recipe's ingredients to the cart, but that lives inside Safeway's app, which
is exactly the jumping we're avoiding. Instacart can build a Safeway shopping list for another app, but it opens in
Instacart and adds delivery or service fees. Neither meets the requirement.

What does meet it: Simmer acting on Safeway's website **as her**, the same way she does by hand (sign in, search,
add to cart, check out), but driven by Simmer and reported back in Simmer. It's an unofficial route: it works through
Safeway's site rather than a door Safeway built for apps, so it can break when Safeway changes their site, and Safeway's
bot protection may push back. That's why it starts as a test (Phase 1) before anything is built on it.

### How it would work for her

1. On the Groceries tab, the Safeway section has one button: **Fill my Safeway cart**.
2. Simmer works through the Safeway part of the list. For each item it uses her usual product (learned from her past
   Safeway orders), or searches and picks the closest match to what she usually buys.
3. A **review screen in Simmer** shows every item: the product it picked (with its picture and price), the quantity,
   and anything it couldn't find or that's out of stock, with two alternatives to tap. Missing nothing is the point: the
   screen only says *Ready* when every item on the list is in the cart or she's decided to skip it.
4. When it says *Ready*, she opens the Safeway app: the cart is already full, because Safeway keeps one cart per
   account, shared between its site and its app. She picks the time and checks out there.
5. The out-of-stock items from the order flow straight into section 4.4: swap the meal, or move the item to a Trader
   Joe's or Costco trip.

### What it needs

- **Her Safeway sign-in, kept as a secret** in Vercel (like the other keys), never on screen, in the Sheet or in code.
  Set up once, by Matt, with her. If Safeway asks for a code sent to her, Simmer asks her for it in Simmer.
- **It only runs when she taps the button.** No background ordering, no schedule.
- **Her past orders** are read once at setup, and after each order, to learn her usual products. This is also what
  makes the cart right the first time.

### The test before building (Phase 1)

A small experiment, run from Matt's Mac with her account: can a program sign in to Safeway, read her past orders,
search a product, add it to the cart, and list the cart, reliably, without being blocked? And does a cart filled that way
show up in her Safeway app? Three outcomes:

- **Works from Simmer's server:** build it as described.
- **Works only from a real browser** (bot protection blocks the server): run the same steps in a browser on Matt's
  Mac, started from Simmer's button and reporting back to Simmer's review screen. Marcela still never leaves Simmer;
  the Mac just needs to be on.
- **Blocked or too fragile:** Simmer keeps the review-quality list and her usual products, and the fallback is filling
  the cart with as little of her attention as possible. Decide that with her at the time.

### Not doing

Checking out from Simmer (it stays in the Safeway app); storing her password anywhere but Vercel's secrets; delivery
services that add fees.

---

## 6. Screens

Built only from `components/ui.tsx`, in the style the other family apps share (the Simmer lockup top left, one action
top right, one large title, inset grouped lists, one sheet style).

### This week (tab)

- Title *This week*, subtitle with the dates. Top right: Settings.
- If nothing is planned: an empty state with one button, *Plan the week*.
- **Tonight** group: tonight's meal, large, with its tag; tap to cook. On a planned night that's past: the *Did you make
  it?* notice.
- **The week** group: one row per night (day, meal, Quick/Regular tag, pin mark). Tap a row for a sheet: *Cook*,
  *Swap* (three suggestions), *Pin*, *Made it*, *Clear*.
- At the bottom: *Plan next week* once it's Saturday or later.

### Plan the week (sheet)

Page 1, **The nights:** the shortcut shapes, then each night with a Quick / Regular / Skip segmented control and a pin
button. Page 2, **This week's trips:** Trader Joe's and Costco toggles (pre-set by the rhythm). Page 3, **Suggestions:**
each open night with its pick and two alternatives; *Something else*. Footer: *Save the week*. The sheet's page dots and
back/forward follow the shared `Sheet` component.

### Groceries (tab)

- Title *Groceries*, subtitle with the next trip ("Safeway order Tuesday").
- An add field at the top.
- **Check you have these** (pantry items from the plan, if any), skimmable.
- One group per store: **Safeway**, **Trader Joe's** (with when the next trip is), **Costco**. Inside each: Fresh first,
  then Pantry, Household. Each row: item, quantity, and what it's for in small text ("for Wednesday's chili").
- *Running low?* row (opens Staples). *Freezer* row (opens the freezer).
- The Safeway header has **Fill my Safeway cart** (section 5), which leads to the review screen. The
  Trader Joe's and Costco headers have *Shop* (the in-store checklist). Every store has *Done shopping*.

### Search (the round search button)

Searches the collection. Before typing: *Not made in a while*, *Favorites*, *Quick*, recent searches. Results open the
recipe screen. *Add recipes* sits here too (opens the import sheet).

### Recipe (drill-in)

Back chevron, recipe name as the title, subtitle "Quick · 25 minutes · Made 3 weeks ago". Ingredients, steps, notes,
source. Actions: *Plan this*, *Add to list*, *Edit* (top right).

### Safeway order review (drill-in)

Title *Safeway order*. A progress line while the cart fills ("Adding 18 of 24…"). Then groups: **Needs a choice**
(out of stock or unsure, each with two alternatives), **In the cart** (product picture, name, price, quantity; tap to
change), **Skipped**. The estimated total, then *Your cart is ready. Check out in Safeway when you like.*

### Add recipes (sheet)

Choices: *From a link* (pasted, or shared to Simmer), *From my files* (her Drive, picked inside Simmer), *From a
photo* (camera or library), *Type it in*. All of it happens in Simmer. Then the found list with
checkboxes, then the review page per recipe, then *Save*.

### Settings (exists)

Themes, plus: which nights count as the week, and how many people dinner is for. The store rhythm and rules stay in the
Sheet (no maintenance screens).

### Words on screen

Plain and warm, never technical: *Plan the week*, *Quick*, *Regular*, *Make-ahead*, *Running low?*, *Check you have
these*, *Didn't get it*, *Done shopping*, *Made it*, *Add recipes*, *Something else*. No mention of how things work
underneath, and no device names.

---

## 7. How it's built (the parts that are new)

- **Writes to the Sheet.** Head Out mostly reads; Simmer writes a lot (the list, the plan, made, freezer). Writes go
  through one small module that appends or updates rows by `id`, with the same forgiving reading. Two people editing the
  list at once is the main concurrency case: each change is a single-row write (add a row, set `checked` on a row), never
  a rewrite of the whole tab, so two people adding at the same time can't erase each other's items.
- **The list is the one live thing.** It's refetched when the app comes to the front and every 30 seconds while the
  Groceries tab is open; changes are sent immediately and shown optimistically, with a quiet retry if a write fails.
  Offline, additions wait on the device and go out when the connection is back.
- **Ingredient parsing is code.** Quantities, units and item names are parsed by code (`1 lb ground turkey` → 1, lb,
  ground turkey) so merging and freezer matching are exact; the model is only asked to file an ingredient it hasn't
  seen.
- **Planning is code.** The scoring in section 4.2 is a plain function with tests: the same week and collection always
  give the same suggestions (with a seed for *Something else*).
- **Import uses the model for reading only.** Pictures and PDFs go to the model with a strict JSON shape; code checks
  the result. Links use the page's own recipe data first.
- **Names stay private.** As in Head Out, people's names are swapped for roles before anything goes to the model.
- **No background work.** Every model call happens because someone tapped something, or right after (`after()`).
- **Deployments are a budget.** The family apps share one Vercel team with a daily deployment limit (hit on Oct 26
  while iterating on the kids' apps). Batch changes into fewer pull requests, and do branch work where pushes don't
  deploy.

---

## 8. Build order

Each phase ends with something Marcela uses for a real week, then a revision with her before the next.

**Phase 1: The shared list, and the Safeway test.** The Groceries tab with the add field, stores, fresh/pantry
sections, staples, check-off, done shopping, and the live shared list. This alone replaces her current grocery list. In
parallel, the Safeway test from section 5, which decides how ordering gets built.

**Phase 2: The collection.** The Recipes tab, search, the recipe screen, *Type it in* and *From a link*. Import her
master list of meal ideas. Effort guesses she corrects.

**Phase 3: Planning the week.** The plan sheet (shape, pins, trips), suggestions, the week screen, *Made it* and *Did you
make it?*, ingredients flowing into the list with the fresh/pantry split and merging.

**Phase 4: The rest of import.** Drive files and PDFs with the pick-what-to-keep list, screenshots, photos of physical
recipes, duplicates.

**Phase 5: Safeway ordering**, built the way the Phase 1 test said (server, Mac browser, or fallback): fill the cart,
the review screen, usual products from past orders. Checkout stays in the Safeway app.

**Phase 6: The freezer and store rhythm.** The freezer list, freezer-aware planning and list, trip hints, out-of-stock
swaps.

**Phase 7: Later.** Put-away order, leftovers, "what can I make right now?".

---

## 9. Questions to settle with Marcela

1. **Which nights count?** Monday to Friday, or every night? Are weekends planned, or usually loose?
2. **Two kinds of dinner or three?** She said "quick" and "medium or meal-prep". Is *make-ahead* a third kind, or a
   note on a regular meal?
3. **How many people?** Always four, or do quantities need to change?
4. **Lunches:** should Simmer plan the boys' lunches too, or just keep their lunch staples on the list?
5. **Safeway sign-in:** is she comfortable with Simmer signing in to her Safeway account to fill the cart (the sign-in
   kept as a secret, used only when she taps the button)?
6. **Changes after filling:** if she edits the cart in the Safeway app before checking out, should Simmer notice (and
   update "usual products" from what she actually bought)?
7. **Trader Joe's rhythm:** every other Wednesday on a fixed cycle, or whenever it's been about two weeks?
8. **Seasonal meals:** is the season worth tracking, or is "not made in a while" enough?
9. **Matt's role:** does he plan any nights, or mostly cook and add to the list?
