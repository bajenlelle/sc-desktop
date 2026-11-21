# Team plays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team's plays across the coach's own games: video counts with Watch links on the team page's Season view, and a Plays view that lists, plays and collects those plays across games.

**Architecture:** Pure counting, picking and ordering in `packages/shared/lib/team-video.ts` (vitest), copy in `team-copy.ts`. The desktop reads the team's library games and their plays once per team (`use-team-plays.ts`), draws the Season additions from the counts, and draws Plays from Add clips' parts (stage, windowed list, filters) and the Game view's collecting, which is loosened from one game to a set of games.

**Tech Stack:** TypeScript, React 19, Tauri 2 desktop, vitest, Playwright headless (`npm run headless`).

**Spec:** `docs/superpowers/specs/2026-11-21-team-plays-design.md` (approved 2026-11-21; mockup https://claude.ai/artifact/48hfrcEHJ7AzDpPb64puWy).

Branch `feat/team-plays` in the worktree `.claude/worktrees/team-page`, cut from local main f8d9b87. Headless in this worktree: port 1436, device `headless-team-page` (`.env.headless`).

## Global Constraints

- No migration, no new Genius calls, no change to the `genius` function.
- Season numbers stay as they are and open nothing; video counts say "in your N games", sit in secondary text (`text-subheadline text-muted-foreground`) and are the only numbers that open plays.
- Video numbers are counts or "made of attempted", never a percentage.
- "Your games" are the coach's own (`useLibraryGames`, `ownOnly`), archived included, regular season and finals alike.
- A count always equals the plays its Watch opens.
- The team's side in a game comes from `TeamGameRow.home` (home = `teamNumber` 1, away = 2), never from names.
- `packages/shared/lib/clip-filters.ts` is not changed: it is byte-identical to the file on `feat/cloud-game-videos` (docs/game-view.md). The picked set lives beside `ClipFilters`, not in it (a ruling against the spec's "ClipFilters gains it": same behaviour, no merge trap).
- Add clips (`clip-browser-panel.tsx`) is not changed in this step. Plays takes its parts that are already separate components and copies its cross-game playback logic into its own hook (a ruling: the editor's sheet is 1,400 lines with no headless cover for every path; folding the two into one hook is a later cleanup).
- UI: invoke `apple-design` before UI work, `copywriting` before copy. Row highlight is a neutral fill (`bg-row-selected`), the accent only on controls. English, sentence case.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A game whose plays fail to read** (offline mid-read): its header says so with Try again, and the Season counts don't show a number that leaves it out without saying so (Task 4: counts wait for every read and N counts only games read; Task 6 headless).
2. **Turnovers and rebounds with no player** (team rows): counted on the right side through `eventTeam.teamNumber` (Task 1 test `team rows count on their side`).
3. **A pick from router state that matches nothing** (a reload after a game left the library, a player in no game): the pill shows 0 and the list says "No plays match.", nothing throws (Task 3 test, Task 6 headless).
4. **Many games** (the coach's own team page, 25+ games, thousands of plays): newest first, windowed, read four at a time (Task 3 test `25 games stay newest first`, Task 4 batching).
5. **Moving to another team while plays are still reading** (an opponent link on Season): the old team's reads never land on the new team's page (Task 4 test in headless).

---

### Task 1: Team games, sides and picks

**Files:**
- Create: `packages/shared/lib/team-video.ts`
- Create: `packages/shared/lib/__tests__/helpers/plays.ts`
- Test: `packages/shared/lib/__tests__/team-video.test.ts`

**Interfaces:**
- Consumes: `TeamGameRow` (`team-schedule.ts`), `gameBox` (`game-box.ts`), `gameShots`, `ShotZone` (`game-shots.ts`), `isBookkeepingEvent` (`events.ts`), `End`, `KeyMetric` (`league-season.ts`, `team-keys.ts`).
- Produces:

```ts
export interface TeamGame {
  leagueMatchId: number;      // Genius match id
  gameId: string;             // the library game's id (StoredMatch.id)
  side: 1 | 2;                // the team's teamNumber in this game
  at: string;                 // ISO UTC
  home: boolean;
  opponentName: string;
  result: "W" | "L" | null;
  score: { own: number; opp: number } | null;
}
export interface GamePlays { game: TeamGame; events: readonly PlayByPlayEvent[] }
export type PlaysSide = "with" | "without";
export type KeyStat = "threes" | "oreb" | "tov";
export type PlaysPick =
  | { kind: "stat"; stat: KeyStat; side: PlaysSide }
  | { kind: "zone"; zone: ShotZone }                       // always With the ball
  | { kind: "player"; personId: number; name: string };    // always With the ball
export function teamLibraryGames(rows: readonly TeamGameRow[], library: ReadonlyMap<number, string>): TeamGame[];
export function sideOf(e: PlayByPlayEvent): 1 | 2 | null;   // player.teamNumber ?? eventTeam.teamNumber
export function sideNumber(game: TeamGame, side: PlaysSide): 1 | 2;
export function keyStatOf(end: End, metric: KeyMetric): { stat: KeyStat; side: PlaysSide } | null;
export function pickKeys(pick: PlaysPick | null, side: PlaysSide, games: readonly GamePlays[]): string[]; // `${gameId}:${eventId}`
export function flipPick(pick: PlaysPick | null, to: PlaysSide): PlaysPick | null;
export function playability(m: { videoUrl?: string | null; syncPoint?: unknown }, status: "ok" | "missing" | "unreadable" | undefined): "ok" | "video" | "sync";
```

Rules `pickKeys` follows: `null` = every non-bookkeeping play on that side; stat `threes` = the side's `gameBox(events)` `totals.tp.eventIds` (attempts), `oreb` = `totals.oreb.eventIds`, `tov` = `totals.tov.eventIds` (team rows included); zone = the With side's `gameShots` shots in that zone; player = non-bookkeeping plays whose `player.playerId` is `personId` on the With side. A zone or player pick asked for on `"without"` gives `[]`. Order: games as given, each game's keys in `gameBox`/event order (callers sort for display).

`keyStatOf`: own/allowed × threeRate → threes, orebPct → oreb, tovRate → tov, with `side` `"with"` for own and `"without"` for allowed; ppp and pace → null.

`flipPick`: a stat keeps its stat with `side: to`; a zone or player becomes `null`; `null` stays `null`.

`playability`: `"sync"` without a sync point, else `"video"` without a video url or with status `"missing"` / `"unreadable"`, else `"ok"` (status `undefined` = not probed yet = `"ok"`).

- [ ] **Step 1: Write `helpers/plays.ts` and the failing tests**

`helpers/plays.ts` exports `ev(id: number, type: string, side: 1 | 2, extra?: Partial<PlayByPlayEvent>): PlayByPlayEvent` (a player on that side unless `extra.player === null`, then `eventTeam: { teamNumber: side, … }` only; period 1, clock counting down by id) and `tgame(over: Partial<TeamGame>): TeamGame`.

```ts
describe("teamLibraryGames", () => {
  it("keeps played games in the library, newest first, with the team's side", () => {
    const rows = [row({ matchId: 1, at: "2026-11-01T18:00:00Z", home: true }), row({ matchId: 2, at: "2026-11-08T18:00:00Z", home: false }),
      row({ matchId: 3, at: "2026-11-15T18:00:00Z", home: true, status: "upcoming" }), row({ matchId: 4, at: "2026-11-02T18:00:00Z" })];
    const got = teamLibraryGames(rows, new Map([[1, "g1"], [2, "g2"], [3, "g3"]]));
    expect(got.map((g) => [g.gameId, g.side])).toEqual([["g2", 2], ["g1", 1]]);
  });
  it("finals count as well as the regular season", () => { /* row({ regular: false }) in the library → kept */ });
});
describe("pickKeys", () => {
  it("turnovers with and without the ball", () => {
    const g = { game: tgame({ gameId: "g1", side: 2 }), events: [ev(1, "turnover", 2), ev(2, "turnover", 1), ev(3, "turnover", 2)] };
    expect(pickKeys({ kind: "stat", stat: "tov", side: "with" }, "with", [g])).toEqual(["g1:1", "g1:3"]);
    expect(pickKeys({ kind: "stat", stat: "tov", side: "without" }, "without", [g])).toEqual(["g1:2"]);
  });
  it("team rows count on their side", () => {
    const g = { game: tgame({ gameId: "g1", side: 1 }), events: [ev(1, "turnover", 1, { player: null }), ev(2, "rebound", 1, { player: null, subType: "offensive" })] };
    expect(pickKeys({ kind: "stat", stat: "tov", side: "with" }, "with", [g])).toEqual(["g1:1"]);
    expect(pickKeys({ kind: "stat", stat: "oreb", side: "with" }, "with", [g])).toEqual(["g1:2"]);
  });
  it("threes are every attempt, made or missed", () => { /* 3pt made + 3pt missed on side → both keys */ });
  it("a zone or a player gives nothing without the ball", () => {
    expect(pickKeys({ kind: "zone", zone: "rim" }, "without", games)).toEqual([]);
    expect(pickKeys({ kind: "player", personId: 7, name: "Lind" }, "without", games)).toEqual([]);
  });
  it("null is every play on that side, bookkeeping left out", () => { /* a 'game' start row on side → not in */ });
  it("a pick that matches nothing gives []", () => {
    expect(pickKeys({ kind: "player", personId: 999, name: "Gone" }, "with", games)).toEqual([]);
  });
});
describe("flipPick", () => {
  it("swaps a stat to the other side and clears a zone or a player", () => {
    expect(flipPick({ kind: "stat", stat: "tov", side: "with" }, "without")).toEqual({ kind: "stat", stat: "tov", side: "without" });
    expect(flipPick({ kind: "zone", zone: "mid" }, "without")).toBeNull();
    expect(flipPick({ kind: "player", personId: 7, name: "Lind" }, "without")).toBeNull();
    expect(flipPick(null, "with")).toBeNull();
  });
});
describe("keyStatOf", () => {
  it("maps the keys with plays and leaves the rest", () => {
    expect(keyStatOf("allowed", "tovRate")).toEqual({ stat: "tov", side: "without" });
    expect(keyStatOf("own", "threeRate")).toEqual({ stat: "threes", side: "with" });
    expect(keyStatOf("own", "ppp")).toBeNull();
    expect(keyStatOf("own", "pace")).toBeNull();
  });
});
describe("playability", () => {
  it("sync first, then the video", () => {
    expect(playability({ videoUrl: "/v.mp4", syncPoint: null }, "ok")).toBe("sync");
    expect(playability({ videoUrl: "/v.mp4", syncPoint: {} }, "missing")).toBe("video");
    expect(playability({ videoUrl: null, syncPoint: {} }, undefined)).toBe("video");
    expect(playability({ videoUrl: "/v.mp4", syncPoint: {} }, undefined)).toBe("ok");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- team-video` in `packages/shared`
Expected: FAIL, "Failed to resolve import ../team-video".

- [ ] **Step 3: Implement the interfaces above in `packages/shared/lib/team-video.ts`**

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -- team-video`, then `npm run typecheck` in `packages/shared`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/lib/team-video.ts packages/shared/lib/__tests__/team-video.test.ts packages/shared/lib/__tests__/helpers/plays.ts
git commit -m "team plays: a team's games, its side in each and what Watch picks"
```

---

### Task 2: The counts and their copy

**Files:**
- Modify: `packages/shared/lib/team-video.ts`
- Modify: `packages/shared/lib/team-copy.ts`
- Test: `packages/shared/lib/__tests__/team-video.test.ts`, `packages/shared/lib/__tests__/team-copy.test.ts`

**Interfaces:**
- Consumes: Task 1's types and `pickKeys`.
- Produces:

```ts
export interface StatCount { count: number; made: number | null }   // made only for threes
export interface TeamVideo {
  games: number;
  all: Record<PlaysSide, number>;
  stats: Record<PlaysSide, Record<KeyStat, StatCount>>;
  shots: {
    games: number;                 // games with shot positions
    withoutPositions: number;      // games left out of the chart
    dots: (ChartShot & { key: string })[];
    zones: Record<ShotZone, { made: number; attempts: number }>;
  };
  players: ReadonlyMap<number, { games: number; plays: number }>;   // With the ball, by personId
}
export function teamVideo(games: readonly GamePlays[]): TeamVideo;
// team-copy.ts
export function videoKeyLine(stat: KeyStat, side: PlaysSide, c: StatCount, games: number): string;
export function pickLabel(pick: PlaysPick, count: number, made: number | null): string;
export function playersCell(games: number): string;
```

Ruling (against the spec's "threes from the play's type"): the shot chart and its zones count only games with shot positions, so the dots and the three zones always come from the same games; the older games are named in the caption ("Leaves out 1 game imported before shot positions."). Cost if wrong: a coach with only old games sees no chart, where the spec would have shown threes alone.

Copy (exact):
- `videoKeyLine`: prefix `In your ${n} games: ` (n = 1: `In your game: `), then — with: threes `34 of 98 threes`, oreb `38 offensive rebounds`, tov `41 turnovers`; without: threes `30 of 81 threes against them`, oreb `22 offensive rebounds against them`, tov `44 turnovers forced`. A count of 1 takes the singular (`1 turnover`, `1 offensive rebound`, `1 of 1 three`).
- `pickLabel`: stat with — `Threes · 34 of 98`, `Offensive rebounds · 38`, `Turnovers · 41`; without — `Threes against them · 30 of 81`, `Offensive rebounds against them · 22`, `Turnovers forced · 44`; zone — `At the rim · 58 of 102`, `Mid-range · 14 of 38`, `Threes · 34 of 98`; player — `${name} · ${count}`.
- `playersCell`: `3 games`, `1 game`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("teamVideo", () => {
  it("every count equals the plays its pick opens", () => {
    const v = teamVideo(GAMES);
    for (const side of ["with", "without"] as const)
      for (const stat of ["threes", "oreb", "tov"] as const)
        expect(v.stats[side][stat].count).toBe(pickKeys({ kind: "stat", stat, side }, side, GAMES).length);
    expect(v.all.with).toBe(pickKeys(null, "with", GAMES).length);
    for (const zone of SHOT_ZONES) expect(v.shots.zones[zone].attempts).toBe(pickKeys({ kind: "zone", zone }, "with", GAMES).length);
  });
  it("threes carry their makes", () => { /* 2 made of 5 → { count: 5, made: 2 } */ });
  it("zero counts are zero, not missing", () => { expect(teamVideo([emptyGame]).stats.with.oreb).toEqual({ count: 0, made: null }); });
  it("shots leave out games without positions and say how many", () => {
    const v = teamVideo([withPositions, withoutPositions]);
    expect(v.shots).toMatchObject({ games: 1, withoutPositions: 1 });
  });
  it("a player in some games only", () => {
    expect(teamVideo([gameWithLind, gameWithoutLind]).players.get(7)).toEqual({ games: 1, plays: 4 });
  });
});
describe("videoKeyLine", () => {
  it.each([
    ["threes", "with", { count: 98, made: 34 }, 3, "In your 3 games: 34 of 98 threes"],
    ["tov", "with", { count: 41, made: null }, 3, "In your 3 games: 41 turnovers"],
    ["tov", "without", { count: 44, made: null }, 3, "In your 3 games: 44 turnovers forced"],
    ["oreb", "without", { count: 22, made: null }, 3, "In your 3 games: 22 offensive rebounds against them"],
    ["threes", "without", { count: 81, made: 30 }, 3, "In your 3 games: 30 of 81 threes against them"],
    ["oreb", "with", { count: 1, made: null }, 1, "In your game: 1 offensive rebound"],
    ["tov", "with", { count: 0, made: null }, 2, "In your 2 games: 0 turnovers"],
  ])("%s %s", (stat, side, c, n, line) => expect(videoKeyLine(stat as KeyStat, side as PlaysSide, c, n)).toBe(line));
});
describe("pickLabel", () => {
  it("names the pick and its count", () => {
    expect(pickLabel({ kind: "stat", stat: "tov", side: "without" }, 44, null)).toBe("Turnovers forced · 44");
    expect(pickLabel({ kind: "zone", zone: "rim" }, 102, 58)).toBe("At the rim · 58 of 102");
    expect(pickLabel({ kind: "player", personId: 7, name: "Erik Lind" }, 112, null)).toBe("Erik Lind · 112");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- team-video team-copy` in `packages/shared`
Expected: FAIL, "teamVideo is not a function" / "videoKeyLine is not exported".

- [ ] **Step 3: Implement `teamVideo` (counts from `pickKeys` and `gameBox`/`gameShots`, never a second counting rule) and the three copy functions**

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -- team-video team-copy`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/lib/team-video.ts packages/shared/lib/team-copy.ts packages/shared/lib/__tests__/team-video.test.ts packages/shared/lib/__tests__/team-copy.test.ts
git commit -m "team plays: the counts from the coach's games, and their lines"
```

---

### Task 3: The Plays list

**Files:**
- Modify: `packages/shared/lib/team-video.ts`
- Test: `packages/shared/lib/__tests__/team-video.test.ts`

**Interfaces:**
- Consumes: Task 1; `ClipFilters`, `applyClipFiltersByKey` (`clip-filters.ts`, read only); `sortPlaysChronologically`, `isBookkeepingEvent` (`events.ts`).
- Produces:

```ts
export type TeamPlayRow =
  | { kind: "game"; game: TeamGame; plays: number }
  | { kind: "play"; key: string; game: TeamGame; event: PlayByPlayEvent };
export function teamPlayRows(
  games: readonly GamePlays[],
  side: PlaysSide,
  picked: ReadonlySet<string> | null,           // pickKeys(...) as a set; null = no pick
  filters: ClipFilters,
  labelsOf?: (key: string) => ReadonlySet<string> | undefined,
): TeamPlayRow[];
export function nextPlayable(rows: readonly TeamPlayRow[], fromKey: string | null, playable: (gameId: string) => boolean): string | null;
export function previousPlayable(rows: readonly TeamPlayRow[], fromKey: string | null, playable: (gameId: string) => boolean): string | null;
```

Rules: games newest first by `at` (whatever order they come in); a game's plays chronological; bookkeeping out; only the side's plays (`sideOf(e) === sideNumber(game, side)`); `picked` narrows; `filters` narrow through `applyClipFiltersByKey` with `labelsOf`; a game with no listed play has no header; a header's `plays` is its listed count. `nextPlayable(rows, null, …)` is the first playable play; past the last it is `null`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("teamPlayRows", () => {
  it("newest game first, each game in game order, a header per game", () => {
    const rows = teamPlayRows([older, newer], "with", null, EMPTY_CLIP_FILTERS);
    expect(rows.map((r) => (r.kind === "game" ? `# ${r.game.gameId} ${r.plays}` : r.key))).toEqual(["# new 2", "new:1", "new:2", "# old 1", "old:1"]);
  });
  it("only the side asked for", () => { /* "without" lists the other teamNumber's plays */ });
  it("a pick narrows, and a game left with nothing has no header", () => {
    const rows = teamPlayRows([older, newer], "with", new Set(["new:2"]), EMPTY_CLIP_FILTERS);
    expect(rows.map((r) => r.kind === "game" ? r.game.gameId : r.key)).toEqual(["new", "new:2"]);
  });
  it("a pick that matches nothing lists nothing", () => {
    expect(teamPlayRows([older, newer], "with", new Set(), EMPTY_CLIP_FILTERS)).toEqual([]);
  });
  it("filters and labels narrow within the pick", () => { /* types: turnover + labelsOf */ });
  it("25 games stay newest first", () => {
    const games = Array.from({ length: 25 }, (_, i) => gameOn(`2026-10-${String(i + 1).padStart(2, "0")}`));
    const heads = teamPlayRows(shuffle(games), "with", null, EMPTY_CLIP_FILTERS).filter((r) => r.kind === "game");
    expect(heads.map((h) => h.game.at)).toEqual([...heads.map((h) => h.game.at)].sort().reverse());
  });
});
describe("nextPlayable", () => {
  it("skips the plays of a game that can't play, and stops at the end", () => {
    const rows = teamPlayRows([a, b, c], "with", null, EMPTY_CLIP_FILTERS);   // b has no video
    const ok = (id: string) => id !== "b";
    expect(nextPlayable(rows, lastKeyOf("a", rows), ok)).toBe(firstKeyOf("c", rows));
    expect(nextPlayable(rows, lastKeyOf("c", rows), ok)).toBeNull();
    expect(nextPlayable(rows, null, ok)).toBe(firstKeyOf("a", rows));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- team-video`
Expected: FAIL, "teamPlayRows is not a function".

- [ ] **Step 3: Implement `teamPlayRows`, `nextPlayable`, `previousPlayable`**

- [ ] **Step 4: Run them to see them pass**

Run: `npm test -- team-video`, `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/lib/team-video.ts packages/shared/lib/__tests__/team-video.test.ts
git commit -m "team plays: the list across games and the next play that can play"
```

---

### Task 4: Reading a team's games, and collecting from more than one game

**Files:**
- Create: `apps/desktop/src/lib/use-team-plays.ts`
- Modify: `apps/desktop/src/components/game/use-collect.ts`
- Modify: `apps/desktop/src/components/game/game-watch-view.tsx` (the one caller)
- Modify: `apps/desktop/src/lib/use-clip-labels.ts`, and its callers in `components/game/`
- Test: headless regression (`npm run headless -- specs/G-` collect and label specs), typecheck

**Interfaces:**
- Consumes: Task 1 (`TeamGame`, `GamePlays`, `playability`), `listMatchesByIds`, `listEventsForMatchesChecked` (the desktop's `lib/matches-db.ts` wrappers), `probeMatches` (`lib/video-probe.ts`).
- Produces:

```ts
// lib/use-team-plays.ts
export interface TeamPlays {
  status: "none" | "reading" | "ready";     // none: no library games of this team
  games: readonly GamePlays[];               // read so far, newest first
  matches: ReadonlyMap<string, StoredMatch>; // by gameId: title, videoUrl, syncPoint
  playable: (gameId: string) => "ok" | "video" | "sync";
  failed: readonly TeamGame[];
  retry: () => void;
}
export function useTeamPlays(teamGames: readonly TeamGame[], key: string): TeamPlays;  // key = `${competitionId}:${teamId}`

// components/game/use-collect.ts
export interface CollectScope {
  key: string;                                     // a game's id, or `team:${competitionId}:${teamId}`
  games: readonly StoredMatch[];
  title: string;                                   // a new playlist's suggested name
  from: { matchId: string; title: string } | null; // the editor's way back; null from a team
  surface: "game" | "team_plays";                  // on every collect_* event
}
export function useCollect(input: { scope: CollectScope; orgId: string | null; includeUnscoped: boolean }): Collect;

// lib/use-clip-labels.ts
export function useClipLabels(orgId: string | null, matchIds: readonly string[], surface: string): /* unchanged return */;
```

What changes in `useCollect` and nothing else: the target is read and written under `scope.key`; an added clip's `matchId` comes from the play's key (`p.key.split(":")[0]`), not from one game; a send reads `scope.games` beside the playlist's games; `held` is `heldForPlayers` for each game in scope, joined by playlist id; `candidates` put first the playlists holding clips of any game in scope; `openPlaylist` passes `scope.from` (or no `from`); `setAddClipsScope` takes `scope.games`' ids, at most `MAX_BROWSER_GAMES`; `suggestedName` is `scope.title`; every `collect_*` event carries `surface`. The Game view passes `{ key: match.id, games: [match], title: match.title, from: { matchId: match.id, title: match.title }, surface: "game" }` and behaves exactly as before.

`useTeamPlays`: reads `listMatchesByIds` for the games' ids, then plays four games at a time, newest first, each game into `games` as it lands; a stale read for another `key` never lands (drop it on arrival when `key` moved on); a failed game goes to `failed`, `retry` reads only those again; probes the videos once per key (`probeMatches`); `status` is `"ready"` when every game has landed or failed.

`useClipLabels` takes several games: one labels read, assignments for all of them (`listAssignmentsForMatches`), the per-game cache kept per game. Game view callers pass `[match.id]`.

- [ ] **Step 1: Run the Game view's collect and label specs as the baseline**

Run: `npm run headless -- specs/G-` in `apps/desktop` (≥ the collect and label specs it lists today), output to the workspace, read the tail.
Expected: PASS (note any flaky spec by name; it is the baseline).

- [ ] **Step 2: Change `useCollect` to a scope, `useClipLabels` to several games, and the Game view's calls**

- [ ] **Step 3: Write `useTeamPlays`**

- [ ] **Step 4: Typecheck and run the same specs again**

Run: `npx tsc --noEmit` in `apps/desktop`; `npm run headless -- specs/G-`
Expected: no type errors; the same specs pass as in Step 1.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/use-team-plays.ts apps/desktop/src/components/game apps/desktop/src/lib/use-clip-labels.ts
git commit -m "team plays: read a team's games, and collect and label across games"
```

(`useTeamPlays` gets its behavioural tests through the page in Tasks 5–7: it has no logic beyond reading and ordering that Task 1 does not already test.)

---

### Task 5: Season: the counts and the Watch links

**Files:**
- Modify: `apps/desktop/src/pages/team.tsx`
- Modify: `apps/desktop/src/components/team/team-header.tsx`, `team-keys-section.tsx`, `team-players-section.tsx`
- Create: `apps/desktop/src/components/team/team-shots-section.tsx`
- Modify: `packages/shared/types/analytics.ts`
- Modify: `apps/desktop/headless/specs/P-teams.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`teamLibraryGames`, `teamVideo`, `keyStatOf`, `videoKeyLine`, `playersCell`, `useTeamPlays`), `HalfCourt`, `courtPercent` (`components/game/stats/half-court.tsx`).
- Produces:

```ts
// pages/team.tsx
export type TeamView = "season" | "plays";
export interface TeamPageState { from?: TeamPageFrom; back?: { label: string; path: string }; pick?: PlaysPick | null; side?: PlaysSide }
// watch(pick, side, action) navigates to `?view=plays` with { ...state, pick, side } and sends team_page_action
```

Analytics: `team_page_action.action` gains `watch_all`, `watch_key`, `watch_shots`, `watch_player`; optional properties `key` (`${end}.${metric}`) and `zone`.

What it draws (spec, "Season"): the header's "Watch all n plays" after the coverage line; under each key with `keyStatOf` non-null one `videoKeyLine` and Watch (no Watch at count 0); "Their shots in your games" after How they play (caption `${games} games · ${attempts} shots · made of attempted`, `1 game` singular; the line "From the plays in your games, not the season."; the caption line for `withoutPositions`; not drawn when `shots.games` is 0 and `withoutPositions` is 0); the Players table's last column "In your games" with `playersCell` and Watch, or "Not in your games". Nothing new while `useTeamPlays().status !== "ready"`, and nothing new when `"none"`. Watch is a link-styled button (`text-primary`, keyboard reachable).

- [ ] **Step 1: Write the failing headless tests in `P-teams.spec.ts`**

```ts
test("Season shows the coach's games beside the keys and opens their plays", async ({ page }) => {
  const mine = await aLibraryGame(page);
  await mockLeague(page, madeUpLeague({ libraryGame: mine.sourceGameId }));
  await openTeam(page, "Alfa");
  await expect(page.getByRole("button", { name: /^Watch all \d+ plays$/ })).toBeVisible({ timeout: 30_000 });
  const line = page.getByText(/^In your game: /).first();          // one library game
  await expect(line).toBeVisible();
  await expect(page.getByRole("region", { name: "Their shots in your games" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Players" }).getByText(/^1 game$/).first()).toBeVisible();
});
test("a team with none of your games shows no video lines", async ({ page }) => {
  await mockLeague(page, madeUpLeague({}));
  await openTeam(page, "Beta");
  await expect(page.getByRole("heading", { name: "What stands out" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^In your/)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Their shots in your games" })).toHaveCount(0);
});
```

(`openTeam(page, name)`: Teams in the sidebar, then the team's row; add it beside the spec's other helpers if it isn't there.)

- [ ] **Step 2: Run them to see them fail**

Run: `npm run headless -- specs/P-teams.spec.ts -g "Season shows|none of your games"` in `apps/desktop`
Expected: FAIL on "Watch all … plays" not found.

- [ ] **Step 3: Draw the Season additions and wire `watch`**

- [ ] **Step 4: Run them to see them pass, then the whole P-teams spec**

Run: `npm run headless -- specs/P-teams.spec.ts`; `npx tsc --noEmit`
Expected: PASS (32 + 2); no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/pages/team.tsx apps/desktop/src/components/team packages/shared/types/analytics.ts apps/desktop/headless/specs/P-teams.spec.ts
git commit -m "team plays: the coach's games beside the season, with Watch"
```

---

### Task 6: Plays: the switch, the filters and the list

**Files:**
- Create: `apps/desktop/src/components/team/team-view-switch.tsx`
- Create: `apps/desktop/src/components/team/team-plays-view.tsx`
- Create: `apps/desktop/src/components/team/team-plays-filters.tsx`
- Create: `apps/desktop/src/components/team/team-play-list.tsx`
- Modify: `apps/desktop/src/pages/team.tsx`, `packages/shared/types/analytics.ts`
- Modify: `apps/desktop/headless/specs/P-teams.spec.ts`, `apps/desktop/headless/helpers.ts` (`GameReadPatch.videoUrl`)

**Interfaces:**
- Consumes: Tasks 1–5 (`teamPlayRows`, `pickKeys`, `flipPick`, `pickLabel`, `useTeamPlays`, `TeamView`, `TeamPageState`), Add clips' separate components (`EventTypeChips`, `MultiSelectDropdown`, `FilterPresetsMenu`, `LabelPickerPopover`, `LabelChip`, `useListWindow`, `useFilterPresets`), `SegmentedControl`, `EmptyState`, `ImportPick` (step 1).
- Produces: `TeamViewSwitch({ value: TeamView; onChange })` (Season with `ChartColumn`, Plays with `Film`, leading after Back); `TeamPlaysView` props `{ plays: TeamPlays; side; pick; onSide; onClearPick; importPick; latestImportable: TeamGameRow | null; orgId }`.

What it draws (spec, "Plays"): the toolbar switch; With the ball | Without the ball (`flipPick` on a change); Games (every game ticked to start, no limit, untick any; a game picker of its own over `TeamGame`s, since Add clips' `GamePicker` caps at 10), Player (that side's players across the games), Shot type, Situation, Labels, Presets (`applyPresetFilters`, as Add clips); the pill (`pickLabel` with the count of picked plays before other filters; a `role="group"` named "Picked plays") with Clear; the event chips; the list header `${n} plays in ${g} games` and "Newest game first"; a header row per game (`vs|at opponent`, date, result and score, `${plays} plays`) of the list's row height, the top row's game pinned above the list; play rows (clock, `#no name`, what happened, label chips), the lit row `bg-row-selected`; a game whose `playable` isn't `"ok"` dimmed (`opacity-55`) under one line: "This game's video isn't on this computer." + "Locate video" / "This game isn't synced yet." + "Set the tip-off", both linking `/matches/${gameId}?view=details`; no plays: "No plays match." with Clear filters; reading: games as they land, a failed game "Couldn't load plays for ${title}." with Try again; with `status === "none"`: EmptyState title "None of their games are in your library.", body "Import one of their games to watch their plays here.", button `Import their latest game: ${vs|at} ${opponent}, ${playedDay(at)}` (to `/upload` with that game's pick; no button without an importable game). `?view=plays` in the URL; the router state keeps `pick` and `side`; each view keeps its scroll for the visit; Season | Plays cross-fades 150 ms (none with reduced motion).

Analytics: `team_plays_viewed` `{ games, plays, from: "switch" | "watch_all" | "key" | "shots" | "player", side }` once per open of Plays when its games are read.

- [ ] **Step 1: Write the failing headless tests**

```ts
test("Watch on a key opens Plays with its plays picked", async ({ page }) => {
  // library game + made-up league as in Task 5; the first key line's Watch
  const line = page.getByText(/^In your game: /).first();
  const count = Number((await line.innerText()).match(/: (?:\d+ of )?(\d+)/)![1]);
  await line.locator("..").getByRole("button", { name: "Watch" }).click();
  await expect(page).toHaveURL(/view=plays/);
  const pill = page.getByRole("group", { name: "Picked plays" });
  await expect(pill).toContainText(` · `);
  await expect(page.getByText(new RegExp(`^${count} plays? in 1 game$`))).toBeVisible();
});
test("flipping the side swaps a key's pill and clears a player's", async ({ page }) => { /* Turnovers → Turnovers forced; a player's Watch → flip → no pill */ });
test("Plays with none of their games offers their latest game", async ({ page }) => {
  await mockLeague(page, madeUpLeague({}));
  await openTeam(page, "Beta");
  await page.getByRole("radio", { name: "Plays" }).click();
  await expect(page.getByText("None of their games are in your library.")).toBeVisible();
  await page.getByRole("link", { name: /^Import their latest game: / }).click();
  await expect(page).toHaveURL(/\/upload/);
});
test("a game without its video is dimmed and says what to do", async ({ page }) => {
  await patchGameReads(page, { videoUrl: null });   // GameReadPatch gains `videoUrl?: null` (helpers.ts): the read's games lose their video
  // open Alfa → Plays
  await expect(page.getByText("This game's video isn't on this computer.")).toBeVisible();
});
test("a pick that matches nothing says so", async ({ page }) => {
  // open /teams/:c/:t?view=plays with router state { pick: { kind: "player", personId: 999999, name: "Nobody" } }
  await expect(page.getByText("No plays match.")).toBeVisible();
});
test("another team while plays are reading shows only its own games", async ({ page }) => {
  await delayPlaysReads(page, 3000);
  // open Alfa's Plays, go Back, open Beta's Plays at once → "None of their games…" stays, no Alfa game header lands
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run headless -- specs/P-teams.spec.ts -g "Plays|pick|without its video|another team"`
Expected: FAIL on the missing Plays radio / pill.

- [ ] **Step 3: Build the switch, the filters and the list (no playback yet: a row click lights it)**

- [ ] **Step 4: Run them to see them pass, then the whole spec, then typecheck**

Run: `npm run headless -- specs/P-teams.spec.ts`; `npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/team apps/desktop/src/pages/team.tsx packages/shared/types/analytics.ts apps/desktop/headless/specs/P-teams.spec.ts
git commit -m "team plays: the Plays view, its filters and its list across games"
```

---

### Task 7: Plays: playback across games, collecting and labels

**Files:**
- Create: `apps/desktop/src/components/team/use-cross-game-playback.ts`
- Create: `apps/desktop/src/components/team/team-plays-stage.tsx`
- Modify: `apps/desktop/src/components/team/team-plays-view.tsx`, `team-play-list.tsx`
- Modify: `apps/desktop/headless/specs/P-teams.spec.ts`

**Interfaces:**
- Consumes: Tasks 3–6 (`nextPlayable`, `previousPlayable`, `TeamPlays`, `useCollect` with `CollectScope`, `useClipLabels` over several games), `usePersistentVideo`, `PlayerStage`, `computeVideoTime`, `clipBounds`, `isLocalPath`, `streamFileSrc`, `CollectControl`, `GameNowBar` (or its parts), `useHotkeys`, `useKeyScope`, `resolvePlayerKey`, `labelForKey`.
- Produces:

```ts
export function useCrossGamePlayback(input: {
  video: HTMLVideoElement;
  rows: readonly TeamPlayRow[];
  matches: ReadonlyMap<string, StoredMatch>;
  playable: (gameId: string) => boolean;
  preRoll: number;
  postRoll: number;
}): {
  currentKey: string | null;
  play: (key: string) => void;       // load the game's file if another, seek to the play's pre-roll, play, run on
  next: () => void;
  previous: () => void;
  src: string | null;                // the current game's stream url
};
```

Behaviour copied from Add clips' sheet (`clip-browser-panel.tsx` around `seekToEvent`, `pendingSeekRef`, `queueRef` and the `timeupdate` handler), changed only where Plays differs: the queue is `rows` with `nextPlayable`, so the run continues into the next game's first playable play (loading that game's file, then seeking once it has loaded) and stops after the last. Pre- and post-roll: the target playlist's clip length when it has one, else the editor's defaults (`clip-timing.ts`).

The stage and now bar: the opponent and clock over the video; under it the play in words, the game, Label (G) and Add (A) through `useCollect({ scope: { key: \`team:${competitionId}:${teamId}\`, games, title: \`Scout ${teamName}\`, from: null, surface: "team_plays" } })` and `CollectControl` on the toolbar's right. Keys: Space, J K L, arrows; ↑ ↓ previous / next listed play; A add; G label; ⇧G the same label again; ⌥1–⌥9 a label's key; ⌘-click / Shift-click select; ⌘A every listed play; Esc lets go; ⌘F the player search. A key scope `team-plays`, active only in Plays.

- [ ] **Step 1: Write the failing headless tests**

```ts
test("Plays plays a play and adds it to a new playlist", async ({ page }) => {
  // library game with the fixture video linked (linkStageGameToFixture), Alfa → Plays
  await page.getByRole("button", { name: /^Q\d / }).first().click();
  await expect.poll(() => page.evaluate(() => !document.querySelector("video")!.paused)).toBe(true);
  await page.keyboard.press("a");                     // no target yet: the picker opens
  await chooseNewTarget(page, "zz team plays");
  await expect.poll(() => playlistClips(page, "zz team plays")).toHaveLength(1);
  // clean up: deletePlaylistsNamed(page, "zz team plays"); restoreGameVideo(page, link)
});
test("↓ moves to the next play and its label key labels it", async ({ page }) => { /* ↓ → the lit row moves; ⌥1 → a chip */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm run headless -- specs/P-teams.spec.ts -g "plays a play|moves to the next"`
Expected: FAIL (the video stays paused).

- [ ] **Step 3: Write `useCrossGamePlayback`, the stage and the now bar, and wire collecting, labels and keys**

- [ ] **Step 4: Run them to see them pass; then P-teams, K-search, the G- collect specs and typecheck**

Run: `npm run headless -- specs/P-teams.spec.ts specs/K-search.spec.ts specs/G-`; `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/team apps/desktop/headless/specs/P-teams.spec.ts
git commit -m "team plays: play across games, collect and label from the team"
```

---

### Task 8: Docs and the full checks

**Files:**
- Modify: `docs/teams.md` (a "Plays" part: what counts, the picks, the rulings above), `docs/game-view.md` (one line: `useCollect` and `useClipLabels` take several games), `CLAUDE.md` (the teams docs line mentions the plays)

- [ ] **Step 1: Write the docs**

- [ ] **Step 2: Run every check**

Run: `npm test` and `npm run typecheck` in `packages/shared`; `npx tsc --noEmit` in `apps/desktop` and `apps/web`; `cargo test` in `apps/desktop/src-tauri`; `npm run headless` in `apps/desktop` (output to the workspace, read the tail).
Expected: all pass; a flaky spec outside P-teams passes on a rerun and is named in the final message. Then a headless screenshot of Season and Plays in dark and in light, read by eye.

- [ ] **Step 3: Commit**

```bash
git add docs/teams.md docs/game-view.md CLAUDE.md
git commit -m "team plays: docs"
```
