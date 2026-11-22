# One play row: design

Status: draft for Leonard's approval, 2026-11-21. Nothing is built. Branch
`feat/play-row`, cut from local main 8a05d7d (origin/main has no Teams
Plays). The row was chosen from an interactive mockup in the session that
wrote this ("Cleaned up": clock, event, player with labels, score, actions).

## Intent

The desktop app lists plays in four places, each with its own row:

| List | File | Row today |
|---|---|---|
| Teams: Plays | `components/team/team-play-list.tsx` (`PlayRow`) | one line, 32 px: clock · player · label chips · event in grey text, right-aligned. No add, no "in the playlist" mark, no row menu |
| Game view | `components/game/game-play-row.tsx` (`GamePlayRow`) | two lines, 44 px: a coloured strip and a coloured event pill, player, chips; clock · team · qualifiers · note; score; Label and + on hover; ✓ when in the target |
| Add clips | `components/editor/clip-browser-panel.tsx` (`BrowserRow`) | two lines, 45 px, strip + pill, a checkbox, plays already in the playlist dimmed to 40 % with a ✓ |
| Playlist editor | `components/editor/clip-rows.tsx` (`ClipRow`) | two lines, strip + pill, checkbox, drag, group rail, trim ±, note, Label and Remove on hover |

Leonard likes the calm of the Teams list and wants all the power of the game
view in it: adding, seeing which plays are already in the playlist, labelling
with ⌥1–9. Looking at the four side by side, the Teams list is calm because of
its structure (one line, aligned columns, almost no colour), not because it
does less; the game view is loud mainly because every row carries two colour
signals (strip and pill). And the four rows have drifted apart because they
are four components: the play on screen is marked two ways, Teams has no row
menu, Add clips dims what the others tick.

So: one row for every play list, built on the Teams list's structure, with
the game view's features kept as quiet state and transient actions.

## What the research said

From the session's review of comparable tools and design guidance (sources in
the session; not re-checked here):

- **State stays visible, actions appear when needed.** Whether a play is in
  the playlist, and its labels, are always on the row; Add and Label show on
  hover, on the current row and under the keyboard. (Apple Music and Photos'
  hover controls; ServiceNow's list guidance: don't hide stateful controls.)
- **State as thin marks, not buttons.** Final Cut Pro marks clips already used
  in the open project with a thin line on the clip: the closest analogue to
  "already in the playlist". None of the sports tools checked (Hudl,
  Sportscode, Wyscout, Catapult, Veo, Synergy) shows membership on the row in
  their public docs.
- **Every hidden action has a second way in.** The row menu, the native menu,
  tooltips that name the key (Superhuman). NN/g: hover doesn't exist for the
  keyboard, and hidden controls are found less.
- **Calm comes from structure.** Linear's 2026 refresh kept density with fewer,
  smaller icons and less colour; Apple's 2025 guidance puts hierarchy in
  layout and grouping, not decoration.
- **Tables: left-align text, right-align numbers, keep scanned columns
  together at the left.** The first mockup put the event at the right edge and
  the labels in the middle; Leonard found it scattered, and this order fixed it.
- The app's own rules agree (`docs/desktop-design-audit.md`, row 8): chosen
  rows are neutral fills, the cyan accent is for controls, and the event colour
  meanings (make, miss, rebound, assist, steal, block, turnover, foul) are kept.

## Goals

- One row component, used by all four lists, one line high.
- Read left to right as when · what · who · the coach's labels; numbers and
  controls at the right.
- Every list can show, on the row and without hovering: the play on screen,
  the selection, the labels, and whether the play is in the target playlist.
- Teams and the game view offer, on the row: Label, Add, and the same
  right-click menu (`GamePlayMenuContent`). The editor keeps Label, Remove and
  its own menu; Add clips keeps Label and its ticks (see Per list). The keys
  each list has today (A, G, Shift+G, ⌥1–9, ↑ ↓, ⌘A, ⌘-click, Shift-click,
  Esc) keep working unchanged.
- Teams Plays gains what it lacks: the in-playlist mark, Add and Label on the
  row, and the row menu.

