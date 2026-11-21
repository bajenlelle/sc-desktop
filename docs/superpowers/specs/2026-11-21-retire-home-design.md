# Retire Home: design

Status: draft for Leonard's approval, 2026-11-21. Desktop app only. Nothing
is built. Branch `feat/no-home`, cut from local `main` f8d9b87 (which has the
unpushed Teams pages, which touch the same sidebar).

## Intent

Remove the desktop Home page. The app opens on the coach's work instead,
and the sidebar's first row becomes the action coaches take most:
**New playlist**, with **Search** under it, the way Claude's desktop app
opens with "+ New" and "Search" at the top.

Why: since the sidebar gained Open games, Search, Reports, Shared playlists
and Teams, every section of Home repeats a page one click away (Playlists,
Library, Reports, the Shared playlists dashboard). Coaches use Home as a
doorway:

- PostHog, desktop, last 45 days, Leonard's four accounts excluded
  (17 people): Home had 178 views, 69 of them as the first page of a
  session (the launch). A **median of 6 seconds** on Home, then Playlists
  (49), Library (27), Import (20), a game (17). 13 sessions ended there.
- Playlists is where coaches live: the most views (205) and the most
  sessions that end there (69).
- Over the same period coaches created **133 playlists** (14 people), added
  **2,002 clips**, and imported **55 games** (11 people). A playlist is
  what a coach makes most often, so New playlist goes at the top.

Club players already skip Home: `/` sends them to `/my-playlists`
(`pages/home.tsx`). This applies the same to everyone.

## Goals

- The app opens where the coach left off in this space. The first time,
  or when nothing is remembered, it opens on Playlists.
- The sidebar's first two rows are **New playlist** (⌘N) and **Search**
  (⌘K), above the pages.
- Nothing useful is lost: the Getting started checklist, the first-import
  nudge and the note for players about their club space each get a home.
- The Go menu and the ⌘ number keys follow the new rows without two items
  sharing a key.

## Non-goals

- The web and mobile apps' start screens. They are separate and stay as
  they are.
- An activity feed (report opens, who finished watching, new games). A
  rebuilt Home would only make sense as that, and the data doesn't show
  anyone missing it. That would be a feature of its own, later.
- Changes to Reports, Library or Teams beyond the empty states listed
  below. The Shared playlists dashboard gains one button (Invite players)
  and nothing else.

## Anti-goals

- A new coach opens the app and lands on a blank page with nothing telling
  them what to do first.
- The checklist gets hidden somewhere new coaches never find it.
- A flash of an empty or wrong page before the remembered page appears.
- Two Go menu items with the same key, or a key that does nothing on the
  page it names.
