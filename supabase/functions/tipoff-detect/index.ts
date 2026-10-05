// Scoutable — tip-off detection Edge Function
// Reads scoreboard clocks from still frames with Claude so the desktop can
// find the second a game recording's Q1 clock starts. Stateless: the desktop
// schedules which frames to send (packages/shared/lib/tipoff-detect.ts); this
// function only turns frames into readings, or locates the scoreboard graphic.
// JWT verified by the platform (verify_jwt default) and again here.
//
//   POST { action: "read_frames", view: "whole"|"overlay", periodLengthS: 600, frames: [{ jpegBase64 }] }
//     → { readings: [{ index, clockVisible, clock, clockRunning, period, state, jumpBall }], usage }
//   POST { action: "locate_overlay", frames: [{ jpegBase64 }] }
//     → { found, box: { x, y, w, h } | null, confidence, elements, usage }
//
// Secrets: ANTHROPIC_API_KEY (required), TIPOFF_DETECT_MODEL (optional model id).
// Kill switch: app_config.tipoff_detect_enabled = 'false' → 503 detection_disabled.
// Rate limit: 60 calls per user per hour, counted in video_sync_detect_runs.
// Deploy by name: npx supabase functions deploy tipoff-detect

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.131.0/helpers/zod";
import { z } from "npm:zod@4.6.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("TIPOFF_DETECT_MODEL") || "claude-sonnet-5-5";

const MAX_FRAMES = 48;
const MAX_FRAME_BYTES = 150 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_CALLS_PER_HOUR = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey",
};

