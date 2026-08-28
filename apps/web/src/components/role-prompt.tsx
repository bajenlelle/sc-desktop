"use client";

import { useAuth } from "@/components/auth-context";
import { setDeclaredRole } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";

/**
 * One-click coach/player question for accounts that skipped the signup
 * form's role choice (OAuth). Renders nothing once captured — which for
 * email signups and invite joins is always.
 */
export function RolePrompt() {
  const { profile, reloadProfile } = useAuth();

  if (!profile || profile.declaredRole != null) return null;

  function choose(role: "coach" | "player") {
    trackEvent("declared_role_selected", { role });
    setDeclaredRole(role)
      .then(() => reloadProfile())
      .catch(() => {});
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left">
      <span className="text-sm font-medium text-foreground">What describes you best?</span>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => choose("coach")}
          className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
        >
          <span className="font-medium text-foreground">Coach</span>
          <span className="block text-xs text-muted-foreground">I scout and analyze games</span>
        </button>
        <button
          type="button"
          onClick={() => choose("player")}
          className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
        >
          <span className="font-medium text-foreground">Player</span>
          <span className="block text-xs text-muted-foreground">I study my games and build highlights</span>
        </button>
      </div>
    </div>
  );
}
