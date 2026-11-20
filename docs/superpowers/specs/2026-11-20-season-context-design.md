# Season context: design

Status: draft for Leonard's approval, 2026-11-20. Part 2 of 3 (1: game stats,
on `feat/game-stats`; 3: an opponent page across games). Nothing is built.

## Intent

A coach reading a game in the Stats view sees, for each team, whether the
night was normal for them: where tonight's numbers sit against the team's own
season, and which differences are big enough to matter. The page stays easy
to read; season numbers sit quietly behind tonight's, and only the real
differences are written out.

Why: one game's numbers mean little without the team's normal. "Uppsala
turned it over on 22% of possessions" becomes useful when the coach can see
that 15% is their usual, and then open those turnovers.

## Goals

- Each row of "Why it went that way" (points per possession, eFG%, turnover
  rate, offensive rebounds won, free-throw rate) shows each team's season
  average as a mark on that team's bar.
- A caption under tonight's number, "usually 52% · 4th", only when the gap
  is real for that team (see Real gap). On the 2026-11-20 games that is
  about two captions a game (most games 0 to 4), not ten.
- One line under the score with each team's place in the table.
- Season numbers counted with the same formulas as tonight's, so a mark and
  a bar never disagree because of a definition.
- The view draws at once from the plays, as today. Season context arrives
  after it, and the page works the same without it.

## Non-goals

- The opponent page, season trends, and a team's full defensive profile
  (part 3).
- Season marks for what the opponent allows (in the hover text only).
- Web and mobile.
- Leagues without Genius statistics (Profixio, games imported before Genius).
- Changing the player season numbers (part 1's Game | Season switch).

## Anti-goals

- A flag on every row, or a gap flagged that one game's noise explains.
- Red and green, or any colour saying good or bad.
- A league number that looks clickable. Only tonight's numbers open plays.
- A season number from a different formula than tonight's.
- Spending Genius quota before a coach opens the Stats view.

## Constraints

- Builds on `feat/game-stats` (part 1): `FactorsSection`, `teamFactors`,
  `pointsFrom` and the Stats view's layout are the starting point.
- Genius Warehouse calls only through the `genius` edge function, cached
  (Genius requires a caching backend; 20,000 calls a month shared by prod and
  staging). The key never leaves the function.
- Pure logic in `packages/shared/lib` with vitest; UI in
  `apps/desktop/src/components/game/stats/`.
- `apple-design` skill and the app's rules: neutral fills, the accent only on
  controls, team colours from `team-tints.ts`, tabular figures. Copy with
  the `copywriting` skill.
- Data terms: Leonard has said to treat them as fine for now (2026-11-20).

## What Genius gives (probed 2026-11-20, SBL Herr 2026/27, competition 48974)

- `/statistics/teammatch/competitions/{c}`: one row per team per game per
  period, 110 fields, in pages of 500 rows (about two calls a season so far,
  more late in the season). The whole-game rows (`periodType` REGULAR,
  `periodNumber` 0) carry points, points against, FGM/FGA, 3PM/3PA, FTM/FTA,
  offensive and defensive rebounds, turnovers, and paint, second-chance,
  fast-break, off-turnover and bench points. Rows say `matchId` and
  `teamId`, not home or away.
- `/competitions/{c}/standings`: position, played, won, lost, `last5`
  ("LWWLW"), `streak` ("1", "-2"), points difference.
- `/statistics/teamcompetition/competitions/{c}`: season totals per team.
  Not needed: summing the whole-game rows gives the same totals and lets
  tonight's game be left out. Its ready-made ratio averages are wrong (eFG
  average "0.05", pace 0); never read them.
- What the counts hold (checked on the probe's rows):
  - The whole-game row includes overtime: Luleå's season points are its
    periods 1 to 4 plus its overtime row, and equal the standings' points for.
  - Offensive and defensive rebounds include team rebounds:
    `sReboundsTotal = sReboundsOffensive + sReboundsDefensive =
    sReboundsPersonal + sReboundsTeam` on all 100 rows. Our game count does
    the same (`teamRow` in `game-box.ts`).
  - Turnovers include team turnovers: Luleå's 126 hold 5 team ones and match
    the public page's 10.5 a game. Ours do the same.
  - Unknown: whether dead-ball rebounds (`sRebounds*Deadball`, non-zero on
    93 of 100 rows) are inside the offensive and defensive counts, and
    whether our plays count them. The plan's first task settles it (see
    Testing) before the cached payload's shape is fixed; the payload keeps
    the dead-ball and team fields so the formula's inputs can change without
    a new fetch.
- Our eFG formula on Genius totals matches Genius's own eFG exactly.
  Genius's possession count is one number per game for both teams; ours is
  per team (`FGA − OREB + TO + 0.44 × FTA`). Use ours everywhere.
