# Simmer: design requirements

What Simmer is for, and the rules every screen is held to. Gathered Nov 17 from what Sam has asked for since October
(docs/ARCHITECTURE.md, the decision notes, and the Nov 16-17 rounds); brought up to date Nov 19. When a screen and this page disagree, the screen
is wrong or this page needs Sam's update; say which.

## The goal

**Save the household time and thinking on meal planning and shopping.** Robin plans the dinners, checks the house,
shops (in store, or Safeway from the phone), and gets out. Every screen is judged by two questions:

1. **Time:** how few taps, and how little waiting, does the job take?
2. **Thinking:** how little is on screen to read, weigh or decide before the next tap?

A clean, minimal interface is part of the goal, not decoration: anything on screen that doesn't help the job in front
of her is a cost.

## The jobs, and what good looks like

| Job | Where | Good |
| --- | --- | --- |
| Plan dinners | Meals | A day's dinner in two taps (Add meal, then the recipe). Simmer never picks meals. |
| Check the house | List | One tap per thing (Have or Need); what a planned dinner needs has its name in the accent colour, with how much; nothing she didn't ask for appears. |
| Shop in store | Shop | Tick as she goes; one page by store (a filter at the top for one store); ticked things stay struck through or tuck away (Show checked). |
| Shop Safeway from the phone | Shop, Check out | Usuals in one tap (Add usuals), Find for the rest, the order placed in a few taps, every protection kept (docs/CHECKOUT.md). |
| Keep recipes | Recipes | Add from a link, photo, file or typing; fix where an ingredient goes in one tap. |
| Order from the phone | Settings → Ordering, Check out | Face ID on each phone that orders (a new phone is approved from one that has it), a limit per order, the store and card from Safeway. |

## Rules

