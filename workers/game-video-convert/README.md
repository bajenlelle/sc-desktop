# game-video-convert

The containers behind cloud game videos: a Cloudflare Worker that starts one
container per job, and the two programs a container can run — the converter
for a game uploaded from the browser, and the renderer that cuts a web
playlist's clips into files or renders the whole playlist into one MP4 (an
export).

```
game-video function ──POST /convert {videoId}──▶ Worker (src/worker.ts)
                    ──POST /render  {jobId}  ──▶   │ one Durable Object per job
                                                   ▼
                                       container (Dockerfile, EU, standard-4)
                                       node --import tsx src/convert.ts     (the image's entrypoint)
                                       node --import tsx src/render.ts      (an entrypoint override)
                                                   │ job_take · job_progress · job_sign_parts · job_done · job_failed
                                                   │ render_take · render_progress · render_done · render_failed
                                                   ▼                                          (x-worker-secret)
                                           game-video function → R2, game_videos / render_jobs rows
```

`src/convert.ts` downloads the original, probes it, computes the content
fingerprint, looks up shared tip-off hints as the bot, encodes the 720p copy
with the desktop's exact ffmpeg arguments (`packages/shared/lib/game-video-convert.ts`),
uploads the copy in 32 MiB parts to presigned URLs, runs the tip-off detector
when no hint matched, and reports `job_done`.

