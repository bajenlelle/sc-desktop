# The game view

`/matches/:id` on the desktop opens on the whole game: the footage with the
game's timeline right under it, and beside them a list of its plays that
follows the footage. The timeline is the story of the score and a way through
the game. From the page a coach collects plays into a playlist and labels
them. The settings form the page used to be is the other side of a
**Game | Details** switch.

Built after a contact at the federation called a full game view the page that
matters most, and the first coach interview asked for the same things: jump
between quarters, a marker for every timeout, the plays after a timeout, the
stretch where a game turned.

## The page (`apps/desktop/src/pages/game.tsx`)

- `GamePage` is the route's host. It opens on **Game** when the video plays on
  this computer and the game is synced, else on **Details** (the unchanged
  `MatchDetailPage`, which gets the switch as a `viewSwitch` prop).
  `?view=details|game` names a view outright, `?play=<eventId>` opens the game
  on a play, and every `openQuarters` link lands on Details.
- **Only one view is mounted.** Details' tip-off picker has a video of its
  own, and two decoders on one file is how paused frames go black. The game is
  read again when Game is entered from Details or from outside (Library, a
  link), so a sync changed in Details shows; a tab switch serves the copy read
  on this visit until any `matches-changed`, or for 10 minutes.
- A game comes back as it was left: its position across launches
  (`localStorage`, `scoutable_game_positions`, the thirty games left last), and
  for the app session its filters, quarter zoom, list scroll and (on a switch
  between open games) view (`lib/game-tabs.ts`), labels and playlists shown at
  once and read again behind. A link to a play opens without the filters.
  Not kept: the filter sheet, the selection, and Undo for adds made on an
  earlier visit. All of it but the position is dropped when the signed-in
  user changes (sign-out doesn't reload the webview).

### Open games (the game tabs)

- **One mounted view, no hidden videos.** An open game is a remembered game,
  not a page kept alive: switching remounts the page on the other game, so
  there is still one decoder (`lib/release-video.ts`), and the memory above is
  what brings it back as it was left.
- **They are rows in the sidebar, under "Open games"**
  (`components/shell/open-games.tsx`), there from any page. Decided
  2026-11-20: the tabs used to be a bar above the game page (2.0.0), and
  leaving the game for a playlist hid them, so the way back was Library → the
  game. With the rows in the sidebar the bar showed the same thing twice and
  was removed (Arc and Edge's vertical tabs have one tab list, not two), and
  the game got its 44 px back. Everything the bar did moved with it:
  - The caption's **+** opens the game picker (`game-tab-picker.tsx`,
    `packages/shared/lib/game-picker.ts`): the Library's games in the
    Library's order, archived ones left out, searched by title and team. An
    open game says "Open" and choosing it goes to it; Return opens the first.
    New Tab (⌘T, File menu; Ctrl+T without a menu bar) opens the same picker.
  - A row is the game's title alone, starting at the caption's edge (no icon:
    a team-colour bar there read as a missing logo, 2026-11-20), cut short
    team by team ("Fryshuset Bask… vs AIK", `tabTitleParts`), with the whole
    title and date as a tooltip. The game on screen is the selected row, and
    the Library row is not. A switch selects its game from the click, before
    the page has drawn (`setHeadingToGame`): the router keeps the page it
    leaves on screen until the next one is ready, and closing the game on
    screen otherwise lit the Library for a moment, then the next game.
  - A row lights on the press and opens on the release, so a press can turn
    into a drag that moves it without opening anything (framer-motion's
    `Reorder` on y; the others slide aside on the app's springs, no bounce;
    reduced motion fades). While it moves the order is the list's own, and it
    is kept when the row is let go (`orderGameTabs`): written on every swap,
    as it was, the order redrew every page that reads the open games and
    rebuilt the Window menu, and opening on the press loaded a game mid-drag,
    which made the drag stutter.
  - Its × (on hover or focus), a middle click and its menu (Close Tab, Close
    Other Tabs) close it. The game on screen can't be closed while it is the
    only open game: there is no game to give the page to, and the toolbar's
    back button leaves the game. From another page any row closes, the last
    one too.
  - The keyboard: Tab stops once on the rows; ↓ and ↑ move along them and
    wrap, Home and End go to the ends; Return or Space opens one (the arrows
    only move the focus: a game takes a moment to open); Delete closes it and
    the focus goes to the next row. A click doesn't take the focus: the game's
    keys go on working.
- **With the sidebar hidden** the rows are out of sight, so the game's title
  in the toolbar becomes their menu (`GameTitle` in
  `components/game/game-toolbar-parts.tsx`, as Xcode's jump bar): the open
  games, the one on screen checked, and New Tab…, which opens the picker under
  the title. ⌘T off the game page with the sidebar hidden shows the sidebar
  for the picker.
- Six at most: a seventh game closes the one shown least recently, and a
  notice says which, with Reopen. The notice stays eight seconds, twice the
  app's others: nobody asked for that game to close. New games go last.
- **The keys and menus work from any page** (`components/game/game-tab-keys.tsx`,
  drawn by the window's layout, so it answers wherever the coach is):
  - ⌃Tab and ⌃⇧Tab, and the Window menu's Show Next Game Tab (⌘⇧]) and Show
    Previous Game Tab (⌘⇧[): on the game page they step through the open
    games and wrap; from another page they go back to the game shown last.
    Not while a dialog is open.
  - The Window menu lists the open games, the one on screen checked, as a Mac
    app lists its open documents (`menu_open_games` in `src-tauri/src/menu.rs`
    rebuilds the list; a choice arrives as `open-game:<id>`). No menu bar on
    Windows, so no list there.
  - Reopen Closed Tab (⇧⌘T; Ctrl+Shift+T) puts the game closed last back in
    its place, as it was left. The last ten, for the visit, in memory: games
    the coach closed and ones that made room, not games deleted or moved to
    another space. Several closed together (Close Other Tabs) come back one at
    a time, each where it stood (`closedGameTabs`).
  - ⌘W closes the game on screen while another is open, and the window
    otherwise. The File menu has Close Tab and Close Window, as Safari does:
    with two open games or more on the game page, ⌘W and ⇧⌘W; otherwise there
    is no Close Tab in the menu and Close Window is ⌘W (`menu_game_tabs` puts
    Close Tab in and takes it out, because the menu library changes an item's
    shortcut but doesn't take one away). Close Window is closed natively, so it
    works where nothing in the webview listens. Both act only while the main
    window is in front: with the About panel or a file dialog in front, ⌘W is
    not for the window behind it. Close Tab also waits while a dialog is open.
    Without a menu bar, Ctrl+W closes the tab under the same rule
    (`packages/shared/lib/menu-shortcuts.ts`).
- **The Library, Home's Recent imports and the search mark the open games**
  ("Open"); a click on one goes back to it as it was left, with nothing to
  load. The search's Recent lists the open games first.
- **They come back after the app is quit.** Per user and space in
  `localStorage` (`scoutable_game_tabs:<userId>:<orgId>`;
  `apps/desktop/src/lib/game-tabs.ts` over the pure
  `packages/shared/lib/game-tabs.ts`), checked against the database the first
  time they are read on a launch, so a game deleted, renamed or moved since
  isn't offered as it was. Where each game was in its video comes back too
  (`scoutable_game_positions`, the thirty games left last). Signing out forgets
  that user's open games. On any `matches-changed` the store empties its
  loaded-game cache and reads the open games again: renamed games take their
  new title, deleted ones and games moved to another space close (an empty
  read is taken as a failed one). Reversed 2026-11-20: they used to last the
  app session, because the bar showed only on the game page and yesterday's
  games would have turned up the next time any game was opened. In the
  sidebar they are in sight from the start.
- A switch between open games on the game page replaces the history entry
  (`replace: true`), as the Game | Details switch does: Back leaves the games.
  From another page it is a step like any link, and Back returns to that page.
  A switch first leaves the field being typed in, so a Details title saves;
  and a playlist write still out from the game it leaves lands before the next
  game reads or writes that playlist.
- Not built, and why (looked up 2026-11-14 against W3C's Tabs pattern, NN/g's
  tab guidelines, Safari, Chrome, Notion and VS Code, and again 2026-11-20
  against Arc, Edge's vertical tabs and Figma): ⌘1–⌘9 for the nth game (⌘1–⌘6
  are the Go menu); a Library click that changes the game in a row and doesn't
  open a new one (a row per opened game is what lets games be found again; the
  notice at the cap is its price); moving a row with the keyboard; a "Pick up
  where you left off" card on Home (the open games already come back in the
  sidebar, and it would say the same thing twice).

### Ways into the game

The game is where a playlist's clips come from, so the places that name a game
lead to it, as references in the text, not new buttons:

- **The editor's subtitle** (`components/editor/editor-toolbar.tsx`): "12 items
  · Fryshuset vs AIK" names the playlist's one game, and the name opens it;
  with several, "3 games" opens a menu of them with their clips, in the order
  the playlist first uses them (`packages/shared/lib/playlist-games.ts`). Quiet
  until pointed at, then the link it is. A game the Library doesn't hold
  (deleted, another space) is left out.
- **Show in game** on a clip row's menu, and Go → Show Clip in Game (⌘G,
  Ctrl+G; ⇧⌘J was first, and other apps' global keys such as Notion's took
  it): the clip's game at that play (`?play=<eventId>`), as Final Cut's
  Reveal Source in Browser lands on the source at the same frame. The
  menu item is for the row the keys are on, else the clip playing, and is off
  elsewhere. The game's title on a row is not a link: the row is already a
  target for the press, selection and drag, and a link inside it would fight
  them.
- **A shared playlist's footage** (`components/playlist/watch-view.tsx`): for a
  coach, the game under the footage is named, and opens at the clip's play
  when the game is in the space's Library. Players get the name only.
- **Back goes the way it came.** A game opened from a playlist shows
  "‹ {playlist}" where it otherwise has "‹ Library" (`GameBackButton`), as the
  editor shows "‹ {game}" when it was opened from a game; it reopens that
  playlist (the editor, or the shared playlist). It is remembered per game
  for the visit, across the Game | Details switch and a return through the open
  games; opening the game any other way makes it the Library's again. The
  game's Add collects into that playlist (`setCollectTarget`).

### The player and its timeline

- **One unit, in the left column** (`game-watch-view.tsx`): the footage, the
  Now bar, the game's timeline, and under the track one line with the game's
  facts and the zoom. The timeline is as wide as the footage and sits 44 px
  under it, so the control is by what it moves; the play list has the other
  column's whole height. The stage is as large as its column allows once the
  Now bar and the timeline have their room (`UNDER_STAGE`). A sync warning
  opens at the foot of the column.
- **Two ways through the video, on purpose.** The player's own scrubber (the
  stage's floating bar, the one the editor and Add clips have) spans the whole
  file on a straight scale, with elapsed and total time and a mark where each
  quarter starts: it is how warm-up, the breaks and whatever follows the final
  whistle are reached. The timeline folds those stretches into the gaps
  between the quarters and spends its width on basketball. In a window the player's controls don't
  repeat the quarter, clock and score, which the Now bar says right below
  them; in full screen, where there is no Now bar, they say what it would:
  the play's quarter, clock and score, or between plays where the video is
  ("Before tip-off", "Half-time · 42–51"; `betweenPlays` in
  `game-now-bar.tsx`).
- **A sideways swipe scrubs**: two fingers on a trackpad, or a mouse wheel
  turned with Shift, over the timeline or the footage, in full screen too. The
  playhead moves a pixel for a pixel on the timeline's own scale, so a zoomed
  quarter scrubs finer, and stops at the ends. Zoomed on a quarter the video
  isn't in, the video goes on from where it is at the strip's pace, never
  back to the zoomed quarter (`swipeTime`). A notch of a wheel turned with
  Shift is a small step (16 px), not the 100 px it reports. A gesture keeps
  the direction it started in: a scroll that drifts sideways never moves the
  video (`packages/shared/lib/wheel-scrub.ts`,
  `components/game/use-wheel-scrub.ts`). A playing video holds while it is
  swiped and plays on once the fingers have rested 400 ms; a press on the
  timeline, K or the label picker in that moment takes over, so the video
  never starts up under what the coach does next.
- **A scrub is one `game_view_seeked`**, sent when it ends, not one per
  frame: `via` is `scrubber` (the player's bar: a drag, or a key pressed on
  it, once however long it is held), `timeline_drag`, `wheel` (a swipe; one
  that rests longer than 400 ms and goes on is two), or `timeline` for a click
  on the timeline, with the kind of what was clicked: `time` (a second),
  `play` (a play's mark), `run` or `timeout`.
- **No mark per play for the whole game** (decided 2026-11-14, after an audit
  of the strip). It drew a tick per play in nine colours: some 430 in 665 px,
  a mark every other pixel, naming nothing the list beside it doesn't, while
  runs (three-pixel grey bars) and timeouts (small triangles) were the
  hardest things on it to see. And since a play was within four pixels of
  every point, a click anywhere jumped to a play's pre-roll and not to where
  it was made. The strip is the overview: Synergy's and Hoopsalytics' game
  views are built on the score graph (in Hoopsalytics a run is a stretch the
  coach marks), YouTube, the NBA app and Apple TV put a few chosen moments on
  the timeline and never every one, and the rule for large data is overview
  first, zoom and filter, then details on demand (Shneiderman). So the plays
  come out when they answer a question: a filter shows where its plays fall
  against the runs and timeouts, and one quarter has room for all of its own.
  Sources: [Synergy](https://support.synergysports.com/support/solutions/articles/77000565946-game-data-page),
  [Hoopsalytics](https://blog.hoopsalytics.com/see-what-happened-during-that-run-with-the-game-summary/),
  [Veo](https://support.veo.com/hc/en-us/articles/4454946199057),
  [Shneiderman](https://webspace.science.uu.nl/~telea001/uploads/VACourse/Shneiderman96.pdf).
- **Why under the footage** (decided 2026-11-14, after the timeline as a band
  across the bottom of the page read as detached from the video): players
  made for review attach the scrubber to the picture and put their marks on
  it (YouTube's chapters, Frame.io's comments, Hudl). A timeline across the
  bottom of the window is the editing tools' convention, where the timeline
  is the thing being worked on; here the plays and the footage are.

## What it reads from the stats (`packages/shared/lib`, pure, tested)

| Module | What it answers |
|---|---|
| `game-timeline.ts` | Where each play is on the video (`buildGameTimeline`), which play is at second T (`playIndexAt`, `activePlay`, a clicked play is held through its pre-roll by a pin), where T is in the game (`momentAt`: before, live, break, after), and the strip's folded x axis (`gameScale`) |
| `game-flow.ts` | The score story (`gameFlow`): score after each play, quarter and final scores, lead changes, ties, largest lead, runs; which plays belong to which moment (`gameMoments`); a player's stints on the floor with each stint's score change (`onCourtStints`); the chart's geometry (`flowChart`) |
| `game-strip.ts` | The strip's rules: when it marks the plays (`stripShowsPlays`), where a run's score, a timeout's mark and the largest lead's figure go to keep clear of the team names and of each other, as far as two rows a side allow (`placeRunLabels`, `placeTimeoutMarks`, `placePeakLabel`; `lineAlongEdge` for a score that would sit on the graph's line), and what the pointer is on (`stripTargetAt`) |
| `game-marks.ts`, `game-marks-fill.ts` | Timeouts and period bounds (below) |
| `game-list.ts` | Which plays a filter keeps (`keepPlay`) and the list's rows (`gameRows`): period headers, plays, and the timeout, run and period-end markers between them |
| `wheel-scrub.ts` | Which wheel events are a sideways scrub and how far each one moves the playhead; a scroll up or down is never one |
| `clip-filters.ts` | The Add clips filter vocabulary. Byte-identical to the file on `feat/cloud-game-videos`, so the merge sees one file; change it there too |

- **The axis** is video seconds when the game is synced, wall-clock seconds
  when it is not (the list, the graph, collecting and labels still work
  without footage; a click then only selects a play).
- **The score is counted from made shots**, in feed order (period, game clock
  descending, action number). In the 51 Genius games checked on staging the
  made shots summed to the feed's final score every time; the feed's own
  running score is the fallback, and a game with neither draws the quarter
  bands only (and the plays' marks, when they are shown).
- **Named thresholds** in `game-flow.ts`: a run is `RUN_MIN_POINTS` (8)
  unanswered, clutch is the last `CLUTCH_SECONDS` (5:00) of the fourth quarter
  or overtime within `CLUTCH_MARGIN` (5), a quarter's start and end are its
  first and last `EDGE_SECONDS` (2:00). A play counts as "now"
  `ACTIVE_LEAD_SECONDS` before the playhead reaches it; a jump to a quarter
  lands `PERIOD_LEAD_SECONDS` ahead of it, and those seconds already count as
  the quarter.
- **Moments** (one at a time, combined with the team filter): After timeouts,
  Quarter starts, Quarter ends, Clutch, Runs, Fast breaks. "After timeouts" is
  the first shot, turnover or foul after each team timeout in the same
  quarter.
- **A filter keeps the game's frame.** Filtered, the list shows only the plays
  that match, and around them every period of the game keeps its header, its
  timeouts where they fell among the plays that are left, and its end: a coach
  looking at the made twos still sees every timeout and the final score. A
  period with no play listed keeps its frame too ("0 plays"). Only the period
  filter takes periods away, and a filter nothing matches shows "No plays
  match" instead of an empty frame. A run's row needs all of its baskets under
  it, so it is there unfiltered and under Runs only (`gameRows` in
  `game-list.ts`).
- **On court**: with a player chosen, "While on the floor" lists the plays
  during that player's stints (from `onCourtHome` / `onCourtAway`, exact to
  the gap between two plays) and the strip shows the stints as a band.

## Game marks: timeouts and period bounds

The import stores only clippable plays; timeouts and period start and end rows
are dropped, and they can't go into `play_by_play_events` because every
released app lists each row there as a clip.

- **Storage**: `matches.game_marks` (jsonb, nullable, an object of at most
  32 KB; migration `20261111100000_game_marks.sql`, probe
  `supabase/tests/game_marks.sh`). It inherits the table's RLS; released apps
  select `*` and ignore it. Shape (`types/game-marks.ts`): `{v:1, source,
  periods, timeouts[], basis}`; a timeout has its team (or officials), period,
  clock, wall-clock time, the restart time when the feed gives one, and the
  score.
- **Filled when a coach opens the game**, never as a sweep (`fillGameMarks`,
  called by `apps/desktop/src/lib/use-game-marks.ts`): one call to the
  `genius` function's `match` action, which answers from its cache for any
  imported game and touches no import allowance. Staging and production share
  Genius's monthly quota, which is why nothing walks a library.
- **Stale marks are read again**: `basis` is the play count and the first and
  last play time the marks were read against (`gameMarksStale`), so a
  re-import refetches.
- **Nothing depends on it**: any failure leaves the view without timeouts
  ("After timeouts" is disabled with the reason). A database the migration
  hasn't reached, or a game the coach doesn't own, keeps the marks for the app
  session only (outcome `unsaved`). The sample game, older imports with no
  feed id and other providers are skipped; feeds that keep timeouts as rows
  are read from the plays (`gameMarksFromEvents`).
- **The game view is the only writer.** The importer writes them itself after
  `feat/cloud-game-videos` has merged, since an import must never fail on a
  column that isn't there yet.

## The desktop pieces (`apps/desktop/src/components/game/`)

- `use-game-playback.ts`: the video's position is never React state. The
  current play is, and it changes a few times a minute. A clicked play starts
  at its pre-roll and stays the current one for as long as the video is
  inside that run-up, whichever way it is moved there (→ and ←, a scrub, a
  swipe), so the lit row doesn't fall back to the plays that happen during
  the run-up; a jump to a quarter or a marker lets go of it. A jump to a
  place that leads to a play holds that play the same way, from the jump's
  own second until the play has happened: a timeout's restart leads to the
  play out of it (`afterTimeoutPlays`: the first shot, turnover or foul after
  it in the quarter; for a team's timeout, the play the After timeouts list
  puts under it, and an officials' timeout, which that list leaves out, leads
  to its play the same way), a run's
  start to its first basket. Whichever way the jump is made (the mark on the
  timeline, the row in the list, Page Up or Page Down), that play is the one
  on screen at once, so the Now bar names it and A, G and the label keys act
  on it. The play before the timeout was the current one until then, which
  read as the wrong play being marked; no play marked would have left
  nothing to add until the play had happened. A timeout that leads to no play
  (the quarter ended first), or to one the jump lands after, holds none
  (`pinToward`). Until the play happens the Now bar gives its clock and
  score, ahead of the picture: seconds from a restart, the whole timeout
  where the feed has no restart time. `nowKey` is the play
  on screen in the whole game (what the Now bar names and A adds); `activeKey`
  is the lit row, the latest play the filtered list shows.
- `game-timeline-strip.tsx`: hand-drawn SVG, no chart library. It draws the
  game's landmarks: quarter bands with their scores, the score difference
  around a zero line (home above), each run as a shaded stretch over the
  graph's height in its team's colour with its score printed ("15–0"; the six
  largest at the whole game's width, all of them in one quarter), each
  timeout as a pause mark on the calling side's edge with a hairline through
  the graph (so a timeout that ended a run reads as one), a line under the
  clutch stretch, the largest lead. The figures keep clear of the team
  names and of each other by rule (`game-strip.ts`): a run's score keeps the
  edge (a row in where the graph's line itself lies along that edge, so it
  stands under the line), a timeout's mark goes a row in for a name, a score
  or another mark, and the largest lead takes the row under them or, with
  none free, is left to the line under the track. A side has two rows: a
  third timeout of one side within a mark's width of two others stands on
  one of them, and a mark sent a row in by a name can meet a score the line
  sent there. Timeouts' hairlines are painted under all of
  them, so a figure's rim breaks the line. Breaks are folded into the gaps between
  the quarters, which still map to their footage. Under the graph is one
  lane: the playlist's plays as dots, always, and the listed plays as marks
  in one colour (home above the lane's middle, away below, a play the feed
  gives to neither team on it) when a filter is on or one quarter has the
  strip; zoomed, only that quarter's plays, which are there from the first
  frame of the zoom in and ride along with it (zooming out, they go as it
  starts). It answers the press by what the press is on, settled on
  pointer-down (`stripTargetAt`). On a second, the playhead goes to the
  pointer at once and follows 1:1, resisting past the ends. On a run, a
  timeout, a play's mark or a playlist play's dot the video is left where it
  is until the click is made or the pointer has moved 4 px (a drag, which
  takes the playhead up from there): moving it to the pointer first gave the
  video two places to go to within a moment, and WebKit now and then kept
  the first, so the timeout's row came up and the video played from the
  pointer. A release without movement is a click on what was pressed: a run
  (its first basket from the pre-roll, exactly as its row in the list starts
  it), a timeout (the place Page Down stops at for it, played, with the play
  it leads to as the play on screen), each with its
  row shown in the list, a play's mark or a playlist play's dot (that play
  from its pre-roll), else that second. Zoomed, only that quarter's plays are
  click targets: the quarter before ends at the left edge, and its last play
  is not there to be clicked. Double-click a
  quarter to zoom: the strip springs from the scale on screen to the
  quarter's. The second click of a double-click, on anything, is the
  same visit: it asks for nothing again and is reported once. What the
  pointer is on is said in one line
  in the row under the track, by the pointer, inside the strip and clear of
  the zoom beside it: above the track is the footage, and when the footage
  is as tall as the window allows there is no room for more below. For a run
  it gives the score and the clocks it went from and to (both quarters named
  when it crossed a break), and the time in the video is where a click would
  go (for a play, the start of its pre-roll). Where the column is too narrow
  for the line, the team's name is cut short first, and the time in the video
  is left out whole when that isn't enough. When a zoom moves the strip under
  a still pointer the line goes, and comes back about what is under the
  pointer once the strip is at rest. The words on the graph keep a rim of
  the page's
  colour so the line doesn't strike them through, and the team names start
  where the first quarter does, clear of the playhead when a game opens.
- `game-play-list.tsx`, `game-play-row.tsx`: rows are memoised, not
  windowed (one game's plays). Add clips, which lists every play of up to ten
  games, draws only the rows near the view (`lib/use-list-window.ts`, rows of
  one height). The current row follows playback until the coach
  scrolls; "Jump to now", any seek, or scrolling back resumes it. A row has
  one mark for "now" (the tinted pill) and one for "picked to add" (the
  selection's fill). A press with the mouse doesn't take the keyboard's
  focus, as on the timeline's track: a clicked row would otherwise wear the
  focus ring from the next key press on, long after the game had moved past
  it, like a third mark. Tab still reaches the rows and shows its ring.
- `game-now-bar.tsx`: the play on screen in words, with Label (G) and Add (A).
  The player's name keeps room for its number and a few letters: in a narrow
  column the keys' hints go first, then the same-label-again button (⇧G still
  does it).
- `game-filters.tsx`: team, moments, and the filter sheet (presets, search,
  event and shot types, situations, players, quarters, labels, on court).
  Presets are saved per account and space (`filter_presets`,
  `lib/filter-presets.ts`) and shared with Add clips; a preset keeps plays,
  shot types, situations and labels, never the team or players, so the same
  one applies to any player: applying it leaves the Both/home/away control,
  the chosen players, "on court", the search, the moment and the quarters as
  they are.
- Reused as they are: `usePersistentVideo`, `PlayerStage`, `useFrameSeek`,
  `LabelPickerPopover`, the key scope (`game`) and `resolvePlayerKey`.
  `lib/use-clip-labels.ts` gives the view the labels of one game.

**Keys**: the player's own (Space, K, J, L, arrows, R, M, F) as in the editor;
↑ ↓ the previous or next listed play; Page Up and Page Down the previous or
next marker (quarter start, timeout, run); 1–9 the start of that period; A
add; G label; ⇧G the same label again; ⌥1–⌥9 the label that has that key
(held: which key is which label); ⌘F the player search. ⌘-click toggles a
play into the selection and Shift-click selects a range; Shift+↑ ↓ extends it
and plays there; ⌘A selects every listed play; Esc lets go. The pill over the
list adds the selection to the target or another playlist; a row's menu acts
on the selection when that row is in it.

## Collecting (`use-collect.ts`, `collect-control.tsx`)

- **One target playlist, chosen once** and remembered per game on this device
  (`lib/prefs.ts`). With none chosen, the first add opens the picker from the
  control that was pressed; the choice sets the target and adds the play.
  Its field reads "Search or create…", as in the editor's picker: a typed
  name that no playlist has is offered as Create "name". There is no
  ready-made name in it, so that row isn't read as the only way to create.
- **Every clip is a play.** An add is `appendClips` on one promise chain per
  playlist, so quick adds get increasing positions. Undo and removing through
  the row's check are `writePlaylistItems`, and only for clips added on this
  visit: a clip that was already in the playlist may carry notes and trims.
  "Add all n" appears only while a filter or a moment is on.
- **Any playlist, once**: a row's menu (right-click) adds the play to the
  target or, under "Add to another playlist", to any other playlist or a new
  one named after the game. The target doesn't change. The menu is one
  `ContextMenu` around the list (`game-play-menu.tsx`), not one per row, so
  adding doesn't redraw every row; markers and headers have none.
- **A playlist players already have**: the add is the same write, and the
  clips go out by themselves, with no Send to remember. Each add to a shared
  playlist schedules its send (`packages/shared/lib/ship-scheduler.ts`, one
  scheduler for the app in `apps/desktop/src/lib/background-ship.ts`): 30 s
  after the last add (`SHIP_IDLE_MS`), at once when the target changes, and
  at once when the game is left (another tab or page). A quiet spell, not
  every add, because each clip is cut with x264 on this computer while the
  coach is watching; it also leaves an Undo time to take a clip back before
  it is sent, since the send reads what the server holds when it runs. One
  send per playlist at a time; adds during it go in the next. The cut and
  upload are the editor's own path (`apps/desktop/src/lib/ship-clips.ts`):
  the writes still out land first, the footage and plays of other games in
  the playlist are read, and a failure is said as the editor says it.
  Signing out drops whatever waits. Every game in the playlist is read when
  the send runs, so a sync fixed meanwhile is the one the clips are cut
  with, and a sync change (`lib/sync-change.ts`) waits for a send still
  running before it re-cuts. Clips no cut here can make (their game isn't
  synced, its video isn't on this computer, the play couldn't be read) are
  said in a toast with what to do, and the send counts as failed
  (`unsendableClips` in `packages/shared/lib/held-clips.ts`). The files a
  send put up reach every copy on screen (`onUploaded`): another game
  view's too, so a tab switch mid-send never cuts them twice.
- **Quiet unless the coach is needed** (`packages/shared/lib/ship-pill.ts`,
  the Apple-design rule that status takes little room and only warnings and
  errors ask for attention). Clips waiting for the quiet spell show nothing:
  the first add to a shared playlist says once "Players get new clips
  automatically." A send in progress is a 12 px ring on the "Adding to"
  count, filling as clips go up, its words in a tooltip ("Sending 2 of 3
  clips to players"); for another playlist (after a switch) the same ring
  stands beside the control, its tooltip naming that playlist. A send that
  works says nothing (`quiet` in `shipPlaylistClips`). Clips that didn't go,
  or were left from an earlier visit (the app closed, a failure), show "n
  not sent" in the warning color; its popover lists the playlists, each with
  "Send again". They are never sent by themselves: a missing video would
  otherwise fail again on every visit. They are counted per shared playlist
  from the clips players don't have yet (`heldForPlayers` in
  `packages/shared/lib/playlist-sharing.ts`: the target's, and any shared
  playlist holding one of this game's clips without a file). A failure is
  said in a toast wherever the coach is.
- **The editor waits for it**: a ship the editor arms for a playlist the
  game view is sending waits until that send ends, and the files it put up
  are patched into the editor's copy (`onUploaded`), so nothing is cut
  twice. "Open playlist" opens the target in the editor whenever there is
  one, and hands it the way back (`state.from`, the "‹ {game}" button in
  the editor's toolbar; so does Details' "Build a playlist"). Players'
  feeds skip clips with no uploaded file, so they see a clip once it is
  sent.
- Labels are independent of collecting: label now, build later through the
  label filter in Add clips.

## Labelling

A coach going through a game reaches for the same few labels again and again,
so the label picker (`components/labels/LabelPickerPopover.tsx`, the same one
the editor and Add clips use) is built for repeating:

- **The labels used last are repeated at the top** ("Recent", up to four, most
  recent first) over "All labels", the whole vocabulary in alphabetical order.
  They are copies: every label stays where it always is. The order is read
  when the picker opens and holds while it is open, so no row moves under the
  pointer. The rule is `packages/shared/lib/label-order.ts`; what was used is
  kept per device (`lib/recent-labels.ts`), and a label counts as used when
  the picker closes with it still on.
- **Enter starts at the label used last**, so "the same label again" is G,
  Enter. Typing narrows the list and Enter takes the best match (a name that
  starts with it, then a word that does, then anywhere); the arrows move
  through it. Enter closes the picker, a click leaves it open for a second
  label. A new label is made only from the "Create" row, which Enter reaches
  by itself when nothing matches.
- **The same label again without the picker**: ⇧G, or the button beside
  Label in the Now bar (the label's colour and the key; its name too when the
  bar is wide enough). It only ever puts the label on, and says so in a toast
  with Undo.
- **The footage holds while a label is chosen** and carries on when the picker
  closes, and the Now bar's picker stays on the play it was opened for. Both
  are the game view's, not the picker's.

### A key per label

For a coach who tags with three or four labels at once, each of them is one
press away: a label can have a key, 1 to 9, and Option (Alt on Windows) with
that digit puts it on the clip on screen, or takes it off, with nothing
opened and the footage playing on.

- **The coach chooses the keys** in the label picker: a label's row carries
  its key, and on the label's own row that is the control that sets it, from
  a list of the nine keys and who has each. Nothing assigns or moves a key by
  itself. One label has one key and one key has one label, so a key given to
  another label moves, and a toast names the label that lost it.
- **A press toggles**, as a click on the label in the picker does, and says
  what it did in a toast with Undo. Undo names the clip the key was pressed
  on: in the game view another play may be on screen by then. A label put on
  this way counts as used, so Recent and ⇧G follow it. A key no label has
  says so, and where a key is given.
- **Where**: the game view (the play on screen), the editor (the selected
  clips, else the clip on screen) and Add clips (the clip that is playing;
  the ticks are what will be added, so they are left to "Apply label"). Keys
  are off while a field has the keyboard, as all the app's keys are, so the
  characters Option types (@ and $ on a Swedish layout) still type.
- **Holding Option** for a moment in the game view shows which key is which
  label over the corner of the stage (`game-label-keys.tsx`), with a check on
  the labels the play on screen has.
- **Option with a digit** because nothing else is free: the digits alone are
  the quarters here and the arrow kinds while drawing, ⌘1–⌘6 are the Go menu,
  Control with a digit switches desktops on a Mac, and the letters are the
  player's. By the key's place (`KeyboardEvent.code`), not its character.
  AltGr reports as Control with Alt and is left alone.
- **Kept with the account**: `labels.hotkey` (smallint 1–9, nullable, one
  label per key in a coach's vocabulary by a partial unique index; migration
  `20261111110000_label_hotkeys.sql`, probe `supabase/tests/label_hotkeys.sh`).
  A key is set through `set_label_hotkey`, which takes it from the label that
  had it in the same step. The rule is `packages/shared/lib/label-keys.ts`.
  `listLabels` reads a database the migration hasn't reached without keys,
  and setting one there fails with a toast; `move_to_club` recreates labels by
  name and colour, so a label arrives in a club without a key.

Why it is shaped this way (looked up 2026-11-11):

- *Copies on top of an unchanged list.* Menus that reorder themselves by use
  were slower and disliked (Mitchell & Shneiderman 1989); a split menu with at
  most four frequent items on top was faster (Sears & Shneiderman 1994); and
  what makes the split work is that it duplicates rather than moves, leaving
  the familiar list alone (Gajos et al., AVI 2006). In Findlater & McGrenere
  (CHI 2004) a static split beat an adaptive one and most people preferred
  choosing the top items themselves, which is the case for label keys below.
- *One key for the last code.* The research coding tools all have it:
  ATLAS.ti's Quick Coding (⌘L), MAXQDA's code with the last used code, NVivo's
  quick coding bar and its list of recent nodes. Dovetail puts recent tags at
  the top of its tag menu.
- *Hold the footage.* Frame.io pauses when a comment is started and plays on
  when it is sent.
- *Enter takes the highlighted match* is the W3C combobox pattern.

- *A key per label.* Every sports tagging tool gives each code its own key
  (Hudl Sportscode's code window, Nacsport and Catapult's tag templates,
  LongoMatch's dashboard). The shape here is the one the tools with a small
  fixed set share: the person assigns the keys (MAXQDA, Lightroom, Things),
  there are nine (MAXQDA's code shortcuts, Lightroom's keyword set on ⌥1–9;
  Finder has seven), a press toggles (Lightroom, Finder, Things), a key has
  one label (MAXQDA overwrites, LongoMatch refuses a key in use; BORIS lets
  keys be shared and then has to stop and ask), and the key is shown where
  the label is (Sportscode on hover, Lightroom while Option is held; Nielsen
  Norman: beside the command, and never the only way).

Not built: a key for a label in the picker while its search field has the
keyboard (Option types characters there), the key legend outside the game
view, and more than nine keys.

Analytics events are in `packages/shared/types/analytics.ts` (`game_view_*`,
`collect_*`, `game_marks_filled`, `label_picked`, `label_key_set`).

## Not built

"Show in game"
from an editor clip (the view already accepts `?play=`); marking in and out
around a play; substitution rows, lineup tables and a shot chart; the footage
from a game's cloud copy; free time-range clips with no play (a schema change
across all three apps). The web game view on `feat/cloud-game-videos` can
reuse the shared modules after the merge.
