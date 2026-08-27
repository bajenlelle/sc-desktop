// Scoutable — "Report a problem" Edge Function
// Called from all three apps via supabase.functions.invoke (JWT verified by
// the platform since verify_jwt defaults to true). Stores the report in
// feedback_reports (+ optional screenshot in the private feedback-screenshots
// bucket) and best-effort files a GitHub issue — the DB row is the source of
// truth, GitHub failures never fail the request.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
// Fine-grained PAT, Issues read/write on the app repo only.
const GITHUB_ISSUES_TOKEN = Deno.env.get("GITHUB_ISSUES_TOKEN") ?? "";
const GITHUB_REPO = Deno.env.get("GITHUB_ISSUES_REPO") ?? "bajenlelle/sc-desktop";
const SENTRY_ORG_SLUG = "scoutable";

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const MAX_REPORTS_PER_HOUR = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey",
};

interface ReportPayload {
  description?: string;
  app?: string;
  appVersion?: string;
  os?: string;
  route?: string;
  orgId?: string;
  sentryEventId?: string;
  screenshotBase64?: string; // raw base64, no data: prefix
}

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

  const jwt = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData?.user;
  if (userError || !user) return err(401, "not_authenticated");

  let payload: ReportPayload;
  try {
    payload = await req.json();
  } catch {
    return err(400, "invalid_json");
  }

  const description = (payload.description ?? "").trim();
  if (!description) return err(400, "description_required");
  if (description.length > 4000) return err(400, "description_too_long");

  const app = payload.app ?? "";
  if (!["desktop", "web", "mobile"].includes(app)) return err(400, "invalid_app");

  const appVersion = (payload.appVersion ?? "unknown").slice(0, 50);
  const os = payload.os?.slice(0, 200) ?? null;
  const route = payload.route?.slice(0, 300) ?? null;
  const sentryEventId = payload.sentryEventId?.slice(0, 64) ?? null;
  const orgId = payload.orgId ?? null;

  // Rate limit: protects GitHub and the DB from a stuck retry loop.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("feedback_reports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", hourAgo);
  if ((count ?? 0) >= MAX_REPORTS_PER_HOUR) return err(429, "too_many_reports");

  const reportId = crypto.randomUUID();

  // Optional screenshot → private bucket. Failure degrades to a report
  // without an image rather than rejecting the whole submission.
  let screenshotPath: string | null = null;
  if (payload.screenshotBase64) {
    try {
      const bytes = Uint8Array.from(atob(payload.screenshotBase64), (c) => c.charCodeAt(0));
      if (bytes.byteLength > MAX_SCREENSHOT_BYTES) return err(400, "screenshot_too_large");
      const path = `${reportId}.png`;
      const { error: uploadError } = await admin.storage
        .from("feedback-screenshots")
        .upload(path, bytes, { contentType: "image/png" });
      if (uploadError) console.error("screenshot upload failed:", uploadError.message);
      else screenshotPath = path;
    } catch {
      return err(400, "invalid_screenshot");
    }
  }

  const { error: insertError } = await admin.from("feedback_reports").insert({
    id: reportId,
    user_id: user.id,
    org_id: orgId,
    app,
    app_version: appVersion,
    os,
    route,
    description,
    sentry_event_id: sentryEventId,
    screenshot_path: screenshotPath,
  });
  if (insertError) {
    console.error("feedback insert failed:", insertError.message);
    return err(500, "insert_failed");
  }

  // Best-effort GitHub issue. Full detail is fine — the repo is private.
  let issueNumber: number | null = null;
  if (GITHUB_ISSUES_TOKEN) {
    try {
      let screenshotLine = "";
      if (screenshotPath) {
        const { data: signed } = await admin.storage
          .from("feedback-screenshots")
          .createSignedUrl(screenshotPath, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) screenshotLine = `**Screenshot (7-day link):** ${signed.signedUrl}\n`;
      }
      const sentryLine = sentryEventId
        ? `**Sentry event:** https://${SENTRY_ORG_SLUG}.sentry.io/issues/?query=id%3A${sentryEventId}\n`
        : "";

      const title = `[user report] ${description.slice(0, 60)}${description.length > 60 ? "…" : ""}`;
      const body = [
        `## User report`,
        ``,
        description,
        ``,
        `---`,
        `**App:** ${app} ${appVersion}`,
        os ? `**OS:** ${os}` : "",
        route ? `**Route:** ${route}` : "",
        `**User:** ${user.email ?? "unknown"} (\`${user.id}\`)`,
        orgId ? `**Org:** \`${orgId}\`` : "",
        sentryLine.trim(),
        screenshotLine.trim(),
        `**Report id:** \`${reportId}\` (feedback_reports / admin → Feedback)`,
      ].filter(Boolean).join("\n");

      const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_ISSUES_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body, labels: ["bug", "user-report", `app:${app}`] }),
      });
      if (ghRes.ok) {
        const issue = await ghRes.json();
        issueNumber = issue.number ?? null;
        await admin
          .from("feedback_reports")
          .update({ github_issue_number: issueNumber })
          .eq("id", reportId);
      } else {
        console.error("github issue create failed:", ghRes.status, await ghRes.text());
      }
    } catch (e) {
      console.error("github issue create threw:", e instanceof Error ? e.message : String(e));
    }
  }

  return new Response(JSON.stringify({ id: reportId, github_issue_number: issueNumber }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
