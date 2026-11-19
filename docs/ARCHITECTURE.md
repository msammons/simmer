# Simmer: how it's built

Simmer started from the foundation of **Head Out** (a sibling app), the family's day-out planner. This page is the
shape of the app and the lessons that came from building Head Out, so they don't have to be learned twice.

## The shape

- **A home-screen web app for iPhone.** Next.js 16 (App Router, React 19, TypeScript, Tailwind v4) on Vercel. One page
  (`src/app/page.tsx` → `components/App.tsx`); screens are views inside it, not routes. It installs to the home screen
  (`app/manifest.ts`, `public/icon*.png`) and works offline (`public/sw.js`).
- **No accounts.** One household passcode, typed once per phone and sent as the `x-passcode` header. Every API route
  checks it (`lib/auth.ts`, fails closed). `/api/version` is the exception: it's only a build id.
- **The data lives in Upstash Redis** (since Nov 11, Sam; the Google Sheet's limit of about 60 reads and writes a minute
  ran out in a busy minute). Each "tab" is kept as its rows exactly as the Sheet had them (`lib/google/redis-tabs.ts`;
  `lib/google/sheets.ts` is the storage layer under its old name), so the app still reads and writes rows by header name,
  in any column order and capitalization, and a bad row is skipped, never fatal (`lib/parse.ts`). The server keeps the last
  good copy of the Profile for 60 s (`lib/data.ts`). Without Redis (local dev, tests) it reads `data/*.csv`. The Sheet is
  only an export (`/api/export`, no longer in Settings); nothing reads it, so it isn't edited by hand. The five Morales
  apps share the one free Redis database, each under its own key prefix.
- **Code owns facts; the model reads and files.** Anything checkable (dates, times, quantities, what's on the list, every
  amount and name on it) comes from code (`lib/words.ts`, `lib/groceries.ts`). Gemini (`lib/google/gemini.ts`, structured
  JSON output, retries, a lighter fallback model) only reads a recipe from a page, photo or file (`lib/recipes.ts`) and
  guesses where a new item is bought and filed (`lib/groceries.ts`); code checks what it returns. In Head Out, people's names were swapped for roles ("Adult A", "Child, 10") before anything was sent to the
  model and swapped back after; keep doing that.
- **Errors in plain words.** Server failures become "That didn't load. Try again in a minute." (`lib/friendly.ts`);
  problems written for people are thrown as `AppError` and shown as is. A dropped connection reads "No connection…".

## The interface

Everything comes from `components/ui.tsx`, so every screen looks and behaves the same:

