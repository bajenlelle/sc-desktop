# Retire Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the desktop Home page. The app opens where the coach left off, or on Playlists. The sidebar starts with New playlist and Search, and the Getting started checklist moves into a sidebar card.

**Architecture:** `/` becomes a redirect driven by a pure `startPath()` in `packages/shared/lib/start-page.ts`, fed by a per-user, per-space "last page" kept in localStorage. Playlists reopens the last-opened playlist from the existing recent-opens list. The checklist's logic is split from its markup, so a sidebar card with a popover can host it. Home's other sections are dropped, because other pages already cover them.

**Tech Stack:** Tauri 2 (Rust menu in `src-tauri/src/menu.rs`), React 19, react-router, Tailwind/shadcn (`components/ui/popover.tsx`), vitest in `packages/shared`, Playwright headless in `apps/desktop/headless`.

**Spec:** `docs/superpowers/specs/2026-11-21-retire-home-design.md` (read it with this plan).

## Global Constraints

- Branch `feat/no-home` in the main checkout `scoutable/`, cut from local `main` f8d9b87. Commit only; no push.
- Desktop app only. Don't touch `apps/web` or `apps/mobile`.
- `/` stays a route (a redirect). Every existing `navigate("/")` keeps working.
- Every commit builds and is releasable: the Rust `GO_PAGES` and the TS `GO_PAGES` change in the same commit, as do the sidebar rows and the keys.
- localStorage access is wrapped in try/catch, as in `lib/recent-opens.ts`.
- UI: invoke the `apple-design` skill before building UI. Selected rows get neutral fills; the cyan accent goes only on controls. Use `useReducedMotionSafe` and `springs` from `lib/motion`.
- Copy: run the `copywriting` skill over every new string. UI copy is English, sentence case.
- Checks before each commit: `npm test` in `packages/shared`, `npx tsc --noEmit` in `apps/desktop`, plus `cargo test` and `cargo clippy --no-deps -- -D warnings` in `apps/desktop/src-tauri` for Rust changes, plus the headless specs the task names (`npm run headless -- <spec>` in `apps/desktop`; `docs/headless-ui.md`).

## Review Focus

1. **A remembered playlist that no longer exists** (deleted on another device, or moved to another space): Playlists opens with "Select a playlist", with no error toast. Pinned in Task 2.
2. **Switching space while on Playlists:** the reopened playlist must be the new space's last playlist (or none), never the old space's. Pinned in Task 2.
3. **Launch before the space is known** (`activeOrgId` still null): `StartPage` must wait, not fall back to `/playlists` with a null scope and lose the memory. Pinned in Task 6.
4. **`createNew` and the memory:** ⌘N or the sidebar row on a fresh Playlists page opens the new-playlist editor, not the remembered playlist. A temp `temp-…` playlist is never remembered. Pinned in Task 2.
5. **Existing headless specs that assume nothing is selected on Playlists or a Home page:** with reopening and no Home, they break quietly. Task 6 changes the ones that name Home. Task 7 runs the whole suite and fixes whatever reopening disturbs.

---

### Task 1: Pure start-page and last-playlist rules (shared)

**Files:**
- Create: `packages/shared/lib/start-page.ts`
- Modify: `packages/shared/lib/recent-opens.ts`
- Test: `packages/shared/lib/__tests__/start-page.test.ts`, `packages/shared/lib/__tests__/recent-opens.test.ts`

**Interfaces:**
- Produces:
  - `rememberablePath(pathname: string): string | null`: returns the path when it is one of `/playlists`, `/reports`, `/my-playlists`, `/matches`, `/matches/:id`, `/teams`, `/teams/:competitionId/:teamId`, and null for anything else (including `/teams/find/:id`, `/upload`, `/settings…`, `/profile`, `/organization`, `/`, `/auth/…`, `/onboarding`).
  - `startPath(input: StartInput): { path: string; restored: boolean }` with `interface StartInput { remembered: string | null; openGameIds: readonly string[]; clubPlayer: boolean; personal: boolean }`. `restored` is true only when `path === remembered`.
  - `lastOpenedPlaylist(opens: readonly RecentOpen[], playlistIds: ReadonlySet<string>): string | null`: the newest entry of kind `"playlist"` or `"report"` whose id is in `playlistIds`.

