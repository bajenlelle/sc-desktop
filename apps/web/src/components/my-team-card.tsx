"use client";

import { useState } from "react";
import { GroupedList, GroupFooter, GroupHeader, GroupRow } from "@/components/ui/group";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-context";
import { useMyTeam } from "@/lib/my-team";
import { TeamCrest, TeamLabel } from "@/components/team-picker";
import { TeamDialog } from "@/components/team-dialog";
import {
  groupChoicesForProfile,
  spaceListLabel,
  spacesSharingAnswer,
  teamRoleIn,
  teamRoleLine,
  teamSpaces,
  type ProfileTeamRow,
} from "@scoutable/shared/lib/league-teams";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";

/**
 * Profile › Your team. One row while every space uses the same team; one row
 * per answer once they differ. Each row's Change re-opens the picker with the
 * spaces sharing that answer pre-ticked.
 */
export function MyTeamCard() {
  const { myOrgs, profile } = useAuth();
  const { choices, loaded } = useMyTeam();
  const [editing, setEditing] = useState<ProfileTeamRow | null>(null);

  const spaces = sortOrgsClubFirst(teamSpaces(myOrgs));
  if (!loaded || spaces.length === 0) return null;
  const rows = groupChoicesForProfile(spaces, choices);
  const single = rows.length === 1;

  const editOrg = editing?.orgs[0] ?? null;
  const others = editOrg ? spaces.filter((o) => o.orgId !== editOrg.orgId) : [];

  return (
    <section>
      <GroupHeader title="Your team" />
      <GroupedList>
        {rows.map((row) => {
          const roleLine = teamRoleLine(teamRoleIn(row.orgs[0], profile?.declaredRole));
          const used = `${single ? "Used in" : "In"} ${spaceListLabel(row.orgs)}`;
          return (
            <GroupRow
              key={row.key}
              leading={row.team ? <TeamCrest team={row.team} size={28} /> : undefined}
              label={
                row.team ? (
                  <TeamLabel team={row.team} className="text-sm" />
                ) : row.unlistedTeam ? (
                  row.unlistedTeam
                ) : (
                  <span className="text-muted-foreground">No team yet</span>
                )
              }
              description={
                <>
                  {row.team ? roleLine : row.unlistedTeam ? "Not in a league we cover yet" : null}
                  {(row.team ? roleLine : row.unlistedTeam) ? " · " : ""}
                  {used}
                </>
              }
              trailing={
                <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                  {row.team || row.unlistedTeam ? "Change…" : "Choose team…"}
                </Button>
              }
            />
          );
        })}
      </GroupedList>
      <GroupFooter>The team you coach or play for. It finds your games when you import.</GroupFooter>

      {editing && editOrg && (
        <TeamDialog
          key={editing.key}
          mode="change"
          org={editOrg}
          otherSpaces={others}
          defaultChecked={spacesSharingAnswer(spaces, choices, editOrg.orgId).filter((id) => id !== editOrg.orgId)}
          initialTeamId={editing.team?.id ?? null}
          role={teamRoleIn(editOrg, profile?.declaredRole)}
          onDone={() => setEditing(null)}
          onDismiss={() => setEditing(null)}
        />
      )}
    </section>
  );
}
