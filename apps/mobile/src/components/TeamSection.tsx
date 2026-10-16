import { Text, View } from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useMyTeam } from "@/lib/my-team";
import { Button } from "@/components/Button";
import { LeagueChip, TeamCrest } from "@/components/TeamCrest";
import {
  groupChoicesForProfile,
  spaceListLabel,
  teamRoleIn,
  teamRoleLine,
  teamSpaces,
} from "@scoutable/shared/lib/league-teams";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";

/**
 * Profile › Your team. One row while every space uses the same team; one row
 * per answer once they differ. Change opens the team screen for that space.
 */
export function TeamSection() {
  const { myOrgs, profile } = useAuth();
  const { choices, loaded } = useMyTeam();

  const spaces = sortOrgsClubFirst(teamSpaces(myOrgs));
  if (!loaded || spaces.length === 0) return null;
  const rows = groupChoicesForProfile(spaces, choices);
  const single = rows.length === 1;

  return (
    <View className="gap-3 rounded-xl border border-border p-4">
      <View className="gap-1">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Your team
        </Text>
        <Text className="text-sm text-muted-foreground">
          The team you coach or play for. We use it to find your games when you import.
        </Text>
      </View>
      {rows.map((row) => {
        const roleLine = teamRoleLine(teamRoleIn(row.orgs[0], profile?.declaredRole));
        return (
          <View key={row.key} className="gap-2 rounded-lg border border-border p-3">
            {!single && <Text className="text-xs text-muted-foreground">In {spaceListLabel(row.orgs)}</Text>}
            {row.team ? (
              <View className="flex-row items-center gap-3">
                <TeamCrest team={row.team} size={36} />
                <View className="min-w-0 flex-1 gap-0.5">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-base font-medium text-foreground">{row.team.name}</Text>
                    <LeagueChip name={row.team.leagueName} />
                  </View>
                  {roleLine ? <Text className="text-xs text-muted-foreground">{roleLine}</Text> : null}
                </View>
              </View>
            ) : row.unlistedTeam ? (
              <View>
                <Text className="text-base text-foreground">{row.unlistedTeam}</Text>
                <Text className="text-xs text-muted-foreground">Not in a league we cover yet</Text>
              </View>
            ) : (
              <Text className="text-base text-muted-foreground">No team yet</Text>
            )}
            {single && <Text className="text-xs text-muted-foreground">Used in {spaceListLabel(row.orgs)}</Text>}
            <Button
              variant="outline"
              title={row.team || row.unlistedTeam ? "Change" : "Choose team"}
              onPress={() => router.push({ pathname: "/team", params: { mode: "change", orgId: row.orgs[0].orgId } })}
            />
          </View>
        );
      })}
    </View>
  );
}
