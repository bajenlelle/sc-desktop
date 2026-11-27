import { useEffect, useMemo, useRef, useState } from "react";
import { addClipsGames } from "@scoutable/shared/lib/archived-games";
import type { ReportTeam } from "@scoutable/shared/lib/report-draft";
import { teamGameRows } from "@scoutable/shared/lib/team-schedule";
import { teamLibraryGames } from "@scoutable/shared/lib/team-video";
import { isClipItem, type Playlist, type StoredMatch } from "@/types/match";
import { useAuth } from "@/lib/auth-context";
import { listMatchesLight } from "@/lib/matches-db";
import { useLeague } from "@/lib/use-league";
import { useLibraryGames } from "@/lib/use-library-games";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";

export interface ReportAddClipsSource {
  /** The library's games the sheet offers (archived ones only when the report has their clips); null until read. */
  games: StoredMatch[] | null;
  /** The read failed: the sheet can't open. */
  failed: boolean;
  /** The opponent's played games in the library, newest first: where the sheet starts. */
  opponentGames: string[];
  /** The opponent's name in each of those games, as the game names its teams: the sheet's Team filter. */
  opponentNames: string[];
  /** Whether each library game's video is on this computer, read while the sheet is open. */
  videoStatus: Map<string, VideoFileStatus>;
}

/**
 * What a report's Add clips sheet browses (docs/scouting-reports.md, "Adding
 * clips"): the coach's library, read the first time the sheet opens and kept
 * for the page's life, the games against the report's opponent first, and
 * the video probe the sheet's player needs. The playlist editor reads the
 * same for its own sheet (pages/playlists.tsx).
 */
export function useReportAddClips(open: boolean, playlist: Playlist, team: ReportTeam | null): ReportAddClipsSource {
  const { activeOrgId, activeOrgIsPersonal } = useAuth();
  const [library, setLibrary] = useState<{ games: StoredMatch[] | null; failed: boolean }>({ games: null, failed: false });
  const asked = useRef(false);

  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    let cancelled = false;
    listMatchesLight(activeOrgId ?? undefined, { ownOnly: true, includeUnscoped: activeOrgIsPersonal })
      .then((games) => !cancelled && setLibrary({ games, failed: false }))
      .catch(() => {
        asked.current = false;
        if (!cancelled) setLibrary({ games: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeOrgId, activeOrgIsPersonal]);

  const reportGameIds = useMemo(() => [...new Set(playlist.items.filter(isClipItem).map((c) => c.matchId))], [playlist.items]);
  const games = useMemo(
    () => (library.games ? addClipsGames(library.games, null, new Set(reportGameIds)) : null),
    [library.games, reportGameIds],
  );

  // The opponent's games: its season's played games that the coach has (the Teams page's Plays read the same).
  const league = useLeague(open && team ? team.competitionId : null);
  const libraryGames = useLibraryGames();
  const opponent = useMemo(() => {
    if (!team || !league.payload) return { ids: [] as string[], names: [] as string[] };
    const rows = teamGameRows(league.fixtures, league.payload, team.teamId, new Date());
    const ours = teamLibraryGames(rows, libraryGames.games);
    const byId = new Map((games ?? []).map((m) => [m.id, m]));
    const ids: string[] = [];
    const names = new Set<string>([team.name]);
    for (const g of ours) {
      const m = byId.get(g.gameId);
      if (!m) continue;
      ids.push(m.id);
      names.add((g.side === 1 ? m.homeTeam : m.awayTeam).name);
    }
    return { ids, names: [...names] };
  }, [team, league.payload, league.fixtures, libraryGames.games, games]);

  // Whether each game's video is here, while the sheet is open (the playlists page probes the same).
  const [videoStatus, setVideoStatus] = useState<Map<string, VideoFileStatus>>(new Map());
  useEffect(() => {
    if (!open || !games || games.length === 0) return;
    let cancelled = false;
    void probeMatches(games).then((map) => !cancelled && setVideoStatus(map));
    return () => {
      cancelled = true;
    };
  }, [open, games]);

  return { games, failed: library.failed, opponentGames: opponent.ids, opponentNames: opponent.names, videoStatus };
}
