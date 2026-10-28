@AGENTS.md

# Simmer

A cozy family meal planner for Marcela, built on the same foundation as Head Out. Read `docs/ARCHITECTURE.md` before
changing anything: it covers the shape of the app, the interface building blocks, the lessons from Head Out, and the
standing preferences (no technical words on screen, no background jobs, no maintenance screens, secrets only in Vercel
and on Matt's Mac, no model names in commits or PRs).

The screens: `components/Week.tsx` (This week, planning), `Groceries.tsx` (the shared list), `Recipes.tsx` (Search and the
collection). The planning rules are plain code in `lib/week.ts`, with tests; keep them there.

The Safeway helper is a Chrome extension in `extension/` (its own README); it isn't part of the web app or its build.
