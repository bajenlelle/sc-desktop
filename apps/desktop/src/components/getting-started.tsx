import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { dismissOnboardingChecklist, getOrgContextForOrg, listOrgSetupInvites, setDeclaredRole } from "@/lib/profile-db";
import { getMySharedOutPlaylists } from "@/lib/playlists-db";
import { deriveOrgSetupProgress, type OrgSetupProgress } from "@scoutable/shared/lib/org-setup";
import { getHasExported } from "@/lib/prefs";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { Playlist, StoredMatch } from "@/types/match";

interface Step {
  key: string;
  title: string;
  hint?: string;
  done: boolean;
  /** Route target; undefined for the pre-checked account step. */
  to?: string;
  toState?: object;
  locked?: boolean;
}

/**
 * First-session "Getting started" checklist on the Overview page.
 *
 * Every step is derived from real data (playlists, matches, shares) rather
 * than stored per-step, so it stays honest across devices; only the export
 * step — which leaves no server trace — uses a local flag. Shown until the
 * user dismisses it or finishes everything; existing accounts were
 * backfilled as dismissed, so only new signups ever see it.
 */
export function GettingStarted({
  matches,
  playlists,
}: {
  matches: StoredMatch[];
  playlists: Playlist[];
}) {
  const navigate = useNavigate();
  const { user, profile, activeOrg, activeOrgId, activeOrgIsPersonal, activeOrgPlan, activeOrgRole, myOrgs, reloadProfile } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [hasSharedOut, setHasSharedOut] = useState(false);
  const [hasExported, setHasExported] = useState(() => getHasExported(user?.id));
  const [orgSetup, setOrgSetup] = useState<OrgSetupProgress | null>(null);
  const celebratedRef = useRef(false);

  // In club spaces the membership role is authoritative: player members
  // never see the coach checklist there (its CTAs are blocked for them) —
  // they still get it in their personal space, where everyone is a builder.
  const canActHere =
    activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const show =
    !hidden && canActHere && profile != null && profile.onboardingChecklistDismissedAt == null;

  // The club-space final step ("share with your team") is the one signal not
  // already loaded on Home. Deliberately NOT org-scoped: it answers "has
  // this coach ever shared anything", a one-time checklist boolean.
  useEffect(() => {
    if (!show || activeOrgIsPersonal) return;
    getMySharedOutPlaylists()
      .then((ps) => setHasSharedOut(ps.length > 0))
      .catch(() => {});
  }, [show, activeOrgIsPersonal]);

  useEffect(() => {
    const onExported = () => setHasExported(true);
    window.addEventListener("playlist-exported", onExported);
    return () => window.removeEventListener("playlist-exported", onExported);
  }, []);

  // Club admins get org-setup steps instead of the editing walkthrough —
  // their first job is teams and invites, not clips. Derived from real org
  // data, like every other step.
  const isClubAdmin = !activeOrgIsPersonal && activeOrgRole === "admin";
  useEffect(() => {
    if (!show || !isClubAdmin || !activeOrgId) return;
    const load = () => {
      // Invite signals ride along: the invite steps complete when the admin
      // sends/copies an invite, not when someone joins (shared org-setup.ts).
      Promise.all([getOrgContextForOrg(activeOrgId, { myOrgs }), listOrgSetupInvites(activeOrgId)])
        .then(([ctx, invites]) =>
          setOrgSetup(deriveOrgSetupProgress(ctx.allOrgTeams, ctx.orgMembers, invites)),
        )
        .catch(() => {});
    };
    load();
    // Same-session freshness: the invite modal announces copies/sends.
    window.addEventListener("org-setup-changed", load);
    return () => window.removeEventListener("org-setup-changed", load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, isClubAdmin, activeOrgId]);

  // The sample game is seeded per space (personal always; clubs for staff),
  // so the checklist can point at it wherever this space's Library has one.
  const hasDemo = matches.some((m) => m.isDemo);
  // Declared at signup (or inferred from an invite); null = OAuth signup
  // that skipped the form — ask inline below. The player voice only applies
  // in the personal space: in a club space the membership role decides, and
  // a declared-player invited as club coach should read coach copy there.
  const isPlayer = activeOrgIsPersonal && profile?.declaredRole === "player";

  function handleDeclareRole(role: "coach" | "player") {
    setDeclaredRole(role)
      .then(() => reloadProfile())
      .catch((err) => console.error("[onboarding] failed to save role:", err));
  }
  const hasOwnGame = matches.some((m) => !m.isDemo);
  const hasPlaylist = playlists.length > 0;
  const hasClips = playlists.some((p) => p.items.length > 0);

  // Land the user INSIDE a playlist (any one is fine) so the highlighted
  // button is actually on screen; before their first playlist exists the
  // steps fall back to a bare navigate.
  const firstPlaylistState = hasPlaylist
    ? { restore: { playlistId: playlists[0].id } }
    : undefined;

  const steps: Step[] = isClubAdmin ? [
    { key: "account", title: "Create your account", done: true },
    {
      key: "team",
      title: "Create your first team",
      hint: "Invites can target a team, so new members land in the right place",
      done: orgSetup?.teamsDone ?? false,
      to: "/organization",
      toState: { newTeam: true },
    },
    {
      key: "coaches",
      title: "Invite your coaches",
      hint: "Coaches can invite their players and other coaches themselves",
      done: orgSetup?.coachesDone ?? false,
      to: "/organization",
      toState: { invite: true, inviteRole: "coach" },
    },
    {
      key: "players",
      title: "Invite your players",
      hint: "Or leave this to your coaches",
      done: orgSetup?.playersDone ?? false,
      to: "/organization",
      toState: { invite: true, inviteRole: "player" },
    },
    {
      key: "import",
      title: "Import your own game",
      hint: "You'll need the game's video file on your computer",
      done: hasOwnGame,
      to: "/upload",
    },
  ] : [
    { key: "account", title: "Create your account", done: true },
    {
      key: "playlist",
      title: isPlayer ? "Build your first highlight tape" : "Build your first playlist",
      done: hasPlaylist,
      to: "/playlists",
      toState: { createNew: true },
    },
    {
      key: "clips",
      title: hasDemo
        ? isPlayer
          ? "Add your best plays from the sample game"
          : "Add clips from the sample game"
        : "Add clips from a game",
      hint: hasDemo ? "Filter by player or event type, then watch them back-to-back" : undefined,
      done: hasClips,
      to: "/playlists",
      toState: firstPlaylistState && { ...firstPlaylistState, highlight: "add-clips" },
    },
    {
      key: "import",
      title: "Import your own game",
      hint: "You'll need the game's video file on your computer",
      done: hasOwnGame,
      to: "/upload",
    },
    activeOrgIsPersonal
      ? {
          key: "export",
          title: "Export a playlist as MP4",
          done: hasExported,
          to: "/playlists",
          toState: firstPlaylistState && { ...firstPlaylistState, highlight: "export" },
          locked: activeOrgPlan === "free",
          hint: activeOrgPlan === "free" ? "Available on Rookie and Pro" : undefined,
        }
      : {
          key: "share",
          title: "Share a playlist with your team",
          done: hasSharedOut,
          to: "/playlists",
          toState: firstPlaylistState && { ...firstPlaylistState, highlight: "share" },
        },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // Everything checked → thank the user once and retire the card for good.
  useEffect(() => {
    if (!show || !allDone || celebratedRef.current) return;
    celebratedRef.current = true;
    trackEvent("onboarding_completed", { variant: isClubAdmin ? "admin" : "member" });
    dismissOnboardingChecklist().catch(() => {});
    toast.success(isClubAdmin ? "Your club is set up 🎉" : "You're all set — happy scouting! 🎉");
    setHidden(true);
  }, [show, allDone]);

  if (!show) return null;

  function handleDismiss() {
    setHidden(true);
    trackEvent("onboarding_dismissed", { done_count: doneCount });
    dismissOnboardingChecklist().catch(() => {});
  }

  function handleStep(step: Step) {
    if (!step.to || step.done) return;
    trackEvent("onboarding_step_clicked", { step: step.key });
    navigate(step.to, step.toState ? { state: step.toState } : undefined);
  }

  const demoNote = hasDemo
    ? " We've added a sample game so you can try everything without your own footage."
    : "";
  const welcome = activeOrgIsPersonal
    ? hasDemo
      ? isPlayer
        ? "We've added a sample game so you can try building a tape without your own footage."
        : "We've added a sample game so you can try everything without your own footage."
      : "Here's the fastest way to get to your first playlist."
    : isClubAdmin
      ? `You're an admin of ${activeOrg?.orgName ?? "your organization"}. Set up your club so coaches and players can get going.${demoNote}`
      : `You've joined ${activeOrg?.orgName ?? "your organization"}. Here's how to get going.${demoNote}`;

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Welcome to Scoutable 👋</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{welcome}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Dismiss — you can always find these actions in the sidebar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* OAuth signups skip the signup form's role question — ask once here. */}
      {profile?.declaredRole == null && (
        <div className="mt-4 flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          <span className="text-xs font-medium text-foreground">What describes you best?</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleDeclareRole("coach")}
              className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <span className="font-medium text-foreground">Coach</span>
              <span className="block text-xs text-muted-foreground">I scout and analyze games</span>
            </button>
            <button
              type="button"
              onClick={() => handleDeclareRole("player")}
              className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
            >
              <span className="font-medium text-foreground">Player</span>
              <span className="block text-xs text-muted-foreground">I study my games and build highlights</span>
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="mt-4 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {doneCount} of {steps.length}
        </span>
      </div>

      <ul className="mt-4 flex flex-col">
        {steps.map((step) => {
          const clickable = !step.done && !!step.to;
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={() => handleStep(step)}
                disabled={!clickable}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left",
                  clickable && "transition-colors hover:bg-muted/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    step.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent",
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-sm",
                      step.done ? "text-muted-foreground line-through" : "text-foreground",
                    )}
                  >
                    {step.title}
                  </span>
                  {step.hint && !step.done && (
                    <span className="block text-xs text-muted-foreground">{step.hint}</span>
                  )}
                </span>
                {step.locked && !step.done && (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                {clickable && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
