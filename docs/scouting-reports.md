# Scouting reports

A coach scouts an opponent in a playlist: **player cards** (one per player: the
player, a note, their stats) with the clips that show each player below them.
**Generate** turns the playlist into one public, unlisted web page (clips play
inline) that staff and players open from a link, and that "Save as PDF" prints.

## How a playlist becomes a report

- **Player card** = `playlist_clips.item_type = 'player'`, its spec in `card`
  (`packages/shared/lib/player-card.ts`: `{type:'player', v:1, player, note,
  stats}`; `stats` is a stats card spec, a snapshot like any stats card). Not a
  text item: a build that doesn't know player cards draws a text item's
  fallback line as a card in every shared playlist, and mobile builds can't be
  fixed over the air. A row of an unknown `item_type` is dropped by those
  builds (the clip branch of `rowToPlaylist` needs a `match_id`), so they see
  nothing. In the apps the item is a `PlaylistTextCard` with `player` set
  (`isPlayerCard`), so the editors' card rows, selection and undo carry it.
- **Sections**: a player card opens a section; the clips below it, up to the
  next player card, are that player's. Clips and cards before the first player
  card are the "Team" section. A text card is a paragraph where it sits, a
  stats card a stats row. `buildScoutingReport` (`lib/scouting-report.ts`) walks
  a playlist into `{header, sections[]}`; the desktop's preview and the page
  come from the same walk.
- **Never played, never in the video, never shown to a recipient**:
  `buildWatchItems`, `exportContentKey`, the desktop's `startQueue` and
  `buildExportSegments` skip them; the server export only turns `'text'` rows
  into cards; `rowToPlaylist` returns player rows only to the playlist's owner
  (`includePlayerCards`), so a shared playlist never carries one. No card painter
  draws them, so the three-painter rule for stats cards doesn't cover them.
  The web editor shows one as a read-only row ("edit on the desktop app") so a
  reorder there keeps the sections together.

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
  past their expiry or revocation.
- After stop or expiry the page, stats and notes are gone; the clip files are the
  public per-clip cuts the playlists share and stay reachable by URL (unguessable
  in practice, not secret). Per-report copies would make access really end, at
  the cost of re-uploading every clip on each publish.

## The desktop flow (`apps/desktop/src/lib/scouting-report.ts`)

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

## Checking it

- `packages/shared`: `npm test` (`player-card`, `scouting-report`,
  `scouting-reports-db`, and the skips in `watch-queue` and `playlists-db`).
- SQL: `SUPABASE_DB_URL=<staging session pooler> supabase/tests/scouting_reports.sh`
  (rolled-back probes).
- Desktop and web against staging as in CLAUDE.md, with a Franchise test club
  for the paid path and a Free space for the gate.
