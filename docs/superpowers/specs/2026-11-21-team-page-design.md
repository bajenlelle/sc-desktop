# Team page: design

Status: draft for Leonard's approval, 2026-11-21. Part 3 of the Stats work
(1: a game's Stats view; 2: each team's season beside the game), step 1 of 3
(2: plays across the coach's games; 3: scouting reports that start from the
team). Nothing is built.

## Intent

A coach preparing for an opponent opens that team's page and reads, in a
minute, what kind of team it is: what stands out, how it plays at both ends,
who does what, how it has been doing, and which of its games are in the
coach's library.

Step 1 is the half that needs no video. It works for every team in the
league before the coach has imported a single one of its games, because the
season is already read for part 2.

Why now: parts 1 and 2 put numbers beside one game, but a coach scouts a
team, not a game. This page is also where a scouting report will start in
step 3. Today a report can only be started from inside a playlist, and few
coaches find it.

## Goals

- From the sidebar to any team's page in two clicks; from a game in one.
- The page answers, top to bottom: what stands out, how they play, who does
  what, how their games went, and which of those games the coach has.
- About a dozen numbers before the first scroll, each with its place in the
  league beside it.
- Works with nothing imported.
- Season numbers and the coach's video never mix. This step shows season
  numbers only; the library appears as coverage (which games you have) and
  as links to those games.
- No new Genius calls and no migration. One small change to the `genius`
  function: a fixture also carries its group's name and number, so a league
  played in groups can name them (see "Groups"). Nothing cached changes.
- Each section's content is plain data made in `packages/shared`, so step 3
  can put a section into a report (see "What step 3 needs from this").

## Non-goals (this step)

- Numbers from the coach's video across games: pooled shots, lineups, "46
  turnovers in your video", a player's plays. Step 2.
- Any change to scouting reports. Step 3.
- Earlier seasons side by side, splits (home and away, last five as a
  filter), trend charts.
- Leagues without Genius statistics (Profixio, games imported before
  Genius). They get no team page; their game pages stay as they are.
- A page per player.
- Web and mobile. Sharing, printing or exporting the page.
- Gating by plan: every coach who has the Library gets it (open, below).

## Anti-goals

- A season number that looks as if it came from the coach's video, or the
  reverse.
- A wall of statistics. Coaches at this level say long scouts go unread.
- A label on a player that no number backs, such as "shooter" from a
  percentage on nine attempts.
- A key built on a noisy number: a shooting percentage, the free-throw rate,
  the last five games.
- A dead end: a team page with no way to its games, to another team or back
  to the league.

## Constraints

- Desktop only. Pure logic in `packages/shared/lib` with vitest; UI in
  `apps/desktop/src` beside the pages and the game's Stats pieces it reuses.
