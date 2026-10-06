/**
 * Nightly tip-off job: find the Q1 tip-off of recent BasketTV replays and store it
 * as a shared sync hint, so a coach who links the downloaded game gets
 * "Tip-off found from an earlier import of this recording" at once.
 *
 *   npm run nightly-tipoff -- [--channels superettanherr,basketettan-dam] [--since-hours 72]
 *                              [--max 25] [--games slug,slug] [--dry-run] [--dump dir]
 *
 * Flags fall back to the env vars CHANNELS, SINCE_HOURS, MAX_GAMES, GAMES, DRY_RUN,
 * DUMP_DIR (the workflow sets the first five from its inputs). `--dump` writes every
 * game's readings to `<dir>/<slug>.json` so a hard case can be turned into a test. Required env: SUPABASE_URL,
 * SUPABASE_ANON_KEY, TIPOFF_BOT_EMAIL, TIPOFF_BOT_PASSWORD, BASKETTV_USERNAME,
 * BASKETTV_PASSWORD. Optional: FFMPEG (binary path).
 *
 * The bot is an ordinary Supabase user: detection goes through the deployed
 * `tipoff-detect` function (prompts, model, kill switch, logging) and hints through
 * `upsert_video_sync_hint`, exactly like the desktop app. Only the hourly rate limit
 * is lifted for it. Nothing here prints a token or a URL: this log is public.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PILOT_CHANNELS,
  gameUrl,
  selectGamesToProcess,
  toGame,
  type BaskettvGame,
  type RecordedRun,
  type RunStatus,
} from "@scoutable/shared/lib/baskettv";
import { runTipoffDetection, type DetectDeps, type Frame, type OverlayBox } from "@scoutable/shared/lib/tipoff-detect";
import { locateOverlay, readFrames } from "@scoutable/shared/lib/tipoff-detect-client";
import {
  FINGERPRINT_VERSION,
  dhashFromGray9x8,
  fingerprintKey,
  fingerprintOffsetsFor,
  type VideoFingerprint,
} from "@scoutable/shared/lib/video-fingerprint";
import { saveVideoSyncHint } from "@scoutable/shared/lib/video-sync-hints-db";
import { BaskettvError, downloadUrl, login, pastGames, watch } from "./baskettv-client.ts";
import { grabGray9x8, grabJpeg, grabRange, jpegSize, probe, type Probe } from "./ffmpeg.ts";
import { startRangeProxy } from "./range-proxy.ts";

// ── configuration ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && !argv[i + 1]?.startsWith("--") ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const env = (name: string) => process.env[name]?.trim() || undefined;
const list = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const channels = list(flag("channels") ?? env("CHANNELS")).length ? list(flag("channels") ?? env("CHANNELS")) : PILOT_CHANNELS;
const sinceHours = Number(flag("since-hours") ?? env("SINCE_HOURS") ?? 72);
const maxGames = Number(flag("max") ?? env("MAX_GAMES") ?? 25);
const only = list(flag("games") ?? env("GAMES"));
const dryRun = has("dry-run") || env("DRY_RUN") === "true";
const dumpDir = flag("dump") ?? env("DUMP_DIR");

function required(name: string): string {
  const v = env(name);
  if (!v) {
    console.error(`missing env ${name}`);
    process.exit(1);
  }
  return v;
}

/** Hide a value from the Actions log even if something downstream prints it. */
function mask(value: string) {
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${value}`);
}

/** Error text safe for a public log: no URLs, bounded length. */
const safeError = (e: unknown) =>
  String((e as Error)?.message ?? e)
    .replace(/https?:\/\/\S+/g, "<url>")
    .slice(0, 300);

// ── per-game pipeline ─────────────────────────────────────────────────────────
const WHOLE_WIDTH = 640;

/** Scoreboard crops read at native resolution (2× for < 720p sources), whole frames at 640 px. */
const outputWidth = (srcWidth: number, crop?: OverlayBox | null) => (!crop ? WHOLE_WIDTH : srcWidth >= 1280 ? WHOLE_WIDTH : Math.min(1920, Math.round(srcWidth * crop.w * 2)));

async function parallel<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 4): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function fingerprint(source: string, p: Probe): Promise<VideoFingerprint> {
  const offsetsS = fingerprintOffsetsFor(p.durationS);
  const hashes = await parallel(offsetsS, async (t) => dhashFromGray9x8(await grabGray9x8(source, t)));
  return { version: FINGERPRINT_VERSION, durationMs: p.durationMs, offsetsS, hashes, key: await fingerprintKey(p.durationMs, hashes) };
}

function detectDeps(supabase: SupabaseClient, source: string, p: Probe, log: (s: string) => void): DetectDeps {
  const toFrame = (t: number, jpeg: Buffer): Frame => ({ t, jpegBase64: jpeg.toString("base64"), ...jpegSize(jpeg) });
  return {
    grab: (times, o) => parallel(times, async (t) => toFrame(t, await grabJpeg(source, t, { width: outputWidth(p.width, o.crop), crop: o.crop }))),
    grabRange: async (startS, durationS, fps, o) =>
      (await grabRange(source, startS, durationS, fps, { width: outputWidth(p.width, o.crop), crop: o.crop })).map((f) => toFrame(f.t, f.jpeg)),
    read: async (frames, view) => {
      const res = await readFrames(supabase, { frames: frames.map((f) => ({ jpegBase64: f.jpegBase64 })), view, periodLengthS: 600 });
      if (!res.ok) throw new Error(`tipoff-detect: ${res.error}`);
      return res.data.readings;
    },
    locate: async (frames) => {
      const res = await locateOverlay(supabase, { frames: frames.map((f) => ({ jpegBase64: f.jpegBase64 })) });
      return res.ok && res.data.box ? { box: res.data.box, confidence: res.data.confidence } : null;
    },
    log,
  };
}

interface Outcome {
  game: BaskettvGame;
  status: RunStatus;
  mediaId?: string;
  tipoffVideoTime?: number | null;
  basis?: string;
  confidence?: number | null;
  hintId?: string | null;
  apiCalls?: number;
  frames?: number;
  bytesRead?: number;
  error?: string;
  wallS: number;
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<number> {
  const supabaseUrl = required("SUPABASE_URL");
  const anonKey = required("SUPABASE_ANON_KEY");
  const botEmail = required("TIPOFF_BOT_EMAIL");
  const botPassword = required("TIPOFF_BOT_PASSWORD");
  const btvUser = required("BASKETTV_USERNAME");
  const btvPassword = required("BASKETTV_PASSWORD");
  for (const s of [botPassword, btvPassword]) mask(s);

  console.log(`nightly-tipoff: channels=${channels.join(",")} since=${sinceHours}h max=${maxGames}${only.length ? ` games=${only.join(",")}` : ""}${dryRun ? " DRY RUN" : ""}`);

  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: true } });
  const signIn = await supabase.auth.signInWithPassword({ email: botEmail, password: botPassword });
  if (signIn.error) {
    console.error(`bot sign-in failed: ${signIn.error.message}`);
    return 1;
  }

  // Games on the channels, then what is left to do.
  const nowTs = Math.floor(Date.now() / 1000);
  const sinceTs = nowTs - sinceHours * 3600;
  const games: BaskettvGame[] = [];
  for (const channel of channels) {
    try {
      const raw = await pastGames(channel, only.length ? 0 : sinceTs);
      games.push(...raw.map((g) => toGame(g, channel)));
      console.log(`${channel}: ${raw.length} past games listed`);
    } catch (e) {
      console.error(`${channel}: listing failed (${safeError(e)})`);
      return 1;
    }
  }
  const slugs = games.map((g) => g.slug);
  const recorded = new Map<string, RecordedRun>();
  if (slugs.length) {
    const { data, error } = await supabase.rpc("list_baskettv_tipoff_runs", { p_slugs: slugs });
    if (error) {
      console.error(`list_baskettv_tipoff_runs failed: ${error.message}`);
      return 1;
    }
    for (const r of (data ?? []) as { game_slug: string; status: RunStatus; attempts: number }[]) recorded.set(r.game_slug, { status: r.status, attempts: r.attempts });
  }
  const todo = selectGamesToProcess(games, { nowTs, sinceTs, recorded, only: only.length ? only : undefined, max: maxGames });
  console.log(`${todo.length} game(s) to process (${recorded.size} already recorded)`);
  if (todo.length === 0) {
    summary([], dryRun);
    return 0;
  }

  let token: string;
  try {
    token = await login(btvUser, btvPassword);
    mask(token);
  } catch (e) {
    console.error(`BasketTV login failed (${safeError(e)})`);
    return 1;
  }
  const proxy = await startRangeProxy();
  const outcomes: Outcome[] = [];

  for (const game of todo) {
    const t0 = Date.now();
    const tag = `${game.slug} ${game.homeTeam ?? "?"}–${game.awayTeam ?? "?"} ${game.score ?? ""}`.trim();
    const log = (s: string) => console.log(`[${game.slug}] ${s}`);
    let localUrl: string | null = null;
    const out: Outcome = { game, status: "failed", wallS: 0 };
    try {
      const w = await watch(game.channel, game.slug);
      out.mediaId = w.id;
      if (!w.allow_download) throw new Error("download_disabled");
      const url = await downloadUrl(game.channel, w.id, token);
      mask(url);
      localUrl = proxy.register(url);
      const p = await probe(localUrl);
      if (!p) throw new Error("probe_failed");
      log(`${tag} | ${p.durationS.toFixed(0)} s ${p.width}x${p.height}`);

      const fp = await fingerprint(localUrl, p);
      const result = await runTipoffDetection(p.durationS, detectDeps(supabase, localUrl, p, log), { strategy: "crop" });
      if (dumpDir) {
        mkdirSync(dumpDir, { recursive: true });
        writeFileSync(join(dumpDir, `${game.slug}.json`), JSON.stringify({ slug: game.slug, durationS: p.durationS, ...result }, null, 1));
      }
      out.apiCalls = result.stats.apiCalls;
      out.frames = result.stats.frames;
      if (result.outcome === "found") {
        out.status = "found";
        out.tipoffVideoTime = result.estimate.seconds;
        out.basis = result.estimate.basis;
        out.confidence = result.estimate.confidence;
        if (!dryRun) out.hintId = await saveVideoSyncHint(supabase, { fp, tipoffVideoTime: result.estimate.seconds, method: "auto", confidence: result.estimate.confidence });
      } else if (result.outcome === "starts_after_tipoff") {
        out.status = "starts_after_tipoff";
        out.tipoffVideoTime = result.estimateS;
        out.basis = `starts after tip-off (${result.firstClock ?? "?"})`;
      } else if (result.outcome === "not_found") {
        out.status = "not_found";
      } else {
        throw new Error("cancelled");
      }
    } catch (e) {
      out.status = "failed";
      out.error = e instanceof BaskettvError ? `baskettv_${e.status}` : safeError(e);
    }
    if (localUrl) {
      out.bytesRead = proxy.stats(localUrl).fetchedBytes;
      proxy.release(localUrl);
    }
    out.wallS = Math.round((Date.now() - t0) / 1000);
    log(`${out.status}${out.tipoffVideoTime != null ? ` ${out.tipoffVideoTime} s` : ""}${out.basis ? ` (${out.basis})` : ""}${out.error ? ` ${out.error}` : ""} | ${((out.bytesRead ?? 0) / 1e6).toFixed(0)} MB, ${out.apiCalls ?? 0} calls, ${out.wallS} s`);
    if (!dryRun) {
      const { error } = await supabase.rpc("record_baskettv_tipoff_run", {
        p_game_slug: game.slug,
        p_channel: game.channel,
        p_league: game.league,
        p_media_id: out.mediaId ?? null,
        p_game_start_at: new Date(game.startAt * 1000).toISOString(),
        p_home_team: game.homeTeam,
        p_away_team: game.awayTeam,
        p_status: out.status,
        p_tipoff_video_time: out.tipoffVideoTime ?? null,
        p_basis: out.basis ?? null,
        p_confidence: out.confidence ?? null,
        p_hint_id: out.hintId ?? null,
        p_api_calls: out.apiCalls ?? null,
        p_frames: out.frames ?? null,
        p_bytes_read: out.bytesRead ?? null,
        p_error: out.error ?? null,
      });
      if (error) console.error(`[${game.slug}] record_baskettv_tipoff_run failed: ${error.message}`);
    }
    outcomes.push(out);
  }
  proxy.close();
  summary(outcomes, dryRun);
  return 0;
}

function summary(outcomes: Outcome[], dry: boolean) {
  const count = (s: RunStatus) => outcomes.filter((o) => o.status === s).length;
  const mb = outcomes.reduce((a, o) => a + (o.bytesRead ?? 0), 0) / 1e6;
  const calls = outcomes.reduce((a, o) => a + (o.apiCalls ?? 0), 0);
  const head = `${dry ? "Dry run: " : ""}${outcomes.length} game(s): ${count("found")} found, ${count("starts_after_tipoff")} start after the tip-off, ${count("not_found")} not found, ${count("failed")} failed · ${mb.toFixed(0)} MB read · ${calls} model calls`;
  const rows = outcomes.map((o) =>
    `| ${o.game.startAt ? new Date(o.game.startAt * 1000).toISOString().slice(0, 10) : ""} | [${o.game.homeTeam ?? "?"} – ${o.game.awayTeam ?? "?"}](${gameUrl(o.game.channel, o.game.slug)}) | ${o.game.score ?? ""} | ${o.status} | ${o.tipoffVideoTime ?? ""} | ${o.basis ?? ""} | ${((o.bytesRead ?? 0) / 1e6).toFixed(0)} | ${o.wallS} | ${o.error ?? ""} |`,
  );
  const md = ["## Nightly tip-off", "", head, "", "| date | game | score | status | tip-off (s) | basis | MB | s | error |", "|---|---|---|---|---|---|---|---|---|", ...rows].join("\n");
  console.log(`\n${head}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`nightly-tipoff crashed: ${safeError(e)}`);
    process.exit(1);
  },
);