`src/render.ts` takes a render job (`render_take`: the clips to cut, a
presigned GET per cloud copy, a presigned PUT per clip in the public media
bucket), cuts each clip straight from the copy's URL with the desktop's Clip &
Ship arguments (`shipClipArgs`: 960×540, quarter-second fades, libx264 fast,
CRF 28; `-ss` before `-i`, so the copy's 2 s keyframes keep the seek cheap),
checks the cut (at least 4096 bytes, probed within half a second of its
window), PUTs it as `video/mp4`, three clips at a time with one retry pass over
the failures, and reports `render_done` with a result per clip. A clip's failure
is that clip's result, never the job's; only when every clip failed for a reason
outside the clips (the copy unreachable, every PUT refused, no ffmpeg) is the
job handed back with `render_failed(retryable)`. The function writes
`playlist_clips.r2_url` and notifies pending shares.

An `export` job (`render_take`'s `kind: "export"` and its `export` plan) runs
`src/export.ts`: one MP4 of the playlist, or of a selection, made the way the
desktop's `export_playlist` makes it (apps/desktop/src-tauri/src/lib.rs), with
the desktop's argument lists ported to `packages/shared/lib/export-args.ts`
and pinned there by lib.rs's golden strings. Each copy is probed once (a clip
from a copy without audio gets the cards' silent track, since the concat
filter needs audio on every input); each segment is rendered in playlist order
into the work dir (`seg_<i>.mp4`): a clip cut straight from its copy's
presigned GET, letterboxed to 1280×720 or panned in a 9:16 window scaled to
1080×1920, quarter-second fades; a text or stats card painted at the export's
size by `packages/node-video/lib/card-paint.ts` (the desktop painter's drawing
calls over the shared `card-layout.ts`, Roboto from `packages/node-video/assets`)
and looped for its duration. A clip must come out at least 4096 bytes and
probe within half a second of its window (held to the copy's end), a card at
least 1024 bytes. The concat pass joins them at the plan's one frame rate and
overlays the wordmark when the plan says so (`assets/watermark.png`: bottom
right in 16:9, centred 700 px up in 9:16), with `-movflags +faststart -pix_fmt
yuv420p` for web playback; a share also gets a poster frame (0.6 s in, else
the first). The video is PUT as `video/mp4` (and the poster as `image/jpeg`)
to the plan's presigned URLs, three tries each, and `render_done` carries
`{ results: [], export: { sizeBytes, durationSeconds, posterOk } }`. Progress
goes out with its phase: `clips` (done segments / (segments + 1)), `stitch`
(ffmpeg's `-progress` over the expected length), `upload`; at once when the
phase changes, at most every 5 s between, and every 30 s.

An export's `render_failed` tokens: `segment_failed:<n>` (segment n, counting
from 1, failed on its own account: a window outside the copy, a card that
can't be drawn; not retried), `stitch_failed` and `disk_full` (not retried),
`invalid_plan` and `card_painter_unavailable` (not retried), and the retryable
`ffmpeg_unavailable`, `ffmpeg_killed`, `source_unreachable` (a copy that can't
be read; the next attempt gets fresh URLs) and `upload_failed`. A poster that
can't be made or uploaded only sends `posterOk: false`. A 409 `cancelled` from
any call (the owner's `render_cancel`) kills ffmpeg, removes the temp files
and exits 0 without another report.

Anything that fails is reported with a token from the wire contract
(`packages/shared/lib/game-video-wire.ts`) and a `retryable` flag; the
function's sweep decides whether another attempt runs. Every log line is
`[convert <videoId> a<attempt>] key=value …` or `[render <jobId> a<attempt>] …`
with no URL or secret in it.

## Layout

| Path | What |
| --- | --- |
| `src/worker.ts` | The Worker: `POST /convert`, `POST /render`, `POST /alive/:videoId`, `POST /alive/render/:jobId`, the `GameVideoConverter` container class (`@cloudflare/containers`) |
| `src/convert.ts` | The converter program; also runs on a Mac (`npx tsx …`) |
| `src/render.ts` | The renderer program; also runs on a Mac |
| `src/ship.ts` | The per-clip cut, checks and PUT, the passes (pure over injected ffmpeg/PUT, tested) |
| `src/export.ts` | An export: probes, segments, the concat pass, the poster, the PUTs, the dry run's plan (pure over injected ffmpeg/probe/painter/PUT, tested) |
| `src/runtime.ts` | What both programs share: progress, alive pings, health server, heartbeat, SIGTERM, main wrapper |
| `src/function-client.ts` | `FunctionClient` (`job_*`, about a `videoId`) and `RenderClient` (`render_*`, about a `jobId`), retries, `stale_attempt` handling |
| `src/download.ts` / `encode.ts` / `upload.ts` / `detect.ts` | The conversion's steps |
| `src/errors.ts` / `sync.ts` / `log.ts` | Error classification, the sync decision, redacted logging (pure, tested) |
| `Dockerfile` | `node:22-bookworm-slim` + apt ffmpeg + tini; built from the repo root (`.dockerignore` there); one image for both programs |
| `wrangler.jsonc` | Prod at the top level, `env.staging` for staging |
| `test/` | `node --test` suites (`npm test`) |

The frame grabbing, the probe, the card painter and the export's assets live
in `packages/node-video` (shared with the nightly BasketTV job); the pure
contract, the ffmpeg argument lists (`game-video-convert.ts`, `export-args.ts`)
and the clip-window math (`clip-ship-plan.ts`) in `packages/shared`.

## Configuration

Vars in `wrangler.jsonc` (public): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`GAME_VIDEO_FN_URL` (`https://<ref>.supabase.co/functions/v1`).

Secrets, set once per environment and never in a file:

```sh
cd workers/game-video-convert
npx wrangler secret put CONVERT_SECRET   [--env staging]   # the function's GAME_VIDEO_CONVERT_SECRET
npx wrangler secret put WORKER_SECRET    [--env staging]   # the function's GAME_VIDEO_WORKER_SECRET (= app_config.game_video_worker_secret)
npx wrangler secret put BOT_EMAIL        [--env staging]   # the nightly job's tip-off bot
npx wrangler secret put BOT_PASSWORD     [--env staging]
```

The function side needs `GAME_VIDEO_CONVERT_URL` (the Worker's URL, from the
deploy output) and `GAME_VIDEO_CONVERT_SECRET`; both `/convert` and `/render`
carry the same `x-convert-secret`. The renderer needs nothing beyond the
function URL and the worker secret: the copies' GETs and the clips' PUTs are
presigned by the function (the media bucket's credentials never leave it).

Container sizing: `standard-4` (4 vCPU, 12 GiB, 20 GB disk), at most 20
instances, placement constrained to the EU jurisdiction. The function keeps
at most 15 conversions and 4 renders running at once, which stays under the
20. A conversion's peak disk is about the original plus twice the copy
(ffmpeg's faststart pass), which fits an 8 GiB original; a render holds three
clip files at a time. The container stops after 20 minutes without an
`/alive` ping from the program (it pings every 5 minutes), and `onStop`
reports a non-zero exit the program didn't report itself (`job_failed` or
`render_failed` with `container_exit_<code>`, retryable).

## Deploy

From GitHub Actions (Docker is on the runner): `convert-deploy.yml` runs on
pushes to `main` that touch this directory, `packages/shared` or
`packages/node-video` (prod), and by hand from the Actions tab with the
`environment` input (`staging` or `prod`). It needs the repository secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts, Durable Objects, Containers and
Workers Builds edit rights) and `CLOUDFLARE_ACCOUNT_ID`.

Locally, with Docker running (Colima works: `brew install colima docker && colima start`):

```sh
npm ci
cd workers/game-video-convert
npx wrangler deploy --env staging      # or `npx wrangler deploy` for prod
```

`npx wrangler deploy --dry-run --outdir /tmp/out` validates the config and
writes the bundled Worker to the directory without an account; with the
container configured, wrangler then still asks for Docker to build the image
(the bundle is already in `/tmp/out/worker.js` when it does).

## Running the programs on a Mac

Both need an ffmpeg; the desktop's sidecar works:

```sh
export FFMPEG=$PWD/apps/desktop/src-tauri/binaries/ffmpeg-aarch64-apple-darwin
```

**Conversion, pipeline only, no function** (how the encode, the probe, the
fingerprint, the hints and the detector are checked before anything is deployed):

```sh
DRY_RUN_SOURCE=/path/to/game.mp4 npx tsx workers/game-video-convert/src/convert.ts
```

Without `BOT_EMAIL`/`BOT_PASSWORD` the hint lookup and the detection are
skipped with a log line and the sync is `not_found`; with them, the Supabase
URL and key come from `SUPABASE_URL`/`SUPABASE_ANON_KEY` or, failing that,
from `apps/desktop/.env.staging` (`DRY_RUN_ENV_FILE` points elsewhere). The
copy lands in `WORK_DIR` when one is given (a temp dir is removed otherwise),
and the `job_done` payload the run would have sent is printed last.

**Clip cuts, no function** (the ship cut on a local file or any URL ffmpeg
reads; no upload):

```sh
WORK_DIR=/tmp/cuts DRY_RUN_PLAN='{"source":"/path/to/copy.mp4","clips":[{"start":10,"end":23},{"start":40,"end":53}]}' \
  npx tsx workers/game-video-convert/src/render.ts
```

The cuts land in `WORK_DIR` as `0.mp4`, `1.mp4`, … (kept when `WORK_DIR` is
given), each is checked like a real one, and the `render_done` payload the run
would have sent is printed last; the exit code is 1 when a clip failed (a
window past the file's end fails as `duration_mismatch`, for instance).

**An export, no function** (the whole export pipeline on local files or any
URL ffmpeg reads; no upload). The plan is JSON in the variable or a path to a
`.json` file; copies map a video id to a file, segments are
`RenderExportSegment`s (a clip may leave out `matchId`, `eventId` and
`keyframes`, a card its `text` and `card`; `card` is a stats card's spec as
`playlist_clips.card` stores it). Without `rate` the first clip's copy is
probed for it, as the function picks it (`exportFrameRate`). A render_take
response's `{ copies, export }` works as it is.

```sh
cat > /tmp/plan.json <<'EOF'
{
  "copies": { "v1": "/path/to/copy.mp4" },
  "aspect": "9:16",
  "purpose": "share",
  "watermark": true,
  "segments": [
    { "kind": "card", "durationSeconds": 3, "text": "Defence, first half" },
    { "kind": "clip", "videoId": "v1", "start": 10, "end": 16, "keyframes": [{ "t": 0, "cx": 0.3 }, { "t": 6, "cx": 0.7 }] },
    { "kind": "clip", "videoId": "v1", "start": 40, "end": 47 }
  ]
}
EOF
WORK_DIR=/tmp/export DRY_RUN_EXPORT=/tmp/plan.json npx tsx workers/game-video-convert/src/render.ts
```

The export lands in `WORK_DIR` as `export.mp4`, with `poster.jpg` for a share
(both kept when `WORK_DIR` is given; the segments are removed once joined), a
line is logged per segment, and the `render_done` payload is printed last. The
exit code is 1 when the export failed, with its token (`segment_failed:2`, …).

**Against a real row or job** (what `scripts/game-video-smoke.mjs --browser
--local-convert` and `… --ship --local-render` do for you): the row must be
`converting`, or the job `queued`, and the secret is the function's worker secret.

```sh
VIDEO_ID=<uuid> GAME_VIDEO_FN_URL=https://<ref>.supabase.co/functions/v1 WORKER_SECRET=… \
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=… BOT_EMAIL=… BOT_PASSWORD=… \
npx tsx workers/game-video-convert/src/convert.ts

RENDER_JOB_ID=<uuid> GAME_VIDEO_FN_URL=https://<ref>.supabase.co/functions/v1 WORKER_SECRET=… \
npx tsx workers/game-video-convert/src/render.ts
```

Exit codes (both programs): 0 done (also when another container holds the
job, `job_busy`, another attempt took it over, `stale_attempt`, the job is no
longer waiting, `wrong_status`, or its owner cancelled it, `cancelled`), 1
failed and reported, 143 after SIGTERM (ffmpeg killed, `job_failed('sigterm')`
/ `render_failed('sigterm')` sent).

## Checks

```sh
cd workers/game-video-convert
npm run typecheck   # tsconfig.json (Node side) and tsconfig.worker.json (Workers runtime)
npm test            # node --test (ship passes, the export pipeline, function clients, runtime, errors, download, upload, sync)
cd ../../packages/node-video && npm run typecheck && npm test   # card painter, probe parser, detection wiring
```

`check.yml` runs all four in the `game-video-convert` job.

## Troubleshooting

- `/convert` or `/render` answers 401 `bad_convert_secret`: the function's
  `GAME_VIDEO_CONVERT_SECRET` and the Worker's `CONVERT_SECRET` differ.
- The program logs `phase=take error=bad_worker_secret (http 401)`: the
  Worker's `WORKER_SECRET` isn't the function's `GAME_VIDEO_WORKER_SECRET`.
- `phase=hints error=bot sign-in failed …`: the bot credentials; hints and
  detection degrade to `not_found`, the copy still ships.
- A row stays "Waiting to convert", or a render job stays `queued` with
  `heartbeat_at` NULL: check Workers Logs for the `/convert` or `/render` call
  (`start failed`) and the function's `startConvert` / `startRender` log; the
  ten-minute sweep retries, and a job nobody took within a day fails
  `renderer_unavailable`. Container logs are under the Worker's observability too.
- `phase=take error=renderer_unavailable (http 503)` on a render: the function
  lacks the media bucket's `R2_ENDPOINT` / `R2_BUCKET` / `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` / `R2_PUBLIC_URL` secrets (the ones presign-upload uses).
- `phase=clip … error=source_unreachable` on every clip: the copies' presigned
  GETs expired or can't be reached; the job is handed back and the next attempt
  gets fresh URLs. `cut_failed` / `duration_mismatch` on one clip: its window
  lies outside the copy (a sync far off, a trim past the end); the other clips
  ship and the failure is in the job's `result.failures`.
- An export failing `segment_failed:<n>`: the log's `phase=failed` line says
  why (rendered empty: the clip's window lies outside its copy; a duration off
  by more than half a second; a card that couldn't be drawn). `stitch_failed`:
  the concat pass refused the segments (the line carries ffmpeg's last stderr
  line). `card_painter_unavailable`: `@napi-rs/canvas` didn't load in the
  image (its `linux-x64-gnu` binary comes from the lockfile with `npm ci`).
- `phase=cancelled`: the owner stopped the export (`render_cancel`); nothing
  is wrong.
- `job_failed … container_exit_137` / `render_failed … container_exit_137`:
  the container was killed (out of memory is the usual reason); the sweep
  reruns it up to three attempts.