function err(status: number, token: string): Response {
  return new Response(JSON.stringify({ error: token }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const Reading = z.object({
  index: z.number().int(),
  clockVisible: z.boolean(),
  clock: z.string().nullable(),
  period: z.number().int().nullable(),
  state: z.enum(["pregame", "lineup", "in_play", "stoppage", "unknown"]),
  jumpBall: z.boolean().nullable(),
});
const Readings = z.object({ readings: z.array(Reading) });

const Locate = z.object({
  found: z.boolean(),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
  confidence: z.number(),
  elements: z.array(z.string()),
});

const SYSTEM = `You read still frames from basketball broadcasts and report what the scoreboard graphic shows.
Rules:
- The GAME CLOCK is the MM:SS countdown (10:00 at the start of a period, counting down; it may show tenths under a minute). It stalls at 10:00 before the tip-off and during stoppages.
- The SHOT CLOCK is a two-digit countdown (24, 14 ...) next to it. Never report the shot clock as the game clock.
- Report the game clock exactly as displayed (e.g. "10:00", "9:58", "0:45.3"), or null when no game clock is readable.
- period: the period shown ("1st" -> 1, "2nd" -> 2, "Q3" -> 3, "OT" -> 5), or null when not shown.
- state: pregame (warm-ups, shoot-around, empty court, lineups being announced), lineup (teams gathered at the centre circle or standing still right before the jump ball), in_play (live action), stoppage (free throws, timeout, huddle, dead ball), unknown.
- jumpBall: true only if the referee is tossing or holding the ball between two players at centre court.
Return exactly one reading per image, in the same order, with index = the image number minus one.`;

interface FrameIn {
  jpegBase64?: unknown;
}

/** Base64 of a JPEG (FF D8 FF) within the size cap, else a token naming the problem. */
function validateFrames(raw: unknown): { frames: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "invalid_frame" };
  if (raw.length > MAX_FRAMES) return { error: "too_many_frames" };
  const frames: string[] = [];
  for (const f of raw as FrameIn[]) {
    const b64 = f?.jpegBase64;
    if (typeof b64 !== "string" || b64.length < 8 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return { error: "invalid_frame" };
    if (b64.length * 0.75 > MAX_FRAME_BYTES) return { error: "frame_too_large" };
    const head = Uint8Array.from(atob(b64.slice(0, 8)), (c) => c.charCodeAt(0));
    if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return { error: "invalid_frame" };
    frames.push(b64);
  }
  return { frames };
}

function imageBlocks(frames: string[]) {
  const content: Anthropic.ContentBlockParam[] = [];
  frames.forEach((data, i) => {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  });
  return content;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return err(405, "method_not_allowed");

  if (!ANTHROPIC_API_KEY) {
    console.error("[tipoff-detect] ANTHROPIC_API_KEY is not set");
    return err(500, "server_misconfigured");
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return err(400, "payload_too_large");

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return err(401, "not_authenticated");

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return err(400, "payload_too_large");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return err(400, "invalid_json");
  }
  const action = body.action;
  if (action !== "read_frames" && action !== "locate_overlay") return err(400, "invalid_action");

  // Kill switch and per-user rate limit, both without a desktop release.
  const { data: cfg } = await admin.from("app_config").select("value").eq("key", "tipoff_detect_enabled").maybeSingle();
  if (cfg?.value === "false") return err(503, "detection_disabled");
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("video_sync_detect_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_CALLS_PER_HOUR) return err(429, "too_many_requests");

  const validated = validateFrames(body.frames);
  if ("error" in validated) return err(400, validated.error);
  const frames = validated.frames;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  const isHaiku = MODEL.includes("haiku");
  const effort = isHaiku ? {} : { effort: "low" as const };
  const t0 = Date.now();

  const logRun = async (outcome: string, usage?: { input_tokens: number; output_tokens: number }) => {
    const { error } = await admin.from("video_sync_detect_runs").insert({
      user_id: user.id,
      action,
      frame_count: frames.length,
      model: MODEL,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      latency_ms: Date.now() - t0,
      outcome,
    });
    if (error) console.error("[tipoff-detect] run log failed:", error.message);
  };

  try {
    if (action === "read_frames") {
      const view = body.view === "overlay" ? "overlay" : "whole";
      const periodLengthS = typeof body.periodLengthS === "number" && body.periodLengthS > 0 ? body.periodLengthS : 600;
      const instruction = view === "overlay"
        ? `These ${frames.length} images are crops of the scoreboard area of consecutive stills from one game (periods last ${periodLengthS / 60} minutes). Report the readings.`
        : `These ${frames.length} images are consecutive stills from one game broadcast (periods last ${periodLengthS / 60} minutes). Report the readings.`;
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        messages: [{ role: "user", content: [...imageBlocks(frames), { type: "text", text: instruction }] }],
        output_config: { format: zodOutputFormat(Readings), ...effort },
      });
      if (res.stop_reason === "refusal") { await logRun("model_refused", res.usage); return err(502, "model_refused"); }
      if (res.stop_reason === "max_tokens") { await logRun("model_truncated", res.usage); return err(502, "model_truncated"); }
      // Models occasionally repeat or add a reading: keep the first per index and require full coverage.
      const byIndex = new Map<number, z.infer<typeof Reading>>();
      for (const rd of res.parsed_output?.readings ?? []) if (!byIndex.has(rd.index)) byIndex.set(rd.index, rd);
      const ordered = frames.map((_, i) => byIndex.get(i)).map((rd, i) => (rd ? { ...rd, index: i, clockRunning: null } : null));
      if (ordered.some((rd) => rd === null)) { await logRun("parse_failed", res.usage); return err(502, "parse_failed"); }
      await logRun("ok", res.usage);
      return ok({
        readings: ordered,
        usage: { model: MODEL, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, latencyMs: Date.now() - t0 },
      });
    }

    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          ...imageBlocks(frames),
          { type: "text", text: "Find the on-screen scoreboard graphic (team names, score, game clock, period). Return its bounding box as fractions of the image width and height (x, y = top-left corner, w, h = size), found = false if no scoreboard graphic is burnt into the video, and list the elements you can see in it." },
        ],
      }],
      output_config: { format: zodOutputFormat(Locate), ...effort },
    });
    if (res.stop_reason === "refusal") { await logRun("model_refused", res.usage); return err(502, "model_refused"); }
    if (!res.parsed_output) { await logRun("parse_failed", res.usage); return err(502, "parse_failed"); }
    await logRun("ok", res.usage);
    return ok({
      ...res.parsed_output,
      usage: { model: MODEL, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, latencyMs: Date.now() - t0 },
    });
  } catch (e) {
    console.error("[tipoff-detect] model call failed:", e instanceof Error ? e.message : e);
    await logRun("api_error");
    return err(502, "model_error");
  }
});
