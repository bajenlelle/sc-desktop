import { useAuth } from "@/lib/auth-context";
import { usePlaylists } from "@/lib/playlists-store";
import { SheetBackButton } from "@/components/shell/GlassButton";
import { Screen } from "@/components/shell/Screen";
import { TeamSection } from "@/components/TeamSection";
import { ROLE_LABEL } from "@/components/settings/AccountCard";
import { GroupRow } from "@/components/ui/Group";

/**
 * Settings › Team: the team you coach or play for in each space (each row
 * opens the team picker), and your club. Players have no active space: their
 * feed gathers every club, so their clubs are listed read-only, with their
 * own team names (the feed's team names carry club prefixes when there are
 * several).
 */
export default function TeamPage() {
  const { activeOrg, activeOrgRole, isPlayerOnly } = useAuth();
  const { teamMap, clubTeams } = usePlaylists();
  const teamNames = [...teamMap.values()].map((t) => t.name);
  const role = activeOrgRole ? ROLE_LABEL[activeOrgRole] : null;

  return (
    <Screen title="Team" sheet leading={<SheetBackButton />} grouped contentClassName="px-4 pt-2">
      <TeamSection>
        {isPlayerOnly
          ? clubTeams.map((c) => (
              <GroupRow
                key={c.orgId}
                icon="club"
                label={c.orgName}
                description={c.teamNames.length > 0 ? c.teamNames.join(" · ") : undefined}
              />
            ))
          : activeOrg && !activeOrg.isPersonal
            ? [
                <GroupRow
                  key="club"
                  icon="club"
                  label={activeOrg.orgName}
                  description={teamNames.length > 0 ? teamNames.join(" · ") : undefined}
                  trailing={role ?? undefined}
                />,
                // Switching clubs lives in the sidebar. No "Manage…": the web app
                // reaches the pricing page, and App Review rejected build 5 for
                // exactly that path (3.1.1 / 3.1.3(c)). Clubs are managed from the
                // desktop or web app.
              ]
            : null}
      </TeamSection>
    </Screen>
  );
}
