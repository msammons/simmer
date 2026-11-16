# Revision after Robin's first full run (Nov 16, 2026)

From Robin's run on Nov 15 (two sessions, notes in Sam's Drive) and Simmer's own records. Decisions are Sam's (Nov 16)
unless marked. Built in this order; each step ships on its own, with checks, and the checkout pieces with an outside
review (docs/CHECKOUT.md).

## 1. Meals by day

- Meals is a list of days starting today: 7 days, with **Show more** for up to 14 (Robin: "start on the day I open the
  app… that's the farthest out I ever plan"; two weeks for something rare like camping).
- Each day has **Quick** and **Regular**: each opens her recipes of that kind, A–Z, with a search box; tapping one puts
  it on that day. No suggestions (Simmer doesn't pick meals; Sam and Robin agreed again Nov 15).
- **More** on a day offers the other kinds: Breakfast, Lunch, Kids' dinner, Dessert, Side. Lunch stays as an option for
  holidays and breaks (Sam, Nov 16: "keep lunch as an option"); day to day, kids' lunches, snacks and desserts are Stock.
- A day can hold more than one thing (a dinner and a dessert). Each shows with its day; tap for the recipe, − to take it
  off (asks first; what only it needed comes off the list, as now).
- Days before today drop off the list by themselves; nothing is ticked off. What a past dinner still had waiting on
  Stock comes off with the next change to the plan (lib/plan.ts `tidyStock`).
- Dinners planned before days existed show under **Not on a day** until they're taken off.
- New plan stays (empties the plan and the lists; the cart stays).

## 2. Stock: common and specialty, groups, quick add

- **Common** things always show on Stock, to check each shop. **Specialty** things (goat cheese, cinnamon, five spice)
  show only once added, and leave after the shop.
- **Groups** (Cheese, Yogurt, Fruit…): a group expands to its variants, each with Have | Need. Collapsed, a group shows
  only what's marked Need; a group with one thing keeps its own Have | Need (Robin's rule, Nov 15).
- **Quick add**: a big **+** to add something in a few taps (half and half, almond milk), marked Need at once, as common
  or specialty.
- The tab keeps the name Stock for now.

## 3. Recipes

- An ingredient filed in the wrong section (cashews in Fresh) can be moved between Fresh and Pantry on the recipe.

## 4. Checkout

- **Bags**: chosen on each order in Check out, bring your own or use Safeway's (Sam: "user chooses bags"). The helper
  sets Safeway's bags choice to match; a new press on Safeway's page, allowed by that yes.
- **Flash pickup**: offered among the pickup times, always shown with its price and marked Flash (Sam: "offer flash but
  show it"). The approval, the limit and every final-page check apply as to free times; the price is in the total.
- **Robin's phone**: set up once through Add a phone (asks; Sam's phone approves once), then it orders on its own. No
  code needed.
- Known from the run: Place Order was still off when the helper checked (fixed, helper 26.11.16); steps started over from
  the cart (fixed). Before real orders again: one test run with the current helper.

### Where it stands (Nov 16)

- Flash: built (helper 26.11.16.1). Free times and Flash only; other paid times aren't offered (they couldn't be
  ordered). Reviewed outside; the review's three finds were fixed.
- Bags: the helper now reads Safeway's bags choice on Get ready, read only. The choice in Check out and the press come
  after that reading has been seen once with a real cart (the cart was empty, so the page couldn't be reached).
- Before a real order: one test run with helper 26.11.16.1.
- Stock: built. The big Add something opens a sheet: a name, Common or Specialty (Specialty picked first), a group
  (tap one already used, or type a new one), and Add as Need. Typing shows things already kept; tapping one marks it
  Need. ⋯ on a kept thing: Put in a group / Change group, Make common or Make specialty. Everything kept before today
  is Common with no group. Two new columns on the Staples tab: kind, group.
