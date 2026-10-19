"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { getMySharedPlaylists } from "@scoutable/shared/lib/playlists-db";
import type { Playlist, StoredMatch } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { importHref } from "@/components/import/import-entry-link";
import { RolePrompt } from "@/components/role-prompt";
import { ProgressBar } from "@/components/ui/progress-bar";
import { trackEvent } from "@/lib/analytics";
import { dismissOnboardingChecklist } from "@/lib/profile-db";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface Step {
  key: string;
  title: string;
  hint?: string;
  done: boolean;
  /** What the step does when pressed; undefined for the pre-checked account step and locked steps. */
  onPress?: () => void;
  locked?: boolean;
}

/**
 * The first-session checklist on Home, for coaches and anyone in their
 * personal space (club admins get the AdminSetupCard instead): import a
 * game, build a playlist, add clips, then share it (club spaces) or send it
 * to the phone (personal spaces). Every step is derived from real data so
 * it stays honest across devices; shown until the user dismisses it or
 * finishes everything (the same server flag as the desktop's checklist). A
 * port of the desktop's getting-started.tsx.
 */
export function GettingStarted({
  matches,
  playlists,
  readyMatchIds,
  hasExported,
  onNewPlaylist,
  creating,
  addClipsHref,
}: {
  matches: StoredMatch[];
  playlists: Playlist[];
  /** Games with a cloud copy ready to clip. */
  readyMatchIds: ReadonlySet<string>;
  /** Personal spaces: the user has made a highlight link (Send to my phone) on any device. */
  hasExported: boolean;
  onNewPlaylist: () => void;
  creating: boolean;
  /** The editor on a playlist, with the add-clips panel open on a game when one has a cloud copy. */
  addClipsHref: (playlistId: string) => string;
}) {
  const router = useRouter();
  const { profile, activeOrg, activeOrgIsPersonal, activeOrgRole } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [hasSharedOut, setHasSharedOut] = useState(false);
  const celebratedRef = useRef(false);

  // In club spaces the membership role is authoritative: players never see
  // the checklist there; in their personal space everyone is a builder.
  const canActHere = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const show = !hidden && canActHere && profile != null && profile.onboardingChecklistDismissedAt == null;

  // The club-space final step ("share with your team") is the one signal not
  // already loaded on Home. Deliberately not space-scoped: it answers "has
  // this coach ever shared anything", a one-time checklist boolean.
  useEffect(() => {
    if (!show || activeOrgIsPersonal) return;
    let cancelled = false;
    getMySharedPlaylists(createClient())
      .then((ps) => {
        if (!cancelled) setHasSharedOut(ps.length > 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [show, activeOrgIsPersonal]);

  const hasOwnGame = matches.some((m) => !m.isDemo);
  const hasPlaylist = playlists.length > 0;
  const hasClips = playlists.some((p) => p.items.length > 0);
  const hasReadyCopy = matches.some((m) => readyMatchIds.has(m.id));
  const first = playlists[0];
  const firstWithClips = playlists.find((p) => p.items.length > 0);

  const steps: Step[] = [
    { key: "account", title: "Create your account", done: true },
    {
      key: "import",
      title: "Import your own game",
      hint: "Pick a league game and upload its video",
      done: hasOwnGame,
      onPress: () => {
        trackEvent("import_entry_clicked", { placement: "get_started" });
        router.push(importHref());
      },
    },
    {
      key: "playlist",
      title: "Build your first playlist",
      done: hasPlaylist,
      onPress: onNewPlaylist,
    },
    {
      key: "clips",
      title: "Add clips from a game",
      hint: hasReadyCopy ? "Filter by player or event type, then watch them back-to-back" : "Once a game's video is in the cloud",
      done: hasClips,
      onPress: first ? () => router.push(addClipsHref(first.id)) : onNewPlaylist,
    },
    activeOrgIsPersonal
      ? {
          key: "export",
          title: "Send a playlist to your phone",
          hint: "Get a link and a QR code to save or share the video",
          done: hasExported,
          // The editor opens on its export dialog; a playlist without clips gets them first.
          onPress: firstWithClips
            ? () => router.push(`/playlists/${encodeURIComponent(firstWithClips.id)}?export=share`)
            : first
              ? () => router.push(addClipsHref(first.id))
              : onNewPlaylist,
        }
      : {
          key: "share",
          title: "Share a playlist with your team",
          done: hasSharedOut,
          onPress: first ? () => router.push(`/playlists/${encodeURIComponent(first.id)}`) : onNewPlaylist,
        },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // Everything checked: thank the user once and retire the card for good.
  useEffect(() => {
    if (!show || !allDone || celebratedRef.current) return;
    celebratedRef.current = true;
    trackEvent("onboarding_completed", { variant: "member" });
    dismissOnboardingChecklist().catch(() => {});
    toast.success("You're all set");
    setHidden(true);
  }, [show, allDone]);

  if (!show) return null;

  function handleDismiss() {
    setHidden(true);
    trackEvent("onboarding_dismissed", { done_count: doneCount });
    dismissOnboardingChecklist().catch(() => {});
  }

  function handleStep(step: Step) {
    if (!step.onPress || step.done || step.locked) return;
    trackEvent("onboarding_step_clicked", { step: step.key });
    step.onPress();
  }

  const welcome = activeOrgIsPersonal
    ? "Here's the fastest way to your first playlist."
    : `You've joined ${activeOrg?.orgName ?? "your club"}. Here's how to get going.`;

  return (
    <section className="rounded-window bg-card ring-1 ring-separator">
      <div className="flex items-start justify-between gap-4 px-5 pt-4">
        <div>
          <h2 className="text-title-3 text-foreground">Welcome to Scoutable</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{welcome}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          title="Dismiss. These actions stay in the sidebar."
          className="-mt-1 -mr-2 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* OAuth signups skip the signup form's role question: ask once here. */}
      <div className="mx-5 mt-4 empty:hidden">
        <RolePrompt />
      </div>

      <div className="mt-4 flex items-center gap-3 px-5">
        <ProgressBar percent={(doneCount / steps.length) * 100} className="flex-1" />
        <span className="text-callout text-muted-foreground nums">
          {doneCount} of {steps.length}
        </span>
      </div>

      <ul className="mt-3 flex flex-col px-2 pb-3">
        {steps.map((step) => {
          const clickable = !step.done && !step.locked && !!step.onPress;
          const busy =
            clickable && creating && (step.key === "playlist" || (!first && (step.key === "clips" || step.key === "share" || step.key === "export")));
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => handleStep(step)}
                disabled={!clickable || busy}
                className={cn(
                  "flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection pointer-coarse:min-h-11",
                  clickable && "transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    step.done ? "bg-primary text-primary-foreground" : "text-transparent ring-1 ring-inset ring-separator-strong",
                  )}
                >
                  <Check className="size-3 stroke-[2.5]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", step.done ? "text-muted-foreground line-through" : "text-foreground")}>{step.title}</span>
                  {step.hint && !step.done && <span className="block text-callout text-muted-foreground">{step.hint}</span>}
                </span>
                {step.locked && !step.done && <Lock className="size-3.5 shrink-0 text-muted-foreground" />}
                {busy ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  clickable && <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
