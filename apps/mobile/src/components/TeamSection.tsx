import type { ReactNode } from "react";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useMyTeam } from "@/lib/my-team";
import { TeamCrest } from "@/components/TeamCrest";
import { GroupFooter, GroupRow, GroupedList } from "@/components/ui/Group";
import { Text } from "@/components/ui/Text";
import {
  groupChoicesForProfile,
  spaceListLabel,
  teamRoleIn,
  teamRoleLine,
  teamSpaces,
} from "@scoutable/shared/lib/league-teams";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";

/**
 * Settings › Team (the web's MyTeamCard): your team, one row while every
 * space uses the same one and one per answer once they differ, each a
 * disclosure row that opens the team screen for that space; then the club
 * rows the page passes in. The page's title names the group, so it has no
 * heading of its own.
 */
export function TeamSection({ children }: { children?: ReactNode }) {
  const { myOrgs, profile } = useAuth();
  const { choices, loaded } = useMyTeam();

  const spaces = sortOrgsClubFirst(teamSpaces(myOrgs));
  const rows = loaded && spaces.length > 0 ? groupChoicesForProfile(spaces, choices) : [];
  const single = rows.length === 1;
  if (rows.length === 0 && !children) return null;

  return (
    <>
      <GroupedList large inset={56}>
        {rows.map((row) => {
          const roleLine = teamRoleLine(teamRoleIn(row.orgs[0], profile?.declaredRole));
          const used = `${single ? "Used in" : "In"} ${spaceListLabel(row.orgs)}`;
          const lead = row.team ? roleLine : row.unlistedTeam ? "Not in a league we cover yet" : null;
          return (
            <GroupRow
              key={row.key}
              leading={row.team ? <TeamCrest team={row.team} size={28} /> : undefined}
              label={
                row.team ? (
                  row.team.name
                ) : row.unlistedTeam ? (
                  row.unlistedTeam
                ) : (
                  <Text className="text-muted-foreground">No team yet</Text>
                )
              }
              description={[row.team?.leagueName, lead, used].filter(Boolean).join(" · ")}
              chevron
              accessibilityLabel={row.team || row.unlistedTeam ? `Change team, ${row.team?.name ?? row.unlistedTeam}` : "Choose your team"}
              onPress={() => router.push({ pathname: "/team", params: { mode: "change", orgId: row.orgs[0].orgId } })}
            />
          );
        })}
        {children}
      </GroupedList>
      {rows.length > 0 ? <GroupFooter>The team you coach or play for. It finds your games when you import.</GroupFooter> : null}
    </>
  );
}
