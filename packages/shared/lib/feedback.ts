/**
 * "Report a problem" submission, shared by all three apps.
 *
 * Reports go through the `report-issue` edge function (JWT-authed), which
 * stores them in `feedback_reports`, uploads the optional screenshot to a
 * private bucket, and best-effort files a GitHub issue. The user id comes
 * from the JWT server-side — it is never part of the payload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FeedbackReportPayload {
  description: string;
  app: "desktop" | "web" | "mobile";
  appVersion: string;
  os?: string;
  route?: string;
  orgId?: string;
  sentryEventId?: string;
  /** Raw base64 PNG (no data: prefix), ≤ 2 MB decoded. */
  screenshotBase64?: string;
}

export type FeedbackSubmitResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function submitFeedbackReport(
  supabase: SupabaseClient,
  payload: FeedbackReportPayload,
): Promise<FeedbackSubmitResult> {
  const { data, error } = await supabase.functions.invoke("report-issue", { body: payload });
  if (error) {
    // FunctionsHttpError carries the response; surface the snake token when present.
    let token = "request_failed";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        token = (await ctx.json())?.error ?? token;
      } catch {
        // keep generic token
      }
    }
    return { ok: false, error: token };
  }
  return { ok: true, id: (data as { id: string }).id };
}
