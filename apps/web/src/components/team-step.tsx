"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { useMyTeam } from "@/lib/my-team";
import { trackEvent } from "@/lib/analytics";
import { TeamDialog } from "@/components/team-dialog";
import {
  needsTeamStep,
  spacesWithoutChoice,
  teamRoleIn,
  teamSpaces,
} from "@scoutable/shared/lib/league-teams";

/**
 * The once-per-space "Which team do you coach / play for?" step, shown over
 * the app while the active space has no answer. Skip and "isn't listed" are
 * answers too; closing it only hides it until the next launch.
 */
export function TeamStep() {
  const { activeOrg, myOrgs, profile, deviceBlocked } = useAuth();
  const { choices, loaded } = useMyTeam();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const shownRef = useRef<Set<string>>(new Set());

  const org = activeOrg && !activeOrg.isNtOrg ? activeOrg : null;
  const role = teamRoleIn(org ?? undefined, profile?.declaredRole);
  const open =
    org !== null && !deviceBlocked && loaded && needsTeamStep(choices, org.orgId) && !hidden.has(org.orgId);

  useEffect(() => {
    if (!open || !org || shownRef.current.has(org.orgId)) return;
    shownRef.current.add(org.orgId);
    trackEvent("team_step_shown", { role });
  }, [open, org, role]);

  if (!open || !org) return null;

  const others = spacesWithoutChoice(teamSpaces(myOrgs), choices, org.orgId);
  // Joined a club after answering elsewhere: start from the team they already picked.
  const initialTeamId = choices.find((c) => c.team)?.team?.id ?? null;
  const hide = () => setHidden((prev) => new Set(prev).add(org.orgId));

  return (
    <TeamDialog
      key={org.orgId}
      mode="step"
      org={org}
      otherSpaces={others}
      defaultChecked={others.map((o) => o.orgId)}
      initialTeamId={initialTeamId}
      role={role}
      onDone={() => {}}
      onDismiss={hide}
    />
  );
}
