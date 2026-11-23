# Headless UI harness (desktop)

The desktop front end, run in a browser with Tauri mocked, signed in to
staging, driven by Playwright. It is how a change to `apps/desktop/src` is
checked without opening the app: no window, no GUI, no Rust.

```
cd apps/desktop
npm run headless                                   # every spec in WebKit: day to day
npm run headless:full                              # WebKit and Chrome: before a merge to staging
npm run headless:smoke                             # the @smoke tests in WebKit
HEADLESS_PORT=1433 npm run headless -- smoke       # one spec, on a worktree's port
npm run headless:full -- smoke --project='chrome*' # one spec in Chrome only
HEADLESS_WORKERS=1 npm run headless -- K-search    # one worker (the default is 4)
```

## What runs where

- `playwright.config.ts` starts `vite --mode headless` on `HEADLESS_PORT`
  (default 1430; an existing server on that port is reused), signs in once
  (the global setup in `headless/helpers.ts`) and runs `headless/specs/` in
  four workers side by side (`HEADLESS_WORKERS` changes it; see Running side
  by side). Two browsers: WebKit (Playwright's WebKit, the closest thing to
  the app's WKWebView, H.264 through the system media stack), which `npm run
  headless` runs alone, and Chrome (the installed Google Chrome, `channel:
  "chrome"`, as the cross-check; Playwright's own Chromium has no H.264),
  which only `npm run headless:full` adds. Run the full one before a merge
  to staging. Each browser has two projects: `webkit` (every test but the
  @alone ones) and `webkit-alone`, likewise `chrome` and `chrome-alone`;
  `--project='webkit*'` picks both of a browser's.
- `vite.config.ts` in `headless` mode, and only there: injects
  `headless/install-mocks.ts` ahead of `src/main.tsx`, so the mocks exist
  before any app module evaluates; aliases `@tauri-apps/plugin-http` to
  `headless/plugin-http-shim.ts` (the browser's `fetch`); answers a missing
  local file 404 under `/@fs` the way the stream protocol does; takes the port
  from `HEADLESS_PORT`; and refuses to start unless `VITE_SUPABASE_URL` is
  staging (`edalihizooqdxeekaklf`). A Tauri or production build never sees
  any of it. There are no changes to the app's source.
- `headless/make-fixture.sh` generates the test video,
  `headless/fixtures/game.mp4` (two minutes of 1280×720 at 25 fps, testsrc
  with a burnt-in timecode, H.264) and `poster.png`, with the app's ffmpeg
  sidecar. The global setup runs it; it does nothing when they exist.
- Output, all ignored by git, in `apps/desktop/headless/out/`:
  `<port>-<name>.png` screenshots, `state-<port>.json` (the signed-in
  storage state), traces of failed tests. Playwright empties this folder at
  the start of every run, so copy a screenshot out before the next run if a
  report needs it later.

A `tauri dev` running from the same worktree watches these files too: it
reloads its page when a run writes `state-<port>.json` at its start, and
again for each trace a run writes. With someone in that app, pass
`--trace off` (one reload at the run's start is left).

## `.env.headless`

`apps/desktop/.env.headless`, never committed (`.env.*` is ignored). Copy
`.env.staging` and add:

| Variable | What |
| --- | --- |
| `VITE_HEADLESS=1` | Marks the file; nothing reads it yet. |
| `HEADLESS_EMAIL`, `HEADLESS_PASSWORD` | Required. The staging test account. The harness signs in through the real login form. |
| `HEADLESS_DEVICE_ID` | Required (the global setup stops without it). The machine id the device registry sees. One per worktree, so staging gets one device per worktree, not one per run. |
| `HEADLESS_PORT` | Optional; the shell's value wins. Default 1430. |

Worktrees don't share ignored files: each worktree needs its own copy of the
file (with its own `HEADLESS_DEVICE_ID`), and generates its own fixture on
its first run.

## Ports

One Vite per worktree, each on its own port: main checkout 1430, groups A
1431, B 1432, C 1433, D 1434, E 1435. Pass it as `HEADLESS_PORT=<port>`.
Screenshots and the storage state carry the port in their names.

## The mocks

`headless/install-mocks.ts` answers every command the front end sends:

| Command | Answer |
| --- | --- |
| `get_device_identity` | `{ hardwareId: HEADLESS_DEVICE_ID, hostName: "headless-<port>" }`; rejects without `HEADLESS_DEVICE_ID` |
| `get_temp_dir` | `/tmp` |
| `probe_video` | The fixture's numbers (`120000` ms, 1280×720, 25 fps) for the fixture; rejects for any other path |
| `read_file`, `delete_file` | An in-memory map, `window.__headlessFiles` (a spec may put bytes there) |
| `menu_set_enabled`, `menu_set_text`, `menu_sync_theme` | No-ops |
| `cancel_export` | No-op (no export ever starts) |
| `grab_frames`, `extract_poster_frame`, `extract_clip_poster`, `export_playlist`, `export_clip_for_ship` | Reject `headless: native <cmd>`, so a spec that reaches them fails loudly |
| `plugin:app\|version` | The app's version |
| `plugin:updater\|check` | `null` (no update) |
| `plugin:deep-link\|get_current` | `null` |
| `plugin:dialog\|open` | The fixture video (the fixtures folder for a directory pick; an array when `multiple`) |
| `plugin:opener\|open_url` | Records the URL on `window.__headlessOpened` for assertions |
| `plugin:process\|restart`, `plugin:process\|exit` | No-ops |
| `plugin:event\|listen` / `unlisten` / `emit` / `emit_to` | An incrementing id / no-ops; no event is ever delivered |
| `plugin:window\|*`, `plugin:webview\|*` | `mockWindows("main")`; `is_focused`/`is_visible` true, other `is_*` false, sizes from the page, setters `null` |
| `plugin:sentry\|*` | Dropped: a headless run reports nothing to Sentry |
| anything else | Logged once as `headless: unmocked <cmd>` and rejected |

`convertFileSrc(path, "stream")` becomes `http://localhost:<port>/@fs<path>`:
Vite serves the file with Range requests (206 with a `Content-Range`), a
missing file is 404 and a file outside the workspace 403, like the stream
protocol. A path to any worktree's `…/headless/fixtures/<file>` resolves to
this server's own fixtures, so worktrees that point a staging game at "their"
fixture don't break each other.

## The window's drag regions

In the real app a press on an element that carries `data-tauri-drag-region`
(the title strip, a toolbar's empty part) is taken by
Tauri's own script to start a native window drag: the page gets the
pointerdown and nothing after it, no mouseup and no click. Without Tauri a
headless page gets the whole click, so anything that waits for the click
looks fine here and is broken there (a Radix popover closes on the click
after a press outside it, and stayed open). `emulateWindowDragRegions(page)`
in `helpers.ts` reproduces it: call it before the first navigation
(`specs/L-light-dismiss.spec.ts`).

## What it can't reach

These stay in the Manual check of a task: native export and everything
ffmpeg does (frames, posters, Clip & Ship), the Rust menu and its
accelerators, file dialogs (the mock picks the fixture), the stream
protocol itself, real window drag and full screen, vibrancy, WKWebView's
paused-frame purge, deep links, the updater. Requests the app sends through
plugin-http go through the browser here, so a cross-origin one (Genius'
hosted stats pages, R2 uploads, the web app's API) can fail on CORS where the
app succeeds. PostHog loads as in a dev build (staging's environment tag) and
asks for its flags, but no event was ever seen leaving an automated browser:
a spec cannot read analytics off the network.

## Analytics

To assert on what the app reports, a spec replaces the app's one analytics
module at its edge before the first navigation and reads the calls from the
page: `recordAnalytics(page)` in `headless/helpers.ts` routes
`src/lib/analytics.ts` to a module whose `trackEvent` keeps each call on
`window.__tracked`. The stand-in must export what the real module exports; a
new export there breaks the page loudly, which is the reminder to add it.

## Games the test account doesn't have

A spec that needs a game the account has none of (a timeout on the game with
footage, two team colours that are close, a play with no team side, long team
names) changes what the page is told, not the account:
`patchGameReads(page, …)` in `headless/helpers.ts` rewrites the answers to the
page's own reads of `matches` and `play_by_play_events` in the browser, before
the game is opened. `giveSampleGameATimeout(page)` uses it to put one timeout
on the sample game. Nothing is written to staging, and the game view never
saves marks for the sample game.

## Adding a spec

Put `headless/specs/<area>.spec.ts` next to `smoke.spec.ts`. Import `test`
and `expect` from `../helpers`, never from `@playwright/test`: that `test`
fails a test whose page logged a `headless:` line (an unmocked or native
call, even one the app caught) or threw an uncaught error, and prints them.
Tests start signed in (the saved storage state), in any order and in any
worker (see Running side by side). Use
`openFirstGame(page, { shotLibraryAs })` (returns the opened game's title),
`shot(page, name)` and `signIn(page)` from `headless/helpers.ts`; name shots
with the browser (`${browserName}-…`) so the two projects don't overwrite
each other. Assert visible text, not just that nothing threw. The account is
shared by every worktree and every worker: name what a spec creates with
`owned("…")` (`headless-<port>-<slot> …`, see Running side by side) and delete
it in the same spec. A test that changes what other tests see gets `{ tag:
"@alone" }`. Run it with
`HEADLESS_PORT=<port> npm run headless -- <spec>` and name the screenshots in
the task's report. The harness itself is typechecked with
`npx tsc --noEmit -p headless/tsconfig.json` in `apps/desktop` (the app's
`npx tsc --noEmit`, and so check.yml, covers only `src`).

The smoke spec (`specs/smoke.spec.ts`) is the harness's own proof: the Games page
lists games, the first game's Game view draws its play list and timeline, a
playlist's Add clips lists events. It reads only. It needs the test account
to have at least one game and one playlist.

`npm run headless:smoke` runs the tests tagged `@smoke`: the smoke spec and one
quick test of each main view (the start page, Playlists, the player, the
strip, open games, Teams, an open team, search, Stats, the filter menu,
Reports), twelve in all, in under half a minute. Tag a test `{ tag: "@smoke" }`
(or add it to its tags) only when it is quick and covers a view the set
doesn't.

## Running side by side

The suite runs in four workers (`HEADLESS_WORKERS`), and a file's tests are
spread over them (`fullyParallel`). Every test starts from the saved storage
state on a fresh page, so no test may lean on one that ran before it.

- **Names.** What a test writes on the shared account carries its owner,
  `OWNER` in `headless/helpers.ts`: `headless-<port>-<slot>`, the slot being
  Playwright's `parallelIndex` (0 to workers−1). Two workers that run at the
  same time never share a slot, and a worker that replaces a crashed one takes
  its slot, so its sweeps clear what the crashed one left. Name rows with
  `owned("…")` (or `${OWNER} …`); every delete helper refuses a prefix that
  isn't this worker's. The footage journal is per slot too.
- **`@alone`.** A test that changes what other tests see, beyond its own rows,
  carries `{ tag: "@alone" }` (on the test or its describe): archiving a game
  (`E-task18`), linking a game to the test video (`B-task4`, `F-esc-crop`),
  renaming a game (`D-task15`), putting labels on a game's plays or taking a
  label's key (`D-task16`, two in `K-add-clips-window`, three in `P-teams`).
  They run in the `webkit-alone` and `chrome-alone` projects, one at a time,
  queued after everything else, and nothing else of the run is in flight
  while one runs.
- **`@alone:<group>`.** Tests that only see each other's writes take turns
  among themselves and run beside everything else: `@alone:presets`
  (`C-task12`: the space's presets list shows every worker's presets) and
  `@alone:team-report` (`R-team-report`: a report is found by the made-up
  league's team id, the same in every worker).
- **The lock.** Every test holds the account lock for its whole length, hooks
  included: a folder in the system's temp folder,
  `scoutable-headless-lock-<port>`, with a file per holder named by its
  process. A holder that died (a killed worker, a stopped run) is noticed and
  cleared. The wait for the lock has its own timeout (20 minutes), not the
  test's.
- **Route handlers.** A handler still waiting on `route.fetch()` when its
  test ends would throw outside any test and take its worker down; the shared
  `test` lets them go quietly (`page.unrouteAll({ behavior: "ignoreErrors" })`).

A new spec that writes something every test can see (a label, a preset, a
change to a game) needs `@alone` or a group. When in doubt, run it with
`HEADLESS_WORKERS=1` first, then with the default, twice.

## Timings

Measured 2026-11-23 on Leonard's Mac (14 cores), staging, `--trace off`, 222
tests (one skips itself).

| Run | Before (1 worker) | After (4 workers) |
| --- | --- | --- |
| `npm run headless` (WebKit) | 20 min 4 s | 8 min 7 s, 7 min 24 s (two runs, both green) |
| `npm run headless:full` (WebKit + Chrome) | about 35 min (not re-measured) | 30 min 51 s (31 failed), then 18 min 55 s (6 failed); every failure passed on a rerun |
| `npm run headless:smoke` (12 tests) | — | 26 s |

In the 4-worker WebKit run the side-by-side part does about 19 minutes of test
time in under 6 minutes; the 11 `@alone` tests then take about 2 minutes one
at a time. Each test is somewhat slower beside three others (the sum of the
test times rose from 1,186 s to about 1,290 s).

The two full runs failed on staging's speed, not on tests meeting each other:
reads of `matches` or the `genius` function open for over 15 s, a library
read that hadn't landed within a 5 s poll, the Plays list not drawn in 30 s.
In the second run the WebKit half took 8 minutes against 6 in the WebKit-only
runs, slow in one stretch (P-teams), while the Chrome half was as quick as
ever; in the first, everything ran two to three times slower than usual from
the first minute. Staging is a small instance shared by every worktree. A
failure of that kind: rerun it once (`npx playwright test -c
playwright.config.ts --last-failed`) before chasing it; `HEADLESS_WORKERS=3`
asks less of staging.

The slowest specs, one worker, WebKit (seconds, tests):

| Spec | s | Tests | Why |
| --- | --- | --- | --- |
| `P-teams` | 171 | 42 | Many short tests, each a fresh page load and the made-up league; one holds the library read 8 s on purpose |
| `H-game-player` | 102 | 16 | Each test opens the sample game and waits for its video from the network; about 5 s of fixed waits |
| `C-task12-presets` | 95 | 3 | Long flows through Add clips and the game view against staging; one holds Luleå's plays 10 s on purpose |
| `I-game-tabs` | 87 | 16 | Opens several staging games per test; one waits 6 s to prove a notice stays |
| `J-game-strip` | 80 | 22 | Short tests, a league game or the sample game each; about 4 s of fixed waits |
| `K-search` | 59 | 15 | Short tests, staging reads |
| `K-add-clips-window` | 52 | 8 | Add clips reads every game's plays from staging |
| `B-task6-card-note` | 37 | 1 | Genius' hosted stats pages, read cold through the network, twice |

Fixed `waitForTimeout`s add up to about 40 s a browser (`A-task1` 5.5 s,
`D-task16` 4.9 s, `H-game-player` about 5 s, `I-game-tabs` 6.6 s,
`J-game-strip` about 4 s): a few percent. Most of the time is staging: every
test loads the app afresh, signs in from the saved state and reads the space,
its games and their plays.

What would help next, worst first (none mocks the backend):

- **The @alone tail, about 2 minutes a browser.** The two label tests in
  `K-add-clips-window` and the three in `P-teams` could make and use a label
  of their own (`owned(…)`) instead of the space's, and join a
  `@alone:labels` group with `D-task16`; the footage specs (`B-task4`,
  `F-esc-crop`) could take a group of their own if no other test opens the
  game they link.
- **Deliberate holds.** `C-task12` holds Luleå's plays 10 s and `P-teams`
  ("Plays never says none…") holds the library 8 s: both could hold until the
  test lets go (as `C-task12`'s last test does), saving about 15 s a browser.
  `I-game-tabs` waits 6 s to see that a notice stays: `page.clock` could run
  the 6 s instead.
- **`H-game-player`** opens the sample game and waits for its network video in
  each of 16 tests; the tests that only need a game view (not playback) could
  open a league game.
- **`B-task6-card-note`** reads Genius' hosted pages cold. Answering those two
  pages from a saved copy would cut it to a few seconds, but that mocks a
  backend: ask Leonard first.

## A second space

The test account is in one space. A spec that switches spaces calls
`addSecondSpace(page)` in `headless/helpers.ts` before the page loads: the
read of the account's orgs (`get_my_orgs`) gets a club it coaches added
(`OTHER_SPACE`), the read of its team answers says it skipped the team
question there, and the account's own space stays the open one.
`switchSpace(page, OTHER_SPACE.name)` then switches through the sidebar's
space menu. Every write that names the club (the sample-game seeding, any
other) is answered in the browser and never reaches staging; it returns them
so a spec can check nothing else was written. The club's reads go to staging,
which has nothing of it, so the club is an empty space.

## The Add clips list

The Add clips list is windowed: only the rows near the view are in the DOM, so
a spec never counts rows. It reads the list with `readSheetRows(sheet)` (every
row by key, read by scrolling the list through) and reaches one row with
`sheetRow(sheet, key)`, both in `headless/helpers.ts`. A spec that needs the
page's reads of plays to fail or wait uses `failPlaysReads(page)` or
`delayPlaysReads(page, ms)`: each answers or holds back only the page's reads
of `matches` that embed `play_by_play_events`, until the function it returns is
called.

## Footage

A staging game's video is on another computer, so a spec that needs playback
links the game to the test video for the length of the test:
`linkStageGameToFixture(page, matchId, track)` in `headless/helpers.ts` clicks
the player's real Locate file… (the dialog mock picks this worktree's
`headless/fixtures/game.mp4`). Before the click it reads the game's own
`video_url`, writes it to a journal, `<system
temp>/scoutable-headless-video-link-<port>-<slot>.json`, and hands the link to
`track`, so `afterEach` can call `restoreGameVideo` even when a later wait
fails. The journal stays out of `apps/desktop`: Playwright empties `out/` when
a run starts, and Vite reloads the open page when a watched file is removed,
which cancels the app's requests mid-test. `restoreGameVideo` puts the old
value back only while the game still points at this worktree's test video (it
throws if someone else changed it) and then removes the journal;
`restoreJournalledVideoLink` in `beforeEach` restores what a crashed run left;
run it, and any `deletePlaylistsNamed` sweep, through `inScratchPage(page,
…)`, a second page that is closed before the test's own page opens, so that
page never shows a swept row or a stale link. A game that already points at
any `…/headless/fixtures/` path is refused. The test video is two minutes
long: pick plays that sit inside it (`specs/B-task4-this-clip-bar.spec.ts`
picks them from the game's sync point). Both WebKit and Chrome play it through
`/@fs`.

A spec that only needs footage to move through, and writes nothing, can open
the sample game instead (the Games row marked "Sample game"): its video
plays from the network in both browsers, about twenty minutes of it, with no
link to make or restore (`specs/H-game-player.spec.ts`).
