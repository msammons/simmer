# Simmer for Safeway (the Chrome helper)

Simmer's Shop tab (List · Find · Cart) searches Safeway and changes the Safeway cart, but Safeway can only be reached
from a real browser where Robin is signed in. This helper is that browser's hands: in Chrome on a computer, it does
Simmer's small Safeway jobs on safeway.com and reports back. It never signs in and never checks out.

## How it works (1.0)

- **Jobs.** Simmer queues a job (`/api/safeway/jobs`): `search` (a search's products with picture, name, price and
  whether each is in the cart), `setQty` (press Add / + / − on a product until the cart holds that many; 0 takes it
  out), and `sample` / `snapshot` (a short account of a page, to learn how Safeway builds it). The background
  (`background.js`) checks for jobs every half minute; once there's activity, or while the panel is open, it checks
  every couple of seconds until a few minutes pass with nothing. It does each job in a Safeway tab (`safeway.js`): one
  already open, or a new one behind, in front only when the panel is open in that window.
- **The panel is Simmer.** After the one-time setup (Simmer's address and the household passcode, kept on this computer
  only), the panel shows Simmer itself, opening on Shop. The passcode goes to Simmer by message, never in the address.
  So the computer and the phone are the same experience, and both go through the same jobs.
- **Most of it lives in Simmer.** Every job carries Simmer's page details (`PAGE` in `src/lib/safeway-helper.mjs`) and
  pace (`SETTINGS`), so a Safeway redesign or a change of pace is a Simmer deploy. What to search for, which product is
  the usual, the cart, the picks (with pictures) and every word on screen are Simmer's. Only a new kind of job needs
  the helper reloaded.

Why this shape: Safeway blocks automated browsers and has no way in for apps (see `docs/PLAN.md`, section 5). This runs
in her own Chrome, pressing Safeway's own buttons at a person's pace.

## Installing or updating it (once per computer)

1. Get this `extension` folder onto the computer (copy it, or `git pull` in a clone).
2. In Chrome, open `chrome://extensions`, turn on **Developer mode** (top right). New install: **Load unpacked** and
   pick the folder. Update: press the reload arrow on **Simmer for Safeway**'s card (it should say 1.0.0).
3. Pin it (the puzzle-piece button, then the pin), click the Simmer button, and type Simmer's address and the passcode
   (once).
4. Sign in to Safeway in that Chrome, and leave Chrome open. Simmer's Find then works from the phone too.

## Files

- `manifest.json`, `background.js`: the helper; the toolbar button opens the panel, and the background does the jobs.
- `safeway.js`: doing one job in a Safeway tab.
- `page.js`: what runs inside safeway.com: reads the products on screen, presses Add / + / −, using Simmer's page details.
- `panel.html`, `panel.css`, `panel.js`: setup, then Simmer in a frame.
- `../scripts/extension-test.mjs`: the whole thing against a real local Simmer and a stand-in Safeway
  (`node scripts/extension-test.mjs`). It can't tell whether the real Safeway pages still match.

## Not yet tried on the real safeway.com

Whether Safeway's search fills in a tab nobody's looking at; whether − at one removes the product without a
confirmation step; and the − / + buttons' labels on the real page (read from Safeway's code, not pressed). When
something doesn't match, a `sample` or `snapshot` job's text (kept in the Sheet's "Safeway jobs" tab) shows what
Safeway sent, to fix `PAGE` in Simmer.
