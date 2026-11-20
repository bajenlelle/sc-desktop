# Game stats: design

Status: draft for Leonard's approval, 2026-11-20. Part 1 of 3 (2: season
context from the league's pages; 3: an opponent page across games). Nothing
is built.

## Intent

A coach opens a game and reads what happened, why, and who did it, then gets
from any number straight to the plays behind it. Today the game page has the
footage (Game) and a settings form (Details); the numbers a coach scouts with
are nowhere in the app, although the plays we store hold nearly all of them.

Why now: coaches use numbers to decide which video to watch, and the tools
they compare us with (Hudl, Synergy) open clips from a stat. We have the
plays and the video; the page that joins them is missing.

## Goals

- Read a game in a minute, in this order: the story (score by quarter, lead
  graph, runs), the why (points per possession, the four factors, where the
  points came from), the players, the shots, the lineups.
- Every number that stands for plays opens exactly those plays in the Game
  view.
- Works without video and without sync; neither is needed for numbers.
- Drawn at once from the plays already loaded. The network only adds
  minutes, plus-minus and season averages.
- Honest about one game being a small sample.

## Non-goals (this part)

Team season numbers, standings and league rank (part 2). The opponent page
(part 3). Web and mobile. Exporting, printing or sharing the stats. Editing a
number. New Genius API calls. Gating by plan: every coach who has the Library
gets the view (Leonard: say if it should be a paid feature).

## Anti-goals

- Numbers that lead nowhere: a stats page a coach reads and then has to find
  the plays by hand.
- A number that differs from the plays it opens.
- Percentages that pretend precision (2 of 3 shown as 67%).
- A second video on the page (one decoder per game page, `docs/game-view.md`).

## Constraints

- Desktop only. Pure logic in `packages/shared/lib` with vitest; UI in
  `apps/desktop/src/components/game/` beside the game view's pieces.
- What a game holds depends on how it was imported:
  - Genius imports since September 2026: everything (shot positions, the
    five on the floor per play, running score).
  - Older imports: no shot positions, no fives. Shots and Lineups are left
    out, with one line saying why.
  - Profixio and any source without misses, rebounds or assists: a column
    whose values are all unknown is dropped, as stats cards do.
  - No plays at all: an empty state, and the game opens on Details as today.
- Follow the `apple-design` skill and the app's own rules: neutral fills for
  hover, pressed and selected rows; the accent only on controls; team colours
  by `components/game/team-tints.ts`, as the game strip uses them.
- Copy is English, sentence case, written with the `copywriting` skill.
- Built on `main`, which holds `feat/game-wayfinding` since 2026-11-20 (the
  open games moved to the sidebar; merged locally, two commits not pushed
  yet). That merge changed the same page host (`pages/game.tsx`), so an
  older base would conflict.

## Approaches

**Where the view lives**

1. *A third view, Game | Stats | Details (chosen).* One purpose per view and a
   label that says what is behind it. A reading page wants the full width; the
   settings form wants a narrow column. Details and every link to it stay as
   they are.
2. Stats on top of the Details page, settings below. Rejected: two purposes
   on one page, and the settings a coach needs for an unsynced game would sit
   under a page of numbers.
3. Stats as a panel in the Game view. Rejected: a box score needs width, and
   the play list already owns that column.

**Where the numbers come from**

1. *Counted from the stored plays; minutes and plus-minus from the league's
   box score (chosen).* Instant, works offline, and a number always equals the
   plays it opens. This differs from stats cards, which show the league's
   numbers only; there the card goes to players, here the coach is led to
   video.
2. The league's box score as the source for everything. Rejected: a network
   read before anything draws, and nothing ties a number to its plays.
3. The Warehouse API's per-game statistics. Rejected: quota, and a new
   function action, for numbers the plays already give.

**How a number opens its plays**

1. *Hand the Game view the exact plays as one filter (chosen).* The Stats view
   computes a number from a set of plays and passes that same set, with a
   plain-words name ("Lind: three-point attempts"). The Game view shows it as
   one chip that clears with one click. Equal by construction, and it works for
   everything: a zone, a lineup, bench points, a run.
2. Translate each number into the existing filter chips (player + type).
   Rejected: zones, lineups, bench points and runs can't be said in that
   vocabulary, and a translated filter can drift from the number it came from.
3. List the plays in a panel on the Stats page. Rejected for now: a list
   without video is half an answer, and video there is a second decoder.

## The view