- Remembering a page that no longer exists (a closed or deleted game, a
  page this role can't open) and opening onto an error.

## Constraints

- Tauri on macOS (WebKit) and Windows (WebView2). Native macOS menu in
  `src-tauri/src/menu.rs`, which can move an item's accelerator but not
  remove it, and whose tests check that no two items share a key.
  Windows uses the JS keydown fallback in `menu-handler.tsx`.
- `packages/shared/lib/menu-shortcuts.ts` drives both the sidebar rows
  (`sidebarPages`) and the number keys (`goKeyOrder`).
- Sidebar is 220px wide (`--sidebar-width`). Row style, neutral fills for
  selected rows, and the cyan accent only on controls, per the apple-design
  skill and the row-highlight rule.
- New or changed copy goes through the copywriting skill when it's built.
- Game tabs (Open games) are already remembered per computer and scope
  (`lib/game-tabs`, `gameTabsScope(userId, orgId)`).

## Approaches

### What goes at the top of the sidebar (decided: A)

- **A. New playlist first, then Search (chosen).** It's the most frequent
  creation (133 playlists vs 55 imports), and it's what a coach makes
  daily. Import game keeps its row under Open games, its ⌘O shortcut and
  its Library toolbar button.
- **B. Import game first.** Follows the order of the work (games come
  before clips), but puts the less frequent action first. New coaches
  get pointed at importing by the checklist anyway.
- **C. One "+ New" menu** (New playlist, Import game, later New report).
  Closest to Claude, but every creation takes two clicks, and Mac
  sidebars rarely hide actions in a menu.

### What the app opens on (decided: restore, falling back to Playlists)

- **Reopen where the coach left off (chosen).** This is what Mail, Notes and
  Finder do. A coach who was in a playlist or a game is back there.
- **Always Playlists.** Simpler, but a coach mid-game would have to click
  back in on every launch.
- **Always Library** (the Claude "+ New" analogy taken literally, since
  importing starts the work). Rejected for the same frequency reason as B.

## The sidebar

Coach or admin in a club space (personal space is the same without Shared
playlists):

```
[ Space ▾ ]
＋ New playlist                ⌘N
🔍 Search                      ⌘K
──────────
Playlists                      (⌘1)
Reports                        (⌘2)
Shared playlists               (⌘3)
Library                        (⌘4)
Teams                          (⌘5)

Open games                      ＋
  Fryshuset vs AIK
＋ Import game

…
[ Getting started  2 of 5 ▸ ]  ← only until done or dismissed
[ Update card ]
[ Account ]
```

- **New playlist** is an action row, not a page. It looks like the Search
  row: icon, label, `Kbd` hint ⌘N (Ctrl N on Windows). It does what the
  menu's `new-playlist` does: `navigate("/playlists", { state: { createNew:
  true } })`. Shown to the same people as Search (`isCoachOrAdmin`, which
  includes everyone in their personal space). It is never "selected".
- **Playlists must take `createNew` and `highlight` while it is already
  open.** Today `pages/playlists.tsx` reads them only when it mounts or the
  space changes (the load effect's deps are `[activeOrgId]`), and
  `RootLayout` keys the page by pathname, so `/playlists` → `/playlists`
  doesn't remount. Its later-arrival handler (around line 5365) handles only
  `restore`. As a result ⌘N on Playlists does nothing today, and so would
  the new sidebar row and the checklist's steps there. Fix it in the
  later-arrival handler. (Found in review.)
- **Search** keeps its current behaviour and moves under New playlist.
- **Home row** is removed. `GO_PAGES` loses `go-home`.
- **Import game** stays where it is, under Open games.
- The Playlists page's own toolbar "New playlist" button stays.

### Keys

`GO_PAGES` becomes `["go-playlists", "go-reports", "go-my-playlists",
"go-library", "go-teams"]`. The number keys follow the rows shown, as they
do today: for a club coach ⌘1 Playlists … ⌘5 Teams, and Organization moves
from ⌘7 to ⌘6 (`PLAIN` in `menu-shortcuts.ts`). `menu.rs` loses the Home
item, `GO_PAGES` there becomes length 5, and its tests change to match.
The Rust and TS lists must stay in step.

## Opening the app (`/`)

`/` stays as a route, but becomes a redirect (a `StartPage` component with
no UI of its own). Every existing `navigate("/")` keeps working
unchanged: the auth deep link (`App.tsx`), the onboarding finish, login and
reset-password, and the three in `my-playlists.tsx`.

Where `/` goes, in order:

1. Still loading the profile → render nothing (same as today).
2. Club player (`!activeOrgIsPersonal && activeOrgRole === "player"`) →
   `/my-playlists` (unchanged).
3. A remembered page for this user and space, if it's still valid →
   that page.
4. Otherwise → `/playlists`.

The redirect uses `replace`, so Back never returns to `/`.

**What's remembered:** the last page the coach was on in this space, written
on every route change, keyed by user and space (localStorage, wrapped in
try/catch like the other prefs). Only these count: the sidebar's pages
(`/playlists`, `/reports`, `/my-playlists`, `/matches`, `/teams` and a team
page under it) and an open game (`/matches/:id`). Everything else
(settings, profile, organization, upload, auth, onboarding) leaves the
remembered page as it was. Route state (`restore`, `createNew` and so on)
is not remembered.

**Playlists reopens the last playlist (Leonard, 2026-11-21).** Playlists has
no memory of its own today: opened without route state it shows "Select a
playlist". From now on, whenever Playlists opens with no playlist asked
for (on launch, from the sidebar, from ⌘1), it opens the coach's
last-opened playlist in this space, the way Notes and Mail do.
`lib/recent-opens` already records playlist opens per user and space (it's
what Search offers first). If that playlist has been deleted or isn't
visible in this space, it falls back to "Select a playlist". Route state
(`restore`, `createNew`, a report view) always wins over the memory. The
choice of which playlist is a pure function in `packages/shared/lib` with
tests.

**Still valid** means: a game must still be in this space's Open games
(`useGameTabs`, read from localStorage at once), otherwise fall back to
`/matches`. A page this role can't see (e.g. `/my-playlists` in a personal
space) falls back to `/playlists`. The choice lives in a pure function in
`packages/shared/lib` (`startPath`), so it can be unit-tested.

**A game deleted on another device** still passes that check, because the
database read that prunes Open games (`checkRestored` in `lib/game-tabs.ts`)
is async. The start page does not wait for it: waiting would cost a
network round trip and a blank window on every launch that ends on a game.
The rare case lands on the game page's existing "not here" state, which
already has a way back. *(My call.)*

**Switching spaces** stays as it is today. This design doesn't change
what happens on a space switch.

## Getting started, in the sidebar

The checklist (`components/getting-started.tsx`) is the one part of Home
that has nowhere else to go, and it's how new coaches learn the basics.
Existing accounts were backfilled as dismissed, so only new signups see it.

- **The card:** at the bottom of the sidebar, above the update card,
  while `profile.onboardingChecklistDismissedAt == null` and the user can
  act in this space (same `canActHere` rule as today). It shows
  "Getting started", "2 of 5", a thin progress bar, and the next step's
  title on a second line ("Import your own game"), so what to do next is
  visible without opening anything. Pressing it opens the checklist in a
  popover anchored to the card (opening to the right, scaling from the
  card). A × on the card (on hover or focus) dismisses it for good, the
  same as the × inside the popover.
- **The popover** holds today's checklist content unchanged: welcome
  line, the "What describes you best?" question for OAuth signups with no
  role, progress, steps (club admins get the org-setup steps), the dismiss
  ×. Pressing a step navigates as today and closes the popover. Finishing
  every step shows today's success toast and the card goes away.
- **It never opens by itself.** Leonard asked for the practice on this
  (2026-11-21), and it points one way:
  - NN/g calls help that appears unasked a "push revelation" and finds it
    intrusive. In their tutorial study, people who went through the
    tutorial did no better (91% task success vs 94% for those who
    skipped it) and rated the tasks as harder.
  - Practitioners (Appcues; Krystal Higgins, *Better Onboarding*) favour
    a checklist that stays visible but doesn't block, plus guidance at
    the moment people act. They keep modals for input that's required.
  - First launch already opens a modal ("Which team do you coach?",
    `TeamStep` in `root-layout.tsx`). A second first-run surface on top
    would stack two interruptions.

  So guidance is "pulled", not "pushed". The card shows the next step,
  and the empty states where coaches act (Playlists with no games, no
  playlists) say what to do there.
- **How long it stays:** until every step is done (today's success toast,
  then the card goes) or the coach dismisses it. Dismissing is per account
  (the existing `onboardingChecklistDismissedAt`) and for good. There's no
  snooze, it never comes back, and it never hides on a timer. Existing
  accounts were backfilled as dismissed, so this only ever reaches new
  signups.
- **Data:** the checklist needs this space's games and playlists, which
  Home used to load. The card loads them itself (`listMatchesLight` with
  `ownOnly`, `listOwnPlaylistsAndShared`), but only while it's shown, so
  existing accounts pay nothing. Home re-read everything on each visit;
  a card that stays mounted has to be told. It refreshes on the events
  Home listened to (`matches-changed`, `demo-seeded`, `playlist-exported`,
  `org-setup-changed`), plus new or existing events for: a playlist
  created, clips added to a playlist from anywhere (the Playlists page and
  the game view's Collect), and a playlist shared (which re-reads
  `hasSharedAnyPlaylist`). Reuse events that already exist for these.
- **Collapsed sidebar:** the card is hidden with the rest of the sidebar.
  The card never opens by itself, collapsed or not.

## Where the rest of Home goes

| Home section | After |
|---|---|
| Next up: import your first game | Playlists with no own games: the right pane's "Select a playlist" empty state becomes "Import your first game" + Import game (+ "Browse the sample game" when the space has one). Library's empty state already does this. |
| Next up: build your first playlist | Playlists' existing empty state ("No playlists yet" + New playlist). |
| Next up: add clips / share / export | Covered by the checklist for new coaches. For everyone else, dropped. |
| Next up: remind players who haven't finished | Already on the Shared playlists dashboard (per playlist). Dropped from here. |
| Team engagement figures | Already on the Shared playlists dashboard. Dropped. |
| Team engagement's "Invite players" (staff who can manage the club) | Shared playlists dashboard toolbar, same people (`activeOrgCanManage`), same action: `navigate("/organization", { state: { invite: true, inviteRole: "player" } })`. (Leonard, 2026-11-21.) |
| Shared reports | Reports page. Dropped. |
| Playlists (6 recent), Recent imports (3) | Playlists page, Library, Open games. Dropped. |
| "Playlists your coach shares live in the X space" | Playlists page, personal space only, for someone who is a player in a club: the same one line with "Open X" above the playlist list. *(My call on placement.)* |
| Toolbar: New playlist, Import game | Sidebar rows and ⌘N / ⌘O. |

## What gets deleted

- `apps/desktop/src/pages/home.tsx`
- `apps/desktop/src/components/home/` (next-action-hero, team-engagement,
  home-reports)
- `packages/shared/lib/home-hero.ts` and its test. Only the desktop Home
  uses it. Check web and mobile again before deleting.
- The Home row and `go-home` everywhere (`menu-shortcuts.ts`, `menu.rs`,
  `menu-handler.tsx` including `COACH_ADMIN_IDS`, `sidebar.tsx`).

## Analytics

- `page_viewed` with `path: "/"` has to be stopped by hand: `PageTracker`
  in `App.tsx` sits outside `<Routes>` and fires on the first commit at
  `/`, before the redirect. Skip `/` there. After that, the first
  `page_viewed` of a session is the page the app opened on.
- Add `start_page_opened { page, restored }` when `/` redirects, so
  "restored vs fell back" can be counted. Add `checklist_opened` for the
  sidebar card. Nothing else is new.
- Update `reference_posthog_analysis` (memory) once it ships.

## Checking it

- **Shared unit tests:** `startPath` (every fallback: no memory, a closed
  game, a page this role can't see, a club player), and the new
  `sidebarPages` and `goKeyOrder` outputs.
- **Cargo:** `menu.rs` accelerator tests with five Go pages. Organization's
  key isn't tested today, so ⌘6 needs a new test, not an edit.
- **Shared unit tests** also cover which playlist Playlists reopens
  (none remembered, deleted, route state wins).
- **Headless specs to change:** `helpers.ts` (signed-in title no longer
  "Home"; `goViaSidebar` loses "Home"), `F-go-keys` (first row is
  Playlists), `F-sidebar-import`, `G-import-guide`, `E-task18-archive`
  (Home's Recent imports part goes), `I-game-tabs` (the "Home marks open
  games" part goes; the Library half stays), `K-search` (start from
  Playlists).
- **Headless specs to add:** the sidebar's New playlist creates a playlist
  from any page, Playlists included (and ⌘N there); relaunch reopens the
  last page, and a closed game falls back to Library; Playlists reopens
  the last playlist; a new account sees the card with its next step, a
  step in the popover closes it and navigates, and × on the card
  dismisses it; Invite players on Shared playlists opens the invite
  dialog.
- **By hand (Leonard):** the real macOS menu (Go items and keys), Windows
  keys, first launch of a fresh signup, the popover over the vibrancy
  sidebar in light and dark.

## Docs

- `CLAUDE.md` (Archived games) says archiving hides a game from "Home's
  recent imports"; drop that.
- `docs/invite-flow.md` mentions Home in four places; update it.
- `docs/search.md` (line 23) and `docs/game-view.md` (lines 116, 145)
  mention Home; update them.
- `docs/desktop-design-audit.md` mentions Home; leave a line saying it was
  removed.

## Left to the builder

- Where exactly the remembered page is written (a small hook in
  `RootLayout`, or the existing `page_viewed` effect in `App.tsx`).
- The popover component (whichever the app's other popovers use) and its
  width (the checklist reads well at about 360px).
- Whether the checklist's markup gets split into a body (for the popover)
  and the old card wrapper (deleted), or is simply rewrapped.
- The names and payloads of the checklist's refresh events, reusing
  existing ones where they exist.
- Order of commits. It should be releasable at every commit, so the
  sidebar and keys change in the same commit that removes the row.

## Library becomes Games (added 2026-11-21)

Leonard asked during the build whether "Games" makes more sense than
"Library", now that Teams and Reports also hold things a coach collects.
It does: a nav label should name what the page holds, and "Library" is
an umbrella. The page lists the coach's imported games, the sidebar
already has **Open games** under it and **Import game** below it, and
the Go menu's other items are named for their contents.

- User-facing only: the sidebar row, the page title, the Go menu item
  ("Games"), and every string that sends the coach "to the Library"
  (relink hints, export errors, the archive button "Bring back to
  Library", "Back to Library", the game picker's empty line, the Teams
  coverage line "in your library"). Each string is rewritten to read
  naturally rather than swapped word for word, through the copywriting
  skill.
- Unchanged: the route `/matches`, the menu id `go-library`,
  `useLibraryGames`, and other identifiers. Renaming them would only
  churn diffs.
- `packages/shared/lib/team-copy.ts` is also touched by the Teams work on
  `feat/team-plays`. Keep that change to one line.
- Docs and CLAUDE.md that name the page "Library" follow.

## Decided in review (2026-11-21)

- Playlists reopens the last-opened playlist whenever it opens without one
  asked for (Leonard).
- The checklist never opens by itself; the card shows the next step
  (Leonard asked for the practice; see above).
- Invite players moves to the Shared playlists dashboard (Leonard).
- My calls: no wait for the deleted-game check at launch; skip `/` in
  `PageTracker`; Playlists takes `createNew`/`highlight` while open; the
  card's next-step line and its ×; the player-club note's placement on
  Playlists.

Sources for the checklist decision:
[NN/g, onboarding tutorials](https://www.nngroup.com/articles/onboarding-tutorials/),
[NN/g, mobile tutorials](https://www.nngroup.com/articles/mobile-tutorials/),
[Appcues, onboarding UI patterns](https://www.appcues.com/blog/user-onboarding-ui-ux-patterns),
[Krystal Higgins on better onboarding](https://blog.adobe.com/en/publish/2022/01/06/krystal-higgins-better-user-onboarding).