## Non-goals

- New features. No new keys, filters, or list behaviour beyond giving Teams
  what the game view already has.
- The scouting report's outline (`components/report/report-outline.tsx`) and
  the web and mobile apps. Mobile already marks a clip with one dot
  (`eventHue` in `packages/shared/lib/events.ts`).
- `eventLabel`'s wording. It says "2PT Made" while the filter chips say
  "2PT made"; that mismatch is real but `eventLabel` is shared with other apps
  and exports, so it is a separate change.
- Display options (choosing columns per list, as Linear does). Possible later.

## Anti-goals

- A row that is calm because something the coach relies on was dropped:
  scanning makes against misses, seeing a scoring run, telling the two teams
  apart in the game view, seeing which game a clip comes from in a multi-game
  playlist.
- Hover as the only way to an action.
- Controls that appear on hover and push the row's text sideways.
- The accent colour back on rows (fills, text, strips).

## Approaches

- **A. One shared row component (chosen).** One `PlayRow` with fixed columns
  and slots for what differs per list (a checkbox, a drag handle and group
  rail, trim and note marks). The four lists can't drift apart again, and
  Teams gets the game view's features by using the same component. Cost: the
  biggest single change, touching all four lists and their headless specs at
  once.
- **B. Restyle each row separately.** Each list keeps its component and adopts
  the new look. Can go list by list, but leaves four rows to keep in step,
  which is how they drifted.
- **C. Keep two lines, calm them down.** Drop the strip, make the pill grey.
  Keeps the second line's details on the row but halves how many plays fit,
  and Leonard prefers the one-line Teams feel.

Leonard picked the one-line row from the mockup. Building it as one component
(A over B) is Claude's call, for the drift reason above.

## The row

32 px, one line, every list. Left to right:

| Slot | Width | What |
|---|---|---|
| Lead | per list | Editor: the group rail and the checkbox (as today). Add clips: the checkbox. Teams and game view: none. |
| Now | 12 px | ▶ on the play on screen, in the foreground colour; empty otherwise. |
| Clock | fixed, tabular numbers, grey | `Q1 09:47` where the list has no quarter headers (Teams, Add clips, editor); `09:47` under the game view's quarter headers. A feed with no game clock shows the quarter alone. |
| Team | about 36 px, grey | Game view only, when both teams are listed: the team's code (see "Telling the two teams apart"). |
| Event | fixed, about 104 px, left-aligned | A 7 px dot in the event's colour family (`eventHue`) and `eventLabel` in grey. The dots line up down the list so makes, misses and turnovers can be scanned by colour. |
| Player and labels | the rest | `#22 Marko Dujkovic` (or the team's name for a team play), then up to two labels and "+n" with the rest in a tooltip. The name truncates first; the labels never do. |
| Context | per list, grey, truncates | Editor and Add clips, only when the list holds more than one game: the game, e.g. `vs Zeta`. Empty otherwise. |
| Score | 40 px, right-aligned | Game view only: the score after a scoring play, the scoring side's number in the foreground and medium weight, as today. |
| Marks | per list | Editor only: trim ± and the note icon, as today. |
| Actions | 2 × 24 px, reserved | Label (tag), then the playlist slot: **+** (not in the target), **✓** (in the target). |

Labels on the row use a quiet form of `LabelChip`: a neutral pill (the fill a
hovered row uses), a 7 px dot in the label's colour, the name in grey at
11 px. Not the coloured pill: with event dots on the same row, two kinds of
bare coloured dot would be confused, and the grey pill says "this is your
label". The label picker, the report and other places keep today's chip.

The event dot's colours come from one map of `EventHue` to the desktop's
colour classes, next to the row. Shot value no longer deepens the colour (a
dot is too small to carry it), as mobile already decided.

### States

- **Hover:** the neutral hover fill; Label and + become visible. They also
  show on the current row, on the row with keyboard focus, and on a row whose
  menu or picker is open (`REVEAL` in `clip-rows.tsx` does this today). Their
  space is always reserved, so nothing moves.
- **Play on screen:** the moving highlight that springs from row to row
  (`ActiveRowPill`), the ▶ in the Now slot, and the player's name in medium
  weight. Replaces the Teams list's left-edge bar.
- **Selected:** `--row-selected` (neutral), as today. A selected row that is
  also on screen shows the selection fill and the ▶.
- **In the target playlist:** a grey ✓ in the playlist slot, always visible.
  Just after an add it arrives in the accent (the game view's `added` state,
  with its spring) and settles to grey; that ✓ removes it from the target on
  click, with the collect toast's Undo. A play that was in the target before
  (not added from this view) has a static ✓, as in the game view today. In Add clips the
  ✓ replaces today's 40 % dimming: a play already in the playlist keeps full
  contrast, says so with the ✓, and can't be ticked (as today).
- **Can't play here** (Teams: the game's video is missing or unsynced; game
  view: the play is before or after the video): the row's text (clock,
  event, player, labels, score) is dimmed as today; the actions and the ✓
  keep full contrast, since adding and labelling still work. The game view's
  words for it ("Before the video starts", "After the video ends") go in the
  row's tooltip and, when that play is current, in the Now bar's line (see
  Per list).