`/matches/:id?view=stats`. Toolbar as the other two views: back button, the
switch, the game's title. Content at the `wide` page width, one column,
scrolling. Both teams are always shown, home first (above or left), as on the
game strip.

```
[<] [ Game | Stats | Details ]  Fryshuset vs Huddinge

 Score                 Q1  Q2  Q3  Q4    T      lead graph, runs shaded
 Fryshuset             24  31  22  34  111      Largest lead +12 · 9 lead changes
 Huddinge              27  22  30  25  104

 Why it went that way
        1.18 ======  Points per possession  =====   1.09
         56% =====      Shooting (eFG%)     ====    51%
         14% ===         Turnover rate      =====   19%
         31% ====   Offensive rebounds won  ===     24%
        0.28 ===        Free-throw rate     ==      0.22
 Points from: paint 48–36 · second chance 14–9 · fast break 17–10 ·
              turnovers 21–12 · bench 28–19            About 94 possessions each

 Players                                           [ Game | Season ]
 Fryshuset
  #  Player    MIN PTS  FG   3P   FT  OREB DREB AST TO STL BLK PF  +/-  Season PTS
  4  Lind       34  27  9/17 4/9  5/6   1    3   6   3   2   0   2  +11    18.4
  …starters, then bench, then Team and Totals rows
 Huddinge
  …

 Shots
 [ half court, Fryshuset ]            [ half court, Huddinge ]
 At the rim 19/27 · Mid-range 8/17 · Threes 11/29     …

 Lineups
 Fryshuset: on the floor   Time   +/-      Huddinge: …
 4 · 7 · 11 · 15 · 23      11:20   +8
```

### Score

- Line score from `gameFlow().periods`, an overtime column per overtime.
- The lead graph is the game strip's (`flowChart`), smaller and still: no
  playhead, no scrubbing. Runs shaded with their score. Largest lead, lead
  changes and ties beside it.
- A quarter's score opens that team's baskets in the quarter ("Fryshuset:
  points in Q2"), like any other number. A run opens every play of its
  stretch, both teams' ("13–0 run in Q4"). The quarter headers open nothing.
- A game with no score to read (`source: "none"`) shows neither graph nor
  line score.

### Why it went that way

Paired bars mirrored around the label, home left. The better side of each row
is in the heavier weight; no colour says good or bad. Each label has its
plain-words meaning as a tooltip.

| Row | Counted as |
|---|---|
| Possessions | FGA − OREB + TO + 0.44 × FTA, per team; "About N possessions each" is the mean |
| Points per possession | points ÷ possessions |
| Shooting (eFG%) | (FGM + 0.5 × 3PM) ÷ FGA |
| Turnover rate | TO ÷ possessions |
| Offensive rebounds won | OREB ÷ (OREB + the other team's DREB), team rebounds counted |
| Free-throw rate | FTA ÷ FGA |

"Points from" is a second, quieter group: paint, second chance, fast break
(the feed's qualifiers on made shots and free throws) and bench (points by
players outside the first five on the floor; left out without fives). Each
figure opens its plays. Points from turnovers join the group only if the feed
marks them: the sample data doesn't show the qualifier, so it is checked on a
real game first.

### Players

- One table per team, home first. Starters (the first five on the floor)
  first, then the bench by minutes; without fives, by points. Then a Team row
  (team rebounds and turnovers) and Totals.
- Shooting is makes/attempts. No percentages per player for one game.
- MIN and +/- come from the league's box score through the existing loader
  (`loadGameStats`); until it answers, and when it can't, they show a dash.
  +/- then falls back to the on-floor stints (`onCourtStints`). Players the
  box score lists who have no play of their own get a row.
- A header sorts its column (largest first, again for smallest first). The
  sort lasts for the visit.
- **Game | Season** above the tables. Season swaps the columns for the
  league's season averages already read for stats cards
  (`loadSeasonPlayers`): GP, MPG, PPG, RPG, APG, SPG, BPG, TOPG, 3P made and
  attempted per game, 3P% and FT%. A 3P% is shown from 20 attempts
  (`LEADER_MIN_3PA`), else makes and attempts only. In Game, one muted
  trailing column, Season PTS, says whether the night was typical. Season
  numbers open nothing (they span games that may not be in the library) and
  look it: muted, no hover.
- Clicks: a number opens that player's plays of that kind (PTS: made shots
  and free throws; FG, 3P, FT: every attempt; the rest: those plays). The
  name opens all of the player's plays. MIN and +/- open every play while the
  player was on the floor. A zero opens nothing and is dimmed.
- The table keeps the name column in place and scrolls sideways under it when
  the window is too narrow for every column.

### Shots

- Two half courts side by side. A made shot is a filled dot, a miss a ring,
  in the team's tint. Both ends are folded onto one basket (a shot past
  half court at x > 50 becomes 100 − x, 100 − y).
