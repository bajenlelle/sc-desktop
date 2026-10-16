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

  const choices = [
    ["coach", "Coach", "I scout and analyze games"],
    ["player", "Player", "I study my games and build highlights"],
  ] as const;

  return (
    <div className="flex w-full flex-col gap-2 rounded-window bg-fill-1 p-3 text-left">
      <span className="text-callout font-medium text-foreground">What describes you best?</span>
      <div className="grid grid-cols-2 gap-2">
        {choices.map(([role, label, hint]) => (
          <button
            key={role}
            type="button"
            onClick={() => choose(role)}
            className="rounded-md bg-card px-3 py-2 text-left ring-1 ring-separator outline-none transition-[background-color,transform,box-shadow] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
          >
            <span className="text-sm font-medium text-foreground">{label}</span>
            <span className="block text-callout text-muted-foreground">{hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
