# Scouting reports

A coach scouts an opponent next to a playlist: the **report** is a document of
its own (a title and opponent, a team intro, one section per player with their
stats, a note and their clips) built from the playlist's clips. **Share** turns
it into one public, unlisted web page (clips play inline) that staff and
players open from a link, and that "Save as PDF" prints.

## The draft (`packages/shared/lib/report-draft.ts`)

- **One draft per playlist**, `scouting_report_drafts.content` (migration
  `20261101100000_scouting_report_drafts.sql`, owner-only RLS, client-written,
  ≤ 256 KB, ≤ 60 sections): `{v:1, title, opponent, intro, sections:[{id,
  player, note, stats}], placements}`. `stats` is a stats card spec, a snapshot
  like any stats card. `title` and `opponent` are null until the coach types
  them: the playlist's name and the team most sections are about stand in.
- **Clip membership is derived, never stored as a list** (`deriveReportLayout`):
  a clip goes to its placement when the coach moved it by hand (`placements`,
  by clip item key), else to the section whose player is in the play
  (`event.player.playerId`), else to the Team section. So a clip added to the
  playlist later shows up under its player at once, a removed section's clips
  fall back to the team, and **the playlist's order is never changed by the
  report**. `prunePlacements` drops placements for clips that left the
  playlist before every save.
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
  order. The content key, the stored report (v1) and the page are unchanged.

## The desktop (`apps/desktop/src/components/report/`)

- **Entry**: a "Clips | Report" switch at the leading edge of both toolbars
  (`playlist-view-switch.tsx`; a dot while a report is shared). Not in the
  Export menu: the report is the playlist's other view, not an export of it,
  and a centred switch would collide with the clips toolbar's actions. The
  playlists page renders `ReportView` in place of the toolbar and panels
  (`reportFor`); the browser column stays and switching playlist leaves the view. The editor's
  key scope yields to the view's (`useKeyScope("editor", !reportView)`).
- **`use-report-draft.ts`**: reads the draft once per playlist (kept in a
  cache, so coming back is instant), applies ops optimistically, saves 600 ms
  after the last edit (`prunePlacements` first), flushes on unmount or a
  playlist change. A draft that was never edited is never written. Section
  removal has an Undo in its toast.
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
  the clip to another player or the team, or opens it in the playlist. The
  outline (`report-outline.tsx`) scrolls, reorders (drag with `useListDrag`,
  ⌥↑/⌥↓, the row's menu) and removes.
- **Share** keeps `scouting-report-dialog.tsx` minus the title and opponent
  inputs (they are in the document): a summary line, Generate, then the link,
  QR, PDF, Update and Stop sharing. `generateScoutingReport`
  (`apps/desktop/src/lib/scouting-report.ts`) takes the draft. "Changed since
  sharing" compares the live report's content key with the document's.

## Publishing (`supabase/migrations/20261029100000_scouting_reports.sql`)

- `scouting_reports`: the snapshot (`content`, ≤256 KB) behind an unguessable id
  (the link), owner-only RLS, no client writes. A snapshot, not live: only a
  game's owner can read the plays a report is built from, and the page is
  anonymous. It stores storage **keys**, never URLs (`clips/…mp4`, posters
  `highlights/<user>/<uuid>.jpg`); the page prepends the media host
  (`NEXT_PUBLIC_R2_PUBLIC_URL`), the database checks the key shapes.
- `publish_scouting_report` (owner; `upgrade_required` on a free plan;
  `license_locked`; `invalid_content`) updates the playlist's live report in
  place, so **regenerating keeps the same link** and gives it a fresh 30 days.
  `revoke_scouting_report` wipes the content at once and queues the clip files
  for the purge. `get_scouting_report` is the one anonymous door.
- Main has no media purge yet, so clip files stay where they are. Revoked and
  swept reports queue their keys in `media_deletions`; when the purge ships
  (feat/cloud-game-videos), a live report counts as a reference to its clip
  files (`_media_key_referenced`), so it never deletes a file a published
  report still plays.
- Deleting the playlist revokes its report; a cron sweep deletes rows a week
  past their expiry or revocation. Deleting the playlist deletes its draft
  (cascade).
- After stop or expiry the page, stats and notes are gone; the clip files are the
  public per-clip cuts the playlists share and stay reachable by URL (unguessable
  in practice, not secret). Per-report copies would make access really end, at
  the cost of re-uploading every clip on each publish.

## Generating on the desktop (`apps/desktop/src/lib/scouting-report.ts`)

Ship the clips that have no hosted file yet (Clip & Ship, idempotent), cut a
640 px poster per clip from the local game video (`extract_clip_poster`) and
upload it as the coach's own `highlights/<user>/<uuid>.jpg` (best effort), then
publish. Publishing is the only step that makes anything public; cancelling
before it publishes nothing. A staging build links to `http://localhost:3000`.

## The page (`apps/web/src/app/r/[token]/`)

One scrolling document: header, then a section per player. Follows the system
theme on screen and prints light (A4, a player per page, posters for clips, a
QR per player). `X-Robots-Tag`, `Referrer-Policy: no-referrer` and no-store come
from `next.config.ts`; the link preview carries the title, opponent and counts,
never a player's name, stat or note. The footer mark follows the video
watermark rule (always on Rookie, the Settings choice on Pro and Franchise),
decided when publishing.

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
  `report-leaders`, `report-drafts-db`, `player-roster`, `stats-card-data`).
- SQL: `SUPABASE_DB_URL=<staging session pooler> supabase/tests/scouting_report_drafts.sh`
  and `scouting_reports.sh` (rolled-back probes; `RLS_PREFLIGHT=<the migration>`
  applies it inside the transaction before it is pushed).
- Desktop and web against staging as in CLAUDE.md, with a Franchise test club
  for the paid path and a Free space for the gate.
