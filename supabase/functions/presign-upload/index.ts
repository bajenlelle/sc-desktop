// Scoutable — R2 presigned-upload Edge Function
// Called from the desktop app via supabase.functions.invoke (JWT verified by
// the platform since verify_jwt defaults to true). The only place R2 write
// credentials exist client-reachably: the desktop used to embed VITE_R2_*
// secrets in the bundle, which both broke released builds (release.yml never
// injected them) and would have shipped a write-capable key in every install.
// Instead the client submits the object key it wants to PUT, this function
// authorizes it, and returns a short-lived SigV4 presigned URL.
//
//   { key, contentType } → { uploadUrl, publicUrl }
//
// Setup after deployment:
//   1. npx supabase functions deploy presign-upload
//   2. Set function secrets (Supabase dashboard or `npx supabase secrets set`):
//        R2_ENDPOINT          https://<account>.r2.cloudflarestorage.com
//        R2_ACCESS_KEY_ID     scoped R2 API token: Object Read & Write on the
//        R2_SECRET_ACCESS_KEY   media bucket only (NOT an account-wide token)
//        R2_BUCKET            bucket name
//        R2_PUBLIC_URL        public base URL (persisted verbatim into DB rows)
//   3. Rotate/revoke the old broad R2 token that lived in developer .env files.
//
// No rate limiting in v1: authorization already bounds every caller to keys
// addressing their own content (clip keys are deterministic, so re-presigning
// overwrites the caller's own objects; highlight keys are per-user UUIDs).
// If abuse appears, the house pattern is counting rows per user per window
// (see report-issue's MAX_REPORTS_PER_HOUR) against highlight_shares.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const R2_ENDPOINT = Deno.env.get("R2_ENDPOINT") ?? "";
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID") ?? "";
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "";
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "";
// Trailing slash would double-slash every persisted public URL.
const R2_PUBLIC_URL = (Deno.env.get("R2_PUBLIC_URL") ?? "").replace(/\/$/, "");

/** Signature lifetime. Presign happens immediately before each PUT, and only
 * the request START must fall inside the window, so 15 min is generous. */
const EXPIRES_SECONDS = 900;

// Key shapes are pinned by golden tests in packages/shared — keep in sync,
// never loosen:
//   clipShipKey        → lib/__tests__/clip-timing.test.ts
//                        ("clips/m1/42_pre5.0_post3.0.mp4")
//   highlightShareKeys → lib/__tests__/highlight-shares-db.test.ts
// matchId is matches.id: a Genius numeric string, a legacy gameUuid, or
// "demo-<uuid>". eventId is a number; pre/post are toFixed(1) of totals the
// desktop UI clamps >= 0.
const CLIP_KEY = /^clips\/([A-Za-z0-9-]{1,64})\/\d{1,12}_pre\d{1,4}\.\d_post\d{1,4}\.\d\.mp4$/;
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const HIGHLIGHT_KEY = new RegExp(`^highlights/(${UUID})/${UUID}\\.(mp4|jpg)$`);

/** The extension dictates the only Content-Type we will sign for that key. */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  jpg: "image/jpeg",
};

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return err(405, "method_not_allowed");

  // Fail closed: a half-configured signer must refuse, not mint dead URLs.
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL) {
    console.error("[presign-upload] R2_* secrets are not fully configured — refusing all requests");
    return err(500, "server_misconfigured");
  }

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData?.user) return err(401, "not_authenticated");
  const user = userData.user;

  let payload: { key?: string; contentType?: string };
  try {
    payload = await req.json();
  } catch {
    return err(400, "invalid_json");
  }
  const key = typeof payload.key === "string" ? payload.key : "";
  const contentType = typeof payload.contentType === "string" ? payload.contentType : "";

  const clipMatch = CLIP_KEY.exec(key);
  const highlightMatch = clipMatch ? null : HIGHLIGHT_KEY.exec(key);
  if (!clipMatch && !highlightMatch) return err(400, "invalid_key");

  const ext = key.slice(key.lastIndexOf(".") + 1);
  if (contentType !== CONTENT_TYPE_BY_EXT[ext]) return err(400, "invalid_content_type");

  if (clipMatch) {
    // Clip keys are guessable by construction, so authorization is the whole
    // point: only the match owner or a coach/admin of the match's org may
    // (over)write its clip objects. The org branch is deliberate — the match
    // library is org-shared, so coach B ships playlists built on coach A's
    // matches. Players never pass. 403 also for nonexistent matches so the
    // response doesn't leak which ids exist.
    const matchId = clipMatch[1];
    const { data: match, error: matchError } = await admin
      .from("matches")
      .select("user_id, org_id")
      .eq("id", matchId)
      .maybeSingle();
    if (matchError) return err(500, "lookup_failed");
    if (!match) return err(403, "not_authorized");

    let allowed = match.user_id === user.id;
    if (!allowed && match.org_id) {
      const { data: mem, error: memError } = await admin
        .from("org_memberships")
        .select("role")
        .eq("user_id", user.id)
        .eq("org_id", match.org_id)
        .maybeSingle();
      if (memError) return err(500, "lookup_failed");
      allowed = mem?.role === "admin" || mem?.role === "coach";
    }
    if (!allowed) return err(403, "not_authorized");
  } else if (highlightMatch) {
    // Highlight keys live under the caller's own uid — nothing else to check
    // (the shareId half is a client-generated UUID by design, so the key and
    // the highlight_shares row agree before the upload starts).
    if (highlightMatch[1].toLowerCase() !== user.id.toLowerCase()) {
      return err(403, "not_authorized");
    }
  }

  const r2 = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${key}`);
  url.searchParams.set("X-Amz-Expires", String(EXPIRES_SECONDS));
  // Content-Type goes into the signed headers: the URL can only ever upload
  // the declared type, so nobody hosts text/html on the public media domain.
  // allHeaders is required — aws4fetch treats content-type as unsignable by
  // default, which silently drops it from X-Amz-SignedHeaders (smoke-tested:
  // without it R2 accepts any content type).
  const signed = await r2.sign(
    new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }),
    { aws: { signQuery: true, allHeaders: true } },
  );

  return new Response(
    JSON.stringify({ uploadUrl: signed.url, publicUrl: `${R2_PUBLIC_URL}/${key}` }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
