/**
 * Home-page roll-up of the Shared-by-me dashboard: the coach's standing
 * question ("who's behind?") answered without leaving Home. Same three
 * figures as SharedByMe.tsx; the full dashboard is the coach's default tab
 * on /my-playlists.
 */
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GroupedList, GroupHeader } from "@/components/ui/group";
import type { DashboardSummary } from "@scoutable/shared/lib/shared-by-me";

function Stat({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  return (
    <div className="px-4 py-3">
      <div className={cn("text-title-2 nums", warn ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
        {value}
      </div>
      <div className="text-callout text-muted-foreground">{label}</div>
    </div>
  );
}

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
      <GroupedList className="divide-y-0">
        <div className="grid grid-cols-3 divide-x divide-separator">
          <Stat value={summary.playlists} label={summary.playlists === 1 ? "playlist shared" : "playlists shared"} />
          <Stat value={summary.recipients} label={summary.recipients === 1 ? "player reached" : "players reached"} />
          {/* Informational only — bulk reminding is playlist-scoped (the
              hero's newest-behind playlist, or per-playlist on the
              dashboard). */}
          <Stat
            value={summary.behind}
            label={summary.behind === 1 ? "player hasn't finished" : "players haven't finished"}
            warn={summary.behind > 0}
          />
        </div>
      </GroupedList>
    </section>
  );
}