- **Keyboard focus:** the inset focus ring the editor has, only while the
  keys drive the list.

### Per list

- **Teams Plays.** Gains the playlist slot (from `collect.statusOf`), Label on
  the row (the shared `LabelPickerPopover`), and the row menu
  (`GamePlayMenuContent`: Add to the target, to another playlist, or to a new
  one). **Which plays an action on a row acts on** follows Finder, as the
  editor does: on a row that is part of the selection, the selection; on any
  other row, that row alone (the selection is left as it is). The keys keep
  today's rule: the selection, else the play on screen. No score column: the
  game header carries the result. The game headers and the pinned header stay.
- **Game view.** One line instead of two. Score column on. The second line's
  details move to the Now bar under the video, onto the line it already has
  (quarter · clock · score), in that order after the score: qualifiers ("In the
  paint"), the note ("Lead change", "Tied at 51"), and "Before the video
  starts" / "After the video ends" for a play outside the video. The line
  truncates at its end, with the whole line in its tooltip; the bar's buttons
  and key hints keep their current rules for narrow widths. Scanning the list
  for "Lead change" is given up; the score column, with the scoring side's
  number in bold, still shows a run.
  **Telling the teams apart:** the team-code column, below.
- **Add clips.** One line; checkbox lead; context column for multi-game
  lists. The playlist slot shows ✓ for plays already in the playlist (instead
  of dimming them) and is empty otherwise: no + on its rows and no new menu,
  since adding in Add clips is ticks and ⌘↩, unchanged (Return ticks the
  playing clip). Its row height constant changes from 45 to 32.
- **Playlist editor.** Play rows go to one line; the lead keeps the checkbox
  and group rail, the group pill sits before the event; trim ± and the note
  icon in Marks; the playlist slot is Remove (trash, hover only) instead of
  +/✓, since every row is in the playlist. The drag engine and the context
  menu stay as they are. **Text and stats card rows keep their own layout and
  height**: they hold editable text and a duration, so the editor's list has
  mixed heights on purpose. The drag engine measures each row, and the group
  rail runs across whatever heights a group holds; both are checked in review.

### Narrow lists

The fixed columns (Now, clock, event, actions) take about 300 px with their
gaps, so a narrow list has to give way in a set order. The row reads its own
width (a container query), and as it narrows:

1. **Below about 480 px:** labels show as their dots only (no names), still
   up to two and "+n"; the names are in the tooltip.
2. **Below about 400 px:** the event column shrinks to its dot; the word is in
   the tooltip and the Now bar. The clock drops its quarter where the list has
   quarter or game headers.
3. **Then** the player's name truncates. Actions, ✓ and the dots never go.

The exact breakpoints are the builder's, measured against the real panes:
Teams at its narrowest (42 % of the content area, at least 320 px), the game
view's list, the Add clips sheet and the editor's list at the 1024 px window.

### Keys and finding things

Unchanged keys. What changes is that they are named where the action lives:

- Tooltips name the key: "Add to Team plays (A)", "Label (G)".
- Teams and the game view share one row menu; the editor keeps its own.
- The label picker already shows each label's ⌥ key.

## Constraints

- **Fixed height.** Teams and Add clips are windowed by a constant row height
  (`PLAY_ROW_HEIGHT`, `BROWSER_ROW_HEIGHT`). Every row is exactly 32 px
  whatever it holds; one shared constant.
- **Memoised.** The game view re-renders only the rows whose props change
  while the game plays; the shared row keeps that (`memo`, stable callbacks).
- **The editor's drag engine** moves rows by transform; the row's own
  transition must stay colours only (`rowBase` in `clip-rows.tsx`).
- **Accent only on controls** (`feedback`: row highlight). The fresh-add ✓ is
  the one accent on a row, and only for a moment.
- **Reduced motion:** the moving highlight and the ✓'s arrival fall back to
  fades through `MotionConfig`, as today.
- **Copy:** English, sentence case (the tooltip and menu text).
- **Width:** works at the window's minimum, 1024 px wide, with the list at its
  narrowest (Teams: 42 %, at least 320 px). At that width the name truncates
  first, then the context column; clock, event, labels and actions keep their
  place.

## Telling the two teams apart in the game view

Today the team's name is on the game view's second line, which goes. Leonard
chose (2026-11-21) a grey team-code column: when the list shows both teams,
the Team slot after the clock holds the play's `eventTeam.teamCode` ("SÖD",
"KÖP"), about 36 px, tabular. When one team is filtered, the slot is not drawn.
A play with no team (a timeout, a team rebound with no team) leaves it empty.
A feed with no code falls back to the first three letters of the team's name,
upper case. Rejected: an edge in the team's colour (fails for black, white,
grey or matching jerseys, and the graph's fallback is the accent, which rows
don't use) and no marker at all.

