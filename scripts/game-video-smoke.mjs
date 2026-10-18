#!/usr/bin/env node
// Smoke test for the `game-video` edge function against a real project
// (staging), end to end through R2: a throwaway user and game are created
// with the service role, a 48 MiB file goes up in two parts with a resume in
// between, the copy is replaced, played by byte range, removed, and the
// deletion queue is purged. Everything it creates is deleted at the end.
//
//   node --env-file=apps/web/.env.staging scripts/game-video-smoke.mjs
//
// Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_ANON_KEY (or
// NEXT_PUBLIC_SUPABASE_ANON_KEY) and SUPABASE_SERVICE_ROLE_KEY. Never prints
// a key, a token or a signed URL.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

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
const email = `cloud-smoke-${stamp}@scoutable.se`;
const password = randomBytes(18).toString("base64url");
const matchId = `smoke-${stamp}`;

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

/** supabase.functions.invoke with the function's { error } token surfaced. */
async function call(client, body) {
  const { data, error } = await client.functions.invoke("game-video", { body });
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

async function playAndCheck(user, file, expectedVideoId) {
  const r = await call(user, { action: "play", matchId });
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
  expect(Buffer.compare(tailBytes, file.subarray(SIZE - 16)) === 0, "last 16 bytes differ (part 2 wrong?)");
  log("play: 12 h URL, byte ranges at both ends match the file");
}

/** The nightly purge, called the way pg_cron calls it: with the shared secret from app_config. */
let purgeSecret = null;
async function purge() {
  if (purgeSecret === null) {
    const { data, error } = await admin.from("app_config").select("value").eq("key", "game_video_purge_secret").maybeSingle();
    expect(!error && data?.value, "app_config.game_video_purge_secret is not set on this project");
    purgeSecret = data.value;
  }
  const { data, error } = await admin.functions.invoke("game-video", { body: { action: "purge" }, headers: { "x-purge-secret": purgeSecret } });
  if (error) {
    let token = "request_failed";
    try {
      token = (await error.context?.json())?.error ?? token;
    } catch {
      /* keep generic */
    }
    fail(`purge failed: ${token}`);
  }
  return data;
}

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

  console.log("\nAll smoke steps passed.");
} catch (e) {
  if (!process.exitCode) {
    console.error(e);
    process.exitCode = 1;
  }
} finally {
  if (userId) {
    await admin.from("matches").delete().eq("id", matchId);
    const d = await admin.auth.admin.deleteUser(userId);
    if (d.error) console.error("cleanup: deleteUser failed:", d.error.message);
    try {
      const p = await purge();
      console.log(`cleanup: user and game deleted; purge → ${JSON.stringify(p)}`);
    } catch (e) {
      console.error("cleanup: purge failed:", e instanceof Error ? e.message : String(e));
    }
  }
}