- [ ] **Step 1: Write the failing tests**

`start-page.test.ts`:
- `rememberablePath`: `"/playlists"`, `"/matches/abc"`, `"/teams/12/34"` are kept as given; `"/"`, `"/upload"`, `"/settings/move-to-club"`, `"/teams/find/9"`, `"/matches/abc/extra"` → `null`.
- `startPath`:
  - `{ remembered: null, openGameIds: [], clubPlayer: false, personal: false }` → `{ path: "/playlists", restored: false }`
  - club player, with anything remembered → `{ path: "/my-playlists", restored: false }`
  - `remembered: "/reports"` → `{ path: "/reports", restored: true }`
  - `remembered: "/matches/g1"`, `openGameIds: ["g1"]` → `{ path: "/matches/g1", restored: true }`
  - `remembered: "/matches/g1"`, `openGameIds: []` → `{ path: "/matches", restored: false }`
  - `remembered: "/my-playlists"`, `personal: true` → `{ path: "/playlists", restored: false }`
  - `remembered: "/upload"` (not rememberable) → `{ path: "/playlists", restored: false }`

`recent-opens.test.ts`, new `describe("lastOpenedPlaylist")`:
- newest playlist wins over an older one; a newer `"game"`/`"team"` entry is skipped.
- a `"report"` entry counts (its id is the playlist's).
- an id not in `playlistIds` is skipped for the next one; none left → `null`; empty list → `null`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- start-page recent-opens` in `packages/shared`
Expected: FAIL, `startPath`/`rememberablePath`/`lastOpenedPlaylist` not exported.

- [ ] **Step 3: Implement the three functions** in the files above. Add a file header comment in `start-page.ts` that points at the spec.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` in `packages/shared`
Expected: PASS, whole suite.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/lib/start-page.ts packages/shared/lib/recent-opens.ts packages/shared/lib/__tests__/start-page.test.ts packages/shared/lib/__tests__/recent-opens.test.ts
git commit -m "shared: where the desktop opens, and the playlist it reopens"
```

---

### Task 2: Playlists remembers, and takes asks while open

**Files:**
- Modify: `apps/desktop/src/pages/playlists.tsx` (load effect ~778–941, late-arrival handler ~5365–5386, right-pane empty state ~6655, browser column top)
- Create: `apps/desktop/headless/specs/L-playlists-reopen.spec.ts`

**Interfaces:**
- Consumes: `lastOpenedPlaylist` (Task 1); `readRecentOpens`, `recentOpensScope` from `@/lib/recent-opens`.
- Produces: `/playlists` with `state: { createNew: true }` or `state: { restore, highlight }` works whether or not the page is already shown. Task 4 (checklist steps) and Task 6 (sidebar row) rely on this.

- [ ] **Step 1: Write the failing headless spec** `L-playlists-reopen.spec.ts`:
  - `"Playlists reopens the playlist opened last"`: open playlist A from the list, `goViaSidebar("Library")`, then `goViaSidebar("Playlists")`. A's editor is shown (its name is the toolbar heading).
  - `"a deleted remembered playlist opens nothing, quietly"`: in localStorage, set `scoutable_recent_opens:<scope>` to a `playlist` entry with an unknown id, then load `/playlists`. "Select a playlist" is visible and no toast appears.
  - `"New playlist from Playlists itself starts a new one"`: on `/playlists` with A open, press Control+N (Windows user agent, as in `F-go-keys`). The new-playlist name field is focused and A is not the selection.
  - `"a fresh page asked to create doesn't reopen the last one"`: `page.goto("/playlists")` with history state `createNew`, via `page.evaluate` + the router, or by pressing Control+N from Library. The new-playlist editor is shown, not A.
  - `"another space doesn't reopen this space's playlist"`: only if the headless account has two spaces (`test.skip` otherwise). Open A, switch space with the space switcher; A is not shown.
  - `"no games: the right pane says to import first"`: run `pretendImportCount`/an empty space if the helpers allow it; otherwise `test.skip` with a reason. Expect "Import your first game" and an "Import game" link to `/upload`.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run headless -- L-playlists-reopen` in `apps/desktop`
Expected: the first and third tests FAIL (no reopen; ⌘N ignored on Playlists).

- [ ] **Step 3: Reopen the last playlist on load.** In the load effect, when there's no `restore` and no `createNew`, pick `lastOpenedPlaylist(readRecentOpens(recentOpensScope(user?.id, activeOrgId)), new Set(loadedPlaylists.map(p => p.id)))` and select it through the existing `restore` branch, so folders expand and its games' plays load first. Open the editor, not the report.

- [ ] **Step 4: Take `createNew` and `highlight` while open.** Extract `applyHighlight(kind)` from the load effect (the `setOnboardingHighlight` + 6000 ms timer). In the late-arrival effect, read `createNew` and `highlight` alongside `restore`:
  - `createNew` → `handleNewPlaylist()`, deferred until `loading` is false the way `lateRestoreRef` defers.
  - `highlight` with `restore` → `openAsked(...)` then `applyHighlight`.

  The state is still cleared once, as today.

- [ ] **Step 5: Right-pane empty state when the space has no own games.** When `selected === null`, there are no playlists, and the loaded `matches` has no non-demo game, show:
  - title "Import your first game"
  - body "Every clip is generated automatically from the play-by-play."
  - primary "Import game" → `/upload`
  - when a demo game exists, a ghost "Browse the sample game" → `/matches/<demoId>`

  The copy comes from `components/home/next-action-hero.tsx`. Otherwise keep "Select a playlist".

- [ ] **Step 6: The player-club note.** In a personal space, when `myOrgs` has a non-personal org with `role === "player"`, show above the browser list the line Home showed (`pages/home.tsx:303-313`): "Playlists your coach shares live in the {orgName} space." with an "Open {orgName}" text button → `setActiveOrg(orgId)`.

- [ ] **Step 7: Run the spec to verify it passes**, plus the existing Playlists specs.

Run: `npm run headless -- L-playlists-reopen K-add-clips-window K-search` in `apps/desktop`, and `npx tsc --noEmit`
Expected: PASS (skips allowed where the account can't set up the case, each with its reason).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/pages/playlists.tsx apps/desktop/headless/specs/L-playlists-reopen.spec.ts
git commit -m "playlists: reopen the last playlist, and take New playlist while open"
```

---

### Task 3: One event when playlists change

**Files:**
- Create: `apps/desktop/src/lib/playlist-events.ts`
- Modify: `apps/desktop/src/pages/playlists.tsx` (the `trackEvent` sites for `playlist_created` ~4145, ~5109; `clip_added_to_playlist` ~3371, ~3443, ~4772, ~5069, ~5085; `playlist_shared` ~3653), `apps/desktop/src/components/game/use-collect.ts` (~361, ~453, ~465), `apps/desktop/src/pages/my-playlists.tsx` (~360)

**Interfaces:**
- Produces: `PLAYLISTS_CHANGED = "playlists-changed"` and `announcePlaylistsChanged(): void` (dispatches `new CustomEvent(PLAYLISTS_CHANGED)` on `window`). Task 4 listens for it.

- [ ] **Step 1: Create `playlist-events.ts`** with the two exports. Its header comment says it fires when a playlist is created, gets clips, or is shared, from any page.
- [ ] **Step 2: Call `announcePlaylistsChanged()`** right after each `trackEvent` site listed above. These are the existing points where those three things succeed.
- [ ] **Step 3: Verify.** Run `npx tsc --noEmit` in `apps/desktop`, then `git grep -n "announcePlaylistsChanged" apps/desktop/src | wc -l`. Expected: typecheck clean; 16 lines (12 calls, the definition, and 3 imports).
- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/playlist-events.ts apps/desktop/src/pages/playlists.tsx apps/desktop/src/components/game/use-collect.ts apps/desktop/src/pages/my-playlists.tsx
git commit -m "desktop: announce when playlists are made, filled or shared"
```

---

### Task 4: Getting started moves into the sidebar

**Files:**
- Modify: `apps/desktop/src/components/getting-started.tsx` (split it)
- Create: `apps/desktop/src/components/shell/getting-started-card.tsx`
- Modify: `apps/desktop/src/components/shell/sidebar.tsx` (bottom group, above `<UpdateCard />`)
- Modify: `apps/desktop/src/pages/home.tsx` (stop rendering `GettingStarted`, so it isn't shown twice before Task 6 deletes Home)
- Create: `apps/desktop/headless/specs/L-getting-started-card.spec.ts`

**Interfaces:**
- Consumes: `PLAYLISTS_CHANGED` (Task 3); the Task 2 behaviour for the steps' `createNew`/`highlight` navigation on Playlists.
- Produces, from `getting-started.tsx`:
  - `useChecklist(matches: StoredMatch[], playlists: Playlist[]): Checklist`, holding all of today's state, effects, step derivation, celebration and dismiss. It also re-reads `hasSharedAnyPlaylist()` on `PLAYLISTS_CHANGED`. `interface Checklist { show: boolean; steps: Step[]; doneCount: number; next: Step | null; dismiss(): void; open(step: Step): void; /* plus what the body needs: welcome copy, role question state, isClubAdmin */ }`. `next` is the first step that is neither done nor locked.
  - `ChecklistBody({ checklist, onNavigate }: { checklist: Checklist; onNavigate(): void })`: today's markup without the outer card (welcome, role question, progress, steps, ×). `onNavigate` runs after a step navigates.
  - Remove the `GettingStarted` export.
- `GettingStartedCard()` (no props) renders nothing unless `checklist.show`.

- [ ] **Step 1: Write the failing headless spec** `L-getting-started-card.spec.ts`. Give the account an un-dismissed checklist the way existing onboarding specs do; if none can, mock the profile's `onboardingChecklistDismissedAt` via the headless Supabase mock, or `test.skip` with the reason.
  - `"the card shows progress and the next step"`: `aside` contains "Getting started", the "n of m" count, and the next step's title.
  - `"pressing it opens the checklist, and a step closes it and goes there"`: click the card. The popover shows "Welcome to Scoutable" and the steps. Click "Build your first playlist" (or the first open step): the popover closes and the URL is the step's.
  - `"× on the card dismisses it for good"`: hover the card and click "Dismiss". The card is gone, and after a reload it is still gone.
  - `"it never opens by itself"`: on first load after sign-in, no popover is visible.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run headless -- L-getting-started-card`
Expected: FAIL, no card in the sidebar.

- [ ] **Step 3: Split `getting-started.tsx`** into `useChecklist` + `ChecklistBody` as above. Behaviour stays the same; the `playlist-exported` and `org-setup-changed` listeners stay in the hook.

- [ ] **Step 4: Build `GettingStartedCard`.**
  - **Data:** while `profile?.onboardingChecklistDismissedAt == null`, the card loads `listMatchesLight(activeOrgId ?? undefined, { ownOnly: true })` and `listOwnPlaylistsAndShared(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }).playlists`. It reloads them on `matches-changed`, `demo-seeded` and `PLAYLISTS_CHANGED`, and when `activeOrgId` changes.
  - **Look:** a row with "Getting started", "{doneCount} of {steps.length}", a `ProgressBar`, and `next.title` on a second line. A × appears on hover or focus, with `aria-label="Dismiss"`, and calls `checklist.dismiss()`.
  - **Popover:** pressing the card opens `ChecklistBody` in a `Popover` (`side="right"`, `align="end"`, about 360px wide, scaling from the card, plain fade under reduced motion). `trackEvent("checklist_opened")` fires on open. `onNavigate` closes the popover.

- [ ] **Step 5: Mount it in `sidebar.tsx`** in the `mt-auto` group, before `<UpdateCard />`. Remove `<GettingStarted …/>` from `pages/home.tsx`, and on Home show the "Next up" box regardless of `showChecklist`, so Home stays coherent until Task 6.

- [ ] **Step 6: Run to verify it passes**

Run: `npm run headless -- L-getting-started-card` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/components/getting-started.tsx apps/desktop/src/components/shell/getting-started-card.tsx apps/desktop/src/components/shell/sidebar.tsx apps/desktop/src/pages/home.tsx apps/desktop/headless/specs/L-getting-started-card.spec.ts
git commit -m "sidebar: Getting started as a card, its checklist in a popover"
```

---

### Task 5: Invite players on the Shared playlists dashboard

**Files:**
- Modify: `apps/desktop/src/pages/my-playlists.tsx` (the coach toolbar ~472–489)
- Modify: `apps/desktop/headless/specs/` (add to an existing my-playlists spec if there is one, else create `L-shared-invite.spec.ts`)

**Interfaces:**
- Consumes: `activeOrgCanManage` from `useAuth`.

- [ ] **Step 1: Write the failing spec:** `"Invite players on Shared playlists opens the invite dialog"`. As a club admin on `/my-playlists`, click the toolbar's "Invite players". The URL is `/organization` and the invite dialog is open with the Player role. `test.skip` if the headless account can't manage its club.
- [ ] **Step 2: Run it to verify it fails.** Expected: FAIL, no button.
- [ ] **Step 3: Add the button.** When `isCoachOrAdmin && activeOrgCanManage && !activeOrgIsPersonal`, add `<Button variant="ghost" size="sm"><UserPlus />Invite players</Button>` beside the existing `actions`. It calls `navigate("/organization", { state: { invite: true, inviteRole: "player" } })`.
- [ ] **Step 4: Run to verify it passes.** Then run `npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/my-playlists.tsx apps/desktop/headless/specs/
git commit -m "shared playlists: invite players from the dashboard"
```

---

### Task 6: Retire Home

**Files:**
- Create: `apps/desktop/src/pages/start.tsx`, `apps/desktop/src/lib/last-page.ts`
- Modify: `apps/desktop/src/App.tsx` (route `/` → `StartPage`; `PageTracker` skips `/`), `apps/desktop/src/components/root-layout.tsx` (mount the remembering hook), `apps/desktop/src/components/shell/sidebar.tsx`, `apps/desktop/src/components/menu-handler.tsx`, `packages/shared/lib/menu-shortcuts.ts`, `packages/shared/lib/__tests__/menu-shortcuts.test.ts`, `apps/desktop/src-tauri/src/menu.rs`
- Delete: `apps/desktop/src/pages/home.tsx`, `apps/desktop/src/components/home/` (3 files), `packages/shared/lib/home-hero.ts`, `packages/shared/lib/__tests__/home-hero.test.ts`
- Modify headless: `helpers.ts`, `F-go-keys`, `F-sidebar-import`, `G-import-guide`, `E-task18-archive`, `I-game-tabs`, `K-search`
- Create: `apps/desktop/headless/specs/L-start-page.spec.ts`
- Docs: `CLAUDE.md` (Archived games), `docs/invite-flow.md`, `docs/search.md`, `docs/game-view.md`, `docs/desktop-design-audit.md`

**Interfaces:**
- Consumes: `startPath`, `rememberablePath` (Task 1).
- Produces:
  - `lib/last-page.ts`: `lastPageScope = recentOpensScope` (re-export), `readLastPage(scope: string | null): string | null`, `rememberLastPage(scope: string | null, path: string): void`. Key: `scoutable_last_page:${scope}`.
  - `useRememberLastPage(): void`. On each `pathname` change it stores `rememberablePath(pathname)` when non-null, scoped by `user.id` + `activeOrgId`.
  - `StartPage()`.

- [ ] **Step 1: Write the failing tests.**
  - **`menu-shortcuts.test.ts`:**
    - `sidebarPages(coachInClub)` → `["go-playlists", "go-reports", "go-my-playlists", "go-library", "go-teams"]`; `coachAlone` → the same without `go-my-playlists`.
    - `goKeyOrder(playerInClub)` → `["go-my-playlists", "go-playlists", "go-reports", "go-library", "go-teams"]`.
    - The chord table maps `"1"` to `go-playlists` and `"6"` to `go-organization`.
  - **`menu.rs` tests:**
    - Orders without `go-home`: five pages accepted, a sixth id or a duplicate refused.
    - New `fn organization_takes_the_key_after_the_rows()`: `ORGANIZATION_KEY == "CmdOrCtrl+6"`, and it isn't among `go_accelerators(full order)`'s keys.
  - **`L-start-page.spec.ts`:**
    - `"the app opens on Playlists the first time"`: clear `scoutable_last_page:*`, then `goto("/")`. The URL becomes `/playlists`.
    - `"it reopens the last page"`: go to `/reports`, then `goto("/")`. The URL becomes `/reports`.
    - `"a game no longer open falls back to the Library"`: set the last page to `/matches/<id not in open games>`, then `goto("/")`. The URL becomes `/matches`.
    - `"Back never returns to /"`: after the redirect, `page.goBack()` doesn't land on `/`.
    - `"the sidebar starts with New playlist and Search, with no Home"`: the `aside` buttons in order are "New playlist" then "Search"; no "Home" link.
    - `"New playlist in the sidebar starts a playlist from any page"`: click it from Library and from Teams; the new-playlist editor is shown each time.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- menu-shortcuts` in `packages/shared`; `cargo test menu` in `src-tauri`; `npm run headless -- L-start-page`
Expected: FAIL on the new expectations.

- [ ] **Step 3: Remove `go-home`, renumber the keys.**
  - `menu-shortcuts.ts`: drop `"go-home"` from `GO_PAGES`, move `PLAIN["7"]` to `"6"`, update the comment.
  - `menu.rs`:
    - `GO_PAGES: [&str; 5]` without `go-home`.
    - Delete the Home item and its `.item(&go_home)`.
    - Initial keys: Playlists ⌘1, Reports ⌘2, Shared Playlists ⌘3, Library ⌘4, Teams ⌘5.
    - `const ORGANIZATION_KEY: &str = "CmdOrCtrl+6"`, used for Organization.
    - Update the comment about ⌘7.
  - `menu-handler.tsx`: drop `"go-home"` from `COACH_ADMIN_IDS` and its `case`.

- [ ] **Step 4: The sidebar's top rows.** In `sidebar.tsx`, inside the existing `isCoachOrAdmin` block:
  - Put a "New playlist" button before Search, styled exactly like the Search row: `ListPlus` icon in `text-primary`, `Kbd` showing `⌘N` on macOS and `Ctrl N` elsewhere, `aria-keyshortcuts` `Meta+N`/`Control+N`.
  - It calls `navigate("/playlists", { state: { createNew: true } })`. It is never `aria-current`.
  - Remove the `go-home` case and the `Home` icon import.

- [ ] **Step 5: `StartPage` and the memory.**
  - **`StartPage`:**
    - Renders `null` while `profileLoading`, or while `activeOrgId` or `user` is null (Review Focus 3).
    - Then computes `startPath({ remembered: readLastPage(scope), openGameIds: tabs.map(t => t.id), clubPlayer: !activeOrgIsPersonal && activeOrgRole === "player", personal: activeOrgIsPersonal })`, with `tabs` from `useGameTabs(gameTabsScope(user.id, activeOrgId))`.
    - Fires `trackEvent("start_page_opened", { page: path, restored })` once.
    - Returns `<Navigate to={path} replace />`.
  - **Memory:** mount `useRememberLastPage()` in `RootLayout`.
  - **Analytics:** `PageTracker` skips `pathname === "/"`.
  - **Route:** `App.tsx` routes `/` to `<ProtectedRoute><StartPage /></ProtectedRoute>`.

- [ ] **Step 6: Delete Home.** Remove `pages/home.tsx`, `components/home/`, `home-hero.ts` and its test. Run `git grep -n "home-hero\|NextActionHero\|TeamEngagement\|HomeReports\|pages/home"` across `apps packages`. Expected: no hits.

- [ ] **Step 7: Change the headless specs that name Home.**
  - `helpers.ts`:
    - `signedInTitle` becomes "the Main navigation is visible" (`getByRole("navigation", { name: "Main" })`), with the message "signed in".
    - `goViaSidebar`'s type loses `"Home"`.
    - Add `forgetLastPlaces(page)`, which clears `scoutable_last_page:*` and `scoutable_recent_opens:*`, for specs that need a fresh start.
  - `F-go-keys`: the first row is `/playlists`.
  - `F-sidebar-import`: from Playlists, Library and Teams.
  - `G-import-guide` (~220): wait for the Main navigation, not the Home heading.
  - `E-task18-archive`: drop the Home "Recent imports" part (~259-262); keep the Library and Add clips parts.
  - `I-game-tabs`: the Home half of "the Library and Home mark the games that are open" goes, and the title becomes Library only. The `goViaSidebar(page, "Home")` at ~198 becomes Library.
  - `K-search`: the Home starts (~102, ~178, ~225, ~400, ~492) start from Library. Test titles say "from Library".

- [ ] **Step 8: Docs.**
  - `CLAUDE.md` Archived games: drop "Home's recent imports".
  - `docs/invite-flow.md`: Home → the start page / Playlists.
  - `docs/search.md:23` and `docs/game-view.md:116,145`: drop or replace Home.
  - `docs/desktop-design-audit.md`: one line saying Home was retired on 2026-11-21, with a link to the spec.

- [ ] **Step 9: Run everything for this task**

Run, in order: `npm test` in `packages/shared`; `npx tsc --noEmit` in `apps/desktop`; `cargo test` + `cargo clippy --no-deps -- -D warnings` in `src-tauri`; `npm run headless -- L-start-page F-go-keys F-sidebar-import G-import-guide E-task18-archive I-game-tabs K-search`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add -A apps/desktop packages/shared CLAUDE.md docs
git commit -m "desktop: retire Home; open where the coach left off, New playlist first"
```

---

### Task 6b: Library becomes Games

**Files:**
- Modify (labels and copy): `apps/desktop/src/components/shell/sidebar.tsx`, `apps/desktop/src/pages/matches.tsx` (title), `apps/desktop/src/pages/match-detail.tsx` ("Back to Library"), `apps/desktop/src/components/match-row.tsx` ("Bring back to Library"), `apps/desktop/src/components/game/game-tab-picker.tsx`, `apps/desktop/src/components/game/game-toolbar-parts.tsx`, `apps/desktop/src/components/game/use-collect.ts`, `apps/desktop/src/components/editor/clip-browser-panel.tsx`, `apps/desktop/src/components/send-to-phone-dialog.tsx`, `apps/desktop/src/lib/clip-and-ship.ts`, `apps/desktop/src/lib/export.ts`, `apps/desktop/src/pages/playlists.tsx` (~5632), `apps/desktop/src-tauri/src/menu.rs` (Go item label), `apps/desktop/src-tauri/src/lib.rs:212`, `packages/shared/lib/team-copy.ts:22-24` (+ its test)
- Modify: every headless spec and helper that finds the page by the name "Library" (`git grep -l Library apps/desktop/headless`)
- Docs: `CLAUDE.md`, `docs/*.md` where "Library" names the page

**Interfaces:** none new. `/matches`, `go-library`, `useLibraryGames` and other identifiers keep their names. `goViaSidebar`'s link type changes `"Library"` → `"Games"`.

- [ ] **Step 1: Find every user-facing "Library".** Run `git grep -n -i library -- apps/desktop/src apps/desktop/src-tauri/src packages/shared/lib`. List each user-facing string, leaving out identifiers and comments.
- [ ] **Step 2: Rewrite them.** Invoke the `copywriting` skill, then rewrite each string to read naturally with the page called "Games". For example: "Open the game in the Library to relink it" → "Open the game to relink its video"; "Bring back to Library" → "Bring back to Games"; "No games in the Library yet." → "No games yet."; the Teams line "3 in your library" → "3 imported". Change one line in `team-copy.ts` and update its test expectation.
- [ ] **Step 3: Labels.** Change the sidebar row label, the `matches.tsx` toolbar title, and the `menu.rs` Go item to "Games".
- [ ] **Step 4: Specs.** Update `helpers.ts` (`goViaSidebar` type and mapping; any `/^(…|Library)$/` title) and each spec that names the page or row "Library".
- [ ] **Step 5: Docs.** In `CLAUDE.md` and in `docs/` files where "Library" names the desktop page, write "Games". Leave history alone (old specs and plans).
- [ ] **Step 6: Verify.** Run `git grep -n '"Library"' -- apps/desktop/src apps/desktop/src-tauri/src` (expected: nothing user-facing left), `npm test` in `packages/shared`, `npx tsc --noEmit` in `apps/desktop`, `cargo test` in `src-tauri`, and `HEADLESS_PORT=1437 npm run headless -- F-go-keys F-sidebar-import E-task18-archive I-game-tabs K-search L-start-page`. All pass.
- [ ] **Step 7: Commit**

```bash
git add -A apps/desktop packages/shared CLAUDE.md docs
git commit -m "desktop: the Library is called Games"
```

---

### Task 7: Whole-suite check

**Files:** whatever specs the run shows are disturbed by reopening (Review Focus 5).

- [ ] **Step 1: Run the full suite.** Run `npm run headless` in `apps/desktop` (both browsers), and `npm test` in `packages/shared`. Expected: all pass, apart from specs that are known to be flaky (rerun those once; a second failure is real).
- [ ] **Step 2: Fix each real failure at its cause.** A spec that assumes nothing is selected on Playlists calls `forgetLastPlaces(page)` before loading it. A product bug gets fixed in product code with a test. Never loosen an assertion to pass.
- [ ] **Step 3: Rerun what you touched.** Expected: PASS.
- [ ] **Step 4: Commit** (only if anything changed)

```bash
git add apps/desktop/headless
git commit -m "headless: specs start fresh where reopening would change them"
```

- [ ] **Step 5: Hand-check list for Leonard** (don't drive his screen; `npm run tauri dev` in `apps/desktop`, then hand over):
  1. The native Go menu has no Home, and ⌘1–⌘5 and ⌘6 for Organization work.
  2. Quit on a game, relaunch: the game is back. Quit on Reports, relaunch: Reports.
  3. Playlists reopens the last playlist; ⌘N on Playlists starts a new one.
  4. For a fresh signup: the checklist card, the popover over the sidebar vibrancy in light and dark, and the card's ×.
  5. Windows: Ctrl+1…6 and Ctrl+N.
