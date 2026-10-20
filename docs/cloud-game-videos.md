# Cloud game videos

A game's video lives in the cloud, so the web can do what the desktop does:
a coach imports a game and uploads its video from the browser (or the desktop
uploads its copy), clips it into playlists in the web editor, and shares
them. The server cuts the clip files players watch and renders the exports,
16:9 and 9:16, as a download or a link to send to a phone.

## Status (2026-10-19)

Built on `feat/cloud-game-videos`, which also carries the Apple redesign
(`design/apple-redesign-profixio`) and Profixio (`feat/profixio-import`).
Every milestone was checked on staging: the SQL probes, the smoke script on
the deployed staging Worker, and a signed-in browser pass. **Nothing is in
prod yet**: see the rollout below.

| Milestone | What it adds | Runs in |
| --- | --- | --- |
| M1 | The desktop encodes a game's 720p copy and uploads it to the private bucket | desktop (needs a release) |
| M2 | The web imports a game and uploads its original; the converter makes the copy and detects the tip-off; the game page checks the sync | web, function, Worker |
| M3a | Home, Playlists and Library on the web; the playlist editor; the server cuts the clip files players watch (`ship`) | web, function, Worker |
| M3b | The server export (16:9 and 9:16): Download and Send to my phone (`/h/<id>` and a QR code) | web, function, Worker |
| M3c | Folders, stats cards, labels, groups, Add to another playlist, the stats-card suggestion, per-quarter sync and Fix sync, the tip-off following a replaced video, deleting replaced clip files | web, function |

## How it fits together

### Copies, conversion and sync