## Calls to check (Claude's, not Leonard's)

1. The event word stays grey, the player's name is the strongest text. If the
   event should read as strongly as the name, that's one class.
2. Add clips stops dimming plays already in the playlist; the ✓ says it. It
   gets no + and no new menu.
3. The editor shows the game (`vs Zeta`) as a grey column only in multi-game
   playlists, where today it is on line 2.
4. Qualifiers and notes move to the Now bar's line; "Lead change" can no
   longer be scanned down the list.
5. One component (approach A) rather than restyling four.
6. In Teams, Label and the menu on a row outside the selection act on that
   row alone (Finder's rule).
7. A row that can't play dims its text, not its actions.
8. The editor's card rows keep their height; the list mixes heights.
9. The order in which a narrow row gives way (labels to dots, then the event
   to its dot, then the name truncates).

## Left to the builder

- Where the component lives and its exact props. The slots above are the
  contract; a `components/plays/` folder is a reasonable home.
- How the four lists pass their differences in (slots, render props, flags).
- The `EventHue` colour classes, matching today's strip colours' families in
  both appearances and all eight themes.
- Updating the headless specs that find rows by their current structure
  (`P-teams`, `H-game-player`, `M-add-clips-plays`, `K-add-clips-window`,
  `D-task13-row-menu`, `D-task14-selection`, and others that touch rows).
- `docs/game-view.md` and `docs/teams.md` where they describe the rows.

## Review focus

The cases most likely to break for a coach, with no test today:

1. A long name with three labels at 1024 px, in Teams at its narrowest: the
   row gives way in the order under Narrow lists, actions and ✓ stay, nothing
   wraps or overflows.
2. The game view with both teams shown: the two teams can be told apart
   without reading, in light and dark and with team colours that are black,
   white, grey or the same.
3. Hover controls appearing and the fresh-add ✓ never move the row's text.
4. Keyboard only (↑ ↓, A, G, ⌥1–9, Shift+F10 for the menu): every action that
   hover shows can be reached, and the actions show on the focused row.
5. The editor: dragging a row (and a group) still lands where expected with
   the new height, and a checkbox click still selects rather than plays.