### Less on screen
- **One way to do a thing.** The same kind of action looks and works the same on every screen.
- **Row actions live behind ⋯** (the phone's own picker), on the right of the row: move, group, remove, make common or
  specialty. The row itself shows only its name and its one main control (Have | Need, a tick, Find/Add, a stepper).
- **Hide/show is a menu item with a ✓**, in the ⋯ of what it hides, and its words name what it shows (Sam, Nov 17:
  "Show all" didn't say all of what): **Show all groups** in the list's own ⋯ (above the list, on the
  right), **Show checked** in Shop's. A group's own ⋯ has no show options (Sam, Nov 19): it only has Rename group and
  Remove group; opening and closing a group is a tap on its name.
- **A page's own ⋯ sits above its list, on the right**, the same size as a row's; never beside an add field.
- **No explaining text.** No legends, hints or "here's how this works" lines; the control's own words carry it. Words that state the obvious come off ("keeps its things", "(new)").
- **No chevrons where a tap acts at once** (choices, recipe rows, import choices). A chevron only for a real drill-in
  that a person would otherwise not expect.
- **Labels in sentence case**, the same small muted style everywhere.
- **Quiet structure.** A group on the list has a tinted header row and a faint coloured outline around it, sections a
  plain heading. A dinner's thing has its name in the accent (highlight) colour and shows how much all the planned
  dinners need under its name (Sam, Nov 18-19); its row is never tinted, and the group's name stays the usual colour, so
  coloured words always mean a dinner's thing.
- **Selectors appear only when needed** (Specialty/Common and Group show once she types a new name).
- **List things are what's bought** (Nov 18): no sizes or cuts ("large onion" is "onion", "diced" and "chopped" go),
  "red wine or balsamic vinegar" picks one, "salt and black pepper" is two things when both are known (never "half and
  half"), and names that mean the same are one line (cumin and ground cumin; kosher salt and salt).

### Never make her wait or wonder
- **Every tap shows its result at once** (within ~150 ms) and saves behind it. No "Saving…", no disabled-while-saving,
  no spinners; first loads shimmer.
- **Nothing moves under her finger.** No bars that push the page, no rows that appear or vanish around the control she
  is about to tap, no auto-zoom (fields and pickers are 16px or more).
- **Problems are a pop-up in the middle of the screen** (headline, reason, OK). Nothing else interrupts.
- **Risky actions ask first** with the same pop-up (the action in red for a removal, then Cancel). No Undo anywhere.
  Harmless, easily redone taps (a tick, Have/Need) never ask.
- **Only the button adds.** The keyboard's Done closes the keyboard; it never submits a half-made thing.
- **Things she adds come into view** where they landed, lit for a moment.

### Plain words
- No technical words or device names on screen (no "Sheet", "tab", "API", "phone", "Chrome", "extension").
- One name per thing: **List** (what the house keeps and needs), **Shop** (where she buys it), **the plan**
  (dinners on days), **Safeway cart**. "The list" never means two places.
- Buttons say what they do ("Add meal", "Remove group", "Take it off").
- **No third person.** No sentence on screen speaks of the app as someone ("Not sure the order went through", not
  "Simmer isn't sure"; Sam, Nov 18).
- Days are dates ("Tue, Nov 17"), never Today/Tomorrow.

### What people asked for comes first
- **A path someone asked for stays as direct as they asked**, unless they choose otherwise. A budget alone never folds
  it into a menu. Robin asked for Quick and Regular right on each day; on Nov 17 Sam chose two taps for a calmer page:
  a day's adds were in its first row's ⋯; on Nov 18 every day got one Add meal row at the end of its meals, and Quick and
  Regular per day went for good (the kind is a filter in the add sheet).

### Simple, user-driven
- Simple controls that do what they say; no smart behaviour that guesses, fills or decides for her. Nothing goes on a
  list by itself; a dinner's things wait on List until she says Need.
- No timers, polling, intervals, alarms or background jobs, in the app or the helper; things load on open, on return,
  after a change, or when a push says so. A wait on Safeway is a request the server answers when the job is done.
- Plain, user-driven controls over clever automatic ones (Sam): a group opens and closes by tapping its name; ordering
  needs her own Face ID tap; nothing is placed, added or decided for her.

### Look and fit
- One component set (`components/ui.tsx`) and one line-icon set; no emoji. Shared pieces are the same in all five
  studio apps (change one, change all).
- Themes from the accent color; dark mode as good as light.
- Phone first (Chrome on iPhone, so iPhone browser rules apply), 320-430px wide; a wide view for the Safeway helper.
- Tap areas 44px or more, even where the control looks smaller.

## Decided, and why (Nov 17 review)

Kept against an outside critique that argued the other way:
- **Confirms, never Undo.** A removal asks first; nothing offers to undo afterwards.
- **Only the + adds.** The keyboard's Done closes the keyboard.
- **Dates only** on Meals; the first day is always today.
- **A dinner's thing** shows the amount all planned dinners need, under its name, with its name in the accent colour; no
  asterisk, label, chip or row tint (Nov 18-19).
- **⋯ for row actions**, dinners included (Move to another day, Take off the plan).

Changed:
- Meals: tried **one Add per day** (recipes grouped by kind) and **reverted the same day**: Robin asked for Quick and
  Regular on the day, and the single Add made her scan every kind. Later on Nov 17 Sam chose calmer over one tap: a day's
  adds sat in its first dinner's ⋯ until Nov 18, when every day ended with its own Add meal row again, now one row, not
  one per kind.
- List: **Have and Need as a ✓ and a cart**, same one tap; she needs all three states (have, need, not checked yet).
- Shop: **Add usuals (N)** in the Safeway header; Safeway rows show **Safeway's product and how many** under the name (Sam, Nov 17: keep the product); **Mark the Safeway cart bought** and
  **Show checked** live in Shop's ⋯ above the list, with **Check out** and the cart's price on the left of the same line; the add field has a **plain grey + inside its right end** (Sam, Nov 17: a big filled + beside it was overkill), always
  at full colour (an empty tap does nothing).
- List groups were toned down on Nov 17 (a 1px faint outline, a lighter tint, the name in medium weight, a grey ⋯; Sam:
  "pretty close… just too bold"); on Nov 19 the outline and header tint stayed and the group's name went back to the usual colour.
- **Add words:** "Add" and one word for what's added: Add meal, Add recipe, Add item (Sam, Nov 17).
- **Meals adds with one Add** (Sam, Nov 18): one Add meal row at the end of every day, after its meals; no kind picked first; the add sheet shows every kind under its heading, with a pill for each kind (All first) to filter by. Quick and Regular per day are gone.
- **List groups** (Sam, Nov 19): the header row is tinted and the group has a faint coloured outline; tapping its name switches between all its items and only what's in the cart or needed by a dinner (the arrow shows which); a group whose items all show anyway starts open and closes to its name alone (every group can close); its ⋯ only renames or removes it. The list's own ⋯ keeps Show all groups.
- **Shop: Find and the cart** (Sam, Nov 18-19): Find is for one item at a time, searching when the item comes up and on Search (not on every letter), results ranked by her own words, each item starting at the top. A change to something already in the Safeway cart is made on Safeway's cart page first, from Shop's rows and from Find alike (a − from the search page found nothing).
- **Face ID** (Sam, Nov 18): the first phone sets up with the passcode. A phone whose approval was made on another phone (Robin scanning a code with Sam's) is offered "Set up Face ID on this phone" on Check out, so approving needs the other phone only once. Adding a phone needs approval from one that has Face ID: the new phone shows "Waiting for approval" with a code until the other phone approves, the request survives a reload, and a tap too soon says so instead of failing.
- **Test runs** (Sam, Nov 18): Place order shows only when the helper's checkout fingerprint has passed a test run, and a run counts only for the helper Simmer ships; a search or cart fix to the helper needs no new run.
- **Colour (Nov 17 pass):** orange is for things you tap (row actions on glass, text buttons, the one filled button per
  screen); a new row's + is grey everywhere; recipe step numbers and a sheet's × are grey.
- Adding from a page (Meals' Add meal, Recipes' Add recipe) is a **grey + and grey words** at a row's height (Sam, Nov 17: orange was still too bold); the big
  filled button is only **Add to the plan**. Settings values are grey with a chevron; Settings is a **gear**.
- Words: Shop says "Nothing to buy"; a recipe's tags are "Tags".
- Settings has no copy to the Google Sheet; Shop has no helper update note. The **Alpha** badge stays.

## Budgets (measured, Nov 17)

The rules above become numbers, checked at 390×844 with the tab bar left out. "Now" is what the app measured on
Nov 17 with a small test household; the budget is where it should get to.

| Measure | Budget | Now |
| --- | --- | --- |
| Taps to plan one dinner | 2 | 2 (Add meal, then the recipe; the recipe sets the kind) |
| Taps to plan a week of dinners | 14 | 14 |
| Taps per thing when checking the house | 1 | 1 |
| Taps to put the usuals in the Safeway cart | 1 | 1 (Add usuals) |
| Taps to place a Safeway order, after Get ready | 3 + Face ID | not remeasured since the pickup day and time were picked in Simmer and Place order asked first (Nov 14-16) |
| Controls on Meals' first screen | 1 per day + 1 per meal + top bar | An Add meal row ending every day (Sam, Nov 18) |
| Controls on List's first screen | 25 | 37 |
| Controls on Shop's first screen | 20 | 13 (test data) |
| Words on a tab's first screen | 150 | not yet measured per screen |
| Tap areas under 44px | 0 | 0 |
| Text contrast, body | 4.5:1 | dinner-mark and muted lines not yet measured |

A change that adds a control or a tap to a job says which budget it spends, or takes something else away.

## Checking a screen against this page

For each job: count the taps; list everything on screen before the first tap and ask of each item "does this help this
job right now?"; look for two ways of doing one thing; read every word as Robin would. Do it at 390px, light and dark.
