# Teams

The desktop's **Teams** pages: the league's table and a page per team, with
each team's season from the league's numbers. Step 1 of the opponent page
(design: `docs/superpowers/specs/2026-11-21-team-page-design.md`, plan:
`docs/superpowers/plans/2026-11-21-team-page.md`). Season numbers only:
step 2 adds numbers from the coach's own video across games, step 3 reports
that start from a team.

## Where it lives

- **Sidebar:** Teams, the last row a coach or admin sees (Go menu, ⌘6 in a
  club; Organization moved to ⌘7). Players don't get it.
- **`/teams`:** the league picked in the toolbar's pop-up, each league's
  current season only (rosters are synced for current seasons alone). It opens
  on the league chosen last in this space (localStorage
  `scoutable_teams_league:<orgId>`), else the space's "Your team"'s, else the
  league of the coach's newest Genius game, else the first
  (`packages/shared/lib/teams-league.ts`).
- **`/teams/:competitionId/:teamId`:** a team, by the ids the season uses
  (Genius gives a team a new id each season).
- **`/teams/find/:leagueTeamId`:** a stable team (`league_teams`) to its newest
  season's page; search uses it, and a report's opponent will.
- **From a game:** in the Stats view's score table, each team's name opens its
  page once the season is in; Back returns to the game.
- **Search (⌘K):** a Teams group after Games, this season's teams from the team
  catalogue (`docs/search.md`).

## The league

One table per group (Basketettan Herr and Dam are played as Norra and Södra;
the other leagues are one table): place, team, W–L, points per possession
scored and allowed, how many of its games the coach has, and the last five as
dots. "Your next game" sits above when the space's team plays in this
competition. Built by `leagueTables` and `nextGame` in
`packages/shared/lib/team-schedule.ts`.

## A team

Top to bottom, each section plain data made in `packages/shared` (step 3 will
store a section in a report and the web page will draw it):

- **Header:** the standing line, the next or last meeting with the coach's
  team ("You play them Sat 28 Nov, away."), a bar per regular-season game (up
  for a win, down for a loss, as tall as the margin up to 20; a dot under a
  game in the library, which opens it on Stats), and "12 games played · 3 in
  your library" (`team-copy.ts`, `formStrip`).
- **What stands out** (`team-keys.ts`): up to three keys with the ball and
  three without, as sentences. A number is a key when the team has played 5
  regular-season games (`MIN_KEY_GAMES`), sits among the best or worst two of
  its group (`KEY_EDGE`), and is at least two standard errors from the group's
  average (`KEY_ERRORS`; the error is one game's usual swing ÷ √games). Shooting
  (eFG%) and the free-throw rate are never keys. Under 5 games the section is
  one line; with nothing that qualifies, another.
- **How they play** (`league-season.ts`): offence left, what it allows right,
  the game Stats view's five rows plus the share of shots from three, on fixed
  scales (`PROFILE_SCALE`), the group's average as a 2 px line, the place in the
  group beside each number (from 5 games). Then pace and points a game by
  source. Nothing here opens plays.
- **Players** (`team-players.ts`): who does what, by volume (most three-point
  attempts and offensive rebounds a game, free throws a game, and the best and
  worst free-throw percentage from 20 attempts; players with 3 games), then the
  league's season averages, most minutes first. The roster is
  `league_player_teams` for this season's team id; the lines are the league's
  season page. Earlier seasons have no roster.
- **Games:** the next two still to play, then the played ones newest first:
  "In your library" opens the game on Stats, **Import** opens the import page
  with that game chosen (`ImportPick`), else "No play-by-play" or the tip-off.

A team is measured against its own group: places, averages and keys count only
its group's teams; one game's usual swing is competition-wide. The game's Stats
view ranks within the group too (`seasonContext`), so the two pages agree.
Values equal but for rounding in the sums share a place and are never a key
(`apart`).

"In your library" is per coach: a coach reads only their own games
(`useLibraryGames`, `listMatchesLight` with `ownOnly`), archived ones included.

## Data

Two answers of the `genius` function, both already cached server-side, read
together per competition and kept half an hour in memory
(`apps/desktop/src/lib/league-data.ts`, which the Stats view's season context
shares):

- the **season** (`action: "season"`, part 2's): every game's team totals and
  the standings, with each team's group (`poolNumber`);
- the **fixture list** (`action: "fixtures"`): names, dates, scores, logos, and
  since this step each fixture's group name and number (`phaseName`,
  `poolNumber` in `trimFixture`). A function without them titles groups
  "Group 1", "Group 2".

The players' season lines come from Genius's hosted season page, as stats cards
read them; `SeasonLine` gained `ftaPg` (optional) for free throws a game. No
migration and no new Genius calls.

## Rollout

1. Part 2's migration (`genius_season_cache`) and `genius` function on
   production (`docs/game-view.md`, "Season context").
2. The `genius` function from this branch (the two fixture fields). It can be
   the same deploy as step 1.
3. The desktop release.

## Analytics

`team_page_viewed` (league, season, games, library_games, keys, own_team,
from), `team_page_action` (open_game, import, open_team, show_all_players,
show_all_games), `teams_league_changed`, and `search_result_opened` with kind
`team`.

## Checking it

- `packages/shared`: `npm test` (`league-season`, `team-keys`, `team-schedule`,
  `team-players`, `team-copy`, `teams-league`, `league-players-db`).
- Headless: `P-teams` runs on a made-up league (`headless/team-league.ts`,
  answered by `mockLeague`), plus `K-search`, `F-go-keys` and `O-game-stats`.
- Live on staging: Basketettan Herr shows Norra and Södra; SBL Herr's order by
  Scores and Allows should mostly follow Off Rat and Def Rat on Genius's hosted
  team statistics page (the values differ: Genius counts possessions its own
  way).