- Only data the app already has:
  - the season (`getGeniusSeason`, the function's `season` action): every
    game's team totals and the standings;
  - the fixture list (`getGeniusFixtures`): names, dates, scores, logos,
    whether a game has play-by-play;
  - the players' season averages (`loadSeasonPlayers`, Genius's hosted
    page, as stats cards and the game's Players table read them);
  - rosters and photos (`league_player_teams`, `league_players`). Both are
    readable by signed-in users, but no client reads the first today, so
    this is a new shared reader, not a migration;
  - the coach's own games in the space (`listMatchesLight` with `ownOnly`),
    as the Library and the import picker's "Imported" marks use. A coach
    can't read a colleague's games, so "in your library" is per coach.
- One formula. Every factor is `factorsOf` over `geniusTotals`
  (`game-box.ts`, `season-context.ts`), as in parts 1 and 2.
- Follow the `apple-design` skill and the app's rules: neutral fills for
  hover, pressed and selected rows; the accent only on controls; no colour
  says good or bad.
- Copy is English, sentence case, written with the `copywriting` skill.
- The repository is public: no secrets, no private figures in this doc or
  in fixtures (league statistics are public).
- Built on `feat/team-page`, cut from local `main` at 0e68623, which holds
  parts 1 and 2 and is not pushed.
- Ships as a desktop release, after part 2's migration and function are on
  production (they are on staging only today). The function's two new
  fixture fields can ride that same deploy; the desktop works without them
  (groups are then titled "Group 1", "Group 2").

## Approaches

**Where the numbers come from.**

1. *Join what the desktop already reads* (chosen). The season gives each
   game's totals and the standings; the fixture list gives names, dates and
   scores. Shared code joins them by match id. The backend changes by two
   fields on a fixture, and nothing cached is rebuilt. Cost: two requests
   instead of one, and the two caches can be hours apart (a finished game
   may have a score before it has totals; the row then shows the score
   alone).
2. *Extend the season answer* with names, dates and scores. One request and
   one consistent snapshot, but a function deploy, a version on the cached
   payload and a rebuild of every cached season, for nothing the coach sees.
3. *Parse Genius's hosted team pages.* Official ratings, but new parsers
   that break when the layout changes, a second definition of every factor
   beside part 2's, and no per-game rows to rank or measure spread with.

**Where it lives.**

1. *A Teams row in the sidebar* (chosen; Leonard approved the team page as
   the hub on 2026-11-21). A league table leading to a team is the pattern
   every sports product uses, and scouting tools give opponents a top-level
   place of their own.
2. *No new row*: reach a team only from a game and from search. Cheaper, but
   a coach with nothing imported never finds it, and that coach is who the
   season half is for.
3. *Rename Reports to Scouting* and put teams inside. It keeps five rows but
   hides two different things behind an umbrella name and moves a row
   coaches know.

**One page or several.** One scrolling page, like the game's Stats view
(chosen): four short sections, each showing its first few rows. Tabs would
hide the players and the games behind a click to save a scroll.

## Where it lives

- **Sidebar.** A sixth row, **Teams**, after Library, for the same people who
  see the Library (a coach or admin of the space). It joins `GO_PAGES`
  (`menu-shortcuts.ts`) and the macOS Go menu (`menu.rs`), so it takes the
  sixth number key and Organization's key moves from 6 to 7.
- **Routes.** `/teams` is the league. `/teams/:competitionId/:teamId` is a
  team, by the ids the season uses (Genius gives a team a new id each
  season). `/teams/find/:leagueTeamId` takes a stable team id
  (`league_teams`), reads its seasons (`getTeamSources`, `teamSeasons`) and
  replaces itself with the newest one's page; it is what search uses, and
  what step 3 will use for a report's opponent.
- **From a game.** In the Stats view's score table, each team's name opens
  its page when the season lists that team.
- **From search (⌘K).** A fourth group, Teams, after Games: this season's
  teams from the catalogue the team picker already reads (`useTeamCatalog`),
  found by team and club name, with the league to the right. This is the
  last piece and can ship after the rest.

## The league (`/teams`)

Toolbar: the title "Teams" and a pop-up button naming the league and season
("Superettan Herr · 2026/27"). It lists each catalogued league's current
season, and no earlier ones: rosters exist for current seasons only.

Which league it opens on, first that applies:

1. the one chosen last in this space (remembered on the computer);
2. the league of the space's "Your team", when its newest season is that
   league's current one;
3. the league of the coach's newest Genius game in the Library, when that
   league is in the list;
4. the first league in the catalogue.

Content, at the `wide` width:

```
 Your next game                                   (only with "Your team" here)
 Huddinge, away · Sat 28 Nov                                              >

 Superettan Herr · 2026/27
  #  Team                      W–L   Last 5   Scores  Allows  In your library
  1  Borås                     10–2  ●●●○●     1.14    0.98
  2  Jämtland                   9–3  ●○●●●     1.10    1.01    1 game
  5  Huddinge                   7–5  ○●●○●     1.08    1.01    3 games
  7  Fryshuset   Your team      6–6  ●○○●●     1.03    1.04    9 games
```

- One row per team in standings order; a click opens the team. A header
  sorts its column.
- Last 5: a filled dot for a win and a ring for a loss, oldest first, the
  same marks the Shots section uses for makes and misses.
- Scores and Allows are points per possession this season.
- "In your library" counts the team's games the coach has; empty for none.
- A league played in groups gets one table per group, under the group's
  name (see "Groups").
- The row of the space's own team carries "Your team".
- "Your next game" shows only when the space has a team in this competition
  with a game still to play. It opens the opponent's page.

States: skeleton rows while reading; "Couldn't load the league." with Try
again; "This league has no team statistics." for a competition without
them, and for a `genius` function that predates the season.

### Groups

Checked 2026-11-21 against staging's cached fixtures and the league's public
standings pages, at no Genius cost. SBL Herr, SBL Dam and Superettan Herr
are one table each. Basketettan Herr and Dam are played in two groups, Norra
and Södra (in Herr 14 teams and 182 games each, every game inside its
group).

- A standings row carries its group's number (`poolNumber`, already in the
  season payload; set even for a one-table league). A raw fixture carries
  the same number and the group's name (`phaseName`), but the function's
  `trimFixture` drops both. It gains `phaseName` and `poolNumber`; the
  fixture cache holds raw fixtures, so nothing is rebuilt.
