# Scouting reports

A coach scouts an opponent next to a playlist: the **report** is a document of
its own (a title and opponent, a team intro, one section per player with their
stats, a note and their clips) built from the playlist's clips. **Share** turns
it into one public, unlisted web page (clips play inline) that staff and
players open from a link, and that "Save as PDF" prints. In a club space the
coach can also **send** it to players' phones, where the app draws it natively
and tells the coach who read it ("On players' phones" below).

## The draft (`packages/shared/lib/report-draft.ts`)

- **One draft per playlist**, `scouting_report_drafts.content` (migration
  `20261101100000_scouting_report_drafts.sql`, owner-only RLS, client-written,
  ≤ 256 KB, ≤ 60 sections): `{v:1, title, opponent, intro, sections:[{id,
  player, note, stats}], placements, order}`. `stats` is a stats card spec, a snapshot
  like any stats card. `title` and `opponent` are null until the coach types
  them: the playlist's name and the team most sections are about stand in.
- **Clip membership is derived, never stored as a list** (`deriveReportLayout`):
  a clip goes to its placement when the coach moved it by hand (`placements`,
  by clip item key), else to the section whose player is in the play
  (`event.player.playerId`), else to the Team section. So a clip added to the
  playlist later shows up under its player at once, a removed section's clips
  fall back to the team, and **the playlist's order is never changed by the
  report**. A placement of `"out"` (`LEFT_OUT`) leaves a clip out of the
  report while it stays in the playlist. `pruneDraft` drops placements and
  order entries for clips that left the playlist before every save.
- **The report has its own reading order** (`order`, clip keys; added in
  desktop 1.5.0 without a migration: the table's check only looks at `v`,
  `placements` and `sections`). Empty means playlist order. The first move of
  a clip writes down the whole order (`moveClips`); a clip it doesn't name
  (added to the playlist since) reads after the ones it does, in playlist
  order. Two known gaps: a club move that merges a game into the club's copy
  re-keys `placements` but not `order` (`move_to_club`), so that game's clips
  keep their sections and move to the end of them; and a 1.4.0 app that saves
  a draft drops `order` and the left-out placements (it reads neither).
- **The playlist's text and stats cards are video cards**, not part of the
  report. The report has its own intro and notes.
- **Whose section**: anyone in the games the playlist's clips come from, not
  only players with clips (`playerRoster`, `lib/player-roster.ts`): the clipped
  players first, most clips first, then the rest of those games' players (both
  teams) from the stored plays, plus the box scores already read (they also
  list players who played without a recorded action). `taken` is the draft's
  players. `rosterByTeam` groups them, the team with the most clips first.
- **Leaders** (`lib/report-leaders.ts`): the roster joined with the season
  page of each player's competition (`loadSeasonPlayers`, the whole page parsed
  once; `leaderCompetition` picks the game their clips mostly come from, else
  another playlist game with a season). `rankBy` / `topN` sort a column or tick
  the top three; a 3P% ranks only past `LEADER_MIN_3PA` attempts.
- `buildScoutingReport` (`lib/scouting-report.ts`) walks the layout into the
  same `{header, sections[]}` as before: the Team section (intro as its first
  paragraph, then its clips) only when it has something, then `p1..pn` in draft
  order, each section's clips in reading order and none of the left-out ones.
  The editor asks the layout to keep an empty Team section (`keepTeam`) so its
  intro can be written and clips dropped on it. The content key, the stored
  report (v1) and the page are unchanged.

## The report page (`apps/desktop/src/pages/report.tsx`, `/reports/:playlistId`)

A report is a document of its own, reached from everywhere it is named and
returning there: Reports' rows, a team's New/Open report, ⌘K search (and its
Recent list) and the playlist editor's **Report** button all go to
`/reports/:playlistId`, with `state.back` (`ReportPageState`) naming where
Back goes (`‹ AIK`, `‹ Reports`, `‹ <playlist>`; Reports by default). Reports
is the selected sidebar row. A link from before the page
(`/playlists` with `view: "report"`) redirects to it.

- **`lib/use-report-workspace.ts`** reads what the page needs itself: the
  playlist (`getPlaylist`), its games (`listMatchesByIds`) and their plays
  (`listEventsForMatchesChecked`), whether each game's video is on this
  computer (`probeMatches`, again on window focus after 30 s), the labels
  (`useClipLabels`), the shared report, and the publish `run`
  (`generateScoutingReport` with `buildShipSegments`, patching its own copy of
  the playlist as clips are hosted). Clips play and are cut with the editor's
  default pre- and post-roll.
- **`ReportView`** is the body, as it was in the editor: the page passes its
  Back button (`leading`) and **Edit clips** (`onEditClips`), which opens the
  playlist in the editor; a clip's "Edit clip" opens it there with that clip
  selected (`reveal`).
- Esc stops a clip, then the selection, then goes Back.

## Sections (`blocks` in the draft)

