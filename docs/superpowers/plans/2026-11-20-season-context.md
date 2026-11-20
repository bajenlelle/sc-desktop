# Season context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the desktop Stats view, mark each team's season on the "Why it went that way" bars, write out only the real gaps, and show each team's place in the table.

**Architecture:** The `genius` edge function gets a `season` action that sums nothing: it fetches Genius's per-game team rows and the standings, trims them with a pure shared module (`season-payload.ts`, imported by Deno as `genius-roster.ts` is), joins home and away from the cached fixture list, and caches the result 12 hours per competition. The desktop reads it through `getGeniusSeason`. Pure shared code (`season-context.ts`) turns the payload into each team's season with the same formula as tonight's numbers (`factorsOf` in `game-box.ts`), and `season-copy.ts` holds every sentence. The Stats view draws part 1 at once and adds the season when it arrives.

**Tech Stack:** TypeScript, vitest (`packages/shared`), Deno edge function, Postgres migration, React 19 + Tailwind (desktop), Playwright headless specs.

**Spec:** `docs/superpowers/specs/2026-11-20-season-context-design.md` (approved by Leonard 2026-11-20).

## Global Constraints

- Branch `feat/game-stats` in `/Users/leonard/Documents/super-coach/scoutable/.claude/worktrees/game-stats`. Commit per task; never push, never merge (Leonard's call).
- Genius only through the `genius` function; the key never leaves it. Fetch only when a coach opens Stats on a Genius game. Cache 12 hours per competition; serve the stale cache when upstream fails.
- One formula: season numbers and tonight's numbers both go through `factorsOf`. Never read Genius's ratio averages, `sPace` or its possessions.
- The season is the team's other regular-season games (`matchType` `"REGULAR"`). `GAP_SWINGS = 1.5`; captions need at least 4 other games; swing uses teams with at least 3 games, population standard deviation, mean over teams.
- Fixed bar scales: ppp 1.6, eFG 0.75, turnover rate 0.35, offensive rebounds won 0.6, free-throw rate 0.7. A value past the end fills the track.
- No colour says good or bad; season figures never open plays; the mark is a 2 px line in the primary text colour; captions are secondary text at footnote size. Invoke `apple-design` before the UI tasks and `copywriting` before writing any copy; the exact sentences below are fixed by the spec.
- `packages/shared` stays platform-free. `season-payload.ts` has no imports at all (Deno imports it directly).
- Staging (`edalihizooqdxeekaklf`) reads, migrations and deploys: ask Leonard first every time (another session may be working there). Prod migrations and the prod function deploy are not in this plan.
- The repo is public: the test fixture holds only public league numbers. No secrets anywhere.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `npm test` in `packages/shared`; `npm run typecheck` in `packages/shared`; `npx tsc --noEmit` in `apps/desktop`; `npm run headless -- O-game-stats` in `apps/desktop`.

## Review Focus

1. **Tonight is a finals game** (`matchType` not `"REGULAR"`): every regular-season game counts as "other", captions still follow the four-game rule, and the key says "regular season". Test in Task 4 and Task 5.
2. **Tonight's game has no Genius rows yet** (statistics not built): both teams still come from the fixture and get their season. Test in Task 4; the headless mock in Task 7 leaves tonight's rows out on purpose.
3. **Early season**: a team with 0 to 3 other games gets marks (from 1 game) but no captions, and with 0 games no mark and no rank. Test in Task 4 (`realGap` edge) and Task 5 (key).
4. **A factor that can't be counted** (a game with 0 attempts, a team with no other games): `null`, never `NaN`, left out of ranks and swing. Test in Task 4.
5. **Upstream down with no cache, or not a Genius game**: the view is part 1's; only the upstream failure adds "Season numbers aren't available right now." Test in Task 7 (headless failing answer) and Task 4 (`seasonMatchOf` returns `null` for a non-Genius game).

---

### Task 1: Settle dead-ball rebounds against one staging game

Read-only. Decides one line of Task 4 (`geniusTotals`), nothing else.

**Files:**
- Create (scratchpad, not committed): `/private/tmp/claude-501/-Users-leonard--claude-spares-spare-j7cIOR/5ea198c4-c115-4649-9949-ee8c4faeda35/scratchpad/deadball/count-game.ts`
- Read: the probe's rows in `/private/tmp/claude-501/-Users-leonard--claude-spares-spare-j7cIOR/5ea198c4-c115-4649-9949-ee8c4faeda35/scratchpad/genius-probe/out/teammatch.json` (50 SBL Herr 2026/27 games, whole-game rows have `periodNumber` 0)

**Interfaces:**
- Produces: a ledger line `Task 1: Ruling: OREB/DREB from Genius = <sReboundsOffensive | sReboundsOffensive − sReboundsOffensiveDeadball> …` that Task 4's `geniusTotals` implements.

- [ ] **Step 1: Ask Leonard** whether staging is free for a read (it may be in use by another session). Stop until he answers.
- [ ] **Step 2: Find a game on staging in the probe.** With the staging connection from memory (`reference_staging.md`, session pooler), select `id, source_game_id, title` from `matches` where `source_game_id` is one of the probe's 50 `matchId`s. Expected: at least one row. If none, ask Leonard which SBL Herr game to import on staging; don't import one yourself.
- [ ] **Step 3: Count that game the Stats view's way.** `count-game.ts` loads the game's events exactly as the app does (the stored `play_by_play_events` rows mapped by the shared matches-db reader, or `normalizeGeniusActions` over `genius_match_cache.actions` after `correctKnownFeedErrors`), runs `gameBox`, and prints per side: pts, FGM, FGA, 3PM, FTA, OREB, DREB, TO, and the team-row OREB, DREB and TO. Run with `node --experimental-strip-types` or `npx tsx` from the worktree.
- [ ] **Step 4: Compare field by field** with the two Genius whole-game rows for that `matchId` (home is the side whose `teamId` is the fixture's `isHomeCompetitor`; if unsure, match by points): `sPoints, sFieldGoalsMade, sFieldGoalsAttempted, sThreePointersMade, sFreeThrowsAttempted, sReboundsOffensive, sReboundsDefensive, sTurnovers`, plus `sReboundsOffensiveDeadball, sReboundsDefensiveDeadball, sReboundsTeamOffensive, sReboundsTeamDefensive, sTurnoversTeam`.
  Expected: every field equal except possibly the rebounds. The ruling:
  - our OREB = `sReboundsOffensive` → use Genius's counts as they are;
  - our OREB = `sReboundsOffensive − sReboundsOffensiveDeadball` (and DREB likewise) → subtract dead-ball in `geniusTotals`;
  - anything else, or a non-rebound field off by more than 1 → write it in the ledger and tell Leonard in the final message; use the closest rule and keep going.
- [ ] **Step 5: Ledger the ruling** (no commit; nothing in the repo changed).

---

### Task 2: One formula for tonight and the season, and the fixed scales

**Files:**
- Modify: `packages/shared/lib/game-box.ts` (the "Team factors" block, lines ~170–211)
- Modify: `apps/desktop/src/components/game/stats/factors-section.tsx` (import `FactorKey` instead of defining it)
- Test: `packages/shared/lib/__tests__/game-box.test.ts`

**Interfaces:**
- Produces (all exported from `game-box.ts`):
  - `type FactorKey = "ppp" | "efg" | "tovRate" | "orebPct" | "ftRate"`
  - `FACTOR_KEYS: readonly FactorKey[]` in that order
  - `LOWER_IS_BETTER: ReadonlySet<FactorKey>` = `{"tovRate"}`
  - `FACTOR_SCALE: Record<FactorKey, number>` = `{ ppp: 1.6, efg: 0.75, tovRate: 0.35, orebPct: 0.6, ftRate: 0.7 }`
  - `interface FactorTotals { pts: number; fgm: number; fga: number; tpm: number; fta: number; oreb: number; dreb: number; tov: number }`
  - `factorsOf(t: FactorTotals, opp: Pick<FactorTotals, "dreb">): TeamFactors`
  - `barShare(value: number | null, key: FactorKey): number` (0 to 1; `null` and negatives → 0; past the scale → 1)

- [ ] **Step 1: Write the failing tests** in `game-box.test.ts`:

```ts
describe("factorsOf", () => {
  const t = { pts: 100, fgm: 40, fga: 80, tpm: 10, fta: 20, oreb: 10, dreb: 30, tov: 12 };
  it("counts possessions as FGA − OREB + TO + 0.44 × FTA and the factors over them", () => {
    const f = factorsOf(t, { dreb: 25 });
    expect(f.possessions).toBeCloseTo(90.8, 6);
    expect(f.ppp).toBeCloseTo(100 / 90.8, 6);
    expect(f.efg).toBeCloseTo(0.5625, 6);
    expect(f.tovRate).toBeCloseTo(12 / 90.8, 6);
    expect(f.orebPct).toBeCloseTo(10 / 35, 6);
    expect(f.ftRate).toBeCloseTo(0.25, 6);
  });
  it("gives null, never NaN, for a factor with nothing to divide by", () => {
    const f = factorsOf({ ...t, fga: 0, fgm: 0, tpm: 0, fta: 0, oreb: 0, tov: 0 }, { dreb: 0 });
    expect([f.ppp, f.efg, f.tovRate, f.orebPct, f.ftRate]).toEqual([null, null, null, null, null]);
  });
});
it("teamFactors equals factorsOf over the box totals", () => { /* any fixture game already in this file: build FactorTotals from box.home.totals (fgm = fg.value, fga = fg.attempts, tpm = tp.value, fta = ft.attempts) and expect toEqual */ });
it("barShare places a value on the factor's fixed scale", () => {
  expect(barShare(0.375, "efg")).toBeCloseTo(0.5, 6);
  expect(barShare(2, "ppp")).toBe(1);
  expect(barShare(null, "ftRate")).toBe(0);
});
```

- [ ] **Step 2: Run** `npm test -- game-box` in `packages/shared`. Expected: FAIL, `factorsOf` / `barShare` not exported.
- [ ] **Step 3: Implement.** `teamFactors` keeps its `hasMisses` guard and calls `factorsOf` for each side. `factors-section.tsx` imports `FactorKey` and `LOWER_IS_BETTER` and drops its local type and `lowerIsBetter` flags (the bars' scale changes in Task 7, not here).
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` in `packages/shared`, `npx tsc --noEmit` in `apps/desktop`. Expected: all pass.
- [ ] **Step 5: Commit** `shared: one factor formula over plain totals, and each factor's fixed scale`.

---

### Task 3: The season payload, trimmed and joined

**Files:**
- Create: `packages/shared/lib/season-payload.ts` (no imports; Deno imports it)
- Create: `packages/shared/lib/__tests__/season-payload.test.ts`
- Create: `packages/shared/lib/__tests__/fixtures/season-sbl-herr.json` (generated in Step 6)
- Create (scratchpad, not committed): `…/scratchpad/deadball/make-fixture.ts`

**Interfaces:**
- Produces:

```ts
export interface TeamGame {
  teamId: number;
  pts: number; ptsAgainst: number;
  fgm: number; fga: number; tpm: number; tpa: number; ftm: number; fta: number;
  oreb: number; dreb: number; orebTeam: number; drebTeam: number; orebDeadball: number; drebDeadball: number;
  tov: number; tovTeam: number;
  paint: number; secondChance: number; fastBreak: number; offTurnovers: number; bench: number;
}
export interface SeasonGame { matchId: number; matchType: string; homeTeamId: number; awayTeamId: number; home?: TeamGame; away?: TeamGame }
export interface SeasonStanding { teamId: number; position: number; poolNumber: number | null; matchType: string; played: number; won: number; lost: number; last5: string; streak: string }
export interface SeasonPayload { games: SeasonGame[]; standings: SeasonStanding[]; fetchedAt: string }
export function trimTeamGame(row: Json): TeamGame;
export function seasonPayload(teamRows: Json[], fixtures: Json[], standings: Json[], fetchedAt: string): SeasonPayload;
```

- Genius → ours, one row: `sPoints→pts, sPointsAgainst→ptsAgainst, sFieldGoalsMade→fgm, sFieldGoalsAttempted→fga, sThreePointersMade→tpm, sThreePointersAttempted→tpa, sFreeThrowsMade→ftm, sFreeThrowsAttempted→fta, sReboundsOffensive→oreb, sReboundsDefensive→dreb, sReboundsTeamOffensive→orebTeam, sReboundsTeamDefensive→drebTeam, sReboundsOffensiveDeadball→orebDeadball, sReboundsDefensiveDeadball→drebDeadball, sTurnovers→tov, sTurnoversTeam→tovTeam, sPointsInThePaint→paint, sPointsSecondChance→secondChance, sPointsFastBreak→fastBreak, sPointsFromTurnovers→offTurnovers, sBenchPoints→bench`. A missing or null field is 0.
- Rules: only whole-game rows (`periodNumber === 0`) are kept. Every fixture becomes a game, with or without rows; a fixture whose competitors don't name exactly one `isHomeCompetitor` is left out. `matchType` comes from the fixture (`""` when absent). A row whose `matchId` has no fixture is dropped. Standings rows are trimmed to `SeasonStanding` (`streak` and `last5` as strings, `""` when absent).

- [ ] **Step 1: Write the failing tests** with small hand-made raw rows:
  - `trimTeamGame` maps every field above and turns null into 0;
  - `seasonPayload` keeps only `periodNumber` 0 rows, puts each on the side its `teamId` plays per the fixture, keeps a fixture with no rows (no `home`/`away`), drops a fixture with no home competitor, drops a row with no fixture, copies `matchType`;
  - standings: `{ streak: -2 }` (number) → `"-2"`, missing `last5` → `""`.
- [ ] **Step 2: Run** `npm test -- season-payload`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `season-payload.ts` (its own `type Json = Record<string, any>` with the `deno-lint-ignore` comment, as `genius-roster.ts`).
- [ ] **Step 4: Run** `npm test -- season-payload`. Expected: PASS.
- [ ] **Step 5: Check the probe files still exist** at `…/scratchpad/genius-probe/out/` (`teammatch.json`, `standings.json`). If they're gone, stop and ask Leonard: getting them again costs Genius calls through a staging function.
- [ ] **Step 6: Generate the fixture.** `make-fixture.ts` reads the probe's `teammatch.json` and `standings.json`, makes one synthetic fixture per `matchId` (home = the first whole-game row of that match in file order, `matchType` `"REGULAR"`, `isHomeCompetitor` set accordingly), runs `seasonPayload(rows, fixtures, standings, "2026-11-20T12:00:00Z")`, and writes `__tests__/fixtures/season-sbl-herr.json`. Expected: 50 games with both sides, 11 standings, under 100 KB. Public league numbers only; no names are needed, drop none.
- [ ] **Step 7: Commit** `shared: the season payload, Genius's per-game team rows trimmed and joined with the fixtures` (module, test, fixture).

---

### Task 4: Each team's season, swing, ranks and the real-gap rule

**Files:**
- Create: `packages/shared/lib/season-context.ts`
- Create: `packages/shared/lib/__tests__/season-context.test.ts`

**Interfaces:**
- Consumes: `factorsOf`, `FactorTotals`, `FactorKey`, `FACTOR_KEYS`, `LOWER_IS_BETTER`, `TeamFactors`, `PointsFrom`, `POINTS_FROM` (Task 2 / `game-box.ts`); `SeasonPayload`, `TeamGame` (Task 3); `seasonOf`, `statsKindOf` (`stats-card-data.ts`); Task 1's ruling.
- Produces:

```ts
export const GAP_SWINGS = 1.5;
export const MIN_GAP_GAMES = 4;
export const MIN_SWING_GAMES = 3;
export interface TeamStanding { position: number; won: number; lost: number; last5: string; streak: string }
export interface TeamSeason {
  teamId: number;
  games: number;                                   // other regular-season games counted
  factors: TeamFactors;                            // the team's own, summed totals → factorsOf
  allowed: TeamFactors;                            // its opponents' in those games
  perGame: Record<PointsFrom, number | null>;      // paint, second_chance, fast_break, turnovers, bench
  ranks: Record<FactorKey, number | null>;         // 1 = best
  standing: TeamStanding | null;
}
export interface SeasonContext {
  home: TeamSeason; away: TeamSeason;
  teams: number;                                   // teams with a counted regular-season game ("of 11")
  swing: Record<FactorKey, number | null>;
  regular: boolean;                                // tonight is a regular-season game
}
export function geniusTotals(g: TeamGame): FactorTotals;
export function seasonContext(payload: SeasonPayload, matchId: number): SeasonContext | null;
export function realGap(tonight: number | null, season: number | null, swing: number | null, games: number): boolean;
export function seasonMatchOf(match: StoredMatch, leagues: League[]): { competitionId: number; matchId: number } | null;
```

- Rules (from the spec):
  - A game counts only when it is `"REGULAR"` and has both rows. Tonight's game never counts for tonight's two teams. `null` when `matchId` isn't in `payload.games`.
  - `factors`: sum the team's `geniusTotals` over its counted games, `factorsOf(sum, { dreb: opponents' summed dreb })`. `allowed`: the opponents' summed totals, `factorsOf(oppSum, { dreb: team's summed dreb })`. 0 games → every factor `null`.
  - `perGame`: each points-from sum ÷ games, `null` at 0 games.
  - `swing[k]`: for each team with at least `MIN_SWING_GAMES` counted games (all of its regular games, tonight included), the population SD of its single-game `factorsOf` values (nulls skipped); then the mean over those teams; `null` when no team qualifies.
  - `ranks`: tonight's two teams on their other games, every other team on all its counted games; nulls left out; highest is 1st except `LOWER_IS_BETTER`; ties share the rank (1, 2, 2, 4).
  - `standing`: the team's standings row whose `matchType` is `"REGULAR"`, else its first row, else `null`.
  - `realGap`: `games >= MIN_GAP_GAMES` and none of the three values `null` and `|tonight − season| >= GAP_SWINGS × swing`.
  - `seasonMatchOf`: `statsKindOf(match) === "genius"` and `seasonOf(match, leagues)` → `{ competitionId, matchId: Number(match.sourceGameId) }`, else `null`.

- [ ] **Step 1: Write the failing tests.** A small builder in the test makes payloads from `TeamGame`s with round numbers.
  - tonight is left out: team 1 with games A (tonight) and B: `home.factors` equals `factorsOf(geniusTotals(B), { dreb: opponent's B dreb })`, `home.games === 1`;
  - `allowed` equals `factorsOf` over the opponents' rows;
  - a finals tonight (`matchType "FINALS"`): `regular === false`, every regular game counts, a second finals game doesn't;
  - tonight with no rows: `seasonContext` still returns both teams from `homeTeamId`/`awayTeamId`;
  - an unknown `matchId` → `null`;
  - 0 other games → factors all `null`, `ranks` all `null`, `perGame` all `null`; a counted game with `fga: 0` gives a `null` factor that ranks and swing skip; no number anywhere in the result is `NaN` (walk it);
  - ranks: eFG 0.50, 0.55, 0.55, 0.60 → 4, 2, 2, 1; turnover rate lowest is 1st;
  - `realGap`: `realGap(0.60, 0.50, 0.059, 4)` true, `realGap(0.60, 0.50, 0.059, 3)` false, `realGap(0.55, 0.50, 0.059, 10)` false, any `null` → false;
  - `geniusTotals` follows Task 1's ruling (one test pins it: a row with `orebDeadball: 2`);
  - `seasonMatchOf`: a numeric `sourceGameId` in a Genius season → ids; a Profixio game and a game with no league → `null`;
  - on the SBL Herr fixture: `swing` within 0.01 of `{ ppp: 0.114, efg: 0.059, tovRate: 0.047, orebPct: 0.077, ftRate: 0.12 }`; `teams === 11`; replaying every game (each side's `realGap` per factor with that game's own `factorsOf` as tonight) averages between 1.7 and 2.3 captions a game.
- [ ] **Step 2: Run** `npm test -- season-context`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `season-context.ts`.
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` in `packages/shared`. Expected: PASS. If the fixture's swing misses by more than 0.01, find why before touching the tolerance (the probe's `gaps.py` in `…/scratchpad/genius-probe/` is the reference).
- [ ] **Step 5: Commit** `shared: each team's season beside tonight's game, with swing, ranks and the real-gap rule`.

---

### Task 5: The season's sentences

**Files:**
- Create: `packages/shared/lib/season-copy.ts`
- Create: `packages/shared/lib/__tests__/season-copy.test.ts`

**Interfaces:**
- Consumes: `FactorKey` (Task 2), `TeamStanding` (Task 4).
- Produces:

```ts
export function ordinal(n: number): string;
export function formatFactor(key: FactorKey, v: number): string;     // ppp and ftRate: 2 decimals; others: whole percent
export function gapCaption(key: FactorKey, season: number, rank: number | null): string;
export function seasonHoverLine(key: FactorKey, season: number, games: number, rank: number | null, teams: number, regular: boolean): string;
export function allowedLine(key: FactorKey, opponent: string, allowed: number): string;
export function seasonKey(homeGames: number, awayGames: number, regular: boolean): string | null;
export function standingLine(s: TeamStanding): string;
export function lastFiveLine(last5: string): string;
export function usuallyPerGame(n: number): string;
```

- [ ] **Step 1: Write the failing tests** with exactly these strings:

```ts
expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st","2nd","3rd","4th","11th","12th","13th","21st","22nd","101st","111th"]);
expect(formatFactor("efg", 0.524)).toBe("52%");
expect(formatFactor("ppp", 1.183)).toBe("1.18");
expect(gapCaption("efg", 0.52, 4)).toBe("usually 52% · 4th");
expect(gapCaption("efg", 0.52, null)).toBe("usually 52%");
expect(seasonHoverLine("efg", 0.52, 11, 4, 11, true)).toBe("Season, 11 other games: 52% · 4th of 11");
expect(seasonHoverLine("efg", 0.52, 1, null, 11, true)).toBe("Season, 1 other game: 52%");
expect(seasonHoverLine("efg", 0.52, 22, 4, 11, false)).toBe("Regular season, 22 games: 52% · 4th of 11");
expect(allowedLine("efg", "Uppsala", 0.51)).toBe("Uppsala usually allows 51%");
expect(allowedLine("tovRate", "Borås", 0.13)).toBe("Borås usually forces turnovers on 13%");
expect(allowedLine("ppp", "Uppsala", 1.02)).toBe("Uppsala usually allows 1.02");
expect(seasonKey(11, 11, true)).toBe("Each line marks the team's season, from its other 11 games.");
expect(seasonKey(11, 10, true)).toBe("Each line marks the team's season, from their other games (11 and 10).");
expect(seasonKey(3, 3, true)).toBe("Each line marks the team's season after 3 games.");
expect(seasonKey(3, 2, true)).toBe("Each line marks the team's season after 3 and 2 games.");
expect(seasonKey(1, 1, true)).toBe("Each line marks the team's season after 1 game.");
expect(seasonKey(22, 22, false)).toBe("Each line marks the team's regular season, from its 22 games.");
expect(seasonKey(22, 21, false)).toBe("Each line marks the team's regular season, from their games (22 and 21).");
expect(seasonKey(0, 0, true)).toBeNull();
expect(standingLine({ position: 5, won: 7, lost: 5, last5: "LWWLW", streak: "4" })).toBe("5th · 7–5 · won 4");
expect(standingLine({ position: 6, won: 5, lost: 7, last5: "", streak: "-2" })).toBe("6th · 5–7 · lost 2");
expect(standingLine({ position: 1, won: 0, lost: 0, last5: "", streak: "" })).toBe("1st · 0–0");
expect(lastFiveLine("LWWLW")).toBe("Today's table. Last five: L W W L W.");
expect(lastFiveLine("")).toBe("Today's table.");
expect(usuallyPerGame(37.6)).toBe("usually 38 a game");
```

- [ ] **Step 2: Run** `npm test -- season-copy`. Expected: FAIL.
- [ ] **Step 3: Implement** `season-copy.ts`. The `–` in the record is an en dash; `·` is a middle dot with a space either side.
- [ ] **Step 4: Run** `npm test -- season-copy`. Expected: PASS.
- [ ] **Step 5: Commit** `shared: the season context's sentences`.

---

### Task 6: The `season` action in the genius function, its cache and client

**Files:**
- Create: `supabase/migrations/20261121100000_genius_season_cache.sql`
- Modify: `supabase/functions/genius/index.ts` (header comment's action list, constants near `FIXTURES_TTL_MS`, a `loadSeason` beside `loadFixtures`, the action before `return err(400, "unknown_action")`)
- Modify: `packages/shared/lib/genius-client.ts`
- Test: `packages/shared/lib/__tests__/genius-client.test.ts` (create if absent)

**Interfaces:**
- Consumes: `seasonPayload`, `SeasonPayload` (Task 3), imported as `../../../packages/shared/lib/season-payload.ts`.
- Produces: `getGeniusSeason(supabase: SupabaseClient, competitionId: number): Promise<GeniusResult<SeasonPayload>>`, invoking `{ action: "season", competitionId }`.

- [ ] **Step 1: Write the failing client test**: with a stub `supabase.functions.invoke` that records its arguments and returns `{ data: payload, error: null }`, `getGeniusSeason(stub, 48974)` resolves `{ ok: true, data: payload }` and invoked `"genius"` with `{ body: { action: "season", competitionId: 48974 } }`; an error whose `context.json()` gives `{ error: "upstream_failed" }` resolves `{ ok: false, error: "upstream_failed" }`.
- [ ] **Step 2: Run** `npm test -- genius-client`. Expected: FAIL, not exported.
- [ ] **Step 3: Implement `getGeniusSeason`** next to `getGeniusFixtures`. Run the test. Expected: PASS.
- [ ] **Step 4: Write the migration**: `genius_season_cache (competition_id bigint PRIMARY KEY, payload jsonb NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now())`, RLS enabled, no policies (server-written, as `genius_fixture_cache` in `20260907100000_genius_import.sql`), the same autovacuum settings as that table, and a header comment saying what it holds and that only the `genius` function reads and writes it.
- [ ] **Step 5: Implement the action.** `SEASON_TTL_MS = 12 * 60 * 60 * 1000`. `loadSeason(admin, competitionId)`: a fresh cached row is returned as is; otherwise `loadFixtures` (its own 6 h cache), `geniusAll("/statistics/teammatch/competitions/{c}")` and `geniusAll("/competitions/{c}/standings")`, then `seasonPayload(...)`, upsert, return. On upstream error: the stale row if there is one, else throw (the handler's catch answers 502 `upstream_failed`). If the Warehouse accepts a filter to whole-game rows on `teammatch`, use it; else page and let `seasonPayload` drop the rest. The action is open to any signed-in user and the catalogue check already guards `competitionId`. Add it to the header comment's action list.
- [ ] **Step 6: Typecheck** `npm run typecheck` in `packages/shared` and `npx tsc --noEmit` in `apps/desktop`. Expected: pass. (No Deno on this machine; the staging deploy in Step 8 bundles the function and is its compile check.)
- [ ] **Step 7: Commit** `genius: a season action, the competition's per-game team rows and standings, cached 12 hours`.
- [ ] **Step 8: Ask Leonard** before touching staging. On his yes: `npx -y supabase@2 db push --db-url <staging session pooler> --dry-run` (expected: only `20261121100000_genius_season_cache.sql` pending; anything else, stop and show him), then without `--dry-run`; then `npx -y supabase@2 functions deploy genius --project-ref edalihizooqdxeekaklf`. Expected: deployed. The live call is checked in Task 8, Step 6. Ledger what ran.

---

### Task 7: Marks, captions, hover and key on the factor bars

Invoke `apple-design` and `copywriting` first.

**Files:**
- Create: `apps/desktop/src/components/game/stats/use-season-context.ts`
- Modify: `apps/desktop/src/components/game/stats/factors-section.tsx`
- Modify: `apps/desktop/src/components/game/stats/game-stats-view.tsx`
- Modify: `apps/desktop/headless/helpers.ts` (a season mock helper)
- Test: `apps/desktop/headless/specs/O-game-stats.spec.ts`

**Interfaces:**
- Consumes: `getGeniusSeason` (Task 6), `seasonContext`, `seasonMatchOf`, `realGap`, `SeasonContext` (Task 4), the copy functions (Task 5), `barShare`, `FACTOR_SCALE`, `factorsOf`/`teamFactors` (Task 2).
- Produces:
  - `useSeasonContext(match: StoredMatch, leagues: League[]): { status: "none" | "reading" | "ready" | "failed"; context: SeasonContext | null }`: `"none"` when `seasonMatchOf` is `null` or the game isn't in the payload; one request per competition per 30 minutes in a module-level cache (a failure isn't cached), as `playableSchedule` in `basketball-api.ts`.
  - `FactorsSection` gains `season: { status, context }` and `onGaps?: (n: number) => void` (how many captions it drew, for analytics in Task 8).
  - Headless helper `mockSeason(page, answer: (matchId: number) => SeasonPayload | "fail")`: records the open game's `source_game_id` from the plays read (`isPlaysRead`), answers POSTs to `**/functions/v1/genius` whose body has `action: "season"`, and lets every other action through.

- [ ] **Step 1: Write the failing headless tests** in `O-game-stats.spec.ts`:
  - **"Each team's season marks the factor bars"**: `mockSeason` with a payload built in the spec: tonight (the open game's id, `REGULAR`, home team 1, away team 2, **no rows**); 11 other games for each of teams 1 and 2 against teams 10–20 and 21–31, where teams 1 and 2 shoot `fga: 50` and `fgm` alternating 4 and 6 (`tpm: 0`; eFG about 10%, swing about 0.02) and, so that only eFG can be a real gap whatever tonight's plays say, `pts` alternates 40 and 160, `tov` 0 and 30, `oreb` 0 and 30 and `fta` 0 and 60 (opponents' `dreb` 30), which makes every other factor's swing wide; standings for teams 1 (`position 1, won 11, lost 0, streak "11", last5 "WWWWW"`) and 2 (`position 2, won 10, lost 1, streak "-1", last5 "WWWWL"`). Expect: `page.locator("[data-season-mark]")` has count 10; `page.getByText(/^usually 10% · \d+(st|nd|rd|th)$/)` has count 2; `getByText("Each line marks the team's season, from its other 11 games.")` visible; screenshot `factors-season`.
  - **"Without the season the bars stay as they were"**: `mockSeason` answering `"fail"`. Expect: `getByText("Season numbers aren't available right now.")` visible, `[data-season-mark]` count 0, no text matching `/^usually /`.
- [ ] **Step 2: Run** `npm run headless -- O-game-stats` in `apps/desktop`. Expected: the two new tests FAIL (no marks, no line); the existing test passes.
- [ ] **Step 3: Implement the hook** and call it in `GameStatsView`, passing `season` to `FactorsSection`.
- [ ] **Step 4: Implement the bars.** Width is `barShare(value, key) × 100%` for both sides (part 1's fill-to-the-larger goes). Each side's track gets the mark when the team's season factor is non-null: a `data-season-mark` element, 2 px wide, full track height plus a little, primary text colour, at `barShare(season, key)` from the label side (home measures from the right, away from the left), drawn over the bar. The number cell stacks tonight's number and, when `realGap(tonight, season, swing[key], games)`, the caption `gapCaption(key, season, rank)` in secondary text at footnote size. One tooltip per side over its track and caption: `seasonHoverLine(...)` and, when the opponent's `allowed[key]` is non-null, `allowedLine(key, opponentName, allowed)`. Under the grid: `seasonKey(home.games, away.games, regular)` in secondary footnote text, or `"Season numbers aren't available right now."` when `status === "failed"`. While `"reading"`, `"none"`, or with no context: nothing extra, no animation when it arrives. Tonight's number stays the only thing that opens plays.
- [ ] **Step 5: Run** `npm run headless -- O-game-stats`, `npx tsc --noEmit` in `apps/desktop`. Expected: all pass. Look at `factors-season` in light and dark; the mark must read on both tints (adjust its opacity in dark if needed; ledger the value).
- [ ] **Step 6: Commit** `stats: each team's season on the factor bars, with captions only for real gaps`.

---

### Task 8: Standings line, points-from hover, analytics, docs and the live check

**Files:**
- Modify: `apps/desktop/src/components/game/stats/score-section.tsx`
- Modify: `apps/desktop/src/components/game/stats/factors-section.tsx` (points-from hover)
- Modify: `apps/desktop/src/components/game/stats/game-stats-view.tsx` (analytics)
- Modify: `packages/shared/types/analytics.ts` (the `game_stats_viewed` comment)
- Modify: `docs/game-view.md` (Stats section, "Not built"), `CLAUDE.md` (the `docs/game-view.md` line: mention the season context)
- Test: `apps/desktop/headless/specs/O-game-stats.spec.ts`

**Interfaces:**
- Consumes: `useSeasonContext` result (Task 7), `standingLine`, `lastFiveLine`, `usuallyPerGame` (Task 5), `TeamSeason.standing`, `TeamSeason.perGame` (Task 4).
- Produces: `ScoreSection` gains `season: SeasonContext | null`; `game_stats_viewed` gains `season: "shown" | "none" | "failed"` and `season_gaps: number`.

- [ ] **Step 1: Extend the season test** from Task 7 (with `recordAnalytics` before navigation): `getByText("1st · 11–0 · won 11")` and `getByText("2nd · 10–1 · lost 1")` visible, each next to its team's name; hovering the first shows `"Today's table. Last five: W W W W W."`; the tracked `game_stats_viewed` has `season: "shown"` and `season_gaps: 2`. In the failing test: no `" · won "`/`" · lost "` text and `game_stats_viewed` has `season: "failed"`.
- [ ] **Step 2: Run** `npm run headless -- O-game-stats`. Expected: the new assertions FAIL.
- [ ] **Step 3: Implement.** Under the score table, one line per team with a standing: team name, then `standingLine`, secondary text, tooltip `lastFiveLine`. Each points-from figure's hover adds `usuallyPerGame(perGame[k])` when non-null. `game_stats_viewed` waits until the season status isn't `"reading"` as well as the box score; `"ready"` → `"shown"`, `"none"` → `"none"`, `"failed"` → `"failed"`; `season_gaps` from `onGaps` (0 without a season).
- [ ] **Step 4: Run** `npm run headless -- O-game-stats`, `npx tsc --noEmit` in `apps/desktop`, `npm test` in `packages/shared`. Expected: all pass.
- [ ] **Step 5: Docs.** In `docs/game-view.md`'s Stats section, one bullet "Season context": where it comes from (the `season` action, Genius per-game team rows, 12 h cache), the rule (other regular-season games, `GAP_SWINGS` 1.5 × the league's swing, 4 games), the fixed scales, what shows when it's missing; update the Analytics bullet; take season context out of "Not built" (the opponent page stays). Point to the spec and this plan. Commit `stats: each team's place in the table and its usual points; docs`.
- [ ] **Step 6: Live check on staging** (only after Task 6, Step 8 ran; ask Leonard first). Add a test **"the real season answer draws the marks"** skipped unless `SEASON_LIVE=1`, with no mock: Stats on the first game shows at least one `[data-season-mark]` or, for a game with no counted season, no failure line. Run `SEASON_LIVE=1 npm run headless -- O-game-stats -g "real season"`. Expected: pass. It spends about three Genius calls the first time and none within 12 hours. Commit the test.

---

## After the last task

Final whole-branch review per the executing skill. Then tell Leonard: what's on the branch (not pushed), what ran on staging, Task 1's ruling, and what prod needs before a release (the migration and the function deploy), and ask before any merge.
