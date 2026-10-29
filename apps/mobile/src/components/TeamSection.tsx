import { View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useMyTeam } from "@/lib/my-team";
import { LeagueChip, TeamCrest } from "@/components/TeamCrest";
import { Button } from "@/components/ui/Button";
import { GroupFooter, GroupHeader, GroupRow, GroupedList } from "@/components/ui/Group";
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
 * Profile › Your team (the web's MyTeamCard). One row while every space uses
 * the same team; one row per answer once they differ. Change opens the team
 * screen for that space.
 */
export function TeamSection() {
  const { myOrgs, profile } = useAuth();
  const { choices, loaded } = useMyTeam();

  const spaces = sortOrgsClubFirst(teamSpaces(myOrgs));
  if (!loaded || spaces.length === 0) return null;
  const rows = groupChoicesForProfile(spaces, choices);
  const single = rows.length === 1;

  return (
    <View>
      <GroupHeader title="Your team" />
      <GroupedList>
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
                  <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                    <Text numberOfLines={1} className="shrink">
                      {row.team.name}
                    </Text>
                    <LeagueChip name={row.team.leagueName} />
                  </View>
                ) : row.unlistedTeam ? (
                  row.unlistedTeam
                ) : (
                  <Text className="text-muted-foreground">No team yet</Text>
                )
              }
              description={[lead, used].filter(Boolean).join(" · ")}
              trailing={
                <Button
                  variant="outline"
                  size="xs"
                  onPress={() => router.push({ pathname: "/team", params: { mode: "change", orgId: row.orgs[0].orgId } })}
                >
                  {row.team || row.unlistedTeam ? "Change…" : "Choose team…"}
                </Button>
              }
            />
          );
        })}
      </GroupedList>
      <GroupFooter>The team you coach or play for. It finds your games when you import.</GroupFooter>
    </View>
  );
}