- How much one game moves: across the league, a team's single-game number
  swings around its season by about 0.11 points per possession, 6 points of
  eFG, 5 of turnover rate, 8 of offensive rebounds won and 0.12 of
  free-throw rate. The teams' season averages differ from each other by less
  (0.09, 3.6, 2.6, 2.8 and 0.04). So a team's own swing, not the league
  ladder, decides what counts as unusual, and ranks are quiet detail.

## Approaches

**How the comparison looks** (mockups shown in the conversation)

1. *A mark on each bar (chosen).* The existing paired bars stay; a thin line
   on each team's bar marks its season, and a caption appears under tonight's
   number only for a real gap. Fits the section as built, reads at a glance,
   and adds no new section. Cost: the line has to be learned once, so a
   one-line key sits under the section.
2. A season column beside each team's number, with rank. Rejected: the
   section turns into a dense table and nothing says where to look.
3. Sentences about what stood out. Rejected for now: clearest, but it hides
   the rest and generated sentences read like a summary bot. A candidate for
   a one-line summary above the bars later.

**Where the season numbers come from**

1. *Genius per-game team rows, summed in our code (chosen).* Complete (all
   five factors, both ends), counted with our formulas, and tonight can be
   left out. About three calls per competition per refresh.
2. The public hosted pages. Rejected: no free-throw attempts and no
   opponent rebounds, so free-throw rate and offensive rebounds won would
   have no mark, and nothing on defence.
3. Genius season totals (`teamcompetition`). Rejected: totals only, so
   tonight can't be left out and nothing gives what a team allowed.
4. Counting every league game's play-by-play. Rejected: two calls a game
   and heavy work for numbers Genius already sums.

## Decisions (Leonard approved these in the conversation)

1. **The season is the team's other games.** Tonight's game is left out of
   the average it is compared with.
2. **The bar's mark is the team's own season.** What the opponent usually
   allows is in the hover text ("Borås usually forces turnovers on 13%").
3. **Under four other games, no captions,** and the key says "after 3
   games".
4. **Cost:** fetched only when a coach opens Stats on a Genius game, through
   the `genius` function, cached 12 hours per competition. About three
   calls per refresh; at most about 2,500 of the 20,000 a month.

## Which games are the season (my call)

Regular-season games of the same competition, by the fixture list's
`matchType` (the payload keeps it per game). A game of another type (finals)
is compared with the regular season, and the key says so: "Each line marks
the team's regular season." Swing and ranks use regular-season games only.

Standings: SBL Herr returns one table. When a competition returns several
pools, a team's place is its `position` within its own pool, as Genius gives
it; factor ranks are across every team in the competition ("of 11" counts
the teams with a regular-season game).

## The bars' scale (my call)

Each factor row gets a fixed scale, the same for every game, so a season
mark always has a place on the track and nothing re-scales when the season
arrives: points per possession 0 to 1.6, eFG 0 to 75%, turnover rate 0 to
35%, offensive rebounds won 0 to 60%, free-throw rate 0 to 0.7. A value past
the end fills the track. This changes part 1's bars, which today fill to the
larger of the two teams; fixed scales also make one game's bars comparable
with another's.

## Real gap

A gap is real when the team has at least four other games and
`|tonight − season| ≥ 1.5 × swing`, where `swing` is the league's typical
single-game swing for that factor: for each team with at least three games,
the standard deviation of its per-game values; then the mean over those
teams. One value per factor per competition, so a team with few games
doesn't get a noisy threshold of its own. With the 2026-11-20 numbers that
is about 0.17 points per possession, 9 points of eFG, 7 of turnover rate, 12
of offensive rebounds won and 0.18 of free-throw rate. Replayed on the 50
SBL Herr games then available, with each game left out of its own season:
1 × swing gives 4 captions a game, 1.5 × gives 2.0 (most games 0 to 4), 2 ×
gives 0.9. 1.5 is the setting; one constant, `GAP_SWINGS`.

## Ranks

Rank among the teams of the competition with at least one game, 1 = best:
highest for points per possession, eFG%, offensive rebounds won and
free-throw rate; lowest for turnover rate. Tonight's two teams are ranked on
their other games against every other team's full season; ties share a rank.
Shown as "4th" in a caption and "4th of 11" in the hover text.

## The view

