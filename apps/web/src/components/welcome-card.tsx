"use client";

import { useState } from "react";
import Link from "next/link";
import { Clapperboard, Monitor, X } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { dismissWelcome } from "@/lib/profile-db";

/**
 * First-visit welcome on /my-playlists — mainly for invited players, who
 * otherwise land on an empty feed with no explanation. Also cross-sells the
 * personal space: players can import and scout their own games in the
 * desktop app (and maybe buy a subscription there), so we never hide that
 * side of the product from them.
 */
export function WelcomeCard() {
  const { profile, isPlayerOnly } = useAuth();
  const [hidden, setHidden] = useState(false);

  if (hidden || !profile || profile.welcomeDismissedAt != null) return null;

  function handleDismiss() {
    setHidden(true);
    dismissWelcome().catch(() => {});
  }

  return (
    <div className="mx-4 mt-4 rounded-xl border border-primary/30 bg-card p-4 sm:mx-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-foreground">Welcome to Scoutable 👋</h2>
          <p className="text-sm text-muted-foreground">
            When your coach shares clips with you, they show up here — you&apos;ll get an
            email whenever something new lands.
          </p>
          {isPlayerOnly ? (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Clapperboard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
              <span>
                Want to cut your own tapes? Check{" "}
                <Link
                  href="/my-highlights"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  My Highlights
                </Link>
                .
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
              <span>
                You also have a personal space: import your own games and build your own
                highlight tapes in the{" "}
                <a
                  href="https://scoutable.se/#download"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  desktop app
                </a>
                .
              </span>
            </p>
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
