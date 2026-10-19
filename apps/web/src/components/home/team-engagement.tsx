"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import type { DashboardSummary } from "@scoutable/shared/lib/shared-by-me";
import { StatCells } from "@/components/stat-cells";
import { Button } from "@/components/ui/button";
import { GroupHeader } from "@/components/ui/group";

/**
 * Home's roll-up of the Shared-by-me dashboard: the coach's standing
 * question ("who's behind?") answered without leaving Home. The same three
 * figures as the dashboard, which is the coach's default view on
 * /my-playlists. A port of the desktop's components/home/team-engagement.tsx.
 */
export function TeamEngagement({
  summary,
  canInvite,
}: {
  summary: DashboardSummary;
  /** Squads change every season; staff get the invite shortcut here. */
  canInvite: boolean;
}) {
  const router = useRouter();
  if (summary.playlists === 0) return null;

  return (
    <section>
      <GroupHeader
        title="Team engagement"
        action={
          <>
            {canInvite && (
              <Button variant="ghost" size="xs" onClick={() => router.push("/organization?invite=player")}>
                <UserPlus />
                Invite players
              </Button>
            )}
            <Link href="/my-playlists" className="text-sm text-primary hover:underline">
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