- Under each court: At the rim, Mid-range, Threes as makes/attempts. Twos and
  threes by the play's type; the rim by distance from the basket, computed
  from the position with the court's real measures as named constants.
- A pop-up button per court narrows it to one player.
- A dot's tooltip names the shooter, the shot and the clock; a click opens
  that play in the Game view. A zone figure opens its plays.

### Lineups

- Per team, the fives by time on the floor: shirt numbers (names in the
  tooltip), time, +/-. The five most used that played two minutes or more;
  "Show all" lists the rest.
- Time is exact to the gap between two plays, as the stints are.
- A row opens every play while that five was on the floor.
- One line under the tables: one game is too little to rate a lineup.

### From a number to the plays, and back

- `GameFilters` gets one more member, `picked: { name, eventIds } | null`
  (`packages/shared/lib/game-list.ts`); `keepPlay` keeps a play only if it is
  in the set. `ClipFilters` is not touched.
- A click sets `picked` in the game's remembered view (`rememberGameView`),
  clears the other filters, and switches to Game, which opens on the first of
  those plays the way a link to a play does today (`?play=`). The Game view
  shows the chip with its name and a clear button; the list, the strip's
  marks and collecting work on it as on any filter, so "add these to a
  playlist" is the Game view's existing control.
- A single shot's dot is one play: it opens through `?play=` as it is, with
  no chip.
- The Stats view's scroll position and its Game | Season choice are
  remembered with the game for the app session, so coming back through the
  switch lands where the coach left.
- The cells that open plays are buttons: highlighted on press, a focus ring
  for the keyboard, an accessible name that says what opens ("Lind,
  three-point attempts, 4 of 9, show plays").

### Which view a game opens on

Unchanged: Game when the video plays here and the game is synced, else
Details, where the coach links or locates the video and sets the tip-off.
`?view=stats` and the remembered view name Stats outright, and the switch's
Stats segment is there for every game with plays.

Considered and left out: opening on Stats when the video isn't on this
computer. Details has the Locate… action for exactly that case, so Stats
would need the same notice and action to be an honest landing page. Worth
revisiting once the analytics show how often coaches open Stats on such
games.

### Motion and materials

The view switch swaps at once, as today. Nothing on the page animates in; a
press answers on pointer-down. No new materials: the page uses the app's
grouped surfaces and separators.

## Analytics

`game_stats_viewed` (entry, has_shots, has_lineups, source of minutes),
`game_stats_plays_opened` (kind: player_stat, team_stat, shot, zone, lineup,
quarter, run; stat), `game_stats_season_shown`. They tell which sections
coaches use before parts 2 and 3 are designed.

## Checking it

- Before Shots and Lineups are built: one read-only look at a real game
  imported since September 2026, to confirm where the basket sits in the
  positions, that every play carries five ids a side, who the first five
  are, and which qualifiers the feed sends. Nothing from it is committed
  (the repo is public and the play-by-play is the federation's).
- vitest for the pure module on whole games built by hand in the tests: the
  team's points equal `gameFlow().final`; a player's line equals the size of
  the play set each cell opens; zones, lineups and bench points on known
  cases; the degraded shapes (no fives, no positions, no misses). The Genius
  sample fixture is 23 plays from two games and serves only for field shapes.
- A headless spec: the switch has three views; a click on a number lands in
  the Game view with the chip and exactly that many plays; back to Stats is
  where it was left; an old import shows no Shots or Lineups.
- The real app before it is called done (WKWebView has shown layout bugs the
  headless browsers didn't).
- `docs/game-view.md` gets a Stats section when it is built.

## Left to the builder

The component split; the chart's drawing details; the exact rim distance,
checked against a real game's positions before it is fixed; the wording of
labels, tooltips and empty states; how the narrow table behaves beyond the
rule above.

## Open (Leonard's)

1. Gating: assumed free for every coach.
2. The real game for the look above: one read of a game on staging, which
   needs Leonard's go-ahead while other sessions may be working there.
