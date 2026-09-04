/**
 * Admin org-setup progress — the data behind the "set up your club"
 * checklist shown to club admins on web and desktop.
 *
 * Derived from real org data (teams, members) rather than stored per-step,
 * matching the Getting Started convention: it stays honest across devices
 * and never needs resetting. Admins don't count toward "invite your
 * coaches" — the admin is usually the person looking at the checklist, and
 * the step is about bringing in the coaching staff.
 */

export interface OrgSetupProgress {
  teamsDone: boolean;
  coachesDone: boolean;
  playersDone: boolean;
  doneCount: number;
  total: number;
  allDone: boolean;
}

export function deriveOrgSetupProgress(
  teams: ReadonlyArray<{ id: string }>,
  members: ReadonlyArray<{ role: string }>,
): OrgSetupProgress {
  const teamsDone = teams.length > 0;
  const coachesDone = members.some((m) => m.role === "coach");
  const playersDone = members.some((m) => m.role === "player");
  const doneCount = [teamsDone, coachesDone, playersDone].filter(Boolean).length;
  return { teamsDone, coachesDone, playersDone, doneCount, total: 3, allDone: doneCount === 3 };
}
