@AGENTS.md

# Simmer

A cozy family meal planner for Robin, built on the same foundation as Head Out. Read `docs/ARCHITECTURE.md` before
changing anything: it covers the shape of the app, the interface building blocks, the lessons from Head Out, and the
standing preferences (no technical words on screen, no background jobs or timers, no maintenance screens, secrets only in Vercel
and on Sam's Mac, no model names in commits or PRs).

The screens: `components/Week.tsx` (Meals: days from today, each with its meals and one Add meal row at the end; the add sheet filters her recipes by kind with pills; she picks every dinner, Simmer doesn't pick meals), `Stock.tsx` (the List: Have or Need on every thing, a dinner's things with their names in the accent colour and the amount all dinners need, groups that open and close by tapping their name), `Shop.tsx` (the Shop tab: one page of the shared list by store with a store filter, each Safeway row with +, Find or − n +, Add favorites and Check out above the list), `Safeway.tsx` (Find at Safeway and the cart's workings), `Recipes.tsx` (Add recipe and the collection), and `Ordering.tsx` / `Checkout.tsx` / `Settings.tsx` (Face ID, limit, store and card; test runs and placing; docs/CHECKOUT.md). The planning rules are plain code in `lib/week.ts`, with tests; keep them there (the old meal-picking rules were removed Nov 14).

The Safeway helper is a Chrome extension edited in `extension-working/` (its own README); it isn't part of the web app or its build. `extension/` is the released copy Chrome loads on the Safeway computer: git-ignored, filled only by `node scripts/release-helper.mjs`. Never edit it.
