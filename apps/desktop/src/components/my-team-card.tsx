import { useState } from "react";
import { Shield } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
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
    <Card>
      <CardContent className="p-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            Your team
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The team you coach or play for. We use it to find your games when you import.
          </p>
        </div>

        {rows.map((row) => {
          const roleLine = teamRoleLine(teamRoleIn(row.orgs[0], profile?.declaredRole));
          return (
            <div key={row.key} className="space-y-1.5 rounded-md border border-border p-3">
              {!single && <p className="text-xs text-muted-foreground">In {spaceListLabel(row.orgs)}</p>}
              <div className="flex items-center gap-3">
                {row.team ? (
                  <>
                    <TeamCrest team={row.team} size={32} />
                    <div className="min-w-0 flex-1">
                      <TeamLabel team={row.team} className="text-sm" />
                      {roleLine && <p className="text-xs text-muted-foreground">{roleLine}</p>}
                    </div>
                  </>
                ) : (
                  <div className="min-w-0 flex-1 text-sm">
                    {row.unlistedTeam ? (
                      <>
                        <span className="text-foreground">{row.unlistedTeam}</span>
                        <p className="text-xs text-muted-foreground">Not in a league we cover yet</p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">No team yet</span>
                    )}
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                  {row.team || row.unlistedTeam ? "Change" : "Choose team"}
                </Button>
              </div>
              {single && <p className="text-xs text-muted-foreground">Used in {spaceListLabel(row.orgs)}</p>}
            </div>
          );
        })}

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
      </CardContent>
    </Card>
  );
}
