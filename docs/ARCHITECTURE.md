# Simmer: how it's built

Simmer started from the foundation of **Head Out** (a sibling app), the family's day-out planner. This page is the
shape of the app and the lessons that came from building Head Out, so they don't have to be learned twice.

## The shape

- **A home-screen web app for iPhone.** Next.js 16 (App Router, React 19, TypeScript, Tailwind v4) on Vercel. One page
  (`src/app/page.tsx` → `components/App.tsx`); screens are views inside it, not routes. It installs to the home screen
  (`app/manifest.ts`, `public/icon*.png`) and works offline (`public/sw.js`).
- **No accounts.** One household passcode, typed once per phone and sent as the `x-passcode` header. Every API route
  checks it (`lib/auth.ts`, fails closed). `/api/version` is the exception: it's only a build id.
- **The Google Sheet is the data store.** People edit it by hand and Gemini edits it too, so parsing is forgiving: columns
  are matched by header name in any order, values in any capitalization, and a bad row is skipped and reported, never fatal
  (`lib/parse.ts`). The server keeps the last good copy for 60 s and falls back to it when the Sheet can't be reached
  (`lib/data.ts`). The Sheet's id is in `lib/google/sheets.ts`; without the service account key, local dev reads `data/*.csv`.
- **Code owns facts; the model writes words.** Anything checkable (dates, times, quantities, what's in the Sheet) comes from
  code. Gemini (`lib/google/gemini.ts`, structured JSON output, retries, a lighter fallback model) only writes the friendly
  sentences. In Head Out, people's names were swapped for roles ("Adult A", "Child, 10") before anything was sent to the
  model and swapped back after; keep doing that.
- **Errors in plain words.** Server failures become "That didn't load. Try again in a minute." (`lib/friendly.ts`);
  problems written for people are thrown as `AppError` and shown as is. A dropped connection reads "No connection…".

## The interface

Everything comes from `components/ui.tsx`, so every screen looks and behaves the same:

- `TopBar` on every screen: the Simmer lockup top left (it never moves), at most one action then the same Settings
  button top right (`OpenSettings`, set once in `App.tsx`, so screens don't pass it), then one large title in the same
  place. Settings holds who's using the phone, Add recipes, and the look. Drill-in screens get a round back chevron
  before the title, named for the screen below; swiping right also goes back (`useSwipe`).
- Navigation is one back stack in `App.tsx`: a tab (Meals, Groceries, or Recipes) with screens pushed on it (a
  recipe). Back pops; a tab tap starts that tab fresh. The tab bar shows on every screen, the stack's tab lit. Sheets
  name what they show (a week, a night, an item) rather than holding a copy, so a refresh shows in them. A passcode
  turned down by any request (the client sends `SIGNED_OUT`) closes everything and asks for it again.
- `TabBar`: the three tabs in one Liquid Glass capsule. There is no search; the Recipes tab lists the collection by
  kind, each kind opening to all of it (the plan's recipe picker still searches).
- `Group`/`Row` (inset grouped lists), `Button` (primary is tinted glass; no gradients on anything you tap), `Sheet`
  (one grabber, pull down to close, page dots, rides above the keyboard), `EmptyState`, `Notice`, `IconBadge`.
- Type scale `t-*` utilities and colors as CSS variables in `app/globals.css`. Themes set `--accent` and a brand gradient
  (`--g1..g3`) used only on non-interactive brand surfaces. Simmer (calm sage, matching the icon), Apricot (the original warm orange), then plain iOS colors.
- One line-icon set (`components/icons.tsx`). No emoji anywhere.

## Lessons from Head Out (keep these)

- **Dates by the calendar.** Never add 24 hours to get tomorrow: on the nights the clocks change it's wrong. Use
  `addDays`/`dateIn`. Use `hourCycle: "h23"` (some browsers write midnight as 24). The household's time zone is `TZ`.
- **Updates while the app is open.** An iPhone can keep the app in memory for days. When it comes back to the front on a
  screen at rest, it checks `/api/version` (at most once a minute) and reloads into a new build, returning to the same
  screen. Add new screens to `RESTING` in `App.tsx` only if a reload there loses nothing.
- **Waits.** Run slow requests through `wait()` in `App.tsx`: one at a time (a double tap sends one request), a Cancel that
  appears after 2 s (so the second tap of a double tap can't hit it), late answers after Cancel ignored, and an estimate
  from this phone's recent waits. Never a spinner with no way out.
- **Offline.** The shell is cached; data saved on the phone (in Head Out, plans) still shows. Coming back online reloads
  what's needed. `localStorage` reads and writes are always wrapped in try/catch.
- **Wrong passcode says so.** The passcode screen shows the error and a "Checking…" state.
- **Lists built from choices go stale.** If the choices behind a list change, clear it, so tabs and swipes don't bring
  back results for old choices.
- **Swipes inside a sheet stay in the sheet.**
- **Test at iPhone size (390×844, also 375), light and dark, at clock edges** (just after midnight, late evening, the
  clock-change nights), offline then online, slow and failed requests, and double taps. In headless Chrome with mobile
  emulation, `dblclick` doesn't tap and two simultaneous taps become one two-finger touch: tap twice in sequence instead.

## Standing preferences

- No technical words in anything a person sees: no "Gemini", "Google", "Sheet", "tab", "web", "API".
- No device names in anything a person sees either: not "iPhone", "iPad" or "phone". Say "saved", "here" or "your
  settings" instead.
- No scheduled background jobs. Work happens while someone is using the app (or right after a response, with `after()`).
- No maintenance screens in the app. The Sheet is where data is managed.
- Secrets live only in Vercel and on Sam's Mac. Never print them, never commit them.
- Commits and PRs never name the AI model.

## Running it

- `npm run dev` for local work (no Sheet needed: it reads `data/*.csv`).
- `npm test` (vitest), `npm run lint`, `npx tsc --noEmit`.
- Browser smoke test (any day, sample data, phone and iPad sizes): start a server with `HOUSEHOLD_PASSCODE=test123`
  (e.g. `npx next dev -p 3202`), then `URL=http://localhost:3202/ node scripts/smoke.cjs`.
- After changing `public/icon.svg`: `npm run icons`.

## Setting up production

1. A Google Sheet with a **Profile** tab (`who, type, value`; see `data/profile.csv`), shared as Editor with the service
   account's email.
2. A Vercel project linked to this repo, with `HOUSEHOLD_PASSCODE`, `GOOGLE_SERVICE_ACCOUNT_JSON` (the key
   file's whole JSON on one line) and `GEMINI_API_KEY` (see `.env.example`).
   These three are secrets: they stay in Vercel (ideally as shared variables linked to every app), never in code,
   because code is copied everywhere and git keeps every version forever. The Sheet's id isn't a secret, so it lives in code.