- The league page shows one table per group number, titled with that
  group's name, in the name's order. One group: one table, no title (its
  name is just the league's, "SBL Herr"). The numbers on standings rows and
  on fixtures match (checked for SBL Herr and Superettan Herr).
  Without names (a function that predates the two fields): "Group 1",
  "Group 2", by number.
- **A team is measured against its own group.** Its places, the average its
  bars are marked with and its keys count only the teams of its group ("2nd
  of 14"), because those are the teams it plays and the ones the coach
  compares it with. One game's usual swing stays competition-wide: it
  describes how much any single game varies.
- Part 2's Stats view changes the same way (`seasonContext` ranks within the
  group), so a team's place is the same on both pages. In a one-table league
  nothing changes.
- Where a sentence or tooltip says "in the league", a grouped league says
  the group's name: "most in Södra", "4th of 14 in Södra".
- A team with standings in more than one group hasn't been seen in any
  current season. It would be listed in each table, and its page uses the
  row part 2 already picks (`standingOf`).

## The team (`/teams/:competitionId/:teamId`)

Toolbar: back (to where the coach came from, else Teams), the team's name,
and the league and season under it. No actions in this step.

```
 [<]  Huddinge
      Superettan Herr · 2026/27

 5th · 7–5 · won 2                    You play them Sat 28 Nov, away.
 ▂▅▁▇▃ ▂▆▅▁▃▆▂      12 games played · 3 in your library
   ·       · ·

 What stands out
  With the ball                         Without the ball
  Shoot a lot of threes: 44% of         Force turnovers: on 21% of
  shots, most in the league.            opponents' possessions, most in
  Crash the offensive glass: win        the league.
  34% of their misses, 2nd of 12.       Give up second chances: opponents
  Lose the ball: on 19% of              win 31% of their misses, 11th of 12.
  possessions, 11th of 12.

 How they play                    Season, 12 games · the line marks the league average
              Their offence                              What they allow
  1.08  4th  ====|==   Points per possession    ==|===   3rd   1.01
   51%  5th  ====|=       Shooting (eFG%)       ===|     2nd    47%
   19% 11th   ==|==        Turnover rate        ==|===   1st    21%
   34%  2nd  ===|==   Offensive rebounds won    ==|=    11th    31%
  0.31  3rd   ==|=        Free-throw rate       =|       4th   0.22
   44%  1st  ===|==   Share of shots from three  ==|=    5th    38%
  78 possessions a game, 2nd fastest.
  Points a game from the paint 36 · second chances 13 · fast breaks 15 ·
  turnovers 18 · the bench 22

 Players                                                        Show all 13
  Most threes: Lind 7.1 a game, Holm 4.6 · Offensive glass: Sand 3.2, Berg 2.4
  To the line: Berg 6.4 free throws a game, Lind 4.1
  Free throws: best Lind 81%, worst Berg 58%
  #  Player   GP  MIN  PTS  REB  AST  STL  BLK  TO  3P a game  3P%  FT%
  7  Lind     12   31 18.4  3.1  4.2  1.3  0.1 2.4  2.8 of 7.1  39%  81%
  …

 Games                                                          Show all 12
  Sat 28 Nov   at Fryshuset   You                              18:00
  16 Nov       vs Jämtland    L 78–84    1.01 – 1.09           In your library
  9 Nov        at Luleå       W 91–80    1.16 – 1.02           In your library
  26 Oct       at Uppsala     L 70–77    0.92 – 1.01           Import
```

### Header

- The standing line, as part 2 writes it (`standingLine`).
- When the space's team plays in this competition: the next meeting ("You
  play them Sat 28 Nov, away."), else the last one ("You beat them 83–81 on
  19 Oct." or "You lost to them 81–83 on 19 Oct."), else nothing. On the
  space's own team's page: "Your team."
- A strip of the season: one bar per regular-season game played, oldest
  first, up for a win and down for a loss, its height the margin (capped at
  20 points). A dot under a game that is in the library. The tooltip names
  the game ("9 Nov at Luleå, won 91–80. In your library."); a bar with a dot
  opens that game.
- The coverage line: "12 games played · 3 in your library", or "none in your
  library yet".

### What stands out

Up to three lines under **With the ball** and three under **Without the
ball**, as sentences with the number and the place in the league. It is the
first thing on the page because a coach wants a few keys, not a table.

What can be a key:

| | With the ball | Without the ball |
|---|---|---|
| Points per possession | scored | allowed |
| Share of shots from three | their own | their opponents' |
| Offensive rebounds won | their own | their opponents' |
| Turnover rate | their own | forced |
| Possessions a game | fast or slow | |

Shooting (eFG%) and the free-throw rate are in the table below but are never
a key: over a season this short they are the least settled, and late
intentional fouls inflate the free-throw rate.

A number is a key when all three hold:

1. the team has played 5 regular-season games or more;
2. it is among the best two or the worst two of its group;
3. it is at least twice its own uncertainty from the group's average (the
   mean of the teams' season values): the gap is 2 or more times (one
   game's usual swing ÷ √games). The swing is part 2's (`leagueSwing`),
   computed for the two new numbers as well; for a number the team allows
   it is the swing of opponents' single-game values.

The strongest by rule 3 come first. With fewer than 5 games the section is
one line, "Too early to say what stands out: 3 games played." With none that
qualify: "Nothing stands out. Close to the league average at both ends."
With keys on one side only, the other heading stays with a muted "Nothing
stands out." under it.

Replayed on the SBL Herr season fixture (11 teams, 8 to 10 games each), the
rule gives 0 to 4 keys a team, 3 for the median team: five teams have keys
on both sides, five on one side and one has none.

The sentences have no subject, so they read right on any team's page, the
coach's own included. Proposed copy (H = high, L = low; the place is "most
in the league", "fewest in the league", or "2nd of 12"):

| Key | H | L |
|---|---|---|
| Points scored | Score efficiently: 1.14 points per possession, {place}. | Struggle to score: 0.94 points per possession, {place}. |
| Threes | Shoot a lot of threes: 44% of shots, {place}. | Rarely shoot threes: 24% of shots, {place}. |
| Offensive rebounds | Crash the offensive glass: win 34% of their misses, {place}. | Leave the offensive glass: win 21% of their misses, {place}. |
| Turnovers | Lose the ball: on 19% of possessions, {place}. | Take care of the ball: turnovers on 12% of possessions, {place}. |
| Pace | Play fast: 78 possessions a game, {place}. | Play slowly: 66 possessions a game, {place}. |
| Points allowed | Easy to score on: 1.12 points allowed per possession, {place}. | Hard to score on: 0.94 points allowed per possession, {place}. |
| Threes allowed | Give up threes: 45% of opponents' shots, {place}. | Take away the three: 27% of opponents' shots, {place}. |
| Second chances | Give up second chances: opponents win 31% of their misses, {place}. | Clean the defensive glass: opponents win 22% of their misses, {place}. |
| Forced turnovers | Force turnovers: on 21% of opponents' possessions, {place}. | Rarely force turnovers: on 13% of opponents' possessions, {place}. |

### How they play

The game Stats view's factor rows, turned to one team: its offence grows left
from the label and what it allows grows right. Same five rows, order, labels,
help text and fixed scales (`FACTOR_SCALE`), plus a sixth row, the share of
shots from three (scale 0.6).

- Beside each number, its place in the team's group. On the left 1st is the
  best offence (fewest for turnovers; most for threes). On the right 1st is
  the best defence (most for forced turnovers; fewest threes allowed).
- A place among the best two or the worst two is in the regular text weight
  and colour, the rest muted: what the table stresses is what could be a
  key. No colour says good or bad.
- Each bar has the 2 px mark part 2 uses, here at the league's average.
- Nothing here opens plays, and the cells are not buttons: these are season
  numbers. A number's tooltip gives the place in words ("4th of 12 in the
  league").
- Under the rows: the pace line, then points a game from the paint, second
  chances, fast breaks, turnovers and the bench.
- With fewer than 5 games the places are left out and the caption says
  "Places appear after 5 games."

### Players

- **Who does what**, three lines above the table, each by volume and never
  by percentage alone:
  - most threes (attempts a game) and the offensive glass (offensive
    rebounds a game): the top two each;
  - to the line (free throws a game): the top two;
  - free throws: the best and the worst percentage among players with 20
    attempts or more.
  Only players with 3 games or more are named. A line with no one to name is
  left out. Free throws a game is on the league's page (FTAPG) and the
  parser reads it, but `SeasonLine` doesn't carry it: it gains an optional
  field, kept when a player's rows are combined. Attempts are that average
  times games, so the 20 is approximate.
- **The table**: the Season columns of the game's Players table, reused: GP,
  MIN, PTS, REB, AST, STL, BLK, TO, threes made and attempted a game, 3P%
  from 20 attempts, FT%. The photo and number lead the row. Sorted by
  minutes; a header sorts its column. The first 8, then "Show all 13".
- The team's players are its roster (`league_player_teams` for this season's
  team id); their lines come from the league's season page by player id. A
  roster member without a season line (staff, a player yet to play) is left
  out. The league's page lists a player once per team they appeared for and
  has no team column, so our parser combines those rows: a player who also
  played for another team shows the combined line, with the tooltip
  "Includes games for another team this season."
