#!/usr/bin/env node
// Smoke test for the `game-video` edge function against a real project
// (staging), end to end through R2: a throwaway user and game are created
// with the service role, a 48 MiB file goes up in two parts with a resume in
// between, the copy is replaced, played by byte range, removed, and the
// deletion queue is purged. Everything it creates is deleted at the end.
//
//   node --env-file=apps/web/.env.staging scripts/game-video-smoke.mjs                      # the desktop path
//   node --env-file=apps/web/.env.staging scripts/game-video-smoke.mjs --browser            # the browser path, this
//                                                                                           # script playing the converter
//   node --env-file=apps/web/.env.staging scripts/game-video-smoke.mjs --browser --local-convert [--file game.mp4]
//                                                                                           # the real converter program,
//                                                                                           # run here with tsx
//   node --env-file=apps/web/.env.staging scripts/game-video-smoke.mjs --browser --local-convert --file game.mp4 \
//        --ship [--local-render]                                                            # + a web playlist's clips cut
//                                                                                           # on the server (render jobs)
//   … --ship --export [--local-render]                                                      # + the playlist exported on the
//                                                                                           # server: a download and a share
//   node --env-file=apps/web/.env.staging scripts/game-video-smoke.mjs --browser --cloud --file game.mp4 \
//        [--ship [--export]]                                                                # the DEPLOYED Worker does it
//                                                                                           # all: this script only asks,
//                                                                                           # waits and checks the files
//
// The browser path uploads an ORIGINAL to a source key, completes into
// `converting`, then either drives the job_* actions itself with the worker
// secret from app_config (so the function's converter side is checked
// without a converter), or spawns workers/game-video-convert/src/convert.ts
// against the row (--local-convert; needs FFMPEG, and BOT_EMAIL/BOT_PASSWORD
// for a real detection). With --file the real file is uploaded instead of
// random bytes, and the converter encodes it.
//
// --ship goes on from the ready copy: three plays around the anchor, a club
// with a second throwaway user, a playlist with three clips and a text card
// shared to that user (pending, no file yet), `ship` → a queued render job
// (no renderer is reached here: the job waits as it would for the sweep),
// then the job is run either by this script playing the renderer (fake cuts
// PUT to the presigned URLs) or by the real program,
// workers/game-video-convert/src/render.ts, spawned here (--local-render;
// needs a real copy, so --local-convert --file with a video of at least 17 s,
// and FFMPEG). Then: every r2_url is the public base + clipShipKey, the
// files GET as video/mp4 and probe at the window's length (--local-render),
// the pending share is notified, `ship` again cuts nothing, a trim cuts one
// clip anew, a sync change cuts all three again. The clip objects stay in the
// media bucket under clips/smoke-<stamp>/ (the smoke can't delete there).
//
// --export goes on from the shipped playlist: two more plays (one whose window
// runs past the copy's end, one that starts after it) and a pan on the first
// clip; who may export (a bad request, a non-owner, a free club and a free
// personal space get refused; then the club goes Pro); a download (16:9,
// wordmark off) and a share (9:16, with a content key), each run either by
// this script playing the renderer (a small real MP4 and JPEG made with the
// local ffmpeg, PUT to the presigned URLs) or by the real program
// (--local-render: the render is probed, 1280x720 / 1080x1920, its length
// ≈ the clips + the card, faststart). Then: export_link saves the download
// (206 for a range, Content-Disposition attachment), the share is a valid
// highlight link, the same share request reuses it, a fresh one is cancelled
// while a renderer holds it (its calls get 409 cancelled), a queued selection
// is cancelled before any renderer takes it, and deleting the download's row
// queues its file, which the purge deletes. Needs FFMPEG (or ffmpeg on PATH).
// The share's files stay in the media bucket under highlights/<uid>/.
//
// Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_ANON_KEY (or
// NEXT_PUBLIC_SUPABASE_ANON_KEY) and SUPABASE_SERVICE_ROLE_KEY. Never prints
// a key, a token or a signed URL.

import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
// The key scheme every shipped clip is stored under (an import-free TypeScript file; Node strips the types).
import { clipBounds, clipShipKey } from "../packages/shared/lib/clip-ship-plan.ts";
// The export's names, keys and rate, and the pan rebasing a 9:16 clip gets (import-free too).
import { exportFileName, exportFrameRate, gameVideoExportKey, HIGHLIGHT_KEY_RE } from "../packages/shared/lib/game-video-wire.ts";
import { toSegmentKeyframes } from "../packages/shared/lib/crop-path.ts";

const args = process.argv.slice(2);
const BROWSER = args.includes("--browser");
const LOCAL_CONVERT = args.includes("--local-convert");
const SHIP = args.includes("--ship");
const EXPORT = args.includes("--export");
const LOCAL_RENDER = args.includes("--local-render");
// --cloud: the deployed Worker does the work (the conversion, the cuts, the
// exports) and this script only asks, waits and checks the real files.
const CLOUD = args.includes("--cloud");
const REAL_COPY = LOCAL_CONVERT || CLOUD;
const REAL_RENDER = LOCAL_RENDER || CLOUD;
const fileArg = args.indexOf("--file") >= 0 ? args[args.indexOf("--file") + 1] : null;
if (SHIP && !BROWSER) {
  console.error("--ship needs --browser (it goes on from the browser path's ready copy).");
  process.exit(2);
}
if (EXPORT && !SHIP) {
  console.error("--export needs --ship (it goes on from the shipped playlist).");
  process.exit(2);
}
if (CLOUD && (!BROWSER || !fileArg || LOCAL_CONVERT || LOCAL_RENDER)) {
  console.error("--cloud needs --browser --file <video of at least 17 s>, and no --local-convert or --local-render (the deployed Worker plays both).");
  process.exit(2);
}
if (LOCAL_RENDER && !(SHIP && LOCAL_CONVERT && fileArg)) {
  console.error("--local-render needs --ship --local-convert --file <video of at least 17 s> (real clips are cut from the real copy).");
  process.exit(2);
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (or the NEXT_PUBLIC_ names).");
  process.exit(2);
}

const MIB = 1024 * 1024;
const PART = 32 * MIB;
const SIZE = 48 * MIB; // two parts: a full one and a short one

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const stamp = Date.now().toString(36);
// Resend's delivered@ test inbox takes any label, so the ready email of a browser smoke bounces nowhere.
const email = BROWSER ? `delivered+cloud-smoke-${stamp}@resend.dev` : `cloud-smoke-${stamp}@scoutable.se`;
const password = randomBytes(18).toString("base64url");
const matchId = `smoke-${stamp}`;
const matchIds = [matchId];

let step = 0;
function log(msg) {
  step++;
  console.log(`${String(step).padStart(2, " ")}. ${msg}`);
}
function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}
function expect(cond, msg) {
  if (!cond) fail(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** supabase.functions.invoke with the function's { error } token surfaced. */
async function call(client, body, headers) {
  const { data, error } = await client.functions.invoke("game-video", { body, headers });
  if (error) {
    let token = "request_failed";
    let extra = {};
    const ctx = error.context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        token = j?.error ?? token;
        extra = j ?? {};
      } catch {
        /* keep generic */
      }
    }
    return { ok: false, error: token, status: ctx?.status ?? 0, extra };
  }
  return { ok: true, data };
}

async function putPart(url, bytes) {
  const res = await fetch(url, { method: "PUT", body: bytes });
  expect(res.ok, `part PUT answered ${res.status}`);
  const etag = res.headers.get("etag");
  expect(etag, "part PUT returned no ETag");
  return etag;
}

/** One secret from app_config, the way pg_cron reads it. */
async function configSecret(key) {
  const { data, error } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
  expect(!error && data?.value, `app_config.${key} is not set on this project`);
  return data.value;
}

