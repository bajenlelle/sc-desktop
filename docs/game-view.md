# The game view

`/matches/:id` on the desktop opens on the whole game: the footage, a list of
its plays that follows it, and one timeline that is both the scrubber and the
story of the score. From it a coach collects plays into a playlist and labels
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
- A game comes back as it was left, for the app session: its position
  (`sessionStorage`, `scoutable_game_position:<id>`), and its filters, quarter
  zoom, list scroll and (on a tab switch) view (`lib/game-tabs.ts`), labels and
  playlists shown at once and read again behind. A link to a play opens without the filters.
  Not kept: the filter sheet, the selection, and Undo for adds made on an
  earlier visit. All of it but the position is dropped when the signed-in
  user changes (sign-out doesn't reload the webview).

### Games in tabs

- **One mounted view, no hidden videos.** A tab is a remembered game, not a
  page kept alive: switching remounts the page on the other game, so there is
  still one decoder (`lib/release-video.ts`), and the memory above is what
  brings it back as it was left.
- From two open games a tab bar sits under the toolbar, inside its material
  (`Toolbar`'s `tabBar` row, `components/game/game-tab-strip.tsx`). Six at
  most: a seventh game closes the tab shown least recently, quietly. New games
  open on the right; no drag reordering. A tab activates on press, closes with
  its × (on hover or focus) or a middle click; ⌘W stays Close Window.
- The tabs are per user and space for the app session (`sessionStorage`,
  `scoutable_game_tabs:<userId>:<orgId>`; `apps/desktop/src/lib/game-tabs.ts`
  over the pure `packages/shared/lib/game-tabs.ts`). On any `matches-changed`
  the store empties its loaded-game cache and reads the open games again:
  renamed games take their new title, deleted ones and games moved to another
  space lose their tab (an empty read is taken as a failed one).
- ⌃Tab and ⌃⇧Tab step through the tabs and wrap (handled in the page, on every
  layout, not while a dialog is open); the Window menu has Show Next Game Tab
  (⌘⇧]) and Show Previous Game Tab (⌘⇧[), on only on the game page.
- A switch replaces the history entry (`replace: true`), as the Game | Details
  switch does: Back leaves the games. It first leaves the field being typed
  in, so a Details title saves; and a playlist write still out from the game
  it leaves lands before the next game reads or writes that playlist.

## What it reads from the stats (`packages/shared/lib`, pure, tested)

| Module | What it answers |
|---|---|
| `game-timeline.ts` | Where each play is on the video (`buildGameTimeline`), which play is at second T (`playIndexAt`, `activePlay`, a clicked play is held through its pre-roll by a pin), where T is in the game (`momentAt`: before, live, break, after), and the strip's folded x axis (`gameScale`) |
| `game-flow.ts` | The score story (`gameFlow`): score after each play, quarter and final scores, lead changes, ties, largest lead, runs; which plays belong to which moment (`gameMoments`); a player's stints on the floor with each stint's score change (`onCourtStints`); the chart's geometry (`flowChart`) |
| `game-marks.ts`, `game-marks-fill.ts` | Timeouts and period bounds (below) |
| `game-list.ts` | Which plays a filter keeps (`keepPlay`) and the list's rows (`gameRows`): period headers, plays, and the timeout, run and period-end markers between them |
| `clip-filters.ts` | The Add clips filter vocabulary. Byte-identical to the file on `feat/cloud-game-videos`, so the merge sees one file; change it there too |

- **The axis** is video seconds when the game is synced, wall-clock seconds
  when it is not (the list, the graph, collecting and labels still work
  without footage; a click then only selects a play).
- **The score is counted from made shots**, in feed order (period, game clock
  descending, action number). In the 51 Genius games checked on staging the
  made shots summed to the feed's final score every time; the feed's own
  running score is the fallback, and a game with neither draws bands and ticks
  only.
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
  current play is, and it changes a few times a minute. `nowKey` is the play
  on screen in the whole game (what the Now bar names and A adds); `activeKey`
  is the lit row, the latest play the filtered list shows.
- `game-timeline-strip.tsx`: hand-drawn SVG, no chart library. Quarter bands
  with their scores, the score difference around a zero line (home above), a
  tick per play coloured by event, timeout flags, run bars, a clutch bracket,
  the largest lead. Breaks are folded into notches that still map to their
  footage. It answers the press: the playhead goes to the pointer on
  pointer-down and follows 1:1, resists past the ends, and a release without
  movement is a click (on a play: that play from its pre-roll). Double-click a
  quarter to zoom.
- `game-play-list.tsx`, `game-play-row.tsx`: rows are memoised, not
  virtualised (as Add clips). The current row follows playback until the coach
  scrolls; "Jump to now", any seek, or scrolling back resumes it.
- `game-now-bar.tsx`: the play on screen in words, with Label (G) and Add (A).
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
- **A playlist players already have**: the add is the same write. The control
  counts, per shared playlist, the clips players don't have yet: the target's,
  and any shared playlist holding one of this game's clips without a file
  (`heldForPlayers` in `packages/shared/lib/playlist-sharing.ts`). It is read
  from the playlists, so it survives leaving the page. One playlist: "Send n
  clips" cuts and uploads them from here, without leaving the game, through
  the editor's own path (`apps/desktop/src/lib/ship-clips.ts`, which the
  editor's deferred ship also runs): the writes still out for that playlist
  land first, the footage and plays of any other game in the playlist are
  read, one toast carries the progress and ends on "Sent n clips to
  {playlist}", a failure is said as the editor says it, and the count comes
  down as the files land. Several: the same button opens a menu of them.
  "Open playlist" opens the target in the editor whenever there is one; it
  uploads nothing on arrival. Players' feeds skip clips with no uploaded
  file, so they see nothing until then. Both leave the game only through
  "Open playlist", which hands the editor the way back (`state.from`, the
  "‹ {game}" button in the editor's toolbar; so does Details' "Build a
  playlist").
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
  the quarters here and the arrow kinds while drawing, ⌘1–⌘5 are the Go menu,
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
