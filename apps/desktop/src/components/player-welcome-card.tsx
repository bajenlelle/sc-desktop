/**
 * First-visit welcome on the club-space player feed — invited players
 * otherwise land on an empty feed with no explanation, and nothing on
 * desktop tells them the personal space (where importing and tape-building
 * live) exists. Desktop twin of web's welcome-card.tsx, sharing the same
 * welcome_dismissed_at flag; the CTA switches straight into the personal
 * space, where the checklist and sample game are waiting.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clapperboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { dismissWelcome } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";

export function PlayerWelcomeCard() {
  const navigate = useNavigate();
  const { profile, myOrgs, setActiveOrg } = useAuth();
  const [hidden, setHidden] = useState(false);

  const personalOrg = myOrgs.find((o) => o.isPersonal) ?? null;

  if (hidden || !profile || profile.welcomeDismissedAt != null) return null;

  function handleDismiss() {
    setHidden(true);
    trackEvent("player_welcome_dismissed");
    dismissWelcome().catch(() => {});
  }

  function handleOpenMySpace() {
    if (!personalOrg) return;
    trackEvent("player_welcome_cta");
    setActiveOrg(personalOrg.orgId);
    navigate("/");
  }

  return (
    <div className="mx-4 mt-4 rounded-xl border border-primary/30 bg-card p-4 sm:mx-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Welcome to Scoutable 👋</h2>
          <p className="text-sm text-muted-foreground">
            When your coach shares clips with you, they show up here — you&apos;ll get an
            email when something new lands.
          </p>
          {personalOrg && (
            <>
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Clapperboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
                <span>
                  You also have a personal space: import your own games and build highlight
                  tapes that are yours to keep.
                </span>
              </p>
              <Button size="sm" className="mt-1 w-fit" onClick={handleOpenMySpace}>
                Open my space
              </Button>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
