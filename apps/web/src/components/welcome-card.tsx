"use client";

import { useState } from "react";
import Link from "next/link";
import { Clapperboard, X } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/group";
import { dismissWelcome } from "@/lib/profile-db";

const DESKTOP_APP_URL = "https://scoutable.se/#download";

/**
 * First-visit welcome on /my-playlists — mainly for invited players, who
 * otherwise land on an empty feed with no explanation. Also cross-sells the
 * personal space: players can import and scout their own games in the
 * desktop app (and maybe buy a subscription there), so we never hide that
 * side of the product from them. Coaches/admins in the active org get their
 * own voice ("other coaches") and a desktop-editor pointer instead. Shares
 * the welcome_dismissed_at flag with the desktop app.
 */
export function WelcomeCard() {
  const { profile, isPlayerOnly, activeOrgRole } = useAuth();
  const [hidden, setHidden] = useState(false);

  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";

  if (hidden || !profile || profile.welcomeDismissedAt != null) return null;

  function handleDismiss() {
    setHidden(true);
    dismissWelcome().catch(() => {});
  }

  const link = "font-medium text-primary underline-offset-2 hover:underline";

  return (
    <Callout
      icon={<Clapperboard />}
      action={
        <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={handleDismiss}>
          <X />
        </Button>
      }
    >
      <p className="font-medium">Welcome to Scoutable</p>
      <p className="mt-0.5 text-muted-foreground">
        {isCoachOrAdmin ? (
          <>
            Playlists other coaches share with you show up here. Import your games, cut clips and share
            playlists with your team in the{" "}
            <a href={DESKTOP_APP_URL} target="_blank" rel="noreferrer" className={link}>
              desktop app
            </a>
            .
          </>
        ) : isPlayerOnly ? (
          <>
            When your coach shares clips with you, they show up here, and you get an email whenever something
            new lands. Want to cut your own tapes? See{" "}
            <Link href="/my-highlights" className={link}>
              My highlights
            </Link>
            .
          </>
        ) : (
          <>
            When your coach shares clips with you, they show up here, and you get an email whenever something
            new lands. You also have a personal space: import your own games and build highlight tapes in the{" "}
            <a href={DESKTOP_APP_URL} target="_blank" rel="noreferrer" className={link}>
              desktop app
            </a>
            .
          </>
        )}
      </p>
    </Callout>
  );
}