async function uploadCopy(user, file, { replace = false, label }) {
  let r = await call(user, { action: "begin", matchId, sizeBytes: SIZE, durationSeconds: 12.5, width: 1280, height: 720, fingerprintKey: "smoke-fp", replace });
  expect(r.ok, `begin (${label}) failed: ${r.error}`);
  expect(r.data.partSize === PART && r.data.partCount === 2 && r.data.resumed === false, `begin (${label}) planned ${r.data.partCount} parts of ${r.data.partSize}`);
  const videoId = r.data.videoId;
  log(`begin (${label}): 2 parts of 32 MiB, video ${videoId.slice(0, 8)}…`);

  r = await call(user, { action: "sign_parts", videoId, partNumbers: [1, 2] });
  expect(r.ok && r.data.urls.length === 2, `sign_parts failed: ${r.error}`);
  const urls = Object.fromEntries(r.data.urls.map((u) => [u.partNumber, u.url]));
  const etag1 = await putPart(urls[1], file.subarray(0, PART));
  log("part 1 uploaded");

  // An interrupted upload resumes: begin again with the same file.
  r = await call(user, { action: "begin", matchId, sizeBytes: SIZE, durationSeconds: 12.5, width: 1280, height: 720, fingerprintKey: "smoke-fp", replace });
  expect(r.ok, `begin (resume) failed: ${r.error}`);
  expect(r.data.resumed === true && r.data.videoId === videoId, "begin did not resume the same upload");
  expect(r.data.completedParts.length === 1 && r.data.completedParts[0].partNumber === 1, "resume did not list part 1");
  expect(`"${r.data.completedParts[0].etag}"` === etag1 || r.data.completedParts[0].etag === etag1.replace(/"/g, ""), "resume listed a different ETag for part 1");
  log("begin again: resumed with part 1 already there");

  r = await call(user, { action: "sign_parts", videoId, partNumbers: [2] });
  expect(r.ok, `sign_parts (2) failed: ${r.error}`);
  const etag2 = await putPart(r.data.urls[0].url, file.subarray(PART));
  log("part 2 uploaded");

  const parts = [
    { partNumber: 1, etag: etag1 },
    { partNumber: 2, etag: etag2 },
  ];
  r = await call(user, { action: "complete", videoId, parts });
  expect(r.ok && r.data.status === "ready", `complete failed: ${r.error} ${JSON.stringify(r.extra ?? {})}`);
  r = await call(user, { action: "complete", videoId, parts });
  expect(r.ok && r.data.status === "ready", `second complete not idempotent: ${r.error}`);
  log("complete: ready (and a repeat is harmless)");
  return videoId;
}

async function playAndCheck(user, file, expectedVideoId, { gameId = matchId, size = SIZE } = {}) {
  const r = await call(user, { action: "play", matchId: gameId });
  expect(r.ok, `play failed: ${r.error}`);
  expect(r.data.videoId === expectedVideoId, "play returned another copy");
  expect(Date.parse(r.data.expiresAt) - Date.now() > 11 * 3600 * 1000, "play URL expires too soon");
  const head = await fetch(r.data.url, { headers: { Range: "bytes=0-15" } });
  expect(head.status === 206, `range GET (head) answered ${head.status}`);
  expect((head.headers.get("content-type") ?? "").startsWith("video/mp4"), `content type was ${head.headers.get("content-type")}`);
  const headBytes = new Uint8Array(await head.arrayBuffer());
  expect(Buffer.compare(headBytes, file.subarray(0, 16)) === 0, "first 16 bytes differ");
  const tail = await fetch(r.data.url, { headers: { Range: "bytes=-16" } });
  expect(tail.status === 206, `range GET (tail) answered ${tail.status}`);
  const tailBytes = new Uint8Array(await tail.arrayBuffer());
  expect(Buffer.compare(tailBytes, file.subarray(size - 16)) === 0, "last 16 bytes differ (part 2 wrong?)");
  log("play: 12 h URL, byte ranges at both ends match the file");
}

/** The nightly purge, called the way pg_cron calls it: with the shared secret from app_config. */
let purgeSecret = null;
async function purge() {
  if (purgeSecret === null) purgeSecret = await configSecret("game_video_purge_secret");
  const r = await call(admin, { action: "purge" }, { "x-purge-secret": purgeSecret });
  if (!r.ok) fail(`purge failed: ${r.error}`);
  return r.data;
}

/** A row as the function sees it. */
async function row(videoId) {
  const { data, error } = await admin
    .from("game_videos")
    .select("id, status, origin, storage_key, source_storage_key, source_size_bytes, convert_progress, convert_attempts, convert_heartbeat_at, convert_error, sync_status, suggested_tipoff_seconds, size_bytes, duration_seconds, width, height, fps, content_fingerprint")
    .eq("id", videoId)
    .maybeSingle();
  expect(!error, `row read failed: ${error?.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// The browser path
// ---------------------------------------------------------------------------

const ANCHOR = "2026-10-04T13:00:00.000Z";

/** Uploads an original the way the web does: begin with origin browser, two parts, a resume, complete → converting. */
async function uploadOriginal(user, file, gameId, { sourceName = "smoke.mp4", label }) {
  const size = file.length;
  const partSize = PART;
  const count = Math.ceil(size / partSize);
  const beginBody = {
    action: "begin",
    matchId: gameId,
    sizeBytes: size,
    durationSeconds: null,
    width: null,
    height: null,
    fingerprintKey: `wb1:${stamp}`,
    origin: "browser",
    sourceName,
    anchorKind: "tipoff",
    anchorLabel: null,
    anchorRealWorldTime: ANCHOR,
  };
  let r = await call(user, beginBody);
  expect(r.ok, `begin (${label}) failed: ${r.error} ${JSON.stringify(r.extra ?? {})}`);
  expect(r.data.partSize === partSize && r.data.partCount === count && r.data.resumed === false, `begin (${label}) planned ${r.data.partCount} parts`);
  const videoId = r.data.videoId;
  log(`begin (${label}, browser): ${count} part${count === 1 ? "" : "s"}, video ${videoId.slice(0, 8)}…`);

  const etags = {};
  for (let n = 1; n <= count; n++) {
    if (n === 2) {
      // An interrupted upload resumes: begin again with the same file.
      r = await call(user, beginBody);
      expect(r.ok && r.data.resumed === true && r.data.videoId === videoId, `begin (resume) did not resume: ${r.error ?? JSON.stringify(r.data)}`);
      expect(r.data.completedParts.length === 1 && r.data.completedParts[0].partNumber === 1, "resume did not list part 1");
      log("begin again: resumed with part 1 already there");
    }
    r = await call(user, { action: "sign_parts", videoId, partNumbers: [n] });
    expect(r.ok && r.data.urls.length === 1, `sign_parts (${n}) failed: ${r.error}`);
    etags[n] = await putPart(r.data.urls[0].url, file.subarray((n - 1) * partSize, Math.min(size, n * partSize)));
    log(`part ${n} of the original uploaded`);
  }
  const parts = Object.entries(etags).map(([n, etag]) => ({ partNumber: Number(n), etag }));
  r = await call(user, { action: "complete", videoId, parts });
  expect(r.ok && r.data.status === "converting", `complete failed: ${r.error} ${JSON.stringify(r.extra ?? {})} ${JSON.stringify(r.data ?? {})}`);
  r = await call(user, { action: "complete", videoId, parts });
  expect(r.ok && r.data.status === "converting", `second complete not idempotent: ${r.error}`);
  const after = await row(videoId);
  expect(after.status === "converting" && after.origin === "browser" && after.source_storage_key && after.sync_status === "pending", `row after complete: ${JSON.stringify(after)}`);
  expect(after.storage_key.includes("/games/") && after.source_storage_key.includes("/sources/"), "keys are not a copy key and a source key");
  log("complete: converting (and a repeat is harmless); the original is under sources/, the copy key is reserved");
  return videoId;
}

/** The converter's side of the protocol, played by this script against a converting row. */
async function convertAsWorker(user, videoId, original, { wsecret }) {
  const w = (body) => call(admin, body, { "x-worker-secret": wsecret });

  let r = await call(admin, { action: "job_take", videoId }, { "x-worker-secret": "wrong" });
  expect(!r.ok && r.error === "bad_worker_secret", `job_take with a wrong secret answered ${r.ok ? "ok" : r.error}`);
  r = await w({ action: "job_take", videoId });
  expect(r.ok, `job_take failed: ${r.error} ${JSON.stringify(r.extra ?? {})}`);
  const { attempt, sourceUrl, sourceSizeBytes, partSize, match } = r.data;
  expect(attempt === 1 && sourceSizeBytes === original.length && partSize === PART, `job_take answered ${JSON.stringify({ attempt, sourceSizeBytes, partSize })}`);
  expect(match.anchorRealWorldTime && Date.parse(match.anchorRealWorldTime) === Date.parse(ANCHOR) && match.isProfixio === false, `job_take match: ${JSON.stringify(match)}`);
  const src = await fetch(sourceUrl, { headers: { Range: "bytes=-16" } });
  expect(src.status === 206 && Buffer.compare(new Uint8Array(await src.arrayBuffer()), original.subarray(original.length - 16)) === 0, "the original's signed URL does not serve the uploaded bytes");
  log(`job_take: attempt 1, the original downloads, the copy's upload is open`);

  r = await w({ action: "job_take", videoId });
  expect(!r.ok && r.error === "job_busy", `a second job_take answered ${r.ok ? "ok" : r.error}`);
  r = await w({ action: "job_progress", videoId, attempt, progress: 0.42 });
  expect(r.ok, `job_progress failed: ${r.error}`);
  let cur = await row(videoId);
  expect(Math.abs(cur.convert_progress - 0.42) < 1e-6 && cur.convert_attempts === 1 && cur.convert_heartbeat_at, `row after progress: ${JSON.stringify(cur)}`);
  r = await w({ action: "job_progress", videoId, attempt: attempt + 1, progress: 0.5 });
  expect(!r.ok && r.error === "stale_attempt", `a stale attempt's progress answered ${r.ok ? "ok" : r.error}`);
  log("job_progress: 42% on the row; a second take is busy; a stale attempt is refused");

  const copy = randomBytes(1 * MIB);
  r = await w({ action: "job_sign_parts", videoId, attempt, partNumbers: [1] });
  expect(r.ok && r.data.urls.length === 1, `job_sign_parts failed: ${r.error}`);
  const etag = await putPart(r.data.urls[0].url, copy);
  log("job_sign_parts: the copy's one part uploaded");

  const fingerprint = {
    version: 1,
    durationMs: 12500,
    offsetsS: [6],
    hashes: ["00ff00ff00ff00ff"],
    key: randomBytes(32).toString("hex"),
  };
  const done = {
    action: "job_done",
    videoId,
    attempt,
    parts: [{ partNumber: 1, etag }],
    sizeBytes: copy.length,
    durationSeconds: 12.5,
    width: 1280,
    height: 720,
    fps: 25,
    fingerprint,
    sync: { outcome: "estimate", seconds: 336.5, confidence: 0.92 },
  };
  r = await w(done);
  expect(r.ok && r.data.status === "ready" && r.data.syncStatus === "applied", `job_done answered ${r.ok ? JSON.stringify(r.data) : r.error + " " + JSON.stringify(r.extra ?? {})}`);
  r = await w(done);
  expect(r.ok && r.data.status === "ready", `a repeated job_done answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  cur = await row(videoId);
  expect(cur.status === "ready" && cur.sync_status === "applied" && cur.suggested_tipoff_seconds === 336.5 && cur.source_storage_key === null && cur.fps === 25 && cur.width === 1280, `row after done: ${JSON.stringify(cur)}`);
  const m = await admin.from("matches").select("sync_point").eq("id", match.id).maybeSingle();
  expect(m.data?.sync_point?.syncVideoTime === 336.5 && m.data?.sync_point?.syncRealWorldTime === ANCHOR, `the game's sync point: ${JSON.stringify(m.data?.sync_point)}`);
  const gone = await fetch(sourceUrl, { method: "HEAD" });
  expect(gone.status === 404 || gone.status === 403, `the original still answers ${gone.status}`);
  log("job_done: ready, the tip-off applied to the game (336.5 at the anchor), the original deleted; a repeat is harmless");
  return { copy, fingerprintKey: fingerprint.key };
}

async function browserPath(user, userId) {
  const wsecret = await configSecret("game_video_worker_secret");
  const original = fileArg ? readFileSync(fileArg) : randomBytes(SIZE);
  if (fileArg) log(`uploading ${path.basename(fileArg)} (${(statSync(fileArg).size / 1e6).toFixed(0)} MB) as the original`);

  const videoId = await uploadOriginal(user, original, matchId, { sourceName: fileArg ? path.basename(fileArg) : "smoke.mp4", label: "first original" });

  let copyBytes = null;
  if (LOCAL_CONVERT) {
    await runLocalConverter(videoId, wsecret);
    const cur = await row(videoId);
    expect(cur.status === "ready", `after the local converter the row is ${cur.status} (${cur.convert_error ?? "no error"})`);
    expect(["applied", "suggested", "not_found", "skipped"].includes(cur.sync_status), `sync status after the converter: ${cur.sync_status}`);
    log(`local converter: ready, sync ${cur.sync_status}${cur.suggested_tipoff_seconds !== null ? ` at ${cur.suggested_tipoff_seconds}s` : ""}, ${(Number(cur.size_bytes) / 1e6).toFixed(1)} MB copy, ${cur.width}x${cur.height}`);
  } else if (CLOUD) {
    const cur = await waitForConversion(videoId);
    expect(["applied", "suggested", "not_found", "skipped"].includes(cur.sync_status), `sync status after the cloud converter: ${cur.sync_status}`);
    log(`cloud converter: ready, sync ${cur.sync_status}${cur.suggested_tipoff_seconds !== null ? ` at ${cur.suggested_tipoff_seconds}s` : ""}, ${(Number(cur.size_bytes) / 1e6).toFixed(1)} MB copy, ${cur.width}x${cur.height}`);
  } else {
    const made = await convertAsWorker(user, videoId, original, { wsecret });
    copyBytes = made.copy;
    await playAndCheck(user, copyBytes, videoId, { size: copyBytes.length });
  }

  // The uploader sets the sync by hand; the game and a confirmed hint follow.
  let r = await call(user, { action: "sync_set", videoId, status: "manual", seconds: 341 });
  expect(r.ok && r.data.syncStatus === "manual" && r.data.seconds === 341, `sync_set answered ${r.ok ? JSON.stringify(r.data) : r.error + " " + JSON.stringify(r.extra ?? {})}`);
  const m = await admin.from("matches").select("sync_point").eq("id", matchId).maybeSingle();
  expect(m.data?.sync_point?.syncVideoTime === 341, `sync point after sync_set: ${JSON.stringify(m.data?.sync_point)}`);
  const hints = await admin.from("video_sync_hints").select("id, method, tipoff_video_time").eq("detected_by", userId);
  if (!REAL_COPY) expect(hints.data?.length === 1 && hints.data[0].method === "confirmed" && hints.data[0].tipoff_video_time === 341, `hints after sync_set: ${JSON.stringify(hints.data)}`);
  r = await call(user, { action: "retry_convert", videoId });
  expect(!r.ok && r.error === "wrong_status", `retry_convert on a ready row answered ${r.ok ? "ok" : r.error}`);
  log(`sync_set manual 341: the game follows${REAL_COPY ? "" : ", a confirmed hint is written"}; retry on a ready row is refused`);

  if (SHIP) {
    const shipped = await shipPath(user, userId, videoId, wsecret);
    if (EXPORT) await exportPath(user, userId, videoId, wsecret, shipped);
  }

  // A conversion that fails: one retryable attempt, then a final one, then the
  // original is gone. Played by this script, so not with --cloud, where the
  // real Worker would take the row too.
  if (CLOUD) {
    r = await call(user, { action: "remove", videoId });
    expect(r.ok, `remove (ready row) answered ${r.error}`);
    const p0 = await purge();
    expect(p0.refused === 0 && p0.remaining === 0, `purge after the remove: ${JSON.stringify(p0)}`);
    log(`remove: the row gone, purge → ${JSON.stringify(p0)}`);
    return;
  }
  const match2 = `${matchId}-b`;
  matchIds.push(match2);
  const ins = await admin.from("matches").insert({ id: match2, user_id: userId, title: "Cloud smoke (failing)", league_id: "sweden-national-men" });
  expect(!ins.error, `second match insert failed: ${ins.error?.message}`);
  const small = randomBytes(2 * MIB);
  const video2 = await uploadOriginal(user, small, match2, { label: "second original" });
  const w = (body) => call(admin, body, { "x-worker-secret": wsecret });
  r = await w({ action: "job_take", videoId: video2 });
  expect(r.ok && r.data.attempt === 1, `job_take (2) failed: ${r.error}`);
  r = await w({ action: "job_failed", videoId: video2, attempt: 1, error: "transcode_incomplete", retryable: true });
  expect(r.ok && r.data.status === "converting", `job_failed (retryable) answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  let cur = await row(video2);
  expect(cur.status === "converting" && cur.convert_heartbeat_at === null && cur.convert_attempts === 1 && cur.convert_error === "transcode_incomplete", `row after a retryable failure: ${JSON.stringify(cur)}`);
  r = await w({ action: "job_take", videoId: video2 });
  expect(r.ok && r.data.attempt === 2, `job_take after a failure answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  r = await w({ action: "job_failed", videoId: video2, attempt: 2, error: "unsupported_type", retryable: false });
  expect(r.ok && r.data.status === "failed", `job_failed (final) answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  cur = await row(video2);
  expect(cur.status === "failed" && cur.convert_error === "unsupported_type" && cur.source_storage_key === null, `row after a final failure: ${JSON.stringify(cur)}`);
  r = await call(user, { action: "retry_convert", videoId: video2 });
  expect(!r.ok && r.error === "source_expired", `retry_convert without an original answered ${r.ok ? "ok" : r.error}`);
  log("a failing conversion: handed back once, failed for good the second time, the original dropped, retry says source_expired");

  // The sweep runs with the worker secret only.
  r = await call(user, { action: "sweep" });
  expect(!r.ok && r.error === "bad_worker_secret", `sweep as a user answered ${r.ok ? "ok" : r.error}`);
  r = await w({ action: "sweep" });
  expect(r.ok && typeof r.data.examined === "number", `sweep answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  log(`sweep: ${JSON.stringify(r.data)}`);

  // Removing a failed browser row and the ready one; both games deleted; purge leaves nothing.
  r = await call(user, { action: "remove", videoId: video2 });
  expect(r.ok, `remove (failed row) answered ${r.error}`);
  r = await call(user, { action: "remove", videoId });
  expect(r.ok, `remove (ready row) answered ${r.error}`);
  r = await call(user, { action: "play", matchId });
  expect(!r.ok && r.error === "not_found", `play after remove answered ${r.ok ? "ok" : r.error}`);
  const p = await purge();
  expect(p.refused === 0 && p.remaining === 0, `purge after removes: ${JSON.stringify(p)}`);
  log(`remove: both rows gone, play says not_found, purge → ${JSON.stringify(p)}`);
}

const WORKER_HINT =
  "the function could not start the Worker, or the Worker could not reach the function: check that GAME_VIDEO_CONVERT_URL points at the Worker, that GAME_VIDEO_CONVERT_SECRET equals the Worker's CONVERT_SECRET and that the Worker's WORKER_SECRET equals app_config.game_video_worker_secret";

/** --cloud: waits for the deployed converter to finish a row, logging where it is. */
async function waitForConversion(videoId, timeoutMs = 20 * 60 * 1000) {
  const started = Date.now();
  let last = "";
  for (;;) {
    const cur = await row(videoId);
    const where = `${cur.status}${cur.convert_progress !== null && cur.convert_progress !== undefined ? ` ${Math.round(Number(cur.convert_progress) * 100)}%` : ""}${cur.convert_heartbeat_at ? "" : " (no converter yet)"}`;
    if (where !== last) {
      log(`cloud converter: ${where} after ${((Date.now() - started) / 1000).toFixed(0)} s`);
      last = where;
    }
    if (cur.status === "ready") return cur;
    if (cur.status === "failed") fail(`the cloud conversion failed: ${cur.convert_error ?? "no error"}`);
    if (Date.now() - started > timeoutMs) fail(`the row is still ${where} after ${timeoutMs / 60000} min: ${WORKER_HINT}`);
    await sleep(10000);
  }
}

/** --cloud: waits for the deployed renderer to settle a render job. */
async function waitForJob(jobId, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  let last = "";
  for (;;) {
    const job = await jobRow(jobId);
    const where = `${job.status}${job.phase ? ` ${job.phase}` : ""}${job.progress !== null && job.progress !== undefined ? ` ${Math.round(Number(job.progress) * 100)}%` : ""}`;
    if (where !== last) {
      log(`cloud renderer: job ${jobId.slice(0, 8)}… ${where} after ${((Date.now() - started) / 1000).toFixed(0)} s`);
      last = where;
    }
    if (job.status === "done") return job;
    if (job.status === "failed") fail(`the cloud render failed: ${job.error ?? "no error"}`);
    if (Date.now() - started > timeoutMs) fail(`job ${jobId.slice(0, 8)}… is still ${where} after ${timeoutMs / 60000} min: ${WORKER_HINT}`);
    await sleep(5000);
  }
}

/** Runs the converter program on this machine against a converting row, the way the container would. */
async function runLocalConverter(videoId, wsecret) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(here, "../workers/game-video-convert/src/convert.ts");
  const env = {
    ...process.env,
    VIDEO_ID: videoId,
    GAME_VIDEO_FN_URL: `${SUPABASE_URL}/functions/v1`,
    WORKER_SECRET: wsecret,
    SUPABASE_URL,
    SUPABASE_ANON_KEY: ANON_KEY,
  };
  delete env.PORT;
  log(`local converter: tsx ${path.relative(process.cwd(), script)} on ${videoId.slice(0, 8)}… (FFMPEG=${process.env.FFMPEG ? "set" : "ffmpeg"}, detection ${process.env.BOT_EMAIL ? "as the bot" : "off: no BOT_EMAIL"})`);
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn("npx", ["tsx", script], { env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  expect(code === 0, `the converter exited with ${code}`);
  log(`local converter finished in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  // The function marks the row ready inside job_done; give the read a moment.
  await sleep(500);
}

// ---------------------------------------------------------------------------
// Shipping: a web playlist's clips cut on the server (--ship)
// ---------------------------------------------------------------------------

/**
 * Where the smoke puts the tip-off in the copy, and the plays after it: with
 * the default rolls (10 s before, 3 s after) the windows are [0,13], [2,15]
 * and [4,17], inside any copy of 17 s or more.
 */
const SHIP_TIP = 10;
const SHIP_PLAY_OFFSETS_S = [0, 2, 4];
const SHIP_EVENT_IDS = [1001, 1002, 1003];
const ROLLS = { pre: 10, post: 3 };
/** The columns the web reads to follow a job (packages/shared/lib/render-jobs-db.ts). */
const RENDER_JOB_SELECT = "id, kind, playlist_id, status, phase, request, progress, requeue, result, error, attempt, created_at, finished_at";

const shipCleanup = { playlistId: null, orgId: null, playerId: null };

async function jobRow(jobId) {
  const { data, error } = await admin.from("render_jobs").select(`${RENDER_JOB_SELECT}, heartbeat_at, user_id`).eq("id", jobId).maybeSingle();
  expect(!error && data, `job read failed: ${error?.message ?? "no row"}`);
  return data;
}

async function clipRows(playlistId) {
  const { data, error } = await admin.from("playlist_clips").select("id, match_id, event_id, item_type, position, pre_roll_offset, post_roll_offset, r2_url").eq("playlist_id", playlistId).order("position");
  expect(!error, `clips read failed: ${error?.message}`);
  return data.filter((c) => c.item_type === "clip");
}

async function shareRow(playlistId, playerId) {
  const { data, error } = await admin.from("playlist_user_shares").select("notified_at").eq("playlist_id", playlistId).eq("user_id", playerId).maybeSingle();
  expect(!error && data, `share read failed: ${error?.message ?? "no row"}`);
  return data;
}

/** The window and key the plan computes for play `i` at a tip-off of `tip` seconds, with the clip's offsets. */
function expectedCut(i, tip, preOff = 0, postOff = 0) {
  const t = tip + SHIP_PLAY_OFFSETS_S[i];
  const { start, end } = clipBounds(t, ROLLS.pre, ROLLS.post, preOff, postOff);
  return { key: clipShipKey(matchId, SHIP_EVENT_IDS[i], ROLLS.pre + preOff, ROLLS.post + postOff, start), seconds: end - start };
}

/** A key's public base ("https://media.example" from "https://media.example/clips/…"). */
const baseOf = (r2Url, key) => (r2Url && r2Url.endsWith(`/${key}`) ? r2Url.slice(0, r2Url.length - key.length - 1) : null);

/** A file's duration through ffmpeg (FFMPEG, or `ffmpeg` on PATH), which reads https URLs too. */
async function probeDuration(source) {
  const ffmpeg = process.env.FFMPEG?.trim() || "ffmpeg";
  const stderr = await new Promise((resolve) => execFile(ffmpeg, ["-hide_banner", "-i", source], { maxBuffer: 8 * MIB }, (_e, _out, err) => resolve(String(err ?? ""))));
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
}

/** Each shipped file is public, an MP4 of a real size, and as long as its window. */
async function checkShippedFiles(clips, cuts) {
  for (const [i, clip] of clips.entries()) {
    const head = await fetch(clip.r2_url, { method: "HEAD" });
    expect(head.ok, `HEAD of clip ${i} answered ${head.status}`);
    expect((head.headers.get("content-type") ?? "").startsWith("video/mp4"), `clip ${i} is served as ${head.headers.get("content-type")}`);
    expect(Number(head.headers.get("content-length")) >= 4096, `clip ${i} is ${head.headers.get("content-length")} bytes`);
    const seconds = await probeDuration(clip.r2_url);
    expect(seconds !== null && Math.abs(seconds - cuts[i].seconds) <= 1, `clip ${i} probes at ${seconds} s, expected ${cuts[i].seconds} s`);
  }
}

/** Runs the renderer program on this machine against a queued job, the way the container would. */
async function runLocalRenderer(jobId, wsecret) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const script = path.resolve(here, "../workers/game-video-convert/src/render.ts");
  const env = {
    ...process.env,
    RENDER_JOB_ID: jobId,
    GAME_VIDEO_FN_URL: `${SUPABASE_URL}/functions/v1`,
    WORKER_SECRET: wsecret,
  };
  delete env.PORT;
  log(`local renderer: tsx ${path.relative(process.cwd(), script)} on job ${jobId.slice(0, 8)}… (FFMPEG=${process.env.FFMPEG ? "set" : "ffmpeg"})`);
  const started = Date.now();
  const code = await new Promise((resolve) => {
    const child = spawn("npx", ["tsx", script], { env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (c) => resolve(c ?? 1));
    child.on("error", () => resolve(1));
  });
  expect(code === 0, `the renderer exited with ${code}`);
  log(`local renderer finished in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  await sleep(500);
}

/** The renderer's side of the protocol, played by this script: take, progress, fake cuts PUT to the signed URLs, done. Returns the public base. */
async function renderAsWorker(jobId, wsecret, { cuts, videoId }) {
  const w = (body) => call(admin, body, { "x-worker-secret": wsecret });

  let r = await call(admin, { action: "render_take", jobId }, { "x-worker-secret": "wrong" });
  expect(!r.ok && r.error === "bad_worker_secret", `render_take with a wrong secret answered ${r.ok ? "ok" : r.error}`);
  r = await w({ action: "render_take", jobId });
  expect(r.ok, `render_take failed: ${r.error} ${JSON.stringify(r.extra ?? {})}`);
  const { attempt, kind, copies, clips, publicBase } = r.data;
  expect(attempt === 1 && kind === "ship" && clips.length === cuts.length && typeof publicBase === "string" && /^https:\/\//.test(publicBase), `render_take answered ${JSON.stringify({ attempt, kind, clips: clips.length, publicBase: typeof publicBase })}`);
  expect(copies[videoId]?.url, "render_take has no URL for the copy");
  clips.forEach((c, i) => expect(c.key === cuts[i].key && c.videoId === videoId && c.putUrl && Math.abs(c.end - c.start - cuts[i].seconds) < 1e-6, `render_take clip ${i}: ${JSON.stringify({ key: c.key, start: c.start, end: c.end })}, expected ${cuts[i].key}`));
  const head = await fetch(copies[videoId].url, { headers: { Range: "bytes=0-15" } });
  expect(head.status === 206, `the copy's signed URL answered ${head.status}`);
  log(`render_take: attempt 1, ${clips.length} clip${clips.length === 1 ? "" : "s"} planned with the expected keys, the copy's URL serves bytes`);

  r = await w({ action: "render_take", jobId });
  expect(!r.ok && r.error === "job_busy", `a second render_take answered ${r.ok ? "ok" : r.error}`);
  r = await w({ action: "render_progress", jobId, attempt, progress: 0.5 });
  expect(r.ok, `render_progress failed: ${r.error}`);
  let cur = await jobRow(jobId);
  expect(cur.status === "running" && Math.abs(Number(cur.progress) - 0.5) < 1e-6 && cur.attempt === 1 && cur.heartbeat_at, `job after progress: ${JSON.stringify(cur)}`);
  r = await w({ action: "render_progress", jobId, attempt: attempt + 1, progress: 0.6 });
  expect(!r.ok && r.error === "stale_attempt", `a stale attempt's progress answered ${r.ok ? "ok" : r.error}`);
  log("render_progress: 50% on the job; a second take is busy; a stale attempt is refused");

  // Stand-in cuts go to the presigned PUTs, with the content type that was signed; another type is refused.
  const fakeClip = randomBytes(8192);
  for (const c of clips) {
    const res = await fetch(c.putUrl, { method: "PUT", body: fakeClip, headers: { "content-type": "video/mp4" } });
    expect(res.ok, `PUT of a clip answered ${res.status}`);
  }
  const wrongType = await fetch(clips[0].putUrl, { method: "PUT", body: fakeClip, headers: { "content-type": "text/plain" } });
  expect(wrongType.status === 403, `a PUT with another content type answered ${wrongType.status}`);
  log("stand-in cuts PUT to the media bucket; a PUT with another content type is refused");

  const results = clips.map((c) => ({ matchId: c.matchId, eventId: c.eventId, key: c.key, ok: true }));
  r = await w({ action: "render_done", jobId, attempt, results });
  expect(r.ok && r.data.status === "done" && r.data.shipped === clips.length && r.data.failed === 0 && r.data.superseded === 0, `render_done answered ${r.ok ? JSON.stringify(r.data) : r.error + " " + JSON.stringify(r.extra ?? {})}`);
  r = await w({ action: "render_done", jobId, attempt, results });
  expect(r.ok && r.data.status === "done", `a repeated render_done answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  log(`render_done: done, ${clips.length} shipped; a repeat is harmless`);
  return publicBase;
}

/** A queued job gets its renderer: the real program (--local-render) or this script. Returns the public base when known. */
async function settleJob(jobId, wsecret, expectations) {
  if (CLOUD) {
    await waitForJob(jobId);
    return null;
  }
  if (LOCAL_RENDER) {
    await runLocalRenderer(jobId, wsecret);
    return null;
  }
  return renderAsWorker(jobId, wsecret, expectations);
}

async function shipPath(user, userId, videoId, wsecret) {
  const copy = await row(videoId);
  const copySeconds = Number(copy.duration_seconds) || 0;
  if (REAL_RENDER) expect(copySeconds >= 17, `--local-render needs a copy of at least 17 s (this one is ${copySeconds} s): use --file with a longer video`);

  // The tip-off at SHIP_TIP seconds into the copy, so the plays' windows sit inside it.
  let r = await call(user, { action: "sync_set", videoId, status: "manual", seconds: SHIP_TIP });
  expect(r.ok && r.data.seconds === SHIP_TIP, `sync_set (${SHIP_TIP}) answered ${r.ok ? JSON.stringify(r.data) : r.error}`);

  // Three plays after the anchor, with the columns listEventsForMatches reads.
  const events = SHIP_EVENT_IDS.map((eventId, i) => ({
    match_id: matchId,
    event_id: eventId,
    type: "2pt",
    sub_type: "jumpshot",
    period: 1,
    game_clock_time: `09:${String(59 - SHIP_PLAY_OFFSETS_S[i]).padStart(2, "0")}`,
    real_world_time: new Date(Date.parse(ANCHOR) + SHIP_PLAY_OFFSETS_S[i] * 1000).toISOString(),
    is_successful: 1,
    player: { playerId: `smoke-${i + 1}`, pno: i + 1, firstName: "Smoke", familyName: `Player ${i + 1}`, teamNumber: 1 },
    event_team: { teamCode: "SMK", teamName: "Cloud smoke", teamNumber: 1 },
    qualifiers: [],
  }));
  const evIns = await admin.from("play_by_play_events").insert(events);
  expect(!evIns.error, `events insert failed: ${evIns.error?.message}`);
  log(`sync_set manual ${SHIP_TIP}; three plays at +0, +2 and +4 s from the anchor`);

  // A club with the owner as coach and a second throwaway user as player: a share needs both.
  const org = await admin.from("organizations").insert({ name: `Cloud smoke club ${stamp}`, is_personal: false }).select("id").single();
  expect(!org.error, `org insert failed: ${org.error?.message}`);
  shipCleanup.orgId = org.data.id;
  const playerEmail = `delivered+cloud-smoke-${stamp}-player@resend.dev`;
  const playerPassword = randomBytes(18).toString("base64url");
  const created = await admin.auth.admin.createUser({ email: playerEmail, password: playerPassword, email_confirm: true });
  expect(!created.error, `createUser (player) failed: ${created.error?.message}`);
  const playerId = created.data.user.id;
  shipCleanup.playerId = playerId;
  const mem = await admin.from("org_memberships").insert([
    { user_id: userId, org_id: org.data.id, role: "coach" },
    { user_id: playerId, org_id: org.data.id, role: "player" },
  ]);
  expect(!mem.error, `memberships insert failed: ${mem.error?.message}`);
  const player = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const playerSignIn = await player.auth.signInWithPassword({ email: playerEmail, password: playerPassword });
  expect(!playerSignIn.error, `player sign in failed: ${playerSignIn.error?.message}`);

  // The playlist, its clips and a text card, as the owner writes them from the web; then a share, pending.
  const pl = await user.from("playlists").insert({ user_id: userId, name: "Cloud smoke playlist", org_id: org.data.id }).select("id").single();
  expect(!pl.error, `playlist insert failed: ${pl.error?.message}`);
  const playlistId = pl.data.id;
  shipCleanup.playlistId = playlistId;
  const items = await user.from("playlist_clips").insert([
    ...SHIP_EVENT_IDS.map((eventId, i) => ({ playlist_id: playlistId, item_type: "clip", match_id: matchId, event_id: eventId, position: i, pre_roll_offset: 0, post_roll_offset: 0 })),
    { playlist_id: playlistId, item_type: "text", item_id: randomUUID(), text_content: "Cloud smoke card", duration_seconds: 5, position: 3, match_id: null, event_id: null, pre_roll_offset: 0, post_roll_offset: 0 },
  ]);
  expect(!items.error, `clips insert failed: ${items.error?.message}`);
  const share = await user.from("playlist_user_shares").insert({ playlist_id: playlistId, user_id: playerId, shared_by: userId });
  expect(!share.error, `share insert failed: ${share.error?.message}`);
  expect((await shareRow(playlistId, playerId)).notified_at === null, "the share should stay pending while the playlist has no file");
  log("a club, a player, a playlist with 3 clips and a text card, shared to the player (pending: no file yet)");

  // Who may ship.
  r = await call(user, { action: "ship", playlistId: "not-a-uuid" });
  expect(!r.ok && r.error === "invalid_request", `ship with a bad id answered ${r.ok ? "ok" : r.error}`);
  r = await call(player, { action: "ship", playlistId });
  expect(!r.ok && r.error === "not_owner", `ship by the player answered ${r.ok ? "ok" : r.error}`);
  r = await call(user, { action: "ship", playlistId: randomUUID() });
  expect(!r.ok && r.error === "not_owner", `ship on an unknown playlist answered ${r.ok ? "ok" : r.error}`);
  log("ship: a bad id is invalid_request; a non-owner and an unknown playlist get not_owner");

  // The owner ships: three clips to cut, one queued job that waits for a renderer.
  r = await call(user, { action: "ship", playlistId });
  expect(r.ok, `ship failed: ${r.error} ${JSON.stringify(r.extra ?? {})}`);
  expect(r.data.total === 3 && r.data.status === "queued" && r.data.jobId && r.data.skipped.length === 0 && r.data.noCopy.length === 0 && r.data.requeued === false, `ship answered ${JSON.stringify(r.data)}`);
  const jobId = r.data.jobId;
  let job = await jobRow(jobId);
  expect(job.status === "queued" && job.attempt === 0 && job.heartbeat_at === null && job.user_id === userId, `job after ship: ${JSON.stringify(job)}`);
  const mine = await user.from("render_jobs").select(RENDER_JOB_SELECT).eq("playlist_id", playlistId).eq("kind", "ship").order("created_at", { ascending: false }).limit(1);
  expect(!mine.error && mine.data?.length === 1 && mine.data[0].id === jobId, `the owner's poll: ${mine.error?.message ?? JSON.stringify(mine.data)}`);
  const theirs = await player.from("render_jobs").select("id").eq("playlist_id", playlistId);
  expect(!theirs.error && theirs.data?.length === 0, `the player's poll: ${theirs.error?.message ?? JSON.stringify(theirs.data)}`);
  r = await call(user, { action: "ship", playlistId });
  expect(r.ok && r.data.jobId === jobId && r.data.status === "queued" && r.data.requeued === false && r.data.total === 3, `a second ship did not coalesce: ${JSON.stringify(r.data)}`);
  log(`ship: total 3, job ${jobId.slice(0, 8)}… queued and waiting (heartbeat NULL); the owner reads it, the player can't; a repeat coalesces`);

  // The render.
  const cuts = SHIP_EVENT_IDS.map((_, i) => expectedCut(i, SHIP_TIP));
  const publicBase = await settleJob(jobId, wsecret, { cuts, videoId });
  job = await jobRow(jobId);
  expect(job.status === "done" && job.result?.shipped === 3 && job.result?.total === 3 && job.result?.failed === 0 && job.result?.superseded === 0 && job.finished_at && Number(job.progress) === 1, `job after the render: ${JSON.stringify(job)}`);
  let clips = await clipRows(playlistId);
  const base = publicBase ?? baseOf(clips[0].r2_url, cuts[0].key);
  expect(base && /^https:\/\//.test(base), `clip 0 has no https r2_url ending in its key (${clips[0].r2_url ? "set" : "null"})`);
  clips.forEach((c, i) => expect(c.r2_url === `${base}/${cuts[i].key}`, `clip ${i} r2_url is not publicBase + ${cuts[i].key}`));
  if (REAL_RENDER) await checkShippedFiles(clips, cuts);
  expect((await shareRow(playlistId, playerId)).notified_at, "the pending share was not notified once the files landed");
  log(`render: done, 3 of 3 shipped, every r2_url is the public base + clipShipKey${REAL_RENDER ? ", every file GETs as video/mp4 and probes at 13 s" : ""}; the pending share is notified`);

  // Nothing left to cut.
  r = await call(user, { action: "ship", playlistId });
  expect(r.ok && r.data.total === 0 && r.data.status === "done" && r.data.skipped.length === 3 && r.data.skipped.every((s) => s.reason === "up_to_date"), `ship with everything shipped answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  log("ship again: total 0, three clips up to date");

  // A trim on one clip: only that clip is cut again, under a new key; its old file is left behind.
  const trimmed = clips[1];
  const upd = await user.from("playlist_clips").update({ pre_roll_offset: -2 }).eq("id", trimmed.id);
  expect(!upd.error, `trim update failed: ${upd.error?.message}`);
  r = await call(user, { action: "ship", playlistId });
  expect(r.ok && r.data.total === 1 && r.data.status === "queued" && r.data.jobId !== jobId, `ship after a trim answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  const trimCuts = [expectedCut(1, SHIP_TIP, -2, 0)];
  await settleJob(r.data.jobId, wsecret, { cuts: trimCuts, videoId });
  clips = await clipRows(playlistId);
  expect(clips[1].r2_url === `${base}/${trimCuts[0].key}`, `the trimmed clip's r2_url is not the new key ${trimCuts[0].key}`);
  expect(clips[0].r2_url === `${base}/${cuts[0].key}` && clips[2].r2_url === `${base}/${cuts[2].key}`, "the other clips changed");
  if (REAL_RENDER) await checkShippedFiles([clips[1]], trimCuts);
  log(`a trim: ship → total 1, the clip's file replaced under its new key${REAL_RENDER ? ` (${trimCuts[0].seconds} s)` : ""}; the others untouched`);

  // A sync change moves every play: the shared playlist's clips are cut again under keys with the new start.
  r = await call(user, { action: "sync_set", videoId, status: "manual", seconds: SHIP_TIP + 1 });
  expect(r.ok && r.data.seconds === SHIP_TIP + 1, `sync_set (${SHIP_TIP + 1}) answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  const live = await admin.from("render_jobs").select(RENDER_JOB_SELECT).eq("playlist_id", playlistId).in("status", ["queued", "running"]).maybeSingle();
  expect(!live.error && live.data?.status === "queued", `no queued job after the sync change: ${live.error?.message ?? JSON.stringify(live.data)}`);
  const movedCuts = [expectedCut(0, SHIP_TIP + 1), expectedCut(1, SHIP_TIP + 1, -2, 0), expectedCut(2, SHIP_TIP + 1)];
  await settleJob(live.data.id, wsecret, { cuts: movedCuts, videoId });
  clips = await clipRows(playlistId);
  clips.forEach((c, i) => expect(c.r2_url === `${base}/${movedCuts[i].key}`, `after the sync change clip ${i} r2_url is not ${movedCuts[i].key}`));
  if (REAL_RENDER) await checkShippedFiles(clips, movedCuts);
  log("a sync change: a job is queued for the shared playlist and all three clips are cut again with the new start in their keys");
  return { playlistId, orgId: org.data.id, player, tip: SHIP_TIP + 1, publicBase: base };
}

// ---------------------------------------------------------------------------
// Exporting: one MP4 of the playlist, rendered on the server (--export)
// ---------------------------------------------------------------------------

/**
 * The export's plays in playlist order (the card sits between 1003 and 1004):
 * the ship path's three (1002 trimmed 2 s earlier), then one at +45 s whose
 * window runs past a 52 s copy's end and one at +60 s that starts after it.
 */
const EXPORT_PLAYS = [
  { eventId: 1001, offset: 0, preOff: 0 },
  { eventId: 1002, offset: 2, preOff: -2 },
  { eventId: 1003, offset: 4, preOff: 0 },
  { eventId: 1004, offset: 45, preOff: 0 },
  { eventId: 1005, offset: 60, preOff: 0 },
];
const CARD_TEXT = "Cloud smoke card";
const CARD_SECONDS = 5;

/** What the export of the whole playlist holds for a tip-off at `tip` in a copy of `copySeconds`: the plan's rules (lib/export-plan.ts). */
function exportCuts(tip, copySeconds) {
  const kept = [];
  const dropped = [];
  for (const p of EXPORT_PLAYS) {
    const { start, end } = clipBounds(tip + p.offset, ROLLS.pre, ROLLS.post, p.preOff, 0);
    if (start >= copySeconds - 0.25) dropped.push({ matchId, eventId: p.eventId, reason: "past_end" });
    else kept.push({ eventId: p.eventId, start, end: Math.min(end, copySeconds) });
  }
  return { kept, dropped };
}

function runFfmpeg(argv) {
  const ffmpeg = process.env.FFMPEG?.trim() || "ffmpeg";
  return new Promise((resolve, reject) =>
    execFile(ffmpeg, argv, { maxBuffer: 8 * MIB }, (e, _out, err) => (e ? reject(new Error(`ffmpeg: ${String(err).slice(-300)}`)) : resolve())),
  );
}

/** A small real MP4 (2 s of test pattern and silence, faststart) and a JPEG, made with the local ffmpeg: what the played renderer uploads. */
async function makeStandIns(dir) {
  const mp4 = path.join(dir, "stand-in.mp4");
  const jpg = path.join(dir, "stand-in.jpg");
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=25", "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", mp4]);
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240", "-frames:v", "1", jpg]);
  return { mp4: readFileSync(mp4), jpg: readFileSync(jpg) };
}

/** A file's length and picture size through ffmpeg (a path or an https URL). */
async function probeVideo(source) {
  const ffmpeg = process.env.FFMPEG?.trim() || "ffmpeg";
  const stderr = await new Promise((resolve) => execFile(ffmpeg, ["-hide_banner", "-i", source], { maxBuffer: 8 * MIB }, (_e, _out, err) => resolve(String(err ?? ""))));
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const v = /Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(stderr);
  return {
    seconds: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    width: v ? Number(v[1]) : null,
    height: v ? Number(v[2]) : null,
  };
}

/** True when an MP4's `moov` box comes before its `mdat` (faststart), reading the top-level boxes. */
function moovFirst(bytes) {
  let at = 0;
  while (at + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    if (type === "moov") return true;
    if (type === "mdat") return false;
    if (size === 1) size = Number(bytes.readBigUInt64BE(at + 8));
    if (size < 8) return false;
    at += size;
  }
  return false;
}

/** The export plan render_take hands out, checked against what the rows say it must be. */
function checkExportPlan(plan, { aspect, purpose, watermark, rate, cuts, panned, videoId }) {
  expect(plan && plan.aspect === aspect && plan.purpose === purpose && plan.watermark === watermark && plan.rate === rate && plan.title === "Cloud smoke playlist", `export plan: ${JSON.stringify(plan && { aspect: plan.aspect, purpose: plan.purpose, watermark: plan.watermark, rate: plan.rate, title: plan.title })}`);
  // The playlist's order: the three shipped plays, the card, the two late ones; dropped plays leave no segment.
  const want = [];
  for (const item of [1001, 1002, 1003, "card", 1004, 1005]) {
    if (item === "card") {
      want.push({ kind: "card", durationSeconds: CARD_SECONDS, text: CARD_TEXT, card: null });
      continue;
    }
    const c = cuts.kept.find((k) => k.eventId === item);
    if (c) want.push({ kind: "clip", matchId, eventId: c.eventId, videoId, start: c.start, end: c.end, keyframes: aspect === "9:16" ? toSegmentKeyframes(c.eventId === 1001 ? panned : undefined, c.start, c.end) : null });
  }
  const got = plan.segments.map((s) => (s.kind === "clip" ? { ...s, start: Number(s.start.toFixed(6)), end: Number(s.end.toFixed(6)) } : s));
  const norm = want.map((s) => (s.kind === "clip" ? { ...s, start: Number(s.start.toFixed(6)), end: Number(s.end.toFixed(6)) } : s));
  expect(JSON.stringify(got) === JSON.stringify(norm), `export segments: ${JSON.stringify(got)}\n  expected ${JSON.stringify(norm)}`);
}

/** The renderer's side of an export, played by this script: take, progress with phases, the stand-ins PUT, done. Returns the plan. */
async function renderExportAsWorker(jobId, wsecret, expected, standIns) {
  const w = (body) => call(admin, body, { "x-worker-secret": wsecret });
  let r = await w({ action: "render_take", jobId });
  expect(r.ok, `render_take (export) failed: ${r.error} ${JSON.stringify(r.extra ?? {})}`);
  const { attempt, kind, copies, clips, export: plan } = r.data;
  expect(attempt === 1 && kind === "export" && Array.isArray(clips) && clips.length === 0, `render_take (export) answered ${JSON.stringify({ attempt, kind, clips: clips?.length })}`);
  checkExportPlan(plan, expected);
  if (expected.purpose === "download") {
    expect(plan.keys.video === gameVideoExportKey(expected.ref, expected.userId, jobId) && !plan.keys.poster && !plan.put.poster && plan.put.video, `download keys: ${JSON.stringify(plan.keys)}`);
  } else {
    const v = HIGHLIGHT_KEY_RE.exec(plan.keys.video);
    expect(v && v[1] === expected.userId && v[3] === "mp4" && plan.keys.poster === plan.keys.video.replace(/\.mp4$/, ".jpg") && plan.put.video && plan.put.poster, `share keys: ${JSON.stringify(plan.keys)}`);
  }
  const head = await fetch(copies[expected.videoId]?.url ?? "", { headers: { Range: "bytes=0-15" } });
  expect(head.status === 206, `the export's copy URL answered ${head.status}`);

  r = await w({ action: "render_progress", jobId, attempt, progress: 0.3, phase: "clips" });
  expect(r.ok, `render_progress (clips) failed: ${r.error}`);
  let cur = await jobRow(jobId);
  expect(cur.phase === "clips" && Math.abs(Number(cur.progress) - 0.3) < 1e-6, `job after progress: ${JSON.stringify({ phase: cur.phase, progress: cur.progress })}`);
  r = await w({ action: "render_progress", jobId, attempt, progress: 0.9, phase: "stitch" });
  expect(r.ok && (await jobRow(jobId)).phase === "stitch", `render_progress (stitch) failed: ${r.error}`);
  r = await w({ action: "render_progress", jobId, attempt, progress: 0.95, phase: "cutting" });
  expect(!r.ok && r.error === "invalid_request", `a phase the wire doesn't know answered ${r.ok ? "ok" : r.error}`);

  const res = await fetch(plan.put.video, { method: "PUT", body: standIns.mp4, headers: { "content-type": "video/mp4" } });
  expect(res.ok, `PUT of the export answered ${res.status}`);
  const wrongType = await fetch(plan.put.video, { method: "PUT", body: standIns.mp4, headers: { "content-type": "text/html" } });
  expect(wrongType.status === 403, `a PUT of the export with another content type answered ${wrongType.status}`);
  if (plan.put.poster) {
    const pres = await fetch(plan.put.poster, { method: "PUT", body: standIns.jpg, headers: { "content-type": "image/jpeg" } });
    expect(pres.ok, `PUT of the poster answered ${pres.status}`);
  }
  r = await w({ action: "render_progress", jobId, attempt, progress: 0.99, phase: "upload" });
  expect(r.ok, `render_progress (upload) failed: ${r.error}`);

  const done = { action: "render_done", jobId, attempt, results: [], export: { sizeBytes: standIns.mp4.length, durationSeconds: 2, posterOk: !!plan.put.poster } };
  r = await w(done);
  expect(r.ok && r.data.status === "done", `render_done (export) answered ${r.ok ? JSON.stringify(r.data) : r.error + " " + JSON.stringify(r.extra ?? {})}`);
  r = await w(done);
  expect(r.ok && r.data.status === "done", `a repeated render_done (export) answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
  log(`render (played): take hands out the expected ${plan.segments.length} segments at ${plan.rate} fps with ${expected.purpose === "download" ? "a private PUT" : "a video and a poster PUT"}; phases clips → stitch → upload land on the job, an unknown one is refused; the PUT's content type is signed; done (and again)`);
  return plan;
}

/** An export job gets its renderer: the real program (--local-render) or this script. Returns the plan when this script played it. */
async function settleExport(jobId, wsecret, expected, standIns) {
  if (CLOUD) {
    await waitForJob(jobId);
    return null;
  }
  if (LOCAL_RENDER) {
    await runLocalRenderer(jobId, wsecret);
    return null;
  }
  return renderExportAsWorker(jobId, wsecret, expected, standIns);
}

async function exportPath(user, userId, videoId, wsecret, { playlistId, orgId, player, tip, publicBase }) {
  const copy = await row(videoId);
  const copySeconds = Number(copy.duration_seconds);
  const rate = exportFrameRate(copy.fps === null ? null : Number(copy.fps));
  const ref = copy.storage_key.split("/")[0];
  const cuts = exportCuts(tip, copySeconds);
  const work = mkdtempSync(path.join(tmpdir(), "game-video-smoke-"));
  try {
    const standIns = REAL_RENDER ? null : await makeStandIns(work);

    // Two more plays after the card, and a pan on the first clip (absolute video seconds, as the desktop stores it).
    const more = EXPORT_PLAYS.slice(3).map((p, i) => ({
      match_id: matchId,
      event_id: p.eventId,
      type: "2pt",
      sub_type: "jumpshot",
      period: 1,
      game_clock_time: `09:${String(10 - i).padStart(2, "0")}`,
      real_world_time: new Date(Date.parse(ANCHOR) + p.offset * 1000).toISOString(),
      is_successful: 1,
      player: { playerId: `smoke-${p.eventId}`, pno: 10 + i, firstName: "Smoke", familyName: `Late ${i + 1}`, teamNumber: 1 },
      event_team: { teamCode: "SMK", teamName: "Cloud smoke", teamNumber: 1 },
      qualifiers: [],
    }));
    const evIns = await admin.from("play_by_play_events").insert(more);
    expect(!evIns.error, `late events insert failed: ${evIns.error?.message}`);
    const items = await user.from("playlist_clips").insert(
      EXPORT_PLAYS.slice(3).map((p, i) => ({ playlist_id: playlistId, item_type: "clip", match_id: matchId, event_id: p.eventId, position: 4 + i, pre_roll_offset: 0, post_roll_offset: 0 })),
    );
    expect(!items.error, `late clips insert failed: ${items.error?.message}`);
    const first = clipBounds(tip, ROLLS.pre, ROLLS.post, 0, 0);
    const pan = [{ t: first.start + 2, cx: 0.3 }, { t: first.end - 2, cx: 0.7 }];
    const panned = await user.from("playlist_clips").update({ crop_keyframes: pan }).eq("playlist_id", playlistId).eq("event_id", 1001);
    expect(!panned.error, `pan update failed: ${panned.error?.message}`);
    const { data: cardRow } = await admin.from("playlist_clips").select("item_id").eq("playlist_id", playlistId).eq("item_type", "text").single();
    log(`two more plays (+45 s, +60 s; the copy is ${copySeconds.toFixed(1)} s) and a pan on the first clip`);

    // Who may export, and on which plan.
    const ex = (client, body) => call(client, { action: "export", playlistId, ...body });
    let r = await ex(user, { aspect: "4:3", purpose: "download" });
    expect(!r.ok && r.error === "invalid_request", `export with a bad aspect answered ${r.ok ? "ok" : r.error}`);
    r = await ex(user, { aspect: "16:9", purpose: "download", selection: [] });
    expect(!r.ok && r.error === "invalid_request", `export with an empty selection answered ${r.ok ? "ok" : r.error}`);
    r = await ex(player, { aspect: "16:9", purpose: "download" });
    expect(!r.ok && r.error === "not_owner", `export by the player answered ${r.ok ? "ok" : r.error}`);
    r = await call(user, { action: "export", playlistId: randomUUID(), aspect: "16:9", purpose: "download" });
    expect(!r.ok && r.error === "not_owner", `export of an unknown playlist answered ${r.ok ? "ok" : r.error}`);
    r = await ex(user, { aspect: "16:9", purpose: "download" });
    expect(!r.ok && r.error === "upgrade_required", `export in a free club answered ${r.ok ? "ok" : r.error}`);
    const personal = await user.rpc("ensure_personal_org");
    expect(!personal.error && personal.data, `ensure_personal_org failed: ${personal.error?.message}`);
    const own = await user.from("playlists").insert({ user_id: userId, name: "Cloud smoke personal", org_id: personal.data }).select("id").single();
    expect(!own.error, `personal playlist insert failed: ${own.error?.message}`);
    const ownClip = await user.from("playlist_clips").insert({ playlist_id: own.data.id, item_type: "clip", match_id: matchId, event_id: 1001, position: 0, pre_roll_offset: 0, post_roll_offset: 0 });
    expect(!ownClip.error, `personal clip insert failed: ${ownClip.error?.message}`);
    r = await call(user, { action: "export", playlistId: own.data.id, aspect: "9:16", purpose: "share" });
    expect(!r.ok && r.error === "upgrade_required", `export in a free personal space answered ${r.ok ? "ok" : r.error}`);
    await admin.from("playlists").delete().eq("id", own.data.id);
    const pro = await admin.from("organizations").update({ plan_tier: "pro" }).eq("id", orgId);
    expect(!pro.error, `plan update failed: ${pro.error?.message}`);
    r = await ex(user, { aspect: "16:9", purpose: "download", selection: [`text:${cardRow.item_id}`] });
    expect(!r.ok && r.error === "nothing_to_export", `export of a card alone answered ${r.ok ? "ok" : r.error}`);
    log("export: a bad aspect or an empty selection is invalid_request; the player and an unknown playlist get not_owner; a free club and a free personal space get upgrade_required; the club goes Pro; a card alone is nothing_to_export");

    // A download, 16:9, the wordmark left off (Pro may).
    const keptClips = cuts.kept.length;
    r = await ex(user, { aspect: "16:9", purpose: "download", watermark: false });
    expect(r.ok, `export (download) failed: ${r.error} ${JSON.stringify(r.extra ?? {})}`);
    expect(r.data.jobId && r.data.status === "queued" && r.data.reused === false && r.data.clips === keptClips && r.data.cards === 1 && r.data.noCopy.length === 0 && r.data.watermark === false, `export (download) answered ${JSON.stringify(r.data)}`);
    expect(JSON.stringify(r.data.dropped) === JSON.stringify(cuts.dropped), `export (download) dropped ${JSON.stringify(r.data.dropped)}, expected ${JSON.stringify(cuts.dropped)}`);
    const downloadId = r.data.jobId;
    r = await ex(user, { aspect: "16:9", purpose: "download" });
    expect(r.ok && r.data.jobId === downloadId && r.data.watermark === false, `a second download did not land on the live one: ${JSON.stringify(r.data ?? r.error)}`);
    const mine = await user.from("render_jobs").select(RENDER_JOB_SELECT).eq("id", downloadId).single();
    expect(!mine.error && mine.data.kind === "export" && mine.data.request?.purpose === "download" && mine.data.request?.watermark === false && typeof mine.data.request?.fingerprint === "string" && (CLOUD || mine.data.phase === null), `the owner's read of the export: ${mine.error?.message ?? JSON.stringify(mine.data)}`);
    log(`export (download, 16:9, no wordmark): job ${downloadId.slice(0, 8)}… queued with ${keptClips} clips and the card, ${cuts.dropped.length} dropped past the copy's end; a repeat lands on it; the owner reads it`);

    await settleExport(downloadId, wsecret, { aspect: "16:9", purpose: "download", watermark: false, rate, cuts, panned: pan, videoId, ref, userId }, standIns);
    let job = await jobRow(downloadId);
    const filename = exportFileName("Cloud smoke playlist", "16:9");
    expect(job.status === "done" && job.result?.purpose === "download" && job.result?.aspect === "16:9" && job.result?.watermark === false && job.result?.clips === keptClips && job.result?.cards === 1 && job.result?.filename === filename && job.result?.key === gameVideoExportKey(ref, userId, downloadId) && job.result?.sizeBytes >= 4096, `download job after the render: ${JSON.stringify(job)}`);

    const link = await call(user, { action: "export_link", jobId: downloadId });
    expect(link.ok && link.data.filename === filename && Date.parse(link.data.expiresAt) - Date.now() > 23 * 3600 * 1000, `export_link answered ${link.ok ? JSON.stringify({ filename: link.data.filename, expiresAt: link.data.expiresAt }) : link.error}`);
    const part = await fetch(link.data.url, { headers: { Range: "bytes=0-15" } });
    const disposition = part.headers.get("content-disposition") ?? "";
    expect(part.status === 206 && (part.headers.get("content-type") ?? "").startsWith("video/mp4") && /^attachment/.test(disposition) && disposition.includes(filename), `the download link answered ${part.status} ${part.headers.get("content-type")} "${disposition}"`);
    const firstBytes = Buffer.from(await part.arrayBuffer());
    if (standIns) expect(Buffer.compare(firstBytes, standIns.mp4.subarray(0, 16)) === 0, "the download's first bytes are not the uploaded file's");
    if (REAL_RENDER) {
      const whole = Buffer.from(await (await fetch(link.data.url)).arrayBuffer());
      const file = path.join(work, filename);
      writeFileSync(file, whole);
      const probed = await probeVideo(file);
      const want = cuts.kept.reduce((n, c) => n + (c.end - c.start), 0) + CARD_SECONDS;
      expect(probed.width === 1280 && probed.height === 720 && probed.seconds !== null && Math.abs(probed.seconds - want) <= 1 && moovFirst(whole), `the download probes ${JSON.stringify(probed)} (faststart ${moovFirst(whole)}), expected 1280x720 ≈ ${want.toFixed(1)} s`);
      log(`the rendered download: 1280x720, ${probed.seconds.toFixed(1)} s (≈ the clips + the card), moov before mdat`);
    }
    r = await call(player, { action: "export_link", jobId: downloadId });
    expect(!r.ok && r.error === "not_owner", `export_link by the player answered ${r.ok ? "ok" : r.error}`);
    const shipJob = await admin.from("render_jobs").select("id").eq("playlist_id", playlistId).eq("kind", "ship").limit(1).single();
    r = await call(user, { action: "export_link", jobId: shipJob.data.id });
    expect(!r.ok && r.error === "invalid_request", `export_link for a ship job answered ${r.ok ? "ok" : r.error}`);
    log(`export_link: a 24 h link that saves "${filename}" (206 for a range, Content-Disposition attachment); the player gets not_owner, a ship job invalid_request`);

    // A share, 9:16, with a content key: a highlight link; the same request reuses it.
    const contentKey = `smoke-${stamp}`;
    r = await ex(user, { aspect: "9:16", purpose: "share", contentKey, watermark: false });
    expect(r.ok && r.data.status === "queued" && r.data.reused === false && r.data.watermark === true && r.data.clips === keptClips, `export (share) answered ${r.ok ? JSON.stringify(r.data) : r.error + " " + JSON.stringify(r.extra ?? {})}`);
    const shareJobId = r.data.jobId;
    log(`export (share, 9:16): job ${shareJobId.slice(0, 8)}… queued, the wordmark forced on`);
    await settleExport(shareJobId, wsecret, { aspect: "9:16", purpose: "share", watermark: true, rate, cuts, panned: pan, videoId, ref, userId }, standIns);
    job = await jobRow(shareJobId);
    expect(job.status === "done" && job.result?.purpose === "share" && job.result?.shareId && job.result?.url?.endsWith(`/h/${job.result.shareId}`) && job.result?.clips === keptClips, `share job after the render: ${JSON.stringify(job)}`);
    const shareId = job.result.shareId;
    const { data: shareRow, error: shareError } = await admin.from("highlight_shares").select("*").eq("id", shareId).single();
    expect(!shareError && shareRow.user_id === userId && shareRow.playlist_id === playlistId && shareRow.aspect === "9:16" && shareRow.content_key === contentKey && shareRow.clip_count === keptClips && shareRow.title === "Cloud smoke playlist", `highlight_shares row: ${shareError?.message ?? JSON.stringify(shareRow)}`);
    expect(shareRow.r2_key === `highlights/${userId}/${shareId}.mp4` && shareRow.r2_url === `${publicBase}/${shareRow.r2_key}` && shareRow.poster_key === `highlights/${userId}/${shareId}.jpg` && shareRow.poster_url === `${publicBase}/${shareRow.poster_key}`, `highlight_shares files: ${JSON.stringify({ r2_url: shareRow.r2_url, poster_url: shareRow.poster_url })}`);
    const days = (Date.parse(shareRow.expires_at) - Date.now()) / 86400000;
    expect(days > 29.9 && days <= 30, `the link expires in ${days.toFixed(2)} days`);
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const pub = await anon.rpc("get_highlight_share", { p_id: shareId });
    expect(!pub.error && pub.data?.valid === true && pub.data.url === shareRow.r2_url && pub.data.poster_url === shareRow.poster_url, `get_highlight_share: ${pub.error?.message ?? JSON.stringify(pub.data)}`);
    const video = await fetch(shareRow.r2_url, { method: "HEAD" });
    const poster = await fetch(shareRow.poster_url, { method: "HEAD" });
    expect(video.ok && (video.headers.get("content-type") ?? "").startsWith("video/mp4") && poster.ok && (poster.headers.get("content-type") ?? "").startsWith("image/jpeg"), `the link's files answered ${video.status} ${video.headers.get("content-type")} / ${poster.status} ${poster.headers.get("content-type")}`);
    if (REAL_RENDER) {
      const probed = await probeVideo(shareRow.r2_url);
      const want = cuts.kept.reduce((n, c) => n + (c.end - c.start), 0) + CARD_SECONDS;
      expect(probed.width === 1080 && probed.height === 1920 && probed.seconds !== null && Math.abs(probed.seconds - want) <= 1, `the share probes ${JSON.stringify(probed)}, expected 1080x1920 ≈ ${want.toFixed(1)} s`);
      log(`the rendered share: 1080x1920, ${probed.seconds.toFixed(1)} s, with a JPEG poster`);
    }
    log(`the share: highlight_shares ${shareId.slice(0, 8)}… (9:16, the content key kept, 30 days), get_highlight_share is valid for anyone, the video and the poster are public`);

    r = await ex(user, { aspect: "9:16", purpose: "share", contentKey });
    expect(r.ok && r.data.reused === true && r.data.jobId === null && r.data.status === "done" && r.data.share?.shareId === shareId && r.data.share.url.endsWith(`/h/${shareId}`) && r.data.share.expiresAt, `the same share again answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
    r = await ex(user, { aspect: "9:16", purpose: "share", contentKey: `${contentKey}-other` });
    const otherKey = r.ok ? r.data.jobId : null;
    expect(r.ok && r.data.reused === false && otherKey, `a share of other content answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
    log("the same share request reuses the link (no job); another content key renders anew");

    // Cancelled while a renderer holds it: every later call of that renderer is answered cancelled.
    const w = (body) => call(admin, body, { "x-worker-secret": wsecret });
    if (CLOUD) {
      // The deployed renderer has it (or is about to): cancel, then it must stay cancelled.
      await sleep(8000);
      r = await call(player, { action: "render_cancel", jobId: otherKey });
      expect(!r.ok && r.error === "not_owner", `render_cancel by the player answered ${r.ok ? "ok" : r.error}`);
      r = await call(user, { action: "render_cancel", jobId: otherKey });
      expect(r.ok && r.data.status === "failed", `render_cancel answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
      await sleep(30000);
      job = await jobRow(otherKey);
      expect(job.status === "failed" && job.error === "cancelled", `the cancelled job 30 s later: ${JSON.stringify({ status: job.status, error: job.error })}`);
      log("render_cancel while the cloud renderer works: failed cancelled, and it stays so (the renderer stops at its next call)");
    } else {
    r = await w({ action: "render_take", jobId: otherKey });
    expect(r.ok && r.data.attempt === 1, `render_take (to cancel) failed: ${r.error}`);
    r = await call(player, { action: "render_cancel", jobId: otherKey });
    expect(!r.ok && r.error === "not_owner", `render_cancel by the player answered ${r.ok ? "ok" : r.error}`);
    r = await call(user, { action: "render_cancel", jobId: otherKey });
    expect(r.ok && r.data.status === "failed", `render_cancel answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
    r = await w({ action: "render_progress", jobId: otherKey, attempt: 1, progress: 0.5, phase: "clips" });
    expect(!r.ok && r.error === "cancelled" && r.status === 409, `render_progress after the cancel answered ${r.ok ? "ok" : `${r.status} ${r.error}`}`);
    r = await w({ action: "render_done", jobId: otherKey, attempt: 1, results: [], export: { sizeBytes: 9000, durationSeconds: 2, posterOk: false } });
    expect(!r.ok && r.error === "cancelled", `render_done after the cancel answered ${r.ok ? "ok" : r.error}`);
    r = await w({ action: "render_failed", jobId: otherKey, attempt: 1, error: "sigterm", retryable: true });
    expect(!r.ok && r.error === "cancelled", `render_failed after the cancel answered ${r.ok ? "ok" : r.error}`);
    job = await jobRow(otherKey);
    expect(job.status === "failed" && job.error === "cancelled" && job.finished_at, `the cancelled job: ${JSON.stringify(job)}`);
    r = await call(user, { action: "render_cancel", jobId: otherKey });
    expect(r.ok && r.data.status === "failed", `a second render_cancel answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
    log("render_cancel while a renderer holds the job: failed cancelled; its progress, done and failed calls get 409 cancelled; the player can't cancel; a repeat is harmless");
    }

    // A queued download of a selection, cancelled before any renderer took it.
    r = await ex(user, { aspect: "16:9", purpose: "download", selection: [`${matchId}:1001`, `text:${cardRow.item_id}`, "nope:1"] });
    expect(r.ok && r.data.status === "queued" && r.data.clips === 1 && r.data.cards === 1 && r.data.watermark === true && r.data.jobId !== downloadId, `export of a selection answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
    const selectionId = r.data.jobId;
    const asked = await jobRow(selectionId);
    expect(JSON.stringify(asked.request?.selection) === JSON.stringify([`${matchId}:1001`, `text:${cardRow.item_id}`, "nope:1"]), `the selection job's request: ${JSON.stringify(asked.request)}`);
    r = await call(user, { action: "render_cancel", jobId: selectionId });
    expect(r.ok && r.data.status === "failed", `render_cancel (queued) answered ${r.ok ? JSON.stringify(r.data) : r.error}`);
    r = await w({ action: "render_take", jobId: selectionId });
    expect(!r.ok && r.error === "wrong_status", `render_take of a cancelled job answered ${r.ok ? "ok" : r.error}`);
    log("a selection (1 clip, the card) exports with the wordmark on (Pro's default); cancelled while queued, no renderer can take it");

    // The download's file follows its row: deleting the row queues the key, and the purge deletes the object.
    const key = gameVideoExportKey(ref, userId, downloadId);
    const del = await admin.from("render_jobs").delete().eq("id", downloadId);
    expect(!del.error, `deleting the download's row failed: ${del.error?.message}`);
    const queued = await admin.from("game_video_deletions").select("storage_key").eq("storage_key", key);
    expect(!queued.error && queued.data?.length === 1, `the download's key was not queued: ${queued.error?.message ?? JSON.stringify(queued.data)}`);
    const p = await purge();
    expect(p.deleted >= 1 && p.refused === 0, `purge after the download's row went: ${JSON.stringify(p)}`);
    const gone = await fetch(link.data.url, { headers: { Range: "bytes=0-15" } });
    expect(gone.status === 404, `the deleted download still answers ${gone.status}`);
    r = await call(user, { action: "export_link", jobId: downloadId });
    expect(!r.ok && r.error === "export_expired", `export_link after the row went answered ${r.ok ? "ok" : r.error}`);
    log(`the download's row deleted: its key queued, the purge deleted the file (${JSON.stringify(p)}), the old link 404s, export_link says export_expired`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

let userId = null;
try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(!created.error, `createUser failed: ${created.error?.message}`);
  userId = created.data.user.id;
  log(`throwaway user created`);

  const ins = await admin.from("matches").insert({ id: matchId, user_id: userId, title: "Cloud smoke", league_id: "sweden-national-men" });
  expect(!ins.error, `match insert failed: ${ins.error?.message}`);
  log(`throwaway game ${matchId} created`);

  const user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const signIn = await user.auth.signInWithPassword({ email, password });
  expect(!signIn.error, `sign in failed: ${signIn.error?.message}`);

  const quota = await user.rpc("get_game_video_quota", { p_org_id: null });
  expect(!quota.error && quota.data?.enabled === true, `quota: ${quota.error?.message ?? JSON.stringify(quota.data)}`);
  log(`quota: ${quota.data.used} of ${quota.data.max_games} used on the ${quota.data.tier} tier`);

  if (BROWSER) {
    await browserPath(user, userId);
  } else {
    const file1 = randomBytes(SIZE);
    const video1 = await uploadCopy(user, file1, { label: "first copy" });
    await playAndCheck(user, file1, video1);

    let r = await call(user, { action: "begin", matchId, sizeBytes: SIZE, durationSeconds: 12.5, width: 1280, height: 720, fingerprintKey: "smoke-fp" });
    expect(!r.ok && r.error === "already_ready", `begin without replace answered ${r.ok ? "ok" : r.error}`);
    log("begin without replace: already_ready");

    const file2 = randomBytes(SIZE);
    const video2 = await uploadCopy(user, file2, { replace: true, label: "replacement" });
    expect(video2 !== video1, "replacement reused the old row");
    await playAndCheck(user, file2, video2);
    let p = await purge();
    expect(p.deleted === 1 && p.refused === 0, `purge after replacement: ${JSON.stringify(p)}`);
    log("replacement: the old copy was queued and purged");

    r = await call(user, { action: "remove", videoId: video2 });
    expect(r.ok, `remove failed: ${r.error}`);
    r = await call(user, { action: "play", matchId });
    expect(!r.ok && r.error === "not_found", `play after remove answered ${r.ok ? "ok" : r.error}`);
    log("remove: the copy is gone, play says not_found");

    const file3 = randomBytes(SIZE);
    const video3 = await uploadCopy(user, file3, { label: "third copy" });
    const del = await user.from("matches").delete().eq("id", matchId);
    expect(!del.error, `match delete by its owner failed: ${del.error?.message}`);
    p = await purge();
    expect(p.deleted === 1 && p.remaining === 0, `purge after match delete: ${JSON.stringify(p)}`);
    log(`deleting the game as its owner queued copy ${video3.slice(0, 8)}… and purge removed it`);
  }

  console.log("\nAll smoke steps passed.");
} catch (e) {
  if (!process.exitCode) {
    console.error(e);
    process.exitCode = 1;
  }
} finally {
  if (userId) {
    // The ship path's playlist (its clips, share and jobs follow), club (memberships follow) and player.
    if (shipCleanup.playlistId) await admin.from("playlists").delete().eq("id", shipCleanup.playlistId);
    if (shipCleanup.orgId) await admin.from("organizations").delete().eq("id", shipCleanup.orgId);
    if (shipCleanup.playerId) {
      const dp = await admin.auth.admin.deleteUser(shipCleanup.playerId);
      if (dp.error) console.error("cleanup: deleteUser (player) failed:", dp.error.message);
    }
    for (const id of matchIds) await admin.from("matches").delete().eq("id", id);
    const d = await admin.auth.admin.deleteUser(userId);
    if (d.error) console.error("cleanup: deleteUser failed:", d.error.message);
    try {
      const p = await purge();
      console.log(`cleanup: user and games deleted; purge → ${JSON.stringify(p)}`);
    } catch (e) {
      console.error("cleanup: purge failed:", e instanceof Error ? e.message : String(e));
    }
  }
}
