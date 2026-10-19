/**
 * Home-page roll-up of the Shared-by-me dashboard: the coach's standing
 * question ("who's behind?") answered without leaving Home. Same three
 * figures as SharedByMe.tsx; the full dashboard is the coach's default tab
 * on /my-playlists.
 */
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GroupHeader } from "@/components/ui/group";
import { StatCells } from "@/components/stat-cells";
import type { DashboardSummary } from "@scoutable/shared/lib/shared-by-me";

export function TeamEngagement({
  summary,
  onInvite,
}: {
  summary: DashboardSummary;
  /** Squads change every season; staff get the invite shortcut here. */
  onInvite?: () => void;
}) {
  if (summary.playlists === 0) return null;

  return (
    <section>
      <GroupHeader
        title="Team engagement"
        action={
          <>
            {onInvite && (
              <Button variant="ghost" size="xs" onClick={onInvite}>
                <UserPlus />
                Invite players
              </Button>
            )}
            <Link to="/my-playlists" className="text-sm text-primary hover:underline">
              Open dashboard
            </Link>
          </>
        }
      />
      {/* Informational only: reminding is playlist-scoped (the hero's
          newest-behind playlist, or per playlist on the dashboard). */}
      <StatCells
        cells={[
          { value: summary.playlists, label: summary.playlists === 1 ? "playlist shared" : "playlists shared" },
          { value: summary.recipients, label: summary.recipients === 1 ? "player reached" : "players reached" },
          {
            value: summary.behind,
            label: summary.behind === 1 ? "player hasn't finished" : "players haven't finished",
            warn: summary.behind > 0,
          },
        ]}
      />
    </section>
  );
}
