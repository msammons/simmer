@AGENTS.md

# Simmer

A cozy family meal planner for Robin, built on the same foundation as Head Out. Read `docs/ARCHITECTURE.md` before
changing anything: it covers the shape of the app, the interface building blocks, the lessons from Head Out, and the
standing preferences (no technical words on screen, no background jobs, no maintenance screens, secrets only in Vercel
and on Sam's Mac, no model names in commits or PRs).

The screens: `components/Week.tsx` (Meals: this week's dinners by kind, each added from her recipes; Simmer doesn't pick meals), `Shop.tsx` and `Safeway.tsx` (the Shop tab: the shared list, Find at Safeway, the cart), `Recipes.tsx` (Search and the
collection). The planning rules are plain code in `lib/week.ts`, with tests; keep them there (the picking rules there are no longer used on screen, Nov 10).

The Safeway helper is a Chrome extension edited in `extension-working/` (its own README); it isn't part of the web app or its build. `extension/` is the released copy Chrome loads on the Safeway computer: git-ignored, filled only by `node scripts/release-helper.mjs`. Never edit it.
