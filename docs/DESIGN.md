# Simmer: design requirements

What Simmer is for, and the rules every screen is held to. Gathered Nov 17 from what Sam has asked for since October
(docs/ARCHITECTURE.md, the decision notes, and the Nov 16-17 rounds). When a screen and this page disagree, the screen
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
| Plan dinners | Meals | A day's dinner in two taps (kind, then recipe). Simmer never picks meals. |
| Check the house | List | One tap per thing (Have or Need); what a planned dinner needs is marked; nothing she didn't ask for appears. |
| Shop in store | Shop | Tick as she goes; one list by store; ticked things tuck away. |
| Shop Safeway from the phone | Shop, Check out | Usuals in one tap (Auto-fill), the order placed in a few taps, every protection kept (docs/CHECKOUT.md). |
| Keep recipes | Recipes | Add from a link, photo, file or typing; fix where an ingredient goes in one tap. |

## Rules

### Less on screen
- **One way to do a thing.** The same kind of action looks and works the same on every screen.
- **Row actions live behind ⋯** (the phone's own picker), on the right of the row: move, group, remove, add-another-
  kind. The row itself shows only its name and its one main control (Have | Need, a tick, Find/Add, a stepper).
- **Hide/show is a menu item with a ✓** (Show all), in the ⋯ of what it hides: the list's own ⋯ (above the list, on
  the right), a group's ⋯.
- **A page's own ⋯ sits above its list, on the right**, the same size as a row's; never beside an add field.
- **No explaining text.** No legends, hints or "here's how this works" lines; a mark (the asterisk on a dinner's thing)
  or the control's own words carry it. Words that state the obvious come off ("keeps its things", "(new)").
- **No chevrons where a tap acts at once** (choices, recipe rows, import choices). A chevron only for a real drill-in
  that a person would otherwise not expect.
- **Labels in sentence case**, the same small muted style everywhere.
- **Quiet structure.** Groups get a subtle tint and outline, sections a plain heading; a dinner's thing an accent
  asterisk, never a tinted row or a second color.
- **Selectors appear only when needed** (Specialty/Common and Group show once she types a new name).

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
- Buttons say what they do ("Add a side", "Remove group", "Take it off").
- Days are dates ("Tue, Nov 17"), never Today/Tomorrow.

### What people asked for comes first
- **A path someone asked for stays as direct as they asked.** Robin asked for Quick and Regular right on each day; a
  budget never folds that into a menu or a longer sheet. Budgets trim what nobody asked for.

### Simple, user-driven
- Simple controls that do what they say; no smart behaviour that guesses, fills or decides for her. Nothing goes on a
  list by itself; a dinner's things wait on List until she says Need.
- No timers, polling or background jobs; load on open, on return and after a change.

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
- **The asterisk** marks a planned dinner's thing; no label or chip.
- **⋯ for row actions**, dinners included (Move to another day, Take off the plan).

Changed:
- Meals: tried **one Add per day** (recipes grouped by kind) and **reverted the same day**: Robin asked for Quick and
  Regular on the day, and the single Add made her scan every kind. Quick, Regular and Other (⋯) stay.
- List: **Have and Need as a ✓ and a cart**, same one tap; she needs all three states (have, need, not checked yet).
- Shop: **Add usuals (N)**; Safeway rows show **only how many** under the name; **Mark the Safeway cart bought** and
  **Show checked** live in Shop's ⋯ above the list; the add buttons are a **round +**, and a row's + matches the quantity buttons.
- Words: Shop says "Nothing to buy"; a recipe's tags are "Tags".
- Settings has no copy to the Google Sheet; Shop has no helper update note. The **Alpha** badge stays.

## Budgets (measured, Nov 17)

The rules above become numbers, checked at 390×844 with the tab bar left out. "Now" is what the app measured on
Nov 17 with a small test household; the budget is where it should get to.

| Measure | Budget | Now |
| --- | --- | --- |
| Taps to plan one dinner | 2 | 2 (Add, then the recipe; the recipe sets the kind) |
| Taps to plan a week of dinners | 14 | 14 |
| Taps per thing when checking the house | 1 | 1 |
| Taps to put the usuals in the Safeway cart | 1 | 1 |
| Taps to place a Safeway order, after Get ready | 3 + Face ID | 3 + Face ID |
| Controls on Meals' first screen | 3 per day shown + top bar | 25 with one dinner (Quick, Regular, ⋯ per day: what Robin asked for) |
| Controls on List's first screen | 25 | 37 |
| Controls on Shop's first screen | 20 | 13 (test data) |
| Words on a tab's first screen | 150 | not yet measured per screen |
| Tap areas under 44px | 0 | 0 |
| Text contrast, body | 4.5:1 | dinner-mark and muted lines not yet measured |

A change that adds a control or a tap to a job says which budget it spends, or takes something else away.

## Checking a screen against this page

For each job: count the taps; list everything on screen before the first tap and ask of each item "does this help this
job right now?"; look for two ways of doing one thing; read every word as Robin would. Do it at 390px, light and dark.
