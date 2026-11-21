# Team plays: design

Status: draft for Leonard's approval, 2026-11-21. Part 3 of the Stats work,
step 2 of 3 (1: the team page's season, built and merged into local main
f8d9b87, `docs/teams.md`; 3: scouting reports that start from the team).
Nothing is built. Mockup, approved by Leonard on 2026-11-21:
https://claude.ai/artifact/48hfrcEHJ7AzDpPb64puWy (Season, Plays, Plays
with no games; made-up teams and numbers).

## Intent

A coach preparing for an opponent reads on the team page what stands out
("Lose the ball: on 18% of possessions, most in Norra") and then wants to see
it: those turnovers, back to back, from the opponent's games they have
imported. Step 2 puts the coach's own video behind the season's claims. Every
claim that has plays gets a count from the coach's games and a Watch link,
and Watch opens one list of the team's plays across those games, with the
video playing straight on from one game into the next and every play ready
to go into a playlist.

Why: coaches use numbers to choose which video to watch, and the tools they
compare us with (Synergy, Hudl) open clips from a stat across games. Today
our numbers open plays only within one game (the Stats view), and the only
list across games is Add clips, inside the playlist editor. A coach scouts a
team, not a game.

Leonard chose this shape on 2026-11-21 (approach A below) and approved the
mockup.

## Goals

- From any claim on the Season page that has plays, one click to those plays
  across the coach's games, playing at once.
- The team's plays across games in one list: newest game first, each game's
  plays in game order, the video running on from one game into the next.
