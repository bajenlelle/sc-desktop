# Headless UI harness (desktop)

The desktop front end, run in a browser with Tauri mocked, signed in to
staging, driven by Playwright. It is how a change to `apps/desktop/src` is
checked without opening the app: no window, no GUI, no Rust.

```
cd apps/desktop
npm run headless                                   # every spec, WebKit then Chrome
HEADLESS_PORT=1433 npm run headless -- smoke       # one spec, on a worktree's port
npm run headless -- smoke --project webkit         # one browser
```

## What runs where

- `playwright.config.ts` starts `vite --mode headless` on `HEADLESS_PORT`
  (default 1430; an existing server on that port is reused), signs in once
  (the global setup in `headless/helpers.ts`) and runs `headless/specs/`
  one test at a time in two projects: `webkit` (Playwright's WebKit, the
  closest thing to the app's WKWebView, H.264 through the system media stack)
  and `chrome` (the installed Google Chrome, `channel: "chrome"`, as the
  cross-check; Playwright's own Chromium has no H.264).
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

## What it can't reach

These stay in the Manual check of a task: native export and everything
ffmpeg does (frames, posters, Clip & Ship), the Rust menu and its
accelerators, file dialogs (the mock picks the fixture), the stream
protocol itself, real window drag and full screen, vibrancy, WKWebView's
paused-frame purge, deep links, the updater. Requests the app sends through
plugin-http go through the browser here, so a cross-origin one (Genius'
hosted stats pages, R2 uploads, the web app's API) can fail on CORS where the
app succeeds. PostHog runs as in a dev build (staging's environment tag).

## Adding a spec

Put `headless/specs/<area>.spec.ts` next to `smoke.spec.ts`. Import `test`
and `expect` from `../helpers`, never from `@playwright/test`: that `test`
fails a test whose page logged a `headless:` line (an unmocked or native
call, even one the app caught) or threw an uncaught error, and prints them.
Tests start signed in (the saved storage state). Use
`openFirstGame(page, { shotLibraryAs })` (returns the opened game's title),
`shot(page, name)` and `signIn(page)` from `headless/helpers.ts`; name shots
with the browser (`${browserName}-…`) so the two projects don't overwrite
each other. Assert visible text, not just that nothing threw. The account is
shared by every worktree: name what a spec creates with its port
(`headless-1433 …`) and delete it in the same spec. Run it with
`HEADLESS_PORT=<port> npm run headless -- <spec>` and name the screenshots in
the task's report. The harness itself is typechecked with
`npx tsc --noEmit -p headless/tsconfig.json` in `apps/desktop` (the app's
`npx tsc --noEmit`, and so check.yml, covers only `src`).

The smoke spec (`specs/smoke.spec.ts`) is the harness's own proof: Library
lists games, the first game's Game view draws its play list and timeline, a
playlist's Add clips lists events. It reads only. It needs the test account
to have at least one game and one playlist.

## Footage

A staging game's video is on another computer, so a spec that needs playback
links the game to the test video for the length of the test:
`linkStageGameToFixture(page, matchId, track)` in `headless/helpers.ts` clicks
the player's real Locate file… (the dialog mock picks this worktree's
`headless/fixtures/game.mp4`). Before the click it reads the game's own
`video_url`, writes it to a journal, `<system
temp>/scoutable-headless-video-link-<port>.json`, and hands the link to
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
