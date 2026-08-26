import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createClient } from "@/lib/supabase/client";

const DELETE_ACCOUNT_URL = "https://app.scoutable.se/api/delete-account";

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string; orgName?: string };

/**
 * Full account erasure via the web app's privileged endpoint (same Bearer
 * pattern as billing.ts — the desktop bundle holds no service credentials).
 * Returns a structured error so the dialog can map tokens like 'last_admin'.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "unauthorized" };
  try {
    const res = await tauriFetch(DELETE_ACCOUNT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: (body.error as string) ?? "delete_failed",
      orgName: body.orgName as string | undefined,
    };
  } catch {
    return { ok: false, error: "network" };
  }
}

export function mapDeleteAccountError(result: { error: string; orgName?: string }): string {
  if (result.error === "unauthorized") return "Your session expired. Sign in again and retry.";
  if (result.error === "last_admin") {
    return `You're the only admin of ${result.orgName ?? "your club"}. Promote another admin or remove its members first.`;
  }
  if (result.error === "network") {
    return "Couldn't delete your account. Check your connection and try again.";
  }
  return "Couldn't delete your account. Try again, or contact support.";
}