- Names open nothing in this step.
- States: "Couldn't load the players' season numbers." with Try again; "No
  roster for this team yet." when the roster hasn't been synced (rosters
  sync weekly). On a team page of an earlier season, reached from an old
  game, the section is one line: "Players are listed for the current season
  only."

### Games

- Games still to play first (the next two), then played games, newest first:
  the first 5, then "Show all 12".
- A played row: the date, "vs" or "at" and the opponent (its name opens that
  team's page), the result and score, then points per possession scored and
  allowed, muted. The space's own team as opponent carries "You".
- The last cell is the row's state:
  - **In your library**: the row opens that game on Stats.
  - **Import**: the game has play-by-play and isn't in the library. It opens
    the import page with that game already chosen.
  - "No play-by-play" (muted) for a game the league has no plays for.
  - the tip-off time for a game still to play.
- A game is in the library when one of the coach's own games in the space
  has its Genius match id (`sourceGameId`), archived ones included.

### States

Skeletons per section while reading. The season failing: "Couldn't load this
team's season." with Try again. A team the season doesn't list: "This team
isn't in this season." with a link to Teams. The page needs both the season
and the fixture list (the season has no names or dates), so either failing
is that one message. The players fail on their own, inside their section,
without taking the rest of the page down.

### Motion and materials

As the Stats view: the toolbar's material appears only once something has
scrolled under it; rows highlight on press; "Show all" expands in place with
the app's standard spring, and cross-fades under reduced motion.

## The numbers (`packages/shared/lib`)

- A league-wide reading of the season payload: for every team, its own and
  allowed factors, share of shots from three, possessions a game, points a
  game by source, standing, group, and its place within the group for each
  number at both ends; plus each group's average and the competition's
  single-game swing for each. Only regular-season games with both teams'
  rows count, as today. `seasonContext` keeps its behaviour and its tests in
  a one-table league and ranks within the group in a grouped one.
- The keys of one team from that reading (the rule above), and the sentence
  for each key.
- A team's games: the fixture list joined to the season's rows by match id,
  with result, score, points per possession both ways, whether it can be
  imported and whether it is still to play.
- A team's players: the roster joined to the season lines, and who does
  what.
- The league table's rows.

Every one returns plain, JSON-serialisable data and has vitest cases.

## What step 3 needs from this

Leonard, 2026-11-21: a coach should be able to hide and add sections in the
report. That is step 3's to design, but it shapes this step:

- A report will become a list of sections the coach controls: the ones a new
  report starts with, others they can add (how they play, the games, a
  section of their own with a name), and any of them hidden. A hidden
  section stays in the editor with its text and is left out of the shared
  page.
- A shared report is a snapshot drawn by the web app, so a section has to be
  data, not a desktop component. That is why each section above is produced
  by one shared function returning plain data, and the React component only
  draws it: step 3 stores that data in the report and the web page draws the
  same thing.
- The team page itself gets no hide or add control: four short sections
  don't need one.

## Analytics

- `team_page_viewed` once per open when the season is ready: `league`,
  `season`, `games`, `library_games`, `keys`, `own_team`, `from` (teams,
  game, search, team, other).
- `team_page_action`: `action` (open_game, import, open_team,
  show_all_players, show_all_games).
- `teams_league_changed`: `league`, `season`.
- The routes' `page_viewed` as for every page.

## Checking it

- `packages/shared`: `npm test`. Places in both directions and with ties;
  two groups; finals left out; the keys rule at each of its three
  conditions, its cap and the two numbers that are never keys; every
  sentence; who does what at its minimums; the games join for a fixture
  without rows, one still to play and one without play-by-play. The season
  fixture (`fixtures/season-sbl-herr.json`) serves the places and the keys
  of a one-table league. Its home and away sides are made up and it holds
  only played regular-season games in one group, so the groups, finals,
  games still to play and the join with a fixture list need small
  hand-built payloads.
- Headless (`O-` specs' helpers, with a fixture-list mock beside
  `mockSeason`): the league table, as one table and as two groups; opening
  a team; keys shown and, under 5 games, the early line; a library game
  opening on Stats; Import arriving with the game chosen; the failed and
  unavailable states.
- Live on staging, as part 2's check: open SBL Herr, and compare the order
  of teams by points per possession with the order of Off Rat and Def Rat on
  Genius's hosted team statistics page. The values differ (Genius counts
  possessions its own way); the orders should mostly agree.
- Typecheck, `cargo test` for the menu's keys, and the page in dark mode.

## Left to the builder

File and component names, icons (a crest, not people, for Teams), spacing,
skeletons, how `seasonContext` shares its internals with the league-wide
reading, the in-memory caches (the season and the fixture list per
competition, half an hour, as `use-season-context` does), team logos where
the fixture list has one, how the import page takes the chosen game, and
whether sorts are remembered for the visit.

## Open (Leonard's)

- **Data terms.** Showing the league's statistics this prominently hasn't
  been checked with Genius or the federation; only player photos were
  confirmed. Part 2 already shows season numbers, so this widens something
  that exists.
- **Plan.** Free for every coach with the Library, as proposed here, or a
  paid feature.
- **The key sentences.** Eighteen lines of copy to read through.
