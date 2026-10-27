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
  team, leaves it out, or opens it in the playlist.
- **The side panel** (`report-outline.tsx`, a tree): Team (always, with 0),
  each player and "Not in report" (folded at first), each with its clips as
  one-line rows (the play's colour, the play, the time, a note mark; the hover
  has the rest). Dragging a clip, or the ⌘/⇧-selection it is in, reorders it,
  moves it to another section or out; dragging a player's header moves the
  player with their clips. Where a drop lands is `lib/report-outline.ts`
  (`clipDrop`, `sectionGap`, `sectionDropIndex`) over the drag engine's flat
  rows; a drop on a folded section appends. Keys: ↑/↓, ⇧↑/⇧↓, ←/→ fold,
  ⌥↑/⌥↓ moves (`nudgeClips` crosses into the next section), ⌫ leaves clips
  out or removes a player, Return shows the clip or section in the document,
  ⌘A, Esc clears the selection before it leaves the view.
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
  - The desktop no longer sends `header.attribution`; the page doesn't read it
    (see the page, below). Nothing in the report view is labelled Beta.

## Publishing (`supabase/migrations/20261029100000_scouting_reports.sql`, `20261102100000_scouting_report_launch.sql`)

- `scouting_reports`: the snapshot (`content`, ≤256 KB) behind an unguessable id
  (the link), owner-only RLS, no client writes. A snapshot, not live: only a
  game's owner can read the plays a report is built from, and the page is
  anonymous. It stores storage **keys**, never URLs (`clips/…mp4`, posters
  `highlights/<user>/<uuid>.jpg`); the page prepends the media host
  (`NEXT_PUBLIC_R2_PUBLIC_URL`), the database checks the key shapes.
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
- Deleting the playlist revokes its report; a cron sweep deletes rows a week
  past their expiry or revocation. Deleting the playlist deletes its draft
  (cascade).
- After stop or expiry the page, stats and notes are gone; the clip files are the
  public per-clip cuts the playlists share and stay reachable by URL (unguessable
  in practice, not secret). Per-report copies would make access really end, at
  the cost of re-uploading every clip on each publish.

## Generating on the desktop (`apps/desktop/src/lib/scouting-report.ts`)

Ship the clips in the report that have no hosted file yet (Clip & Ship,
idempotent; left-out clips aren't cut), cut a
640 px poster per clip from the local game video (`extract_clip_poster`) and
upload it as the coach's own `highlights/<user>/<uuid>.jpg` (best effort), then
publish. Publishing is the only step that makes anything public; cancelling
before it publishes nothing. A staging build links to `http://localhost:3000`.

## The page (`apps/web/src/app/r/[token]/`)

One scrolling document: header, then a section per player. Follows the system
theme on screen and prints light (A4, a player per page, posters for clips, a
QR per player). `X-Robots-Tag`, `Referrer-Policy: no-referrer` and no-store come
from `next.config.ts`; the link preview carries the title, opponent and counts,
never a player's name, stat or note.

- **The footer is on every report**, on screen and in the saved PDF, on every
  plan: "Made with scoutable." (`FooterMark`) links to `REPORT_FOOTER_URL`,
  `https://scoutable.se/?utm_source=scouting_report&utm_medium=report_footer`.
  `header.attribution` stays in the stored report (older ones carry it) but the
  page ignores it, and the desktop doesn't set it. A click fires
  `scouting_report_footer_clicked`.
- **Opens are counted from the browser** (`ViewTracker`), after the page shows,
  not by the server render: link previews and crawlers fetch the page without
  running it. A live report's reader calls `record_scouting_report_open`
  (anonymous; adds one to `scouting_reports.open_count`; an expired, stopped or
  unknown id changes nothing; `updated_at` is left alone). The owner reads the
  number through the table's read policy. Nothing about the reader is kept: no
  cookies (PostHog runs in memory), no person profiles, no IP (the PostHog
  project discards IPs, `anonymize_ips`). Anyone with the link can raise the
  number; the only effect is a bigger number on the coach's sheet.
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
  `report-leaders`, `report-drafts-db`, `player-roster`, `stats-card-data`).
- SQL: `SUPABASE_DB_URL=<staging session pooler> supabase/tests/scouting_report_drafts.sh`
  and `scouting_reports.sh` (rolled-back probes; `RLS_PREFLIGHT=<the migration>`
  applies it inside the transaction before it is pushed). `scouting_reports.sh`
  covers the launch rules: the one free report (a second is refused and names
  the first; a lapsed Pro's reports count; a paid plan isn't limited), the share
  sheet's check (`scouting_report_share_limit`, owner only, not for anon), the
  reader counts (`record_scouting_report_open`: live reports only, an update
  keeps the count) and the takedown (service role only; content wiped, clip
  files queued, a second call says `already_off`, an unknown id `not_found`).
- Desktop and web against staging as in CLAUDE.md, with a Franchise test club
  for the paid path and a Free space for the gate: share one report, open its
  link in a browser and see the sheet say "Opened once"; try to share a second
  from the Free space and get the limit view; stop the first from there.
