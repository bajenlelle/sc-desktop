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
//
// The browser path uploads an ORIGINAL to a source key, completes into
// `converting`, then either drives the job_* actions itself with the worker
// secret from app_config (so the function's converter side is checked
// without a converter), or spawns workers/game-video-convert/src/convert.ts
// against the row (--local-convert; needs FFMPEG, and BOT_EMAIL/BOT_PASSWORD
// for a real detection). With --file the real file is uploaded instead of
// random bytes, and the converter encodes it.
//
// Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_ANON_KEY (or
// NEXT_PUBLIC_SUPABASE_ANON_KEY) and SUPABASE_SERVICE_ROLE_KEY. Never prints
// a key, a token or a signed URL.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const BROWSER = args.includes("--browser");
const LOCAL_CONVERT = args.includes("--local-convert");
const fileArg = args.indexOf("--file") >= 0 ? args[args.indexOf("--file") + 1] : null;

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
  if (!LOCAL_CONVERT) expect(hints.data?.length === 1 && hints.data[0].method === "confirmed" && hints.data[0].tipoff_video_time === 341, `hints after sync_set: ${JSON.stringify(hints.data)}`);
  r = await call(user, { action: "retry_convert", videoId });
  expect(!r.ok && r.error === "wrong_status", `retry_convert on a ready row answered ${r.ok ? "ok" : r.error}`);
  log(`sync_set manual 341: the game follows${LOCAL_CONVERT ? "" : ", a confirmed hint is written"}; retry on a ready row is refused`);

  // A conversion that fails: one retryable attempt, then a final one, then the original is gone.
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
