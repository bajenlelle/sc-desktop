// Scoutable — highlight framing Edge Function (2026-11-27, player highlights)
// Finds one player, the release of their shot and the rim in a clip's frames with Claude, so the desktop can crop
// the clip to 9:16 by itself (packages/shared/lib/highlight-framing.ts turns the answer into crop keyframes).
// Stateless: the desktop samples the frames (4 a second, 960 px) and says who the player is from the play-by-play.
// JWT verified by the platform (verify_jwt default) and again here.
//
//   POST { frames: [{ jpegBase64 }], target: "#78 Alex Berg of Fryshuset", context: "…play-by-play…", shot: true }
//     → { observation: { frames: [{ image, x, cameraCut }], releaseImage, rimX, madeImage, identity, note },
//         usage: { model, inputTokens, outputTokens, latencyMs, fallback } }
//
// Measured before it was built (tracking-spike/claude_report.md): with Claude Opus 5.5 the player stayed in the
// 9:16 window 100% of the time on 9 broadcast clips, at about $0.065 and 11 s per clip.
// Secrets: ANTHROPIC_API_KEY (required), HIGHLIGHT_FRAME_MODEL (optional model id).
// Kill switch: app_config.highlight_frame_enabled = 'false' → 503 framing_disabled.
// Daily limit per user: app_config.highlight_frame_daily_limit (calls in 24 h), counted in highlight_frame_runs.
// Deploy by name: npx -y supabase@2 functions deploy highlight-frame

import { createClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@0.131.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("HIGHLIGHT_FRAME_MODEL") || "claude-opus-5-5";

const MAX_FRAMES = 44;
const MAX_FRAME_BYTES = 200 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 1200;
const DEFAULT_DAILY_LIMIT = 80;

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

// The same question as the measured test (tracking-spike/claude_frame.py), field for field.
const FrameObs = z.object({
  image: z.number().int().describe("Image number as labelled, starting at 1"),
  x: z.number().nullable().describe(
    "Horizontal centre of the target player's body as a fraction of the image width (0 = left edge, 1 = right edge), or null if the player is not visible",
  ),
  cameraCut: z.boolean().describe(
    "True if this image comes from a different camera shot than the one before it (a hard cut, a replay angle or a graphic)",
  ),
});
const ClipObs = z.object({
  frames: z.array(FrameObs),
  releaseImage: z.number().int().nullable().describe(
    "Image where the ball leaves the target player's hands on the scoring shot (or the dunk), null if there is no shot by the target",
  ),
  rimX: z.number().nullable().describe(
    "Horizontal centre of the rim the shot goes to, as a fraction of the image width, in the release image; null if there is no shot",
  ),
  madeImage: z.number().int().nullable().describe("Image where the ball goes through the rim, null if not visible"),
  identity: z.enum(["sure", "likely", "unsure"]).describe("How sure you are that you followed the right person"),
  note: z.string().describe("One short sentence: how you recognised the player, and anything that made it hard"),
});

const SYSTEM = `You help frame basketball broadcast footage for a vertical (9:16) phone video that follows one player.
The images are consecutive frames from one broadcast clip, 0.25 seconds apart, in time order.
Find the target player in every image and report the horizontal centre of their body.
Use everything available: the jersey number when it is readable, team colour, hair, body build, position on court, who has the ball, and continuity from one frame to the next (players move at most a few percent of the width per frame unless the camera cuts).
When the target is hidden behind another player, give your best estimate if you can tell where they are, otherwise null.
Coordinates are fractions of the image width: 0 is the left edge, 1 is the right edge.`;

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

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u001f]/g, " ").trim();
  return s.length > 0 && s.length <= MAX_TEXT ? s : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return err(405, "method_not_allowed");

  if (!ANTHROPIC_API_KEY) {
    console.error("[highlight-frame] ANTHROPIC_API_KEY is not set");
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

  // Kill switch and per-user daily limit, both without a desktop release.
  const { data: cfgRows } = await admin.from("app_config").select("key, value").in("key", ["highlight_frame_enabled", "highlight_frame_daily_limit"]);
  const cfg = Object.fromEntries((cfgRows ?? []).map((r) => [r.key, r.value])) as Record<string, string | undefined>;
  if (cfg.highlight_frame_enabled === "false") return err(503, "framing_disabled");
  const limit = Number(cfg.highlight_frame_daily_limit) > 0 ? Number(cfg.highlight_frame_daily_limit) : DEFAULT_DAILY_LIMIT;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("highlight_frame_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", dayAgo);
  if ((count ?? 0) >= limit) return err(429, "too_many_requests");

  const validated = validateFrames(body.frames);
  if ("error" in validated) return err(400, validated.error);
  const frames = validated.frames;
  const target = cleanText(body.target);
  const context = cleanText(body.context);
  if (!target || !context) return err(400, "invalid_context");
  const shot = body.shot === true;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 1 });
  const t0 = Date.now();
  const logRun = async (outcome: string, usage?: { input_tokens: number; output_tokens: number }, fallback = false) => {
    const { error } = await admin.from("highlight_frame_runs").insert({
      user_id: user.id,
      frame_count: frames.length,
      model: MODEL,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
      latency_ms: Date.now() - t0,
      fallback,
      outcome,
    });
    if (error) console.error("[highlight-frame] run log failed:", error.message);
  };

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  frames.forEach((data, i) => {
    content.push({ type: "text", text: `Image ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  });
  content.push({
    type: "text",
    text: `${context}\nTarget: ${target}.\nThere are ${frames.length} images. Report the target's position in every image` +
      (shot ? ", the release image of the scoring shot and the rim's position." : "."),
  });

  try {
    // Server-side fallback: if the model declines for policy reasons, the API finishes the request on its default
    // fallback model inside the same call (logged as fallback = true).
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content }],
      output_config: { format: betaZodOutputFormat(ClipObs), effort: "medium" },
    });
    const fallback = (res.usage.iterations ?? []).some((it: { type?: string }) => it.type === "fallback_message");
    if (res.stop_reason === "refusal") { await logRun("model_refused", res.usage, fallback); return err(502, "model_refused"); }
    if (res.stop_reason === "max_tokens") { await logRun("model_truncated", res.usage, fallback); return err(502, "model_truncated"); }
    const observation = res.parsed_output;
    if (!observation) { await logRun("parse_failed", res.usage, fallback); return err(502, "parse_failed"); }
    await logRun("ok", res.usage, fallback);
    return ok({
      observation,
      usage: {
        model: res.model ?? MODEL,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        latencyMs: Date.now() - t0,
        fallback,
      },
    });
  } catch (e) {
    console.error("[highlight-frame] model call failed:", e instanceof Error ? e.message : e);
    // The account can't call the API at all (no credit, a revoked key): every other play would fail the same way, so
    // say so once and let the app stop asking. Anything else is this one call.
    if (e instanceof Anthropic.APIError && (e.status === 401 || e.status === 403 || (e.status === 400 && /credit balance/i.test(e.message)))) {
      await logRun("unavailable");
      return err(503, "framing_unavailable");
    }
    await logRun("api_error");
    return err(502, "model_error");
  }
});