```
 Score                 Q1  Q2  Q3  Q4    T
 Borås                 24  31  22  34  111
 Uppsala               27  22  30  25  104
 Borås 5th · 7–5 · won 4            Uppsala 6th · 5–7 · lost 1

 Why it went that way
        1.18 ====|=  Points per possession  ==|===   0.94
         58% ===|==     Shooting (eFG%)     ===|=    47%
  usually 52% · 4th
         12% ==|=        Turnover rate      ===|===  22%
                                                     usually 15% · 8th
         31% ==|==  Offensive rebounds won  ==|=     24%
        0.22 ==|=       Free-throw rate     =|==     0.31
 Each line marks the team's season, from its other 11 games.
 Points from: paint 48–36 · second chance 14–9 · …
```

- **The mark:** a 2 px line across the bar track at the season value, in the
  primary text colour, on the same scale as the bar. It never opens plays;
  the number beside the bar still does.
- **The caption:** under tonight's number, secondary text, footnote size:
  "usually 52% · 4th". Only for a real gap. Words, no sign and no colour, so
  turnover rate reads the same way as the rest.
- **Hover** (the row's season mark and caption, one tooltip per team side):
  "Season, 11 other games: 52% · 4th of 11" and a second line with what the
  opponent usually allows: "Uppsala usually allows 51%".
- **The key** under the section: "Each line marks the team's season, from
  its other 11 games." With different counts: "from their other games (11
  and 10)". Under four: "… after 3 games" and no captions.
- **Standings line** under the score, one per team, from the table as it
  stands today: "5th · 7–5 · won 4" (streak "1" → "won 1", "-2" → "lost 2").
  Hover: "Today's table. Last five: W L W W W."
- **Points from:** no marks; each figure's hover adds "usually 38 a game".
- **Loading:** nothing shows until the season arrives; then the marks,
  captions, key and standings line appear without animation.
- **Failure or no season** (not a Genius game, competition not in the
  catalogue, upstream down with no cache): the view is part 1's, with no
  season line. Only an upstream failure adds the line "Season numbers aren't
  available right now." Layout errors don't apply; this is JSON.
- **Tonight's game missing from Genius's rows** (statistics not built yet):
  still works. The two teams come from the fixture list (below).

## The data path

- **`genius` function, new action `season` `{ competitionId }`.** Any signed-in
  user, competition must be in the catalogue (as `fixtures`). Fetches every
  page of `teammatch` and the standings, keeps only whole-game regular rows,
  trims each to the fields above plus `matchId` and `teamId`, and adds each
  game's home and away team ids from the cached fixture list
  (`isHomeCompetitor`), so the payload is
  `{ games: [{ matchId, homeTeamId, awayTeamId, home?: TeamGame, away?: TeamGame }], standings: [...], fetchedAt }`,
  with every fixture listed even before its statistics exist. Cached 12
  hours per competition in a new server-written table (no RLS policies, as
  `genius_fixture_cache`). On an upstream error it serves the stale cache
  when there is one.
- **`packages/shared/lib/season-context.ts`** (pure):
  `seasonContext(payload, matchId)` returns `null` when the game isn't in
  the payload, else `{ home: TeamSeason, away: TeamSeason, teams: number,
  swing: Record<FactorKey, number> }`. `TeamSeason` holds `teamId`, `games`
  (other games), `factors` and `allowed` (both `TeamFactors` shapes),
  `perGame` for the "Points from" figures, `ranks` per factor, and the
  standing (`position, won, lost, last5, streak`). Plus
  `realGap(tonight, season, swing, games)`.
- **One formula.** The factor formulas move out of `teamFactors` into one
  function over plain totals that both `teamFactors` (tonight, from plays)
  and `seasonContext` (from Genius rows) call.
- **Desktop:** a `useSeasonContext(match, leagues)` hook beside
  `useGameBoxScore`, reading through the existing genius client
  (`basketball-api.ts`), keyed by competition, called only by the Stats view.
- **Analytics:** `game_stats_viewed` gains `season` (`shown`, `none`,
  `failed`) and `season_gaps` (how many captions showed).

## Testing

- First, before the function and payload are built: one staging Genius game's
  totals counted from our plays (`gameBox` team totals) against Genius's
  whole-game row for the same game, field by field, to settle dead-ball
  rebounds and confirm the rest. Read-only; ask Leonard before probing
  staging if another session may be working there.
- Vitest for `season-context.ts` from a fixture trimmed from the
  2026-11-20 probe (public league numbers): sums leave tonight out; formulas
  equal `teamFactors` on the same totals; ranks and ties; lower-is-better
  turnover rate; swing and `realGap` at the four-game edge; a game missing
  from the rows; standings mapping.
- The headless Stats spec gains a mocked `season` answer: marks drawn, one
  caption, the key's count, the standings line; and a failing answer that
  leaves the view as part 1's.

## Left to the builder

The cache table's exact shape, the tooltip component, the mark's exact
opacity in dark mode, and how `geniusAll` pages `teammatch` (filter to
whole-game rows upstream if the endpoint allows it, else page and drop).