A game's 720p copy in the PRIVATE R2 bucket
(`R2_VIDEOS_*` secrets), rows in `game_videos` (written by the `game-video`
function only; the uploader reads their own), keys
`<project ref>/games/<matchId>/<videoId>.mp4` for copies and
`<project ref>/sources/<matchId>/<videoId>.<ext>` for browser-uploaded
originals, so staging and prod share the bucket and a project never touches
another's objects (`guardKey`). The desktop encodes (libx264 veryfast,
`src-tauri/src/game_video.rs`) and uploads 32 MiB parts to presigned URLs.
The web imports a game and uploads the ORIGINAL the same way (`origin:
"browser"`); `complete` then moves the row to `converting` and the function
starts the converter: a Cloudflare Worker + container in
`workers/game-video-convert` (EU-pinned, `standard-4`, deployed by
`convert-deploy.yml`) that runs `src/convert.ts` (download → probe →
fingerprint → hints → ffmpeg with the desktop's exact arguments, shared in
`packages/shared/lib/game-video-convert.ts` → upload → tip-off detection as
the bot) and reports through the `job_*` actions behind
`GAME_VIDEO_WORKER_SECRET`, every write fenced by the attempt number. A
confident tip-off is applied to an unsynced game (`_game_video_finish_convert`),
the web confirms or sets it through `sync_set` (`_game_video_set_sync`: a
`confirmed` never overrides a coach's own sync, `sync_locked`; a `manual` set
by the video's uploader always applies, so the tip-off can follow a replaced
video; a copy without an anchor of its own, the desktop's, keeps the game's
reference and moves only its video time; migration `20261022100000`) and
writes per-quarter syncs through `sync_periods_set { videoId, syncPoint }`
(`_game_video_set_periods`: `periods` "2"…"8" replaced whole, `marks` and
`breaksCut` when given, the tip-off with sync_set's manual rule when
`syncVideoTime` is given; shape checked by `parseSyncPeriodsPayload` and
again in SQL; `no_sync` for an unsynced game), a ten-minute pg_cron sweep re-runs dead
conversions, and `game_video_ready` mails the uploader. The web plays the
copy through a 12 h presigned GET (`/library/<matchId>`), where the uploader
also adjusts the sync (Adjust sync: the tip-off and each quarter's own,
`components/game/game-sync-panel.tsx`; banners when the play-by-play runs
past the video's end or the sync predates the video); the editor's Fix sync
is `components/sync/fix-sync-sheet.tsx`. Caps per tier in
`app_config.game_video_limits` (enforced by the insert trigger; conversions
in flight count), kill switch `app_config.cloud_video_enabled`, deletions
queued in `game_video_deletions` and purged nightly by pg_cron through the
function's `purge` action (`GAME_VIDEO_PURGE_SECRET` =
`app_config.game_video_purge_secret`; `GAME_VIDEO_WORKER_SECRET` =
`app_config.game_video_worker_secret`; `GAME_VIDEO_CONVERT_URL/SECRET` point
at the Worker). Wire contract and pure helpers in
`packages/shared/lib/game-video-wire.ts`; end-to-end checks
`node --env-file=apps/web/.env.staging scripts/game-video-smoke.mjs`
(desktop path), `--browser` (the script plays the converter) and
`--browser --local-convert [--file game.mp4]` (the real converter program on
this machine), all with `SUPABASE_SERVICE_ROLE_KEY` in the environment.
Deploy the function by name only. The browser upload needs the bucket's
CORS rule (PUT from the app's origin, `ExposeHeaders: ETag`).

### Server-cut clips (render jobs)

A web playlist's clips are rows without
files until the owner calls `ship { playlistId }` on `game-video` (the web
does so when the playlist is shared, and again after clips are added or
trimmed, the rolls change, or the game's sync changes). Each run is a
`render_jobs` row (kind `ship`; `export` below; migrations
`20261020100000`, `20261021100000`) with the conversions' bookkeeping:
attempt, heartbeat, progress, `requeue`, `result = {shipped, failed,
superseded, total, failures}`; one live job per (playlist, kind, aspect,
purpose), the owner reads their own rows (RLS), only the function writes.
The plan (window from `lib/clip-ship-plan.ts`'s
`computeVideoTime`/`clipBounds`, key from `clipShipKey`, a copy usable when
a ready `game_videos` row exists and the owner owns the match or is
admin/coach of its org) is previewed at `ship`,
recomputed at `render_take` and checked again at `render_done`, so a clip
changed meanwhile is `superseded` and cut again by the follow-up job. The
function asks the same Worker for `POST /render {jobId}`; the container runs
`src/render.ts` (an entrypoint override of the converter image), which cuts
each clip straight from the copy's presigned GET with the desktop's
`shipClipArgs` and PUTs it to a presigned URL of the PUBLIC media bucket
under the desktop's key, reporting through `render_take / render_progress /
render_done / render_failed` (`x-worker-secret`, fenced by attempt). Caps:
one running render per user and `MAX_ACTIVE_RENDERS` = 4 globally, beside
15 conversions (the Worker allows 20). The media bucket's credentials are
presign-upload's `R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID /
R2_SECRET_ACCESS_KEY / R2_PUBLIC_URL` (function secrets are project-wide, so
`game-video` reads the same names); without them `ship` and `render_take`
answer `renderer_unavailable`. An unreachable Worker never fails a `ship`:
the job waits (heartbeat NULL) for the ten-minute sweep, which also re-runs
quiet renders and fails a job nobody took within a day. `render_done` writes
`playlist_clips.r2_url` and calls `_notify_pending_shares_for_playlist`
(the owner-gated RPC's body, REVOKEd from clients); `sync_set` and
`sync_periods_set` move the uploader's pans with their plays, clear legacy
keys and re-ship stale clips of shared playlists (`_playlist_is_shared`).
Superseded clip files: whenever a playlist clip's `r2_url` changes or is
cleared (render_done, a trim, a sync change, the desktop), a trigger queues
the old key in `media_deletions`; the nightly `media_purge` (purge secret,
`run_game_video_purge`) deletes a key only when no `playlist_clips.r2_url`
and no live ship job references it (two playlists can share a file), else
drops it from the queue. Staging shares the media bucket and holds copies of
prod's rows, so the function deletes only in `MEDIA_PURGE_SCOPE` (`all` on
prod at rollout; unset = the smoke's `clips/smoke-` games only). Probes:
`supabase/tests/sync_media.sh`.
Probes: `supabase/tests/render_jobs.sh`. Smoke: the browser smoke plus
`--ship` (the script plays the renderer) or `--ship --local-render` (the
real program here, needs `--local-convert --file <video of ≥ 17 s>`).
The job plumbing both kinds share is `functions/game-video/jobs.ts`.

### Exports (render jobs of kind `export`, `functions/game-video/export.ts`)

The owner's `export { playlistId, aspect: "16:9" | "9:16", purpose:
"download" | "share", watermark?, selection?, contentKey?, fresh? }` makes one
MP4 of the playlist (or of the selected item keys, in playlist order). The
plan is `lib/export-plan.ts` over the rows (windows as the ship plan's; a
game without a copy the owner may use → `noCopy`; a play without a time or
starting in its copy's last 0.25 s → `dropped`; a window past the copy's end
is cut there; 9:16 pans rebased as crop-path does; the rate from the first
clip's copy), previewed at `export` and recomputed at `render_take`; the
same Worker route and `src/render.ts` render it (`src/export.ts`). Gates:
`upgrade_required` on a free plan (`_export_tier_for_playlist`: the
playlist's club, else the owner's personal space), `demo_game`,
`nothing_to_export` (no clip left; cards alone don't export). The wordmark
is always on for shares and Rookie; Pro/Franchise downloads may send
`watermark: false`. A download goes to the PRIVATE bucket at
`<prefix>/exports/<userId>/<jobId>.mp4` (`params.keys.video`, then
`result.key`) and is saved through `export_link { jobId }` (a 24 h presigned
GET with `Content-Disposition: attachment; filename="<exportFileName>"`;
`export_expired` once gone); after 7 days the retention deletes the row and
a BEFORE DELETE trigger queues the key in `game_video_deletions` for the
purge, as it does when a playlist or account deletion cascades into it. A
share PUTs `highlights/<uid>/<shareId>.mp4|jpg` to the PUBLIC media bucket
(so, like `ship`, it needs the `R2_*` secrets, else `renderer_unavailable`),
and `render_done` inserts the `highlight_shares` row (30 days; the client's
`contentKey` kept only when the plan's fingerprint at `render_take` equals
the one at `export`); an unexpired link of the same playlist, aspect and
content key comes back as `reused` instead (never for a selection or
`fresh`); share rows go after 30 days. One live export per (playlist,
aspect, purpose); progress carries `phase` (`clips`, `stitch`, `upload`);
`render_cancel { jobId }` fails a live job of either kind `cancelled` and
the renderer's next call gets 409 `cancelled`; a missing or tiny file at
`render_done` fails the job `output_missing`. Smoke: `--ship --export` (the
script plays the renderer) or `--ship --export --local-render` (the real
program); a `--file` of 47–61 s exercises both the cut at a copy's end and
`past_end`. `--browser --cloud --file <video> --ship --export` runs the
whole chain on the DEPLOYED Worker (conversion, cuts, per-quarter re-cuts and
the media purge, exports, cancel) and only waits and checks the files; the
cleanup clears its clips so the media purge removes their files; a job stuck queued means the function
can't reach the Worker or the secrets don't pair up (`GAME_VIDEO_CONVERT_SECRET`
= the Worker's `CONVERT_SECRET`, the Worker's `WORKER_SECRET` =
`app_config.game_video_worker_secret`).

## Where the code lives

- **Database**: `supabase/migrations/20261019100000_game_videos.sql`
  (copies, the deletion queue, the nightly purge),
  `20261019200000_game_video_conversions.sql` (conversions, the sweep),
  `20261020100000_render_jobs.sql`, `20261021100000_export_jobs.sql`,
  `20261022100000_sync_and_media_cleanup.sql` (the uploader's tip-off,
  per-quarter syncs, `media_deletions`). Every internal helper is SECURITY
  DEFINER and REVOKEd from clients.
- **Function** `supabase/functions/game-video/`: `index.ts` (routing, uploads,
  playback, sync, housekeeping), `render.ts` (`ship` and the renderer's
  calls), `export.ts`, `jobs.ts` (what both job kinds share), `media.ts` (the
  media purge), `common.ts` (secrets, the two S3 clients, key guards).
  `send-email` sends `game_video_ready`.
- **Converter and renderer** `workers/game-video-convert/`: `src/worker.ts`
  (the Worker and the Durable Object that starts a container per job),
  `src/convert.ts`, `src/render.ts` (dispatches `src/ship.ts` or
  `src/export.ts`), `src/runtime.ts`, `src/function-client.ts`, `README.md`.
  Deployed by `.github/workflows/convert-deploy.yml`.
- **Shared** `packages/shared/lib/`: `game-video-wire.ts` (the contract every
  side imports), `game-video-client.ts`, `game-video-convert.ts` (the
  desktop's ffmpeg arguments), `clip-ship-plan.ts`, `export-plan.ts`,
  `export-args.ts` (the desktop's export arguments, golden-tested against
  `apps/desktop/src-tauri/src/lib.rs`), `export-content-key.ts`,
  `render-jobs-db.ts`, `game-videos-db.ts`, `game-library.ts`,
  `playlist-edits.ts` (the editor's optimistic edits), `clip-filters.ts`,
  `folder-tree.ts`, `period-sync.ts`, `stats-card-data.ts`,
  `stats-card-defaults.ts`, `watch-queue.ts`, `app-nav.ts`.
- **Server video tooling** `packages/node-video/`: ffmpeg helpers and the
  card painter for exports (`lib/card-paint.ts`, fonts and the wordmark in
  `assets/`, twins of the desktop's files).
- **Desktop**: `src-tauri/src/game_video.rs` (the encode), `src/lib/game-video.ts`,
  `src/components/cloud-copy-row.tsx`, `src/components/upload-zone.tsx`.
- **Web** `apps/web/src/`: `app/(app)/library/**` (import, the game page and its
  sync), `app/(app)/playlists/**`, `app/(app)/home/`, `app/h/[shareId]/`,
  `app/api/hosted-stats/`; `components/editor/**` (the editor, its player,
  drag, trims, add clips, ship and export), `components/folders/**`,
  `components/labels/**`, `components/stats-card/**`, `components/sync/**`,
  `components/game/**`, `components/playlist/**` (sharing, the players' watch
  view); `lib/game-videos.ts`, `lib/game-upload.ts`, `lib/card-painter.ts`,
  `lib/stats-card-data.ts`.

## Checking it

- **Unit**: `npm test` and `npm run typecheck` in `packages/shared`,
  `workers/game-video-convert` and `packages/node-video`; `npx tsc --noEmit`
  in `apps/web` and `apps/desktop`; `npm run lint` in `apps/web`.
- **SQL probes**: `supabase/tests/game_videos.sh`, `render_jobs.sh`,
  `sync_media.sh`, `table_grants.sh` (the four tables' Data API grants). They run against the CLI's linked project unless
  `SUPABASE_DB_URL` is set, so point them at staging explicitly:
  `SUPABASE_DB_URL=<staging session pooler URL> PSQL_BIN=$(which psql)
  supabase/tests/sync_media.sh`. `RLS_PREFLIGHT=<migration file>` runs them
  with an unapplied migration inside a rolled-back transaction.
- **Smoke** (`scripts/game-video-smoke.mjs`, run with
  `node --env-file=apps/web/.env.staging` and `SUPABASE_SERVICE_ROLE_KEY` in the
  environment): the desktop path by default; `--browser` (the script plays
  the converter); `--browser --local-convert --file <video>` (the real
  converter on this machine); `--ship` and `--export`, with
  `--local-render` for the real renderer; `--browser --cloud --file <video>
  --ship --export` for the whole chain on the deployed staging Worker (71
  steps on 2026-10-19).
- **Browser pass** (staging, 2026-10-19): folders (open, back, a playlist made
  in a folder, drag with Undo, Move to), the editor (add clips, a group that
  holds after a reload, labels, Add to a new playlist, a stats card from game
  line to season averages, Fix sync's Just this clip), sharing (five clips cut
  in 48 s) and the player's view (clips from the cut files, the stats card
  drawn), Adjust sync on the game page, and `/api/hosted-stats` (200, 502, 400,
  401). Not checked in a browser yet: Fix sync's quarter and whole-game moves
  (the smoke covers the server side), the stats-card suggestion, offline
  rollbacks, reduced motion.

## Prod rollout

In this order, each with a dry run or a check first. Secret names are in
`docs/maintenance.md`; values never go in the repo.

1. **Cloudflare**: the prod Worker's secrets `CONVERT_SECRET`,
   `WORKER_SECRET`, `BOT_EMAIL`, `BOT_PASSWORD` (`npx wrangler secret put
   <NAME>` in `workers/game-video-convert`, no `--env`), then deploy it with
   `convert-deploy.yml` (Run workflow, environment `prod`). Do this before
   anything reaches `main`: a push to `main` that touches
   `workers/game-video-convert/**`, `packages/shared/**` or
   `packages/node-video/**` deploys the prod Worker on its own.
2. **R2** (the private bucket is shared with staging and was set up on
   2026-10-18, so check rather than add): its CORS rule allows `PUT` from
   `https://app.scoutable.se` with `ExposeHeaders: ETag`, and a lifecycle rule
   deletes `nbmrujmazvdoaldirpyx/sources/` after 14 days. Optional: rules for
   `nbmrujmazvdoaldirpyx/exports/` and the media bucket's `highlights/`.
3. **Function secrets** on prod: `R2_VIDEOS_*`, `GAME_VIDEO_CONVERT_URL` (the
   prod Worker's URL) with `GAME_VIDEO_CONVERT_SECRET` (= `CONVERT_SECRET`),
   `GAME_VIDEO_WORKER_SECRET` (= `WORKER_SECRET`), `GAME_VIDEO_PURGE_SECRET`,
   and `MEDIA_PURGE_SCOPE=all` (prod only: staging shares the media bucket).
   The `R2_*` media-bucket secrets are already there for presign-upload.
4. **Database**: from this branch, `npx supabase db push --linked --dry-run`
   must list exactly the five migrations above; then push. Then the two
   `app_config` rows the migrations' headers describe:
   `game_video_purge_secret` and `game_video_worker_secret`, with the same
   values as the function secrets. Check `game_video_limits` and
   `cloud_video_enabled`. The migrations schedule `purge-game-videos` (04:00
   UTC) and `sweep-game-videos` (every 10 minutes).
5. **Functions**: `npx supabase functions deploy game-video --project-ref
   nbmrujmazvdoaldirpyx` and the same for `send-email`. (`profixio` is
   already deployed from its branch.)
6. **Merge** the branch into `main`: Vercel deploys the web. Expect a two-line
   conflict in `CLAUDE.md`'s `supabase/` bullet; keep the branch's text.
7. **Desktop release** (M1's upload and the redesign): the `/release` command.
8. **After**: with a test account on prod, upload a short game in the browser,
   share a playlist (the clips get files), and export both aspects.

## Known limits and follow-ups

- An export's audio is the copy's audio.
- The desktop plays a game only from a file on the computer it runs on. A game
  imported on another computer (its stored path doesn't exist here) or in the
  web app (no path at all) shows "video file can't be found" even when its
  cloud copy is ready. Follow-up: with no local file and a ready copy, play
  the clip's window from a presigned GET of the copy, as the web editor does
  (`usePlayUrls`, `buildWatchItems` with `preferWindows`); needs a desktop
  release.
- Link reuse for Send to my phone keys on what the client can see; copies
  uploaded by someone else aren't part of that key.
- Deleting a playlist clip doesn't queue its file for the media purge.
- `fresh=1` on `/api/hosted-stats` skips the 10-minute cache but doesn't
  refresh it.
- Polish from the 2026-10-19 pass: the selection bar covers the last row of a
  short list; phones show the Space key hint; the label picker is a popover
  on phones, not a sheet; a player's list shows a stats card with the
  text-card icon.
