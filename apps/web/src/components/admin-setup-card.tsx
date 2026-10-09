"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, Monitor, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-context";
import { dismissOnboardingChecklist, getOrgContextForOrg, listOrgSetupInvites } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import { deriveOrgSetupProgress, type OrgSetupInvite } from "@scoutable/shared/lib/org-setup";
import { cn } from "@/lib/utils";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";

interface Step {
  key: string;
  title: string;
  hint?: string;
  done: boolean;
  href: string;
}

/**
 * First-run setup checklist for club ADMINS — the web counterpart of the
 * desktop Getting Started card, but voiced for org setup instead of video
 * editing: create a team, invite coaches, invite players. Every step is
 * derived from real org data (teams/members via getOrgContextForOrg), so it
 * stays honest across devices; dismissal reuses the same server-side flag
 * as the desktop checklist (profiles.onboarding_checklist_dismissed_at).
 *
 * Pass `teams`/`members` where the page already holds the org context
 * (/organization) so the card tracks its reloads live; without them the
 * card fetches once on mount (/my-playlists).
 */
export function AdminSetupCard({
  teams,
  members,
  className,
}: {
  teams?: OrgTeam[];
  members?: UserProfile[];
  className?: string;
} = {}) {
  const router = useRouter();
  const { profile, activeOrg, activeOrgId, activeOrgRole, activeOrgIsPersonal } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [fetched, setFetched] = useState<{ teams: { id: string }[]; members: { role: string }[] } | null>(null);
  // Invite signals (email sent / link copied) — the invite steps complete on
  // the admin's action, not on someone joining. Fetched separately from the
  // org context and re-fetched when the invite modal announces a change.
  const [invites, setInvites] = useState<OrgSetupInvite[]>([]);
  const celebratedRef = useRef(false);

  const show =
    !hidden &&
    !activeOrgIsPersonal &&
    activeOrgRole === "admin" &&
    profile != null &&
    profile.onboardingChecklistDismissedAt == null;

  useEffect(() => {
    if (!show || teams || !activeOrgId) return;
    getOrgContextForOrg(activeOrgId)
      .then((ctx) => setFetched({ teams: ctx.allOrgTeams, members: ctx.orgMembers }))
      .catch(() => {});
  }, [show, teams, activeOrgId]);

  useEffect(() => {
    if (!show || !activeOrgId) return;
    const load = () => {
      listOrgSetupInvites(activeOrgId).then(setInvites).catch(() => {});
    };
    load();
    // The invite modal lives on the same page — refresh the moment the admin
    // copies a link or sends invites, so the step checks itself immediately.
    window.addEventListener("org-setup-changed", load);
    return () => window.removeEventListener("org-setup-changed", load);
  }, [show, activeOrgId]);

  const data = teams && members ? { teams, members } : fetched;
  const progress = data ? deriveOrgSetupProgress(data.teams, data.members, invites) : null;

  // Auto-retire once the club is set up — same behavior as the desktop
  // checklist: celebrate once, persist the dismissal, disappear everywhere.
  useEffect(() => {
    if (!show || !progress?.allDone || celebratedRef.current) return;
    celebratedRef.current = true;
    trackEvent("onboarding_completed", { variant: "admin" });
    dismissOnboardingChecklist().catch(() => {});
    toast.success("Your club is set up 🎉", {
      description: "Coaches and players can now get going.",
    });
    setHidden(true);
  }, [show, progress?.allDone]);

  if (!show || !progress) return null;

  const steps: Step[] = [
    {
      key: "team",
      title: "Create your first team",
      hint: "Invites can target a team, so new members land in the right place",
      done: progress.teamsDone,
      href: "/organization?team=new",
    },
    {
      key: "coaches",
      title: "Invite your coaches",
      hint: "Coaches can invite their players and other coaches themselves",
      done: progress.coachesDone,
      href: "/organization?invite=coach",
    },
    {
      key: "players",
      title: "Invite your players",
      hint: "Or leave this to your coaches",
      done: progress.playersDone,
      href: "/organization?invite=player",
    },
  ];

  function handleDismiss() {
    setHidden(true);
    trackEvent("onboarding_dismissed", { variant: "admin", done_count: progress?.doneCount });
    dismissOnboardingChecklist().catch(() => {});
  }

  function handleStep(step: Step) {
    if (step.done) return;
    trackEvent("onboarding_step_clicked", { step: step.key, variant: "admin" });
    router.push(step.href);
  }

  return (
    <section className={cn("rounded-window bg-card ring-1 ring-separator", className)}>
      <div className="flex items-start justify-between gap-4 px-5 pt-4">
        <div>
          <h2 className="text-title-3 text-foreground">
            Welcome to {activeOrg?.orgName ?? "your club"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            You&apos;re the admin. Set up your club so coaches and players can get going.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss setup checklist"
          className="-mr-2 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3 px-5">
        <ProgressBar percent={(progress.doneCount / progress.total) * 100} className="flex-1" />
        <span className="text-callout nums text-muted-foreground">
          {progress.doneCount} of {progress.total}
        </span>
      </div>

      <ul className="mt-3 flex flex-col px-2">
        {steps.map((step) => (
          <li key={step.key}>
            <button
              type="button"
              onClick={() => handleStep(step)}
              disabled={step.done}
              className={cn(
                "flex min-h-9 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection pointer-coarse:min-h-11",
                !step.done && "transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2",
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
                <span className={cn("block text-sm", step.done ? "text-muted-foreground line-through" : "text-foreground")}>
                  {step.title}
                </span>
                {step.hint && !step.done && <span className="block text-callout text-muted-foreground">{step.hint}</span>}
              </span>
              {!step.done && <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />}
            </button>
          </li>
        ))}
      </ul>

      <p className="mx-5 mt-2 flex items-start gap-1.5 border-t border-separator py-3 text-callout text-muted-foreground">
        <Monitor className="mt-px size-3.5 shrink-0 text-primary/70" aria-hidden />
        <span>
          Import games and cut clips in the free{" "}
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
    </section>
  );
}