- Both sides of the ball: the team's own plays, and what its opponents did
  against it (often the coach's own team).
- Collecting as in the Game view: one target playlist, A to add, G to label,
  multi-select, labels shared with every other view.
- Season numbers and video numbers stay apart: video counts always say "in
  your N games", sit in secondary text, and are the only numbers that open
  plays.
- No migration and no new Genius calls.

## Non-goals (this step)

- Scouting reports. Step 3 starts a report from this page and its target
  playlist; nothing about reports changes now.
- Video numbers beyond those named here: no rates or percentages from the
  coach's video, no lineups across games, no per-game splits.
- Opening a colleague's games: "your games" are the coach's own, as "In your
  library" already is (`ownOnly`).
- Teams without Genius statistics (Profixio, pre-Genius games). They have no
  team page.
- Web and mobile.
- Trimming, notes or drawings on a play here: that is the editor's.

## Anti-goals

- A video count that reads as a season number, or a season number that looks
  as if it opens plays.
- A percentage from a handful of plays ("40% from three in your games" on
  ten attempts). Video numbers are counts and made of attempted.
- A second, different play list to learn. Plays is the Add clips list and the
  Game view's collecting, not a third design.

## Approaches (Leonard picked A)

- **A. A Plays view on the team page.** Season | Plays in the toolbar. Plays
  is Add clips' list and player across games, loosened from its playlist,
  opened on the team's games with the number's plays picked; collecting goes
  to a chosen target as in the Game view. One reel across games. The most
  work: Add clips is built around the open playlist.
- B. Into a playlist's Add clips: Watch picks or creates a "Scouting: team"
  playlist and opens Add clips filtered. Little new code, but looking makes a
  playlist.
- C. Game by game: a count splits per game ("5 · 4 · 5") and each opens that
  game's Game view with its plays. Cheapest; no reel.

A, because a coach watching a team's turnovers wants them back to back, as
Synergy and Hudl give them, and step 3's report can start from the same view.

## What the coach sees

### Season (the step 1 page)

Additions only; every season number stays as it is and opens nothing.

- **Header.** After the coverage line ("Your video: 3 of 13 games"), a link
  "Watch all 486 plays" (the team's plays in those games, With the ball). Shown
  only when the coach has at least one of the team's games.
- **What stands out.** Under a key that has plays, one line in secondary text:
  "In your 3 games: 41 turnovers · Watch". The keys and their lines:

  | Key (end, metric)       | Line                                              | Watch opens (side, plays)                        |
  |-------------------------|---------------------------------------------------|--------------------------------------------------|
  | own threeRate           | In your N games: M of A threes                    | With the ball: their three-point attempts        |
  | own orebPct             | In your N games: M offensive rebounds             | With the ball: their offensive rebounds          |
  | own tovRate             | In your N games: M turnovers                      | With the ball: their turnovers                   |
  | allowed threeRate       | In your N games: M of A threes against them       | Without the ball: opponents' three-point attempts|
  | allowed orebPct         | In your N games: M offensive rebounds against them| Without the ball: opponents' offensive rebounds  |
  | allowed tovRate         | In your N games: M turnovers forced               | Without the ball: opponents' turnovers           |
  | own and allowed ppp, pace | none                                            | none (no one kind of play answers them)          |

  A key whose count is 0 in the coach's games shows its line with the count
  and no Watch ("In your 2 games: 0 offensive rebounds").
- **Their shots in your games** (new section, after How they play): one half
  court, basket at the top, a dot per field goal from the coach's games (made
  filled, missed a ring, as the Stats view draws them), and beside it at the
  rim, mid-range and threes as made of attempted, each with Watch (With the
  ball, those shots). Caption: "N games · M shots · made of attempted", and
  one line under the table: "From the plays in your games, not the season."
  Games without shot positions (imported before September 2026) count in
  the zones only if the zone can be told without a position (threes from the
  play's type); otherwise the section says how many games it leaves out. Not
  shown without any of the team's games.
- **Players.** A last column "In your games": "3 games · Watch" (With the
  ball, every play of that player), or "Not in your games" in secondary text.
- **Games.** Unchanged: a game in the library opens on Stats.

With none of the team's games: the page is step 1's, unchanged, except the
Season | Plays switch.

### Plays

The toolbar: Back, then **Season | Plays** (a segmented control, leading, as
the Game view's Game | Stats), then the team's name and league. On the right,
the Game view's collect control: "Adding to" the target playlist and its
count, "Choose playlist…" until one is chosen.

Under the toolbar, two rows:

1. **With the ball | Without the ball** (a segmented control, the words of
   What stands out's two cards), then Games ("3 of 3", the Add clips game
   picker limited to this team's games in the coach's library), Player, Shot
   type, Situation, Labels, Presets (Add clips' filters; Player lists the
   team's players With the ball and the opponents' Without).
2. The picked set, when Watch opened one, as one pill with its count and a
   clear button ("Turnovers · 41"), then the event type chips.

Below, side by side (resizable, as Add clips):

- **The list**: a header line with the count ("41 plays in 3 games") and the
  order ("Newest game first"); a sticky header per game (vs/at opponent,
  date, result, its count of listed plays); the plays in game order: clock,
  player, what happened; label chips. The lit row is the play on screen
  (neutral fill). Windowed (`use-list-window`), since a team's games can hold
  several thousand plays.
- **The stage**: the play's video, the opponent and clock over it, and under
  it the now bar: the play in words, the game, Label (G) and Add (A).
  Playback runs on from the last listed play of one game to the first of the
  next.

A game whose video isn't on this computer, or isn't synced, still lists its
plays, dimmed, under one line saying what to do ("This game's video isn't on
this computer. Locate video" / "This game isn't synced yet. Set the tip-off").
Its plays are skipped when playback runs on, and can still be added, as in
the Game view (sending later says why it can't be cut).

**With none of the team's games**: one line, "None of their games are in your
library.", a body line, and a button that opens the import page on the
team's latest played game with play-by-play (the step 1 `ImportPick`).
"Import their latest game: at Sjöstad Basket, 22 Nov". No button when none of
its games can be imported.

**Loading**: the list shows each game as its plays arrive, newest first; a
game that failed says so in one line with Try again (Add clips' wording).

**Keys**: Add clips' and the Game view's: Space, J K L, arrows; ↑ ↓ the
previous or next listed play; A add; G label; ⇧G the same label again;
⌥1–⌥9 a label's key; ⌘-click and Shift-click select; ⌘A selects every listed
play; Esc lets go; ⌘F the player search.

**Motion**: Season | Plays cross-fades (150 ms); with reduced motion it
changes at once. The page keeps each view's scroll for the visit.

## Rules

- **Your games** for a team: the coach's own library games (archived ones
  included, as `useLibraryGames` reads them) whose Genius match id is one of
  this team's games in this competition, regular season and finals alike
  (video is video; the season half keeps counting regular games only). N in
  "In your N games" is that count.
- **The team's side in a game** comes from the fixture rows (`TeamGameRow.home`):
  home is `teamNumber` 1, away 2. Never from names.
- **Counted from the stored plays**, through the same functions the Stats view
  uses (`game-box.ts`, `game-shots.ts`), so a count always equals the plays
  Watch opens: each count carries its plays as `matchId:eventId` keys.
- **Made of attempted**, never a percentage, for threes and shot zones.
- **The picked set** is a definition, not a frozen list (my call, after the
  builder check; it is what the mockup does): what Watch asked for, as a
  kind (one of the key stats, a shot zone, a player, all plays) and a side.
  Its plays (`matchId:eventId` keys) are worked out from it over the games
  shown, so a count on Season and the pill always agree, and the router state
  carries the definition. Add clips' `ClipFilters` gains it, as
  `GameFilters.picked` did for one game. A filter narrows within it; the pill
  clears it.
- **Flipping With the ball / Without the ball with a pill showing** (my call):
  a key stat swaps to its counterpart on the other side ("Turnovers · 41"
  becomes "Turnovers forced · 44"; threes and threes against them; offensive
  rebounds and offensive rebounds against them). A shot zone or a player's
  plays has no counterpart: the flip clears the pill and lists the other
  side's plays. "All plays" stays all plays.
- **No cap on games** (my call): Plays lists every one of the team's games the
  coach has, however many (the coach's own team page can hold 25 or more), so
  "In your N games" always equals what Watch opens. The Games picker starts
  with all of them ticked and can untick any; it has none of Add clips' limit
  of 10. The list is windowed, and games are read a few at a time, newest
  first.
- **The target playlist** is remembered per team on this device, as the Game
  view remembers it per game. Adds to a playlist players already have go out
  by themselves, as from the Game view (`background-ship.ts`).
- **The URL**: `?view=plays` on the team route; the picked set rides in the
  router state, as the Stats view's does, so a reload keeps it.

## How it is built (decided)

- **Shared and pure** (`packages/shared/lib`, vitest):
  - which library games are the team's and its side in each;
  - the video counts for the Season page: each key's count (table above),
    the shot zones and the dots, each player's games and plays, the total;
    each carrying its play keys;
  - the Plays list's order (newest game first, game order within) and its
    rows across games, with the side filter;
  - the next playable play across games (skipping games without video).
- **Desktop**: the Plays view is built from Add clips' parts (`PlayerStage`,
  `usePersistentVideo`, `useListWindow`, the filters, `EventTypeChips`,
  `GamePicker`) and the Game view's collecting (`useCollect`,
  `CollectControl`, the now bar). `useCollect` today takes one game; it
  takes a set of games and a key to remember its target under (the game's
  id there, the team here). The clip browser stays the editor's; shared
  parts move out of it only as far as Plays needs them.
- **Labels** across games: the per-game label cache (`use-clip-labels.ts`)
  read for every game in the list, written per clip as today.
- **Reading**: the plays through `listEventsForMatchesChecked` (the shared
  cache), the video's state through the existing probe. No migration, no new
  Genius calls, no change to the `genius` function.

## Analytics

- `team_page_action` gains: `watch_all`, `watch_key` (with `key`: end and
  metric), `watch_shots` (with `zone`), `watch_player`.
- `team_plays_viewed` once per open of Plays: `games`, `plays`, `from`
  (switch, watch_all, key, shots, player), `side`.
- Collecting sends the Game view's events with `surface: "team_plays"`.

## Checking it

- `packages/shared`: `npm test`. Which games are the team's (home and away,
  a game not in this competition, a colleague's game absent); every key's
  count and its keys at both ends; 0 counts; shots with and without
  positions; a player in some games only; the list order across games; the
  side filter; the next playable play skipping a game without video.
- Headless (`P-teams.spec.ts`, its mocks plus plays for the library games):
  the Season lines and Watch links with and without library games; Watch
  opening Plays with the pill and count; the side switch; a game without
  video dimmed; Add to a target; the empty state's import button; Season |
  Plays and back keeping each view's scroll.
- In the dev app against staging, on a team with several imported games:
  Watch on a key plays straight on across two games.
- Typecheck, and both views in dark and light.

## Left to the builder

File and component names; how much of the clip browser moves into shared
components; the stage's controls; how many games are read at once; the
skeleton; the exact copy of secondary lines (through the copywriting skill);
the empty state's icon.

## Open (Leonard's)

- None new. The step 1 questions (data terms, plan) stand.