- `BrandBar` on every screen: the Simmer lockup top left (it never moves), at most one action then the same Settings
  button top right (`OpenSettings`, set once in `App.tsx`, so screens don't pass it), pinned and blurred over the page.
  A tab has no visible title (its name is for screen readers). `TopBar` is the bar plus a large title for a screen you
  drill into (a recipe), with a round back chevron before the title, named for the screen below; swiping right also goes
  back (`useSwipe`). Settings holds the look, Ordering (Face ID, limit per order, pickup store, card, on/off) and the release.
- Navigation is one back stack in `App.tsx`: a tab (Recipes, Meals, List or Shop; the List's code is `Stock.tsx`) with
  screens pushed on it (a recipe). Back pops; a tab tap starts that tab fresh. The tab bar shows on every screen, the stack's tab lit. Sheets
  name what they show (a week, a night, an item) rather than holding a copy, so a refresh shows in them. A passcode
  turned down by any request (the client sends `SIGNED_OUT`) closes everything and asks for it again.
- `BrandBar`'s `below` pins a switch inside the top bar, under the same blurred backing (Shop's store filter: All,
  Safeway, Trader Joe's, Costco).
- `TabBar`: the four tabs in one Liquid Glass capsule. There is no search; the Recipes tab lists the collection (from the
  freezer, favorites, Quick, Regular, Kids' dinners), each opening to all of it, and the Add meal sheet searches.
- `Group`/`Row` (inset grouped lists), `Button` (primary is tinted glass; no gradients on anything you tap), `Sheet`
  (one grabber, pull down to close, rides above the keyboard), `MoreMenu` (a ⋯ as the phone's own picker), `Segmented`,
  `AddField` (the grey + inside its right end), `EmptyState`, `IconBadge`.
- Problems are one `Alert` over the page (a short headline, the reason, OK), never a bar that pushes the page; risky
  actions ask first with one `ConfirmSheet` (headline, one muted line, the action, Cancel). No Undo, no toasts, no
  "Saving…": a change shows at once (every tap, within about 150 ms) and saves behind it; one that fails is put back and
  the alert says why. A first load with nothing saved here shows `Held`, grey rows with Head Out's `.shimmer`; no loading
  words, no spinners. No sentence on screen speaks of the app in the third person.
- Settings ends with the release as YY.M.D (`NEXT_PUBLIC_VERSION`, worked out in `next.config.ts`).
- Type scale `t-*` utilities and colors as CSS variables in `app/globals.css`. Themes set `--accent` and a brand gradient
  (`--g1..g3`) used only on non-interactive brand surfaces. Simmer (tomato, matching the icon; the default), Apricot (the original warm orange), then plain iOS colors.
  The accent is for things you tap; a dinner's things on the List also have their names in it.
- One line-icon set (`components/icons.tsx`). No emoji anywhere.

## The screens

- **Meals** (`Week.tsx`): days from today (7, or 14 with Show more days), each with its meals and, last, one Add meal row.
  Add meal opens a sheet of her recipes (search, a pill for each kind with All first, every kind under its heading); a
  meal's ⋯ moves it to another day or takes it off (asking first). New plan, in the top bar, asks first, empties every
  list and logs the dinners as made (the Safeway cart stays). Simmer never picks meals. Rules in `lib/week.ts`, `lib/plan.ts`.
- **List** (`Stock.tsx`, `lib/stock-rows.ts`): what the house keeps, by section (Fresh, Pantry, Freezer, Household), A to Z.
  Every row is answered Have (✓) or Need (a cart): Need puts it on its store's list, Have checks it, the lit side tapped
  again clears it. Common things always show; specialty things only while they're on the list or answered. What the
  planned dinners need shows in its own section with its name in the accent colour and the amount all of them need
  underneath, and waits there until she says Need. Things in a group sit together: the header row is tinted and the group
  has a faint outline; tapping its name switches between all its items and only the ones in the cart or needed by a dinner
  (the arrow shows which); a group whose things all show anyway starts open and closes to its name alone. A group's ⋯ has
  Rename group and Remove group only; the list's own ⋯ has Show all groups. A row's ⋯ moves it, groups it, makes it
  common or specialty, or removes it. The field at the top adds a thing as Need.
- **List items are what's bought** (`parseIngredient`, `bothOf`, `listName` in `lib/words.ts`): no sizes or cuts, "or"
  picks one, "X and Y" splits into two when both are known things, and names that mean the same are one line (spices
  without "ground", kosher salt and salt).
- **Recipes** (`Recipes.tsx`): Add recipe (from a link, photo, file or typed), then the collection. A recipe's page has
  Add to the plan (which asks for a day), its ingredients, steps and notes.
- **Settings** (`Settings.tsx`, `Ordering.tsx`): the look, Ordering and the release.

## Shop and Safeway

The Shop tab (`components/Shop.tsx`, with Find and the cart's workings in `Safeway.tsx`, logic in `lib/shop.ts` with
tests) is one page, grouped by store: Safeway, then Trader Joe's, then Costco (a store with nothing doesn't show), with a
filter pinned under the top bar (All or one store). Every row is the same height with a tick (got it, in the store or
delivered), the household's name for the thing, and one small line: for a Safeway thing with a chosen product, Safeway's
product name and "Need …"; otherwise the amount. While Safeway can be reached, a Safeway row also has + (its usual into
the cart), Find (Safeway's choices with pictures, in a sheet, one item at a time) or − n + once it's in the cart; the
Safeway header has Add usuals (N); and things put in the cart on Safeway's own site end the Safeway group. Above the list,
with something in the cart, Check out and the cart's price sit on the left and Shop's ⋯ on the right: Show checked (on
unless this phone turned it off: ticked rows stay struck through; off, they're hidden) and Mark the Safeway cart bought
(for when Simmer can't tell the order went through). A new plan empties the lists and writes what was got down as bought.
Opening Shop reads Safeway's own cart, so Simmer's copy matches it. A change to something already in the cart (a −, a +
or taking it out) is made on Safeway's cart page first, where the product is listed, from Shop's rows and from Find alike;
only adding something new goes through a search. Find searches when an item comes up and on Search, never on each letter
typed, ranks results by her own words, and starts each item at the top of the screen. Old `?open=lists` addresses land on
Shop, as the helper panel's `?open=shop` does. Check out and ordering are in docs/CHECKOUT.md: Face ID, a limit, test
runs, and a checkout fingerprint of the helper (`scripts/checkout-print.mjs`, `src/lib/checkout-print.json`) that decides
when a new test run is needed (a search or cart fix to the helper needs none).

Safeway can't be reached from Simmer's server, so searches and cart changes are **jobs** done by the Safeway helper in
Chrome on a computer (`extension-working/`): Simmer queues a job (`/api/safeway/jobs`, `lib/jobs.ts`, the "Safeway jobs" rows,
pruned as it goes), the helper takes it, does it on safeway.com and reports back (the app follows it with one request at a
time that the server answers once the job's finished, or after about 20 s: `waitForJob`, no timer in the app); a quantity set on Safeway goes into
Simmer's cart ("Safeway cart" rows, `lib/safeway.ts`, with a `cart` column so more carts can be kept later) and a
product added for an item becomes that item's pick (the Safeway rows, now with the product's picture address; pictures
are shown from Safeway, never stored). The helper's last check-in is kept too, so when the computer isn't answering
Find says so at once rather than waiting; a job the helper doesn't pick up drops Shop's Safeway controls, and the Safeway
rows become a plain checklist. When Simmer has VAPID keys, queuing a job also sends the helper an empty Web Push so it starts at
once (`lib/push.ts`). When Safeway's cart page reads empty, the helper reads the Purchases page (Online) too, and an
order placed since the cart was filled takes the cart's things off the list (`finishJob` in `lib/jobs.ts`). Mark the Safeway cart bought takes what's in the cart off the list and empties the cart. Simmer may be
framed only by itself and by the helper's panel (`frame-ancestors` in `next.config.ts`); framed there, it takes the
passcode by message from its parent, only from a Chrome helper page, never from the address.

## Lessons from Head Out (keep these)

- **Dates by the calendar.** Never add 24 hours to get tomorrow: on the nights the clocks change it's wrong. Use
  `addDays`/`dateIn`. Use `hourCycle: "h23"` (some browsers write midnight as 24). The household's time zone is `TZ`.
- **Updates while the app is open.** An iPhone can keep the app in memory for days. When it comes back to the front on a
  screen at rest, it checks `/api/version` (at most once a minute) and reloads into a new build, returning to the same
  screen. Add new screens to `RESTING` in `App.tsx` only if a reload there loses nothing.
- **Waits.** No spinners and no "Saving…": a tap shows its result at once and saves behind it (taps on a quantity go to
  Safeway as one change when the last is done), a slow first read shimmers, and a Safeway job is followed by a request the
  server answers when it's done or after about 20 s. Nothing in the app or the helper runs on a timer or polls: it loads
  on open, on return, after a change, or when a push says so (Sam, Nov 11).
- **Offline.** The shell is cached; data saved on the phone (the list, recipes and plan) still shows. Coming back online reloads
  what's needed. `localStorage` reads and writes are always wrapped in try/catch.
- **Wrong passcode says so.** The passcode screen shows it as the alert; the button waits for a passcode.
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
- No scheduled background jobs, and no timers, polling, intervals or alarms in the app or the helper (Sam, Nov 11). Work
  happens while someone is using the app (or right after a response, with `after()`), and screens load on open, on
  return, after a change, or when a push says so.
- Every tap responds at once and saves behind it; risky actions ask first (a confirm, never an Undo); no note or info bars
  that move the page (problems are an alert); controls are plain and user-driven, never clever automatic ones.
- No maintenance screens in the app. Data is changed in the app; the Sheet is only an export.
- Secrets live only in Vercel and on Sam's Mac. Never print them, never commit them.
- Commits and PRs never name the AI model.

## Running it

- `npm run dev` for local work (no Redis needed: it reads `data/*.csv`).
- `npm test` (vitest), `npm run lint`, `npx tsc --noEmit`.
- Browser smoke test (any day, sample data; behaviour once at phone size, layout in phone light, phone dark and one
  1000 px wide run): start a server with `HOUSEHOLD_PASSCODE=test123` and blank Redis and Google settings (e.g.
  `npx next start -p 3202`), then `URL=http://localhost:3202/ node scripts/smoke.cjs`.
- After changing `public/icon.svg`: `npm run icons`.

## Setting up production

1. The shared Upstash Redis database (`KV_REST_API_URL` and `KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*` names),
   with a **Profile** tab's rows (`who, type, value`; see `data/profile.csv`).
2. A Vercel project linked to this repo, with `HOUSEHOLD_PASSCODE`, `GEMINI_API_KEY` and the Redis pair (see
   `.env.example`). Optional: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (wakes the Safeway helper by push),
   `CHECKOUT_ENABLED=on` (lets real orders through; docs/CHECKOUT.md), and `GOOGLE_SERVICE_ACCOUNT_JSON` only for the
   export to a Google Sheet.
   These are secrets: they stay in Vercel (ideally as shared variables linked to every app), never in code, because code
   is copied everywhere and git keeps every version forever. The export Sheet's id isn't a secret, so it lives in code.