A report is a list of sections the coach controls (`ReportBlock`:
`keys | players | actions | profile | games | custom`), in the coach's order:

- **Keys**: a key per line (`keyLines` strips typed bullets), with clips.
- **Players to stop**: the player sections, where the block sits.
- **Their actions**: the old Team section (`TEAM_SECTION`, so every stored
  placement and the fall-back for plays about no one stay), words and clips.
- **How they play** and **Their games**: the team's season as the Team page
  shows it (`lib/report-season.ts`: `PROFILE_ROWS`, `POINTS_FROM`, the
  fixtures), drawn live in the editor (`useReportSeason(draft.team)`, the
  cached league reads) and stored in the report when it is published
  (`ReportSeasonSnapshot`). No clips.
- **A section of your own** (`c-<uuid>`, at most 8): a name, words and clips.

Each section's heading has a menu on hover: Hide from players / Show to
players, Move up, Move down, Remove section (not the players or Their
actions). ⌘⇧↑/⌘⇧↓ move the section shown in the outline. A hidden section stays
in place, dimmed, with "Hidden from players"; in the outline its row shrinks to
a thin dimmed one with an eye-slash, and its row's context menu has the same
items (and ⌥↑/⌥↓, ⌫). Hide, remove and move go on the undo stack, with Undo in
the toast (`applyWithUndo`). "+ Add section" at the end lists the sections not
in the report and "Your own section". The summary (the draft's `intro`) opens
the document under the title.

A draft without `blocks` (from before sections) reads as Their actions, then
the players (`blocksOf`), with the same controls as any other: its intro shows
as the summary. Opening it changes nothing, and it publishes the report it
always did, with the same content key, until the first change to a section
(hide, move, add, remove) gives it `blocks`; from then on it publishes as a
report of sections, its intro as the summary. A
report started from a team (`teamReportBlocks`) reads Keys, players, Their
actions, then How they play and Their games hidden. An older desktop that
saves a draft drops `blocks`: the report goes back to Team + players with
every clip in place.

## The desktop (`apps/desktop/src/components/report/`)

- **Entry**: the report page above. The editor's toolbar has a Report button
  (a dot while the report is shared) in place of the old Clips | Report switch.
- **`use-report-draft.ts`**: reads the draft once per playlist (kept in a
  cache, so coming back is instant), applies ops optimistically, saves 600 ms
  after the last edit (`pruneDraft` first), flushes on unmount or a
  playlist change. A draft that was never edited is never written. An edit
  with a label goes on an undo stack per playlist (⌘Z / ⇧⌘Z, the toast's
  Undo): undo restores the structure (`restoreStructure`: sections, placements,
  order) and keeps the words typed since; notes and the intro keep their
  fields' own undo.
- **`use-player-stats.ts`**: `readPlayerStats` (season averages where the
  league has them, else a game line, else none; a failed page read is told
  apart from a league with no numbers), `statsMatchIdOf`, and the box scores
  read so far (`ensureBoxScores` reads the playlist's games when the picker
  opens, so the whole team is listed).
- **The picker** (`report-player-picker.tsx`): one table per team, columns
  clips · PPG · RPG · APG · SPG · BPG · 3P%; a header sorts, a quick pick ticks
  the first team's top three; ticked = in the report, and unticking a player
  with a note asks first. It opens by itself the first time a playlist's
  report is opened, pre-ticked with everyone who has clips. Confirming adds the
  sections at once and reads their numbers three at a time.
- **The document** (`report-document.tsx`) mirrors the page: the title and
  opponent as inline fields, the intro, then each player's number, name, team,
  stats (a popover with the embedded `StatsCardInspector`, or the no-stats line
  with the league's other seasons), note and clip tiles. A tile's menu moves
  the clip (or the side panel's selection it is in) to another player or the
  team, leaves it out, or, with **Edit clip**, goes to the clip in the Clips
  view (the playlist, the clip selected).
- **Clips play in their tiles** (`report-clip-player.tsx`), one at a time: a
  click on a tile plays it there, a click on another stops the first. Only the
  playing tile holds a `<video>` (`VideoPlayer`, so the free-tier mark, the
  shared volume and the load-failure messages are the Clips view's); the
  others are placeholders, and a stopped tile gives its element back
  (`release-video.ts`), since leftover videos in WKWebView end in black paused
  frames. A placeholder shows the clip's first frame as a still
  (`reportFirstFrame`, 0.3 s in, past an uploaded copy's fade-in), asked for
  once the tile comes within 400 px of the screen (`lib/report-frames.ts`):
  from the game's own video with ffmpeg (`grab_frames`, three at a time), or,
  when the video isn't on this computer, from the uploaded copy through one
  hidden video at a time drawn on a canvas and let go at once (the media host
  sends `Access-Control-Allow-Origin: *`). Stills are kept for the session by
  key (a trim, a sync change or a new upload makes a new one); one that failed
  isn't asked for again. A drawn clip shows its first frame here too; the
  shared page's poster is its drawn frame. A click on the footage or Space (while the player has focus) plays
  and pauses; the bar has play/pause and the scrubber; at the end the last
  frame stays with Replay; ✕ (Stop), Esc, or the clip leaving the report or
  its section stops it. What plays is `reportClipSource`
  (`packages/shared/lib/report-clip-source.ts`), in this order: the game's own
  video while it is on this computer (the playlists page's file probe hasn't
  found it missing or unreadable) and the play can be placed in it (the game
  is synced), over the clip's window
  (`clipBounds`, the window exports and uploads are cut with, so with the
  playlist's pre- and post-roll and the clip's own trim); else the clip's
  uploaded copy (`r2Url`, cleared whenever the trim changes, so a present one
  is current), from 0 to the end of the file; else the tile says why: "The
  game’s video isn’t on this computer." or "This game isn’t synced to its
  video yet." Each play is `scouting_report_clip_played` (via tile or panel,
  source local, shared or none). The coach's drawings freeze their frames and
  slow motion slows its stretch, as in the Clips view: `reportClipEffects`
  gives them in the time of what plays (the game's own video keeps their
  absolute times inside the clip's window, `clipEffectsInWindow`; an uploaded
  copy takes the players' rebase onto the file, `clipWatchEffects`). A held
  frame reads as playing, and the scrubber shows the drawings and the sections.
- **The side panel** (`report-outline.tsx`, a tree): Team (always, with 0),
  each player and "Not in report" (folded at first), each with its clips as
  one-line rows (the play's colour, the play, the time, a note mark; the hover
  has the rest). Dragging a clip, or the ⌘/⇧-selection it is in, reorders it,
  moves it to another section or out; dragging a player's header moves the
  player with their clips. Where a drop lands is `lib/report-outline.ts`
  (`clipDrop`, `sectionGap`, `sectionDropIndex`) over the drag engine's flat
  rows; a drop on a folded section appends. Keys: ↑/↓, ⇧↑/⇧↓, ←/→ fold,
  ⌥↑/⌥↓ moves (`nudgeClips` crosses into the next section), ⌫ leaves clips
  out or removes a player, Return shows a section in the document, ⌘A, Esc
  stops a playing clip, then clears the selection, before it leaves the view.
  A plain click on a clip row, or Return on it, scrolls to its tile and plays
  it there; on the clip that is already open it resumes a paused clip and plays
  an ended one again from its start (a playing clip carries on). The row's menu
  has "Show in report" (scroll only) and "Edit clip".
- **Share** keeps `scouting-report-dialog.tsx` minus the title and opponent
  inputs (they are in the document): a summary line, Generate, then the link,
  QR, PDF, Update and Stop sharing. `generateScoutingReport`
  (`apps/desktop/src/lib/scouting-report.ts`) takes the draft. "Changed since
  sharing" compares the live report's content key with the document's.
  - **The limit, checked on open** (`scouting_report_share_limit`, read each
    time the sheet opens, so a report shared or stopped meanwhile is seen; a
    failed check shows nothing and leaves the publish to answer). A free plan
    with nothing in the way reads "1 shared report included. Go Pro to share as
    many as you like." When another report is in the way the sheet opens on it
    instead, before any clip is prepared: the other report's title and its
    expiry, with "Stop sharing it" (it asks first: its link stops working at
    once, then the sheet goes back to the review) and "Go Pro". A publish that
    still meets `report_limit_reached` ends up on the same view, named from the
    error's `DETAIL`.
  - **Opens**: once the link is shown, "Opened n times" (or "Not opened yet",
    "Opened once"; `openedLabel`) from `scouting_reports.open_count`, read again
    each time the sheet opens. The sheet's buttons that open the link in a
    browser add `#app` (view) or `#print` (PDF), so the coach's own looks
    don't count.
  - The desktop no longer sends `header.attribution`; the builder's default
    (true) is what a new report carries, and the page doesn't read it (see the
    page, below).

## Starting from a team (`packages/shared/lib/team-report.ts`, `apps/desktop/src/lib/team-report.ts`)

A coach thinks "we play AIK on Saturday", so a report can start from the
opponent instead of from a playlist. Step A of the report-flow proposal
(artifact "Scouting report flow", 2026-11-22): the report still lives in its
playlist's Report view.

- **Where**: **New report** in the Team page's toolbar (both Season and Plays),
  beside Teams' "Your next game", and on Reports (the toolbar, and the empty
  state's action). The Team page and Teams' button reads **Open report** once
  the team has its report: one report per game against the space's team
  (the draft's `game`), or, when they don't meet again this season, one with
  no game (`findTeamReport`, over `listReportDrafts` and the space's playlists,
  read again on `PLAYLISTS_CHANGED` and window focus).
- **Reports' New report** (`components/report/new-report-popover.tsx`): the
  space's next opponent first ("Your next game · Sat 28 Nov"), then this
  season's catalogue teams (`useTeamCatalog`, the space's own league first),
  and `New report for “name”` for anyone else. A catalogue team is opened by
  its newest season (`resolveLeagueTeam`, which `/teams/find/:id` uses too);
  its next game against the space's team is read, and its existing report for
  that game opens instead of a second one. A typed name makes a playlist of
  that name with a draft that holds only `opponent` (`createNamedReport`).
- **What a team report starts with** (`createTeamReport`, the Team page's own
  cached reads): the playlist named `teamReportName` ("AIK · Sat 28 Nov", or
  "AIK" without a game), and a draft with `opponent` = the team, `team`
  (`{competitionId, teamId, name}`), `game` (`{id, at, home}`, the opponent's
  side), the sections Keys (up to three of the team's keys, surest first,
  `teamReportKeys`; empty under five games), players, Their actions, then
  How they play and Their games hidden (`teamReportBlocks`), and up to three
  players with their season cards already made (`pickReportPlayers`: the
  leading three-point shooter, offensive rebounder and free-throw getter,
  then the most minutes; `makeSeasonCard` from the team's season page). A
  playlist whose draft can't be saved is deleted again. The team's collect
  target (`team:<competition>:<team>`) becomes the new playlist, so Plays'
  + adds into the report.
- **The picker** of a report with a `team` lists the team's season roster after
  the clipped players (`playerRoster`'s `seasonRoster`), so a section can be
  about anyone on the team before any clip exists; their numbers come from
  that season (`leaderCompetition` falls back to it, and `readInto` reads the
  season line when the player has no game in the playlist).
- `team` and `game` are optional draft fields, added without a migration
  (the table's check reads only `v`, `sections`, `placements`). A desktop
  before them drops both when it saves; the report itself is unchanged.
- Analytics: `scouting_report_started` (`from`: team_page, next_game,
  reports; `opponent`: league, typed; `players`, `keys`, `game`), and
  `playlist_created` with `surface: "report"`.

## Player photos (`packages/shared/lib/player-photos.ts`, `supabase/migrations/20261119100000_genius_players.sql`)

A player's section shows their roster photo with the number as a badge on it; without a photo it shows the number circle as before. The player picker shows a small photo on each row.

- **Source.** The `genius` function's roster sync reads `GET /competitions/{c}/teams/{t}/persons` (one call per team, about 15 per league-season) and fills `league_players` (one row per Genius person) and `league_player_teams` (who played for which team in which season). It runs for every league's current season in the weekly season audit, and on demand through the platform-admin action `{ action: "sync_rosters", competitionId? }`. That action is also the backfill: repeat it until `photosPending` is 0, because a run copies at most 150 photos (about 100 s at most). On staging, about 400 photos in one call hit the edge runtime's `WORKER_RESOURCE_LIMIT` (HTTP 546). The first full backfill (5 leagues, 1,358 players, 1,082 photos) took four calls of about 50 s each. SBF leaves height, weight and default numbers empty (0 or `""`), so those columns are mostly null today.
- **Storage.** Photos are copied into the media bucket at `players/genius/<personId>/<hash>-{T1,S1,M1,L1}.jpg` (75/200/400/600 px). `photo_key` holds the S1 key, and the other sizes swap the suffix. The hash is Genius's image hash, so a new photo gets a new key and a published report's links never change underneath it.
- **Access.** Signed-in users can read the names, number and `photo_key` columns. Birth date, height, weight and nationality are stored for later features and only the service role can read them.
- **Reports.** The desktop looks photos up by player id (the Genius personId, the same id the draft holds) with `use-player-photos`. Publishing writes `photoKey` into each `ReportPlayer` of the snapshot, so the public page needs no lookup. Reports published before this, and players without a photo, show the number.
- **Profixio.** Profixio players are not covered: their ids share Genius's numeric namespace, so a `source` on report players must come first.

## The Reports page (`apps/desktop/src/pages/reports.tsx`)

- A sidebar item after Playlists: every report the coach has in the active
  space, one row per playlist (`lib/scouting-report-list.ts`,
  `mergeReportList`). A playlist shows its report that is not switched off,
  else its latest stopped one, else its draft. Rows come from three reads
  (`listPlaylistNames` for the space, `listMyScoutingReports`,
  `listReportDrafts`, which reads only the draft's title and section count);
  reports and drafts of playlists outside the space, or deleted, are left out.
  Reports are owner-only, so a club space shows your own reports from the
  club's playlists, never a colleague's.
- Status: Shared (expires …, or never for a kept report), Expired, Stopped,
  Draft. All / Shared / Drafts filter it (Shared includes ended ones), the
  search matches title and playlist name, and the newest change (report or
  draft) comes first. Shared rows show `openedLabel`, drafts their players.
- A row opens the report page (`/reports/:playlistId`, Back to Reports). Its menu (⋯ and
  right-click) copies the link, opens it in the browser (`#app`, not
  counted), shows the clips, or stops sharing (confirmed). An expired or
  stopped report offers Share again, which opens the report page with `share: true`, so the
  share sheet opens once the report is read (`autoOpenShare`): an expired one keeps its
  link (the publish updates its row), a stopped one gets a new one.
- **New report** in the toolbar (once there is a report) and as the empty
  state's action: see "Starting from a team".
- Live reports are listed on the Reports page, and the share sheet's done step
  links to it ("See all reports").
- Analytics: `scouting_report_list_action` (action, status) for each row
  action, `scouting_report_revoked` with `via: "list"`; the page view is
  `page_viewed`.

## Publishing (`supabase/migrations/20261029100000_scouting_reports.sql`, `20261102100000_scouting_report_launch.sql`)

- `scouting_reports`: the snapshot (`content`, ≤256 KB) behind an unguessable id
  (the link), owner-only RLS, no client writes. A snapshot, not live: only a
  game's owner can read the plays a report is built from, and the page is
  anonymous. It stores storage **keys**, never URLs (`clips/…mp4`, posters
  `highlights/<user>/<uuid>.jpg`); the page prepends the media host
  (`NEXT_PUBLIC_R2_PUBLIC_URL`), the database checks the key shapes.
- **A clip block carries the coach's drawings and slow motion** (`drawings`,
  `slowMotion`, absent when none): in the clip file's time and inside the file,
  as the players get them (`clipWatchEffects`: the key's `_s` start and its pre
  + post totals bound it; a file whose key has no start, from before
  2026-09-14, gets neither), with short ids (`d1`, `s1`, `w1`) and points at
  three decimals so a 300-clip report stays within 256 KB. No migration: the
  database checks only keys, posters and the size. The page re-checks every
  shape (`parseDrawingShape`) and caps what it reads (20 drawings, 40 shapes,
  20 sections a clip). The content key takes them in a fixed form
  (`drawingShapeKey`, since jsonb hands objects back in its own key order) and
  is unchanged for a report without them, so only a report whose clips have
  effects reads "Changed since sharing" until Update link puts them in.
- `publish_scouting_report` (owner; `report_limit_reached`; `license_locked`;
  `invalid_content`) updates the playlist's live report in place, so
  **regenerating keeps the same link** and gives it a fresh 30 days.
  `revoke_scouting_report` wipes the content at once and queues the clip files
  for the purge. `get_scouting_report` is the one anonymous door.
- **One live report on a free plan, any number on a paid one.** Free and
  single-game users (a bought game doesn't change the plan) share one live
  report at a time; Rookie, Pro and Franchise share any number.
  `_scouting_report_blocker(uid, playlist)` finds the report in the way: the
  caller's live one (not stopped, not expired, still on a playlist) on another
  playlist billed to a free plan, newest first. A playlist's own live report
  doesn't count against it, so updating the only one always works. Two
  publishes at once can't both pass (a per-user advisory lock).
- **`report_limit_reached`** is what publish raises instead of `upgrade_required`
  (gone from publishing: free plans are no longer refused outright). Its
  `DETAIL` is the blocking report as JSON, `{id, playlist_id, title,
  expires_at}`, which `publishScoutingReport` turns into
  `ScoutingReportError.blockedBy`. The plan is read when publishing, not when
  the report was made, so the reports of a lapsed Pro count against the one
  allowed from then on (and the lapsed Pro can't update one of two live ones).
- **`scouting_report_share_limit(playlist)`** is the share sheet's check, ahead
  of the publish: `{limited, blocked_by}` (`limited` is true on a free plan;
  `blocked_by` is the same JSON, or null). Owner only. `open_count` on the
  report row is how often readers opened the link (see the page).
- Main has no media purge yet, so clip files stay where they are. Revoked and
  swept reports queue their keys in `media_deletions`; when the purge ships
  (feat/cloud-game-videos), a live report counts as a reference to its clip
  files (`_media_key_referenced`), so it never deletes a file a published
  report still plays.
- Deleting the playlist revokes its report. A cron sweep empties rows a week
  past their expiry or revocation (`20261104100000_scouting_report_history.sql`):
  the content and clip keys go, the clip files are queued for the purge, and
  the title, dates and `open_count` stay for the Reports list. A row whose
  playlist is gone is deleted then instead. Deleting the playlist deletes its
  draft (cascade).
- A **kept** report (Scoutable's own sample, the one scoutable.se opens from
  "See an example"; `20261103100000_scouting_report_keep.sql`) never expires:
  `SELECT _keep_scouting_report('<id>', true);` in the SQL editor sets
  `kept` and a trigger pins `expires_at` to infinity, so Update link, the
  page and the sweep leave it alone (and so do the open counter and the
  one-free-report check of `20261102100000`, which compare against `now()`);
  `false` releases it to a fresh 30 days. Stop sharing still takes it down
  at once (revoked, emptied a week later). Postgres hands clients the expiry
  as the string `"infinity"`; the shared client turns it into
  `expiresAt: null` (`PublishedReport`, `MyScoutingReport`), `isLiveReport`
  counts that as live, the share sheet says "It works until you stop
  sharing it" and the toolbar "Shared · never expires"
  (`sharedStatusLabel`). A desktop older than that (≤ 1.5.0) reads
  `"infinity"` as not live: its sheet opens as if the report were off and a
  re-share says "until infinity", while the link and the flag stay as they
  are.
- After stop or expiry the page, stats and notes are gone; the clip files are the
  public per-clip cuts the playlists share and stay reachable by URL (unguessable
  in practice, not secret). Per-report copies would make access really end, at
  the cost of re-uploading every clip on each publish.

## Generating on the desktop (`apps/desktop/src/lib/scouting-report.ts`)

Ship the clips in the report that have no hosted file yet (Clip & Ship,
idempotent; left-out clips aren't cut), cut a
640 px poster per clip from the local game video (`extract_clip_poster`) and
upload it as the coach's own `highlights/<user>/<uuid>.jpg` (best effort), then
publish. A clip the coach drew on gets the drawn frame as its poster: the first
drawing its uploaded file shows (`reportPosterDrawing`: the players' rule over
the file's own window, read from its key, never today's pre- and post-roll), at
the frame it was drawn on, with the drawing burned in on the export's 16:9
(`clip_poster_args`), so the page shows it before play and the PDF prints it. The others get the play's moment, and so
does a drawn clip whose drawn poster fails. Publishing is the only step that makes anything public; cancelling
before it publishes nothing. A staging build links to `http://localhost:3000`.

## Published sections

A report of sections publishes, still as `v: 1` (the publish function checks
only the version, the sections array, the clip keys and the posters):
`header.intro` (the summary), then a section per shown, non-empty block, of
kind `keys` (a `keys` block of items, then clips), `actions` (text, clips),
`player`, `profile` (a `profile` block: context, rows of label / own / place /
allowed / place, lines), `games` (a `games` block of rows: date, opponent,
home, result or null for a game to play) or `custom` (with its `title`, text,
clips). Section ids are `keys`, `actions`, `profile`, `games`, `p1…`, `x1…`.
Hidden sections and their clips are left out, and their clips aren't cut. The
content key hashes the summary and each new section's kind and title only
where they exist, so a report from before sections keeps its key; a
republished report of sections reads "Changed since sharing" once.
`parseScoutingReport` reads the new kinds and drops any it doesn't know;
`reportSectionTitle` names them for the page, the jump bar and the editor.

**Rollout order:** the web app (main, Vercel) before the desktop release, so a
new report never meets the old page. The old page would drop the new sections
and show the players and Team.

## The page (`apps/web/src/app/r/[token]/`)

One scrolling document: the header with the summary, then the coach's
sections (Keys as a numbered list, How they play as a table, Their games as a
list, the rest as before). Follows the system
theme on screen and prints light (A4, a player per page, posters for clips, a
QR per player). `X-Robots-Tag`, `Referrer-Policy: no-referrer` and no-store come
from `next.config.ts`; the link preview carries the title, opponent and counts,
never a player's name, stat or note.

- **Clips play in the playlists' player** (`report-player.tsx`): the watch
  view's `PlayerStage` in its one-clip form (`single`: play and pause, Replay,
  speed and full screen, no previous, next or stop), with the coach's drawings
  and slow motion (`useClipEffects`, `DrawingLayer`, markers and bands on the
  timeline). Until a tap a clip is its poster with a play button; the tap
  mounts the player (`flushSync`) and gives its video the source and `play()`
  inside the gesture, so phones play it with sound. One clip plays at a time
  across the page and the viewer's speed carries between clips (module state,
  not remembered). Full screen keeps the drawings: the stage itself where the
  browser allows it, a layer over the whole window on an iPhone. With the
  player focused: Space and K, F, R, ←/→ (2 s, ⇧ 10 s), Esc leaves full screen.
  The note stays in the caption under the clip, not on the video. The page is
  outside the signed-in app, so the player brings `AppProviders` (tooltips and
  motion) along. Before 2026-11-06 the page played the file in the browser's
  own controls (AirPlay, picture in picture and Download went with them).
- **The footer is on every report**, on screen and in the saved PDF, on every
  plan: "Made with scoutable." (`FooterMark`) links to `REPORT_FOOTER_URL`,
  `https://scoutable.se/?utm_source=scouting_report&utm_medium=report_footer`.
  `header.attribution` stays in the stored report and is always true now (the
  builder's default; older reports may carry another value), but the page
  ignores it, and the desktop doesn't set it. A click fires
  `scouting_report_footer_clicked`.
- **Opens are counted from the browser** (`ViewTracker`), after the page shows,
  not by the server render: link previews and crawlers fetch the page without
  running it. A live report's reader calls `record_scouting_report_open`
  (anonymous; adds one to `scouting_reports.open_count`; an expired, stopped or
  unknown id changes nothing; the owner's own opens while signed in aren't
  counted; `updated_at` is left alone). The owner reads the number through the
  table's read policy. Scoutable stores nothing about the reader: no cookies
  (PostHog runs in memory), no person profiles, and no IP in the report or in
  the analytics (the PostHog project discards IPs, `anonymize_ips`). The count
  is a request from the reader's browser to Supabase, though, and Supabase's API
  request logs keep that request's IP for their usual retention. Anyone with the
  link can raise the number; the only effect is a bigger number on the coach's
  sheet.
- **The app's own opens don't count.** The desktop opens the link with `#app`
  (and `#print` to print on arrival); `countsAsReaderOpen` skips both, for the
  count and for the event. `#app` is stripped from the address afterwards.
- **In PostHog**, a reader's open is `scouting_report_page_viewed` (`valid`, and
  `reason` for an unavailable page). Count readers with it, not with
  `page_viewed`: the web app's PageTracker still fires that for the app's own
  `#app` and `#print` opens. (Before the launch rules
  `scouting_report_page_viewed` never reached PostHog, because it fired before
  analytics had started; `trackEvent` now starts it itself, so nothing was
  recorded earlier.)

## On players' phones (`supabase/migrations/20261124100000_scouting_report_recipients.sql`)

A live report whose playlist is in a club goes to teams and people of that
club; the mobile app lists it, draws it and records reading; the coach sees who
read how much. FastScout's "Mobile Access" and "Mobile Usage" are the model.

**Database.** Two tables written only by the functions (RLS on, no policies,
no grants):
- `scouting_report_recipients`: a report's targets, a team or a person each
  (`team_id` xor `user_id`, unique per report), `sent_by`, `sent_at`.
- `scouting_report_reads`: per report and person, `opened_at`,
  `last_opened_at` and `watched_clip_keys`. Watched clips are kept by clip
  **key** (the file), not by the page's `c1, c2` ids, so Update link, which
  renumbers the ids, keeps what was watched; counts always intersect with the
  report's current `clip_keys`.

Who a report **reaches** (`_scouting_report_audience`): its direct people plus
the members of its teams, who are in the report's club now, without its
owner. Someone who leaves the team or the club stops seeing it; a stopped or
expired report reaches no one.

Functions (`authenticated` only, house style):
- `send_scouting_report(report, team_ids[], user_ids[])`: the owner's live
  report in a club with an unlocked licence; teams of that club, members of it.
  Sending again to a target changes nothing. Pushes only those the report
  reaches for the first time. Returns `{reached, notified}`. Errors:
  `not_owner`, `report_not_live`, `report_not_in_club`, `license_locked`,
  `team_not_in_report_org`, `recipient_not_in_org`, `no_recipients`,
  `too_many_recipients` (200 targets).
- `unsend_scouting_report(report, team | user)`, whatever the licence.
- `notify_scouting_report_update(report)`: one push to everyone reached
  ("Coach L updated the report"), offered after Update link.
- `get_scouting_report_delivery(report)` (owner): `{clips, targets, readers}`,
  readers being everyone reached with `openedAt` and `watched`.
- `get_my_scouting_report_reach()`: per sent live report, reached and opened
  (the Reports page's "Seen by 9 of 12").
- `get_my_scouting_reports()`: the caller's live reports with opponent,
  `game`, players, clips, sender, the team it came through, `opened_at` and
  `watched_keys`.
- `record_scouting_report_read(report, clip_key?)`: recipients only
  (`not_recipient` otherwise); the open, or one watched clip (a key the report
  doesn't hold is ignored).

The content itself is still read with `get_scouting_report(id)`. Push:
"Scouting report: Fryshuset" / "Coach L sent you the report for Sat 28 Nov"
(the day from `header.game`, Stockholm time), data
`{type: 'scouting_report', reportId}`.

**`header.game`** (`{at, home}`), from the draft's `game`, is new in the
published report: the app dates and orders reports by it. It is part of the
content key only when present, so older reports keep theirs; the web page
ignores it.

**Shared logic** (`packages/shared/lib/scouting-report-inbox.ts`, tested):
Upcoming (game not three hours past tip-off, or no game and sent this week)
and Earlier; `featuredReport` (the next game's, else the newest unread) for the
card on top of My playlists; progress by clip key; a section's clips as queue
items; Seen by's wording and order. Wrappers in `scouting-report-inbox-db.ts`.

**The app** (`apps/mobile`):
- `lib/reports-store.tsx` holds the list beside the playlists store (refreshed
  on foreground and on a push) and each opened report's page; the open and each
  watched clip show at once and are sent in the background.
- The sidebar's **Scouting reports** (players always; staff once one has
  reached them) with the unread count, which the app badge adds to the new
  playlists. `(tabs)/reports` lists Upcoming and Earlier with the playlists'
  status ring.
- **My playlists** shows `featuredReport` as a card above the feed while no
  search or filter is on.
- **The reader** (`reports/[id]`): the team as a large title, sender, game and
  clips watched, the intro, a sticky chip row once there are three sections
  (`reportJumpItems`), then each section: a player's photo, number and name,
  their numbers as tiles in a fixed grid (four across, three at large text),
  the note, the blocks (keys numbered and large, How they play as rows, games
  as a list), and the clips as a rail of posters with Play all. Its foot says
  the coach sees what was opened and watched. No links out (App Store
  3.1.3(c)).
- **The clips** (`reports/[id]/play`): the watch screen's layout and player
  (`useClipQueue`, now generic over `QueueItem`: drawings, slow motion, speed
  and the 90% watched rule as in playlists) over one section's clips, starting
  at the clip tapped or the first not watched. No scrubbing, as for players on
  playlists.
- A push with `reportId` opens the reader (`NotificationsBridge`); so does
  `scoutable://reports/<id>`.

**The desktop**: the share sheet's link view gets **Players' phones**
(`components/report/report-delivery.tsx`). Before a send: one line and Send to
players, which opens the playlists' picker (`ShareRecipients`: the club's
teams, then its members, players first). After: the targets as removable
chips, + Add, Seen by (furthest first: "7 of 16", "Opened", "Not yet") and,
after Update link in the same sheet, Notify players. A personal space says
reports go to phones from a club space. Events: `scouting_report_sent`,
`scouting_report_update_notified`; the app's `scouting_report_read`.

Not built: email for players without the app, offline download, an "I've
read it" button, reports in the web app's player view, staff other than the
owner sending.

## Taking a report down

When a named player asks for their report to go (an email to
hello@scoutable.se), find the report's id (the last part of its link,
`/r/<id>`) and run in the prod SQL editor:

```sql
SELECT _take_down_scouting_report('<id>');
```

It returns `taken_down`, `already_off` (it was stopped before: nothing left to
do) or `not_found` (a wrong id). Service role only; the owner can't call it.

It follows the revoke path exactly (`revoke_scouting_report` without the owner
check). The page, notes and stats go at once: the content is wiped, and the page
says the report is no longer shared. The clip files are another matter. They
stay at their unguessable public R2 keys until the media purge ships (it lives
on feat/cloud-game-videos): the keys are queued in `media_deletions`, but
nothing drains the queue yet. The posters (`highlights/<user>/<uuid>.jpg`) are
never queued at all, because `_queue_media_deletion` only accepts `clips/` keys,
so they stay too. The clip URLs are only ever shown by pages and playlists that
play them and are unguessable in practice, but anyone who opened the report may
still have one, and the files are not deleted.

The coach can share the playlist again; that makes a new report with a new link
(a stopped report is never revived). A coach who puts the same player back is a
repeat case, handled by hand.

## Before the draft: player cards (retired 2026-10-26)

Until desktop v1.3.0 a report was built by shaping the playlist: player cards
were `playlist_clips` rows (`item_type 'player'`) and the clips below a card
were its player's. `20261101100000_scouting_report_drafts.sql` turned every
playlist's cards into a draft (sections in card order, the clips after each
card placed under it) and deleted the rows; the `playlist_clips` check now
refuses the type, so an old build fails loudly instead of writing rows nothing
reads. A row of an unknown `item_type` is dropped by every build
(`rowToPlaylist`'s clip branch needs a `match_id`). `move_to_club` re-points
the draft's game stats and placement keys when a game is merged into the club.

## Checking it

- `packages/shared`: `npm test` (`report-draft`, `scouting-report`,
  `report-leaders`, `report-drafts-db`, `player-roster`, `stats-card-data`,
  `scouting-report-list`).
- SQL: `SUPABASE_DB_URL=<staging session pooler> supabase/tests/scouting_report_drafts.sh`
  and `scouting_reports.sh` (rolled-back probes; `RLS_PREFLIGHT=<the migration>`
  applies it inside the transaction before it is pushed). `scouting_reports.sh`
  covers the launch rules: the one free report (a second is refused and names
  the first; a lapsed Pro's reports count; a paid plan isn't limited, a
  single-game buyer still is), the share sheet's check
  (`scouting_report_share_limit`, owner only, not for anon), the reader counts
  (`record_scouting_report_open`: live reports only, not the owner's own, an
  update keeps the count and an open leaves `updated_at` alone) and the
  takedown (service role only; content wiped, clip files queued, a second call
  says `already_off`, an unknown id `not_found`), and the sweep (an ended row
  is emptied a week later and kept, a playlist-less one deleted, an emptied
  expired report shared again keeps its link).
- Desktop and web against staging as in CLAUDE.md, with a Franchise test club
  for the paid path and a Free space for the gate: share one report, open its
  link in a browser and see the sheet say "Opened once"; try to share a second
  from the Free space and get the limit view; stop the first from there.
