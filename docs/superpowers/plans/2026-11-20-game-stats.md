# Game Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third view on the desktop game page, Game | Stats | Details, that reads one game as numbers and opens the exact plays behind any number in the Game view.

**Architecture:** Three pure, tested modules in `packages/shared/lib` count everything from the game's stored plays (`game-box.ts`, `game-shots.ts`, `game-lineups.ts`). A new `picked` member of `GameFilters` carries a named set of event ids from Stats to the Game view. The desktop draws the view in `apps/desktop/src/components/game/stats/`, one file per section, hosted by `pages/game.tsx`.

**Tech Stack:** TypeScript, React 19, Tailwind/shadcn, Tauri 2 desktop, vitest, Playwright headless specs.

**Spec:** `game-stats-design.md` (approved 2026-11-20). Task 1 moves it into the repo as `docs/superpowers/specs/2026-11-20-game-stats-design.md`; read it beside this plan.

## Global Constraints

- Work in a worktree off local `main` (`0baa492`, holds the game-wayfinding merge; `origin/main` doesn't yet). Never branch from `feat/stat-keeper`. The `scoutable/` checkout itself stays on `main` and is not written to. Nothing is pushed.
- Desktop only. Pure logic in `packages/shared/lib`, never importing app or platform code; `npm test` and `npm run typecheck` in `packages/shared`, `npx tsc --noEmit` in `apps/desktop`.
- Numbers count stored plays. Points: made `2pt` = 2, `3pt` = 3, `freethrow` = 1. `isSuccessful` means made or missed only for the three shot types. `isBookkeepingEvent` rows are skipped. A row with `player: null` is a team stat, credited by `eventTeam.teamNumber`.
- A number's value equals the size of the play set it opens (for shooting cells: attempts = set size, makes = the made ones in it).
- No percentage for one player in one game. Team percentages show as whole numbers (`56%`), rates to two decimals (`1.18`, `0.28`).
- A column whose values are unknown for every player is dropped (a source without misses, rebounds or assists).
- UI follows the `scoutable:apple-design` skill and the app's rules: hover, pressed and selected fills are neutral (`fill-1`/`fill-2`); the accent only on controls; team colours from `components/game/team-tints.ts`; no colour says good or bad; numbers use the `nums` (tabular) class. A clickable cell answers on pointer-down, has a focus ring (`focus-visible:ring-2 focus-visible:ring-selection`) and an accessible name. Nothing animates in; the switch swaps views at once. All colours via theme tokens, so light, dark and the eight themes hold.
- Copy is English, sentence case, written with the `scoutable:copywriting` skill.
- One `<video>` per game page: the Stats view has none.

## Review Focus

1. **A game imported before September 2026** (no `onCourtHome/Away`, no `x/y`): Shots, Lineups and the bench figure are left out with one line each, starters fall back to points order, and nothing throws. Tested in Tasks 2, 3, 4 and 9.
2. **Overtime**: the line score gets an OT column per overtime; lineup time uses the overtime's own length; quarter names come from `periodLabel`. Tested in Tasks 2, 4 and 6.
3. **A player the box score lists who has no play of their own** gets a row with zeros and the box score's minutes. Tested in Task 8.
4. **The box score can't be read** (offline, `hosted_layout_changed`, a Profixio game): MIN shows "–", +/- falls back to the on-floor stints, the rest is unchanged. Tested in Task 8.
5. **A picked set while the coach then changes another filter**: both apply (AND); clearing the chip leaves the other filters; the chip survives a switch to Stats and back for the app session. Tested in Task 5.

---

### Task 1: Worktree, docs, the box-score counter

**Files:**
- Create: `docs/superpowers/specs/2026-11-20-game-stats-design.md` (copy of `../game-stats-design.md`), `docs/superpowers/plans/2026-11-20-game-stats.md` (copy of this plan)
- Create: `packages/shared/lib/game-box.ts`
- Test: `packages/shared/lib/__tests__/game-box.test.ts`

**Interfaces:**
- Produces:
```ts
export type BoxStat = "pts" | "fg" | "tp" | "ft" | "oreb" | "dreb" | "reb" | "ast" | "tov" | "stl" | "blk" | "pf";
/** A number and the plays it stands for. Shooting cells: value = makes, attempts = eventIds.length. */
export interface BoxCell { value: number; attempts?: number; eventIds: readonly number[] }
export interface BoxPlayer { personId: number; name: string; number: string; side: 1 | 2; starter: boolean; cells: Record<BoxStat, BoxCell> }
export interface BoxTeam { side: 1 | 2; players: BoxPlayer[]; teamRow: Pick<Record<BoxStat, BoxCell>, "oreb" | "dreb" | "reb" | "tov">; totals: Record<BoxStat, BoxCell> }
export interface GameBox { home: BoxTeam; away: BoxTeam; hasFives: boolean; hasMisses: boolean }
export function gameBox(events: readonly PlayByPlayEvent[]): GameBox;
/** "Lind: three-point attempts". */
export function statSetName(who: string, stat: BoxStat): string;
export const STAT_WORDS: Record<BoxStat, string>;
```

- [ ] **Step 1: Create the worktree** with `superpowers:using-git-worktrees`, branch `feat/game-stats` from local `main`. Copy the spec and this plan into the paths above. `npm install` at the root if `node_modules` is missing.

- [ ] **Step 2: Write the failing tests** in `game-box.test.ts`, building plays with a `play()` helper like `game-flow.test.ts`'s (player objects with `playerId`, `pno`, names, `teamNumber`):
  - `"counts a player's line from their plays"`: two made twos, one missed three, one made FT, one missed FT, an assist, a defensive rebound → `pts.value 5`, `fg {value 2, attempts 3}`, `tp {value 0, attempts 1}`, `ft {value 1, attempts 2}`, `ast.value 1`, `dreb.value 1`, `reb.value 1`.
  - `"each cell's plays are exactly what it counts"`: for every player and every stat, `pts.eventIds` are the made shots and FTs; for `fg`/`tp`/`ft`, `eventIds.length === attempts`; for the rest `eventIds.length === value`.
  - `"team points equal gameFlow's final"`: on a hand-built four-quarter game, `sum(players.pts) === gameFlow(events).final.home` (and away).
  - `"team rebounds and turnovers go to the team row"`: a `rebound`/`offensive` and a `turnover` with `player: null`, `eventTeam.teamNumber 2` → `away.teamRow.oreb.value 1`, `tov.value 1`; totals include them.
  - `"bookkeeping rows are skipped"`: an `offensivedeadball` rebound counts nowhere.
  - `"starters are the first five on the floor"`: plays carrying `onCourtHome` → those five `starter: true`, first in `players`, the rest after by points; `hasFives: true`.
  - `"without fives players sort by points"`: no `onCourt*` on any play → `hasFives: false`, no starters, `players` by `pts` descending, then name.
  - `"a game with no misses reports it"`: only made shots → `hasMisses: false`.
  - `statSetName("Lind", "tp") === "Lind: three-point attempts"`.

- [ ] **Step 3: Run** `npx vitest run lib/__tests__/game-box.test.ts` in `packages/shared`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement `game-box.ts`.** `STAT_WORDS`: pts "points", fg "shots", tp "three-point attempts", ft "free throws", oreb "offensive rebounds", dreb "defensive rebounds", reb "rebounds", ast "assists", tov "turnovers", stl "steals", blk "blocks", pf "fouls". `fg` counts `2pt` and `3pt`; `pf` counts `foul` (not `foulon`). A player's side is `player.teamNumber`. Names via `playerName`, numbers via `String(pno)`.

- [ ] **Step 5: Run** the test file, then `npm test` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 6: Commit** `docs/superpowers` and the two `game-box` files: `"shared: count a game's box score from its plays, each number with its plays"`.

### Task 2: Team factors and where the points came from

**Files:**
- Modify: `packages/shared/lib/game-box.ts`
- Test: `packages/shared/lib/__tests__/game-box.test.ts`

**Interfaces:**
- Consumes: `GameBox`, `BoxCell` (Task 1); `gameFlow` (`game-flow.ts`).
- Produces:
```ts
export interface TeamFactors { possessions: number; ppp: number | null; efg: number | null; tovRate: number | null; orebPct: number | null; ftRate: number | null }
export function teamFactors(box: GameBox): { home: TeamFactors; away: TeamFactors };
export type PointsFrom = "paint" | "second_chance" | "fast_break" | "turnovers" | "bench";
/** A figure is null when the game can't tell it (no fives for bench, no qualifier anywhere for turnovers). */
export function pointsFrom(events: readonly PlayByPlayEvent[], box: GameBox): Record<PointsFrom, { home: BoxCell; away: BoxCell } | null>;
export interface QuarterCell { period: number; home: BoxCell; away: BoxCell }
export function quarterPoints(events: readonly PlayByPlayEvent[]): QuarterCell[];
```

- [ ] **Step 1: Write the failing tests:**
  - `"possessions follow FGA − OREB + TO + 0.44 × FTA"`: a team with 80 FGA, 10 OREB, 12 TO, 20 FTA → `possessions 90.8`; `ppp` = points ÷ 90.8.
  - `"eFG counts a three as one and a half"`: 30 of 70 with 10 threes → `efg ≈ 0.5`.
  - `"offensive rebounds won include team rebounds"`: home OREB 12 (2 of them team), away DREB 28 → `home.orebPct === 12/40`.
  - `"a factor with nothing to divide by is null"`: a team with 0 FGA → `efg null`, `ftRate null`.
  - `"points from the paint, second chance and fast break read the qualifiers"`: made shots and FTs carrying `pointsinthepaint`, `2ndchance`, `fastbreak` sum per team, each cell's `eventIds` the made plays.
  - `"points from turnovers are null when no play in the game carries the qualifier"` and counted when one does (`fromturnover`).
  - `"bench points are points by players who didn't start"`; null when `box.hasFives` is false.
  - `"quarter points cover overtime"`: a game with period 5 → five `QuarterCell`s; each team's sum equals `gameFlow(events).periods[i].home` / `.away`.

- [ ] **Step 2: Run** the file. Expected: FAIL.

- [ ] **Step 3: Implement** the three functions in `game-box.ts`. Points from free throws count toward a figure when the FT carries the qualifier (the feed marks second-chance and fast-break FTs).

- [ ] **Step 4: Run** the file, `npm test`, `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**: `"shared: a game's four factors, where its points came from, and points by quarter"`.

### Task 3: Shots and zones

**Consumes:** `BoxCell` (Task 1).

**Files:**
- Create: `packages/shared/lib/game-shots.ts`
- Test: `packages/shared/lib/__tests__/game-shots.test.ts`

**Interfaces:**
- Produces:
```ts
/** Court measures in metres (FIBA): 28 × 15, basket centre 1.575 from the baseline. */
export const COURT_LENGTH_M = 28; export const COURT_WIDTH_M = 15; export const BASKET_FROM_BASELINE_M = 1.575;
/** Shots this close to the basket count as at the rim. Confirmed in Step 1. */
export const RIM_RADIUS_M: number;
export type ShotZone = "rim" | "mid" | "three";
export interface ChartShot { eventId: number; personId: number | null; side: 1 | 2; made: boolean; x: number; y: number; zone: ShotZone }
/** Positions on one half court, basket at the left (x 0–50). Null when the play has no position. */
export function chartShot(e: PlayByPlayEvent): ChartShot | null;
export function gameShots(events: readonly PlayByPlayEvent[]): { home: ChartShot[]; away: ChartShot[]; hasPositions: boolean };
export function zoneCells(shots: readonly ChartShot[]): Record<ShotZone, BoxCell>;
```

- [ ] **Step 1: The data look (needs Leonard's go-ahead).** Ask Leonard in chat before touching staging (memory `feedback_staging_probes_concurrency`). With a yes, one read-only `select x, y, area, type, is_successful, on_court_home, on_court_away, qualifiers from play_by_play_events where match_id = <a Genius game imported since 2026-09> ` on staging (connection recipe in memory `reference_staging`). Write down, in the commit message of Step 5 only (nothing from the rows is committed): which x the basket sits near for each team per half, whether every play carries five ids per side, the `area` values seen with their distances, and whether `fromturnover` appears. Set `RIM_RADIUS_M` so the feed's `underbasket` shots fall inside it (start from 1.25, the no-charge arc); if Leonard says no, keep 1.25 and say so in the commit.

- [ ] **Step 2: Write the failing tests:**
  - `"a shot at the far end folds onto the near basket"`: `x 93, y 54` → `x 7, y 46`; `x 6, y 54` stays.
  - `"zones: rim by distance, three by type"`: a `2pt` at the basket → `rim`; a `2pt` at `x 20, y 50` → `mid`; any `3pt` → `three`.
  - `"a play with no position has no chart shot"` and `gameShots` reports `hasPositions: false` when no shot has one.
  - `"free throws are not chart shots"`.
  - `"zone cells count makes of attempts"`: two rim makes and a miss → `rim {value 2, attempts 3, eventIds length 3}`.

- [ ] **Step 3: Run.** Expected: FAIL.

- [ ] **Step 4: Implement.** Distance in metres: `dx = x/100 × COURT_LENGTH_M − BASKET_FROM_BASELINE_M`, `dy = (y/100 − 0.5) × COURT_WIDTH_M` after folding.

- [ ] **Step 5: Run** the file, `npm test`, `npm run typecheck`; commit: `"shared: a game's shots on one half court, by zone"` (with the data-look notes from Step 1 in the body).

### Task 4: Lineups

**Files:**
- Create: `packages/shared/lib/game-lineups.ts`
- Test: `packages/shared/lib/__tests__/game-lineups.test.ts`

**Interfaces:**
- Consumes: `gameFlow`, `periodLengthSeconds`, `clockSeconds` (`game-flow.ts`).
- Produces:
```ts
export interface Lineup { side: 1 | 2; personIds: readonly number[]; seconds: number; plusMinus: number | null; eventIds: readonly number[] }
/** Fives by time on the floor, longest first. Empty when the game has no fives. */
export function gameLineups(events: readonly PlayByPlayEvent[]): { home: Lineup[]; away: Lineup[] };
export const LINEUP_MIN_SECONDS = 120;
export const LINEUPS_SHOWN = 5;
```

- [ ] **Step 1: Write the failing tests:**
  - `"a five's time runs from its first play to the next five's"`: Q1 (600 s) where five A is on plays at 10:00…6:00 and five B from 6:00 on → A 240 s, B 360 s.
  - `"time is the game clock's, period by period"`: the period start to the first play goes to the first play's five; the last play to the period end goes to the last one's.
  - `"overtime uses its own length"`: an OT period of 300 s.
  - `"plus-minus is the score change while the five was on"`, from the team's side.
  - `"the five is the same whatever order the feed lists it"` (ids sorted).
  - `"no fives, no lineups"`.
  - `"each lineup's plays are the plays it was listed on"`.

- [ ] **Step 2: Run.** Expected: FAIL.

- [ ] **Step 3: Implement.** In game order (`gameFlow(events).order`), within each period: the stretch between consecutive plays belongs to the five on the later play; the stretch from period start to the first play to that play's five; from the last play to period end to the last play's five. Plays without fives change nothing. `plusMinus` from `flow.scores` over the five's plays.

- [ ] **Step 4: Run** the file, `npm test`, `npm run typecheck`; commit: `"shared: a game's lineups with time and plus-minus"`.

### Task 5: The picked set in the Game view

**Files:**
- Modify: `packages/shared/lib/game-list.ts` (`GameFilters`, `EMPTY_GAME_FILTERS`, `gameFiltersActive`, `keepPlay`)
- Modify: `apps/desktop/src/components/game/game-filters.tsx` (the `filtered` row), `game-watch-view.tsx` (new prop), `packages/shared/types/analytics.ts` (`game_view_filtered` gains `picked`)
- Modify: any other `GameFilters` literal `tsc` flags (filter presets, headless mocks)
- Test: `packages/shared/lib/__tests__/game-list.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PickedPlays { name: string; eventIds: ReadonlySet<number> }
// GameFilters gains: picked: PickedPlays | null   (EMPTY: null)
// GameWatchView gains prop: startFilters?: GameFilters | null  — used instead of the remembered filters when given
```

- [ ] **Step 1: Write the failing tests** in `game-list.test.ts`:
  - `"a picked set keeps only its plays"`.
  - `"a picked set combines with the other filters"`: picked + team 1 → the picked plays of the home team.
  - `"a picked set makes the list filtered"`: `gameFiltersActive({...EMPTY_GAME_FILTERS, picked})` is true, and `gameRows` keeps every period's frame around it.

- [ ] **Step 2: Run** `npx vitest run lib/__tests__/game-list.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** in `game-list.ts`; then `npx tsc --noEmit` in `apps/desktop` and add `picked: null` wherever it flags a literal.

- [ ] **Step 4: The chip.** In `GameFilterBar`'s `filtered` row, when `filters.picked`, show its name as the first item: a neutral pill with the name (truncated, full name as tooltip) and a ✕ button "Clear {name}" that sets `picked: null` and keeps the rest. The row's existing Clear still clears everything. `game_view_filtered` sends `picked: boolean`.

- [ ] **Step 5: `startFilters`.** `GameWatchView` uses `startFilters` for its first filters when given, even with a `startEventId` (today a link to a play drops the remembered filters; a picked set must not be dropped).

- [ ] **Step 6: Run** `npm test` and `npm run typecheck` in `packages/shared`, `npx tsc --noEmit` in `apps/desktop`. Expected: PASS. Commit: `"game view: a named set of plays as one filter"`.

### Task 6: The Stats view, its switch, and the score

**Files:**
- Modify: `apps/desktop/src/components/game/game-view-switch.tsx` (`GameViewMode = "game" | "stats" | "details"`)
- Modify: `apps/desktop/src/pages/game.tsx`, `apps/desktop/src/lib/game-tabs.ts` (`GameViewMemory.stats`)
- Create: `apps/desktop/src/components/game/stats/game-stats-view.tsx`, `stats/score-section.tsx`, `stats/stat-cell.tsx`
- Modify: `packages/shared/types/analytics.ts`

**Interfaces:**
- Consumes: `quarterPoints` (Task 2), `gameFlow`, `flowChart`, `PickedPlays` (Task 5), `periodLabel`.
- Produces:
```tsx
export function GameStatsView(props: { match: StoredMatch; viewSwitch: ReactNode; onOpenPlays: (set: { name: string; eventIds: readonly number[] }) => void }): JSX.Element;
/** A number that opens plays: a button with press feedback, focus ring and accessible name; a zero is dimmed and inert. */
export function StatCell(props: { cell: BoxCell; label: string; display: string; onOpen: (eventIds: readonly number[]) => void; className?: string }): JSX.Element;
// GameViewMemory gains: stats: { top: number; season: boolean } | null
```

- [ ] **Step 1: The switch.** Add the Stats option between Game and Details: icon `ChartColumn` (lucide), title tooltip "Box score, shots and lineups". It is shown for every game.

- [ ] **Step 2: The host.** In `pages/game.tsx`: `?view=stats` and a remembered `stats` view open Stats; the load effect reads the game for Stats as it does for Game; the opening rule is unchanged. Add `openPlays(set)`: write `stats` scroll into `rememberGameView`, then set params `view=game`, `play=<first eventId in game order>`, replace, and pass `startFilters = {...EMPTY_GAME_FILTERS, picked: {name, eventIds: new Set(ids)}}` to `GameWatchView` through router state. A single shot opens with `play` alone.

- [ ] **Step 3: The view frame.** `GameStatsView`: same `Toolbar` as the other views (back button, switch, title), `PageContent width="wide"`, sections stacked with `space-y-7` and `GroupHeader` titles: "Score", "Why it went that way", "Players", "Shots", "Lineups" (later tasks fill them). A game with no plays shows `EmptyState` ("No plays from the league for this game" with a line saying stats come from the league's play-by-play). Scroll position restored from `GameViewMemory.stats`.

- [ ] **Step 4: The score.** `score-section.tsx`: the line score (a column per period via `periodLabel`, then T, the total larger), each quarter figure a `StatCell` opening "{team}: points in {Q2}"; beside it the lead graph from `flowChart` at a fixed height of 96 px with the strip's team tints, runs shaded with their score as `StatCell`-like targets opening "{13–0} run in {Q4}" (every play from `fromEventId` to `toEventId`); under it "Largest lead {team} +{n} · {n} lead changes · {n} ties". Nothing drawn when `gameFlow().source === "none"`.

- [ ] **Step 5: Analytics.** `game_stats_viewed` (entry, has_shots, has_lineups, minutes_source: box | stints | none) once per visit; `game_stats_plays_opened` (kind: player_stat | team_stat | shot | zone | lineup | quarter | run, stat) from `onOpenPlays`.

- [ ] **Step 6: Check** `npx tsc --noEmit` in `apps/desktop`, then the headless smoke spec `npm run headless -- smoke`. Expected: PASS. Commit: `"game page: a Stats view with the score by quarter and the lead graph"`.

### Task 7: Why it went that way

**Files:**
- Create: `apps/desktop/src/components/game/stats/factors-section.tsx`
- Modify: `stats/game-stats-view.tsx`

**Interfaces:**
- Consumes: `teamFactors`, `pointsFrom` (Task 2), `StatCell` (Task 6).

- [ ] **Step 1: Build the section.** Five rows in the spec's order (points per possession, shooting (eFG%), turnover rate, offensive rebounds won, free-throw rate): home value, a bar growing leftward, the label centred, a bar growing rightward, away value. Bars scaled per row to the larger of the two; the better side's value in medium weight (lower is better for turnover rate). Each label has a tooltip with its plain meaning (copywriting skill). A null value shows "–" and no bar. Under the rows, muted: "About {n} possessions each" (mean, rounded).

- [ ] **Step 2: Points from.** A second, quieter line: paint, second chance, fast break, turnovers, bench, each "{home}–{away}" where each figure is a `StatCell` opening "{team}: paint points" etc. A null figure is left out.

- [ ] **Step 3: Check** `npx tsc --noEmit`; look at it in `npm run headless` screenshots in light and dark. Commit: `"stats: the four factors and where the points came from"`.

### Task 8: Players

**Files:**
- Create: `apps/desktop/src/components/game/stats/players-section.tsx`, `stats/use-game-box-score.ts`
- Modify: `stats/game-stats-view.tsx`

**Interfaces:**
- Consumes: `gameBox`, `statSetName` (Task 1); `onCourtStints`; `loadGameStats`, `loadSeasonPlayers`, `seasonOf` (`apps/desktop/src/lib/stats-card-data.ts`); `useLeagues` (`lib/use-leagues.ts`); `LEADER_MIN_3PA`.
- Produces:
```ts
/** Minutes and plus-minus from the league's box score, by personId; status says which source the table shows. */
export function useGameBoxScore(match: StoredMatch): { byPerson: ReadonlyMap<number, { min: number | null; pm: number | null; number: string | null; name: string }>; status: "reading" | "box" | "stints" | "none" };
```

- [ ] **Step 1: The hook.** `loadGameStats(match, leagues)` once; `status "box"` when it answers with `source "genius_hosted"`, `"stints"` when it fails or has no minutes and the game has fives, else `"none"`. Players the box score lists with no play of their own are returned too, so the table adds them.

- [ ] **Step 2: The table (Game).** One table per team, home first, the team name as its header. Columns: #, Player, MIN, PTS, FG, 3P, FT, OREB, DREB, AST, TO, STL, BLK, PF, +/-, Season PTS. Starters, then bench by MIN (by PTS without fives); then a Team row (OREB, DREB, TO) and Totals. FG/3P/FT as "made/attempts". Every number a `StatCell` opening `statSetName(name, stat)`; the name opens all the player's plays; MIN and +/- open the plays during the player's stints ("{name}: on the floor"). MIN "–" while reading or when unknown; +/- from stints when the box score has none. Columns unknown for every player are dropped. Header click sorts (largest first, again for smallest), for the visit. The # and Player columns stay put (`sticky left-0` with the row's background) while the rest scrolls sideways.

- [ ] **Step 3: Season.** A `SegmentedControl` "Game | Season" above the tables, remembered in `GameViewMemory.stats.season`. Season reads `loadSeasonPlayers(seasonOf(match, leagues).competitionId)` and shows GP, MPG, PPG, RPG, APG, SPG, BPG, TOPG, 3PM/G, 3PA/G, 3P% (only from `LEADER_MIN_3PA` attempts, else "–"), FT%. In Game, Season PTS is PPG, muted. Season numbers are plain text, not buttons. With no season for the game (`seasonOf` null) the control is not shown and Season PTS is dropped; a failed read says so in one muted line with a Try again button. Choosing Season sends `game_stats_season_shown`.

- [ ] **Step 4: Check** `npx tsc --noEmit`; headless screenshots at the 1024 px minimum window. Commit: `"stats: both teams' players, with the league's minutes and season averages"`.

### Task 9: Shots and lineups

**Files:**
- Create: `apps/desktop/src/components/game/stats/shots-section.tsx`, `stats/half-court.tsx`, `stats/lineups-section.tsx`
- Modify: `stats/game-stats-view.tsx`

**Interfaces:**
- Consumes: `gameShots`, `zoneCells` (Task 3), `gameLineups`, `LINEUP_MIN_SECONDS`, `LINEUPS_SHOWN` (Task 4), `StatCell`.

- [ ] **Step 1: Shots.** Two half courts side by side (home left), drawn in SVG with FIBA lines (`half-court.tsx`, lines in `separator-strong`). Made = filled dot, missed = ring, in the team tint. A `PopUpButton` per court: "All players" or one player. Each dot is a button with a tooltip "{name} · {3PT jump shot} · Q2 4:12" opening that one play; under the court "At the rim {m/a} · Mid-range {m/a} · Threes {m/a}", each a `StatCell` ("{team}: threes"). Without positions: one muted line instead, "Shot positions come with games imported since September 2026." (wording via copywriting skill).

- [ ] **Step 2: Lineups.** Two tables side by side: On the floor (shirt numbers joined by " · ", names in the tooltip), Time (m:ss), +/-. The `LINEUPS_SHOWN` longest with at least `LINEUP_MIN_SECONDS`; "Show all {n}" reveals the rest in place. A row opens "Lineup {4 · 7 · 11 · 15 · 23}". Under them: "One game is too little to rate a lineup." Without fives: one muted line instead, as for shots.

- [ ] **Step 3: Check** `npx tsc --noEmit`; headless screenshots of a Genius game and the sample game (old shape). Commit: `"stats: shots by zone and the lineups used"`.

### Task 10: Spec, docs, real app

**Files:**
- Create: `apps/desktop/headless/specs/O-game-stats.spec.ts`
- Modify: `docs/game-view.md` (a "Stats" section; remove "lineup tables and a shot chart" from Not built), `CLAUDE.md` (the docs line for `game-view.md` mentions Stats)

- [ ] **Step 1: The spec.** Using `openLibraryGame` and `showGameView`'s patterns: the switch offers Game, Stats, Details; Stats shows Score, Players; a click on a player's PTS lands on Game with a chip named "{name}: points" and exactly that many play rows (`playRows`); the chip's ✕ clears it; switching back to Stats restores the scroll; the sample game shows the no-positions line instead of courts. Analytics recorded through `recordAnalytics`.

- [ ] **Step 2: Run** `npm run headless -- O-game-stats` (WebKit and Chrome). Expected: PASS.

- [ ] **Step 3: Docs.** The Stats section in `docs/game-view.md`: what each section counts and from where, the picked set, the analytics events, and the decisions from the spec's Approaches.

- [ ] **Step 4: The real app.** `npm run tauri dev` in `apps/desktop`, hand Leonard a checklist at once (memory `feedback_dont_wait_for_dev_app`): open a recent Genius game on Stats; light and dark; the 1024 × 640 window; a click from each section into the Game view and back; an old import. Don't drive his screen.

- [ ] **Step 5: Final checks** — `npm test`, `npm run typecheck` (shared), `npx tsc --noEmit` (desktop). Commit: `"stats: headless spec and docs"`.
