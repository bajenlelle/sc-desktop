# game-video-convert

The converter for cloud game videos uploaded from the browser: a Cloudflare
Worker that starts one container per job, and the program the container runs.

```
game-video function ──POST /convert {videoId}──▶ Worker (src/worker.ts)
                                                   │ one Durable Object per video id
                                                   ▼
                                       container (Dockerfile, EU, standard-4)
                                       node --import tsx src/convert.ts
                                                   │ job_take · job_progress · job_sign_parts
                                                   │ job_done · job_failed   (x-worker-secret)
                                                   ▼
                                           game-video function → R2, game_videos row
```

`src/convert.ts` downloads the original, probes it, computes the content
fingerprint, looks up shared tip-off hints as the bot, encodes the 720p copy
with the desktop's exact ffmpeg arguments (`packages/shared/lib/game-video-convert.ts`),
uploads the copy in 32 MiB parts to presigned URLs, runs the tip-off detector
when no hint matched, and reports `job_done`. Anything that fails is reported
as `job_failed` with a token from the wire contract
(`packages/shared/lib/game-video-wire.ts`) and a `retryable` flag; the
function's sweep decides whether another attempt runs. Every log line is
`[convert <videoId> a<attempt>] key=value …` with no URL or secret in it.

## Layout

| Path | What |
| --- | --- |
| `src/worker.ts` | The Worker: `POST /convert`, `POST /alive/:videoId`, the `GameVideoConverter` container class (`@cloudflare/containers`) |
| `src/convert.ts` | The container's program; also runs on a Mac (`npx tsx …`) |
| `src/function-client.ts` | The `job_*` calls, retries, `stale_attempt` handling |
| `src/download.ts` / `encode.ts` / `upload.ts` / `detect.ts` | The job's steps |
| `src/errors.ts` / `sync.ts` / `log.ts` | Error classification, the sync decision, redacted logging (pure, tested) |
| `Dockerfile` | `node:22-bookworm-slim` + apt ffmpeg + tini; built from the repo root (`.dockerignore` there) |
| `wrangler.jsonc` | Prod at the top level, `env.staging` for staging |
| `test/` | `node --test` suites (`npm test`) |

The frame grabbing and the detection wiring live in `packages/node-video`
(shared with the nightly BasketTV job); the pure contract and the ffmpeg
argument list in `packages/shared`.

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
deploy output) and `GAME_VIDEO_CONVERT_SECRET`.

Container sizing: `standard-4` (4 vCPU, 12 GiB, 20 GB disk), at most 20
instances, placement constrained to the EU jurisdiction. A job's peak disk is
about the original plus twice the copy (ffmpeg's faststart pass), which fits
an 8 GiB original. The container stops after 20 minutes without an `/alive`
ping from the program (it pings every 5 minutes), and `onStop` reports a
non-zero exit the program didn't report itself.

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
bundles the Worker without Docker or an account.

## Running the program on a Mac

The program needs an ffmpeg; the desktop's sidecar works:

```sh
export FFMPEG=$PWD/apps/desktop/src-tauri/binaries/ffmpeg-aarch64-apple-darwin
```

**Pipeline only, no function** (how the encode, the probe, the fingerprint,
the hints and the detector are checked before anything is deployed):

```sh
DRY_RUN_SOURCE=/path/to/game.mp4 npx tsx workers/game-video-convert/src/convert.ts
```

Without `BOT_EMAIL`/`BOT_PASSWORD` the hint lookup and the detection are
skipped with a log line and the sync is `not_found`; with them, the Supabase
URL and key come from `SUPABASE_URL`/`SUPABASE_ANON_KEY` or, failing that,
from `apps/desktop/.env.staging` (`DRY_RUN_ENV_FILE` points elsewhere). The
copy lands in `WORK_DIR` when one is given (a temp dir is removed otherwise),
and the `job_done` payload the run would have sent is printed last.

**Against a real row** (what `scripts/game-video-smoke.mjs --browser
--local-convert` does for you): the row must be `converting`, and the secret
is the function's worker secret.

```sh
VIDEO_ID=<uuid> GAME_VIDEO_FN_URL=https://<ref>.supabase.co/functions/v1 WORKER_SECRET=… \
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=… BOT_EMAIL=… BOT_PASSWORD=… \
npx tsx workers/game-video-convert/src/convert.ts
```

Exit codes: 0 done (also when another converter holds the row, `job_busy`, or
another attempt took it over, `stale_attempt`), 1 failed and reported,
143 after SIGTERM (ffmpeg killed, `job_failed('sigterm')` sent).

## Checks

```sh
cd workers/game-video-convert
npm run typecheck   # tsconfig.json (Node side) and tsconfig.worker.json (Workers runtime)
npm test            # node --test
cd ../../packages/node-video && npm run typecheck && npm test
```

`check.yml` runs all four in the `game-video-convert` job.

## Troubleshooting

- `/convert` answers 401 `bad_convert_secret`: the function's
  `GAME_VIDEO_CONVERT_SECRET` and the Worker's `CONVERT_SECRET` differ.
- The program logs `phase=take error=bad_worker_secret (http 401)`: the
  Worker's `WORKER_SECRET` isn't the function's `GAME_VIDEO_WORKER_SECRET`.
- `phase=hints error=bot sign-in failed …`: the bot credentials; hints and
  detection degrade to `not_found`, the copy still ships.
- A row stays "Waiting to convert": check Workers Logs for the `/convert`
  call (`start failed`) and the function's `startConvert` log; the ten-minute
  sweep retries. Container logs are under the Worker's observability too.
- `job_failed … container_exit_137`: the container was killed (out of
  memory is the usual reason); the sweep reruns it up to three attempts.
