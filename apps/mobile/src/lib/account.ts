import { supabase } from "@/lib/supabase";

// Overridable for local testing (EXPO_PUBLIC_API_URL=http://<lan-ip>:3000).
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://app.scoutable.se";

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string; orgName?: string };

/**
 * Full account erasure via the web app's privileged endpoint (Bearer token,
 * same cross-app pattern the desktop app uses for billing).
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "unauthorized" };
  try {
    const res = await fetch(`${API_URL}/api/delete-account`, {
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
