import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { ReportGame } from "@scoutable/shared/lib/report-draft";
import type { ReportDraftRow } from "@scoutable/shared/lib/scouting-report-list";
import { findTeamReport } from "@scoutable/shared/lib/team-report";
import { useAuth } from "@/lib/auth-context";
import { PLAYLISTS_CHANGED } from "@/lib/playlist-events";
import { listPlaylistNames } from "@/lib/playlists-db";
import { listReportDrafts } from "@/lib/report-drafts-db";
import { createNamedReport, createTeamReport, nextGameAgainstUs, resolveLeagueTeam, type ReportStartFrom } from "@/lib/team-report";
import { useLeagues } from "@/lib/use-leagues";
import { useSpaceTeam } from "@/lib/use-my-team-ids";
import { reportPath } from "@/pages/report";

/** The space's drafts and playlist ids, read again when playlists change and when the window comes back. */
export function useSpaceDrafts(): { ready: boolean; rows: ReportDraftRow[]; inSpace: ReadonlySet<string> } {
  const { activeOrgId, activeOrgIsPersonal } = useAuth();
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ scope: string; rows: ReportDraftRow[]; inSpace: ReadonlySet<string> } | null>(null);
  const scope = `${activeOrgId}:${activeOrgIsPersonal}`;

  useEffect(() => {
    const again = () => setNonce((n) => n + 1);
    window.addEventListener(PLAYLISTS_CHANGED, again);
    window.addEventListener("focus", again);
    return () => {
      window.removeEventListener(PLAYLISTS_CHANGED, again);
      window.removeEventListener("focus", again);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listReportDrafts(), listPlaylistNames(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal })])
      .then(([rows, playlists]) => {
        if (!cancelled) setState({ scope, rows, inSpace: new Set(playlists.map((p) => p.id)) });
      })
      // Unknown: the button offers New report, and a second report for the game is the worst it does.
      .catch((e) => console.error("[report] drafts read failed:", e));
    return () => {
      cancelled = true;
    };
  }, [scope, activeOrgId, activeOrgIsPersonal, nonce]);

  const current = state?.scope === scope ? state : null;
  return { ready: !!current, rows: current?.rows ?? [], inSpace: current?.inSpace ?? new Set() };
}

export interface TeamReportControl {
  /** The report this team has for the game (or, without one, its report with no game); null when it has none yet. */
  playlistId: string | null;
  /** Making one now. */
  busy: boolean;
  /** Whether the team has a report is known; until then a press would make a second one. */
  ready: boolean;
  /** Opens the team's report, making it first when there is none. */
  openOrStart: () => void;
}

/**
 * New report / Open report for a team (Team page, Teams' next game): one
 * report per game against the space's team, or one with no game when they
 * don't meet again. A press while one is being made does nothing.
 */
export function useTeamReport(
  team: { competitionId: number; teamId: number } | null,
  game: ReportGame | null,
  from: ReportStartFrom,
  /** What Back on the report says: the team's name on its page. */
  backName?: string,
): TeamReportControl {
  const navigate = useNavigate();
  const { activeOrgId } = useAuth();
  const spaceTeam = useSpaceTeam();
  const leagues = useLeagues();
  const drafts = useSpaceDrafts();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const playlistId = team ? findTeamReport(drafts.rows, drafts.inSpace, team, game?.id ?? null) : null;

  const location = useLocation();
  const backLabel = from === "next_game" ? "Teams" : (backName ?? "Team");
  const open = useCallback(
    (id: string) => navigate(reportPath(id), { state: { back: { label: backLabel, path: location.pathname + location.search, state: location.state } } }),
    [navigate, backLabel, location.pathname, location.search, location.state],
  );

  const openOrStart = useCallback(() => {
    if (!team || busyRef.current || !drafts.ready) return;
    if (playlistId) {
      open(playlistId);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    createTeamReport({ ...team, game }, { orgId: activeOrgId, spaceTeamId: spaceTeam?.id ?? null, leagues, from })
      .then(open)
      .catch((e) => {
        console.error("[report] couldn't start the report:", e);
        toast.error("Couldn’t create the report. Check your connection and try again.");
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [team, game, playlistId, open, activeOrgId, spaceTeam?.id, leagues, from, drafts.ready]);

  return { playlistId, busy, ready: drafts.ready, openOrStart };
}

/**
 * Reports' New report: a report for a catalogue team (its next game against
 * the space's team, or none), for the next opponent, or for a typed name.
 * The team's report for that game opens when it has one already. A press
 * while one is being made does nothing.
 */
export function useReportStarter(): {
  busy: boolean;
  forTeam: (team: { competitionId: number; teamId: number }, game?: ReportGame | null) => Promise<boolean>;
  forLeagueTeam: (leagueTeamId: string) => Promise<boolean>;
  forName: (name: string) => Promise<boolean>;
} {
  const navigate = useNavigate();
  const { activeOrgId } = useAuth();
  const spaceTeamId = useSpaceTeam()?.id ?? null;
  const leagues = useLeagues();
  const drafts = useSpaceDrafts();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(
    async (make: () => Promise<string | null>): Promise<boolean> => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        const id = await make();
        if (!id) return false;
        navigate(reportPath(id), { state: { back: { label: "Reports", path: "/reports" } } });
        return true;
      } catch (e) {
        console.error("[report] couldn't start the report:", e);
        toast.error("Couldn’t create the report. Check your connection and try again.");
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [navigate],
  );

  const forTeam = useCallback(
    (team: { competitionId: number; teamId: number }, known?: ReportGame | null) =>
      run(async () => {
        const game = known !== undefined ? known : await nextGameAgainstUs(team.competitionId, team.teamId, spaceTeamId, leagues).catch(() => null);
        const existing = findTeamReport(drafts.rows, drafts.inSpace, team, game?.id ?? null);
        return existing ?? createTeamReport({ ...team, game }, { orgId: activeOrgId, spaceTeamId, leagues, from: "reports" });
      }),
    [run, spaceTeamId, leagues, drafts.rows, drafts.inSpace, activeOrgId],
  );

  const forLeagueTeam = useCallback(
    async (leagueTeamId: string) => {
      const team = await resolveLeagueTeam(leagueTeamId, leagues).catch(() => null);
      if (!team) {
        toast.error("This team isn’t in a league with statistics. Type its name to start an empty report.");
        return false;
      }
      return forTeam(team);
    },
    [leagues, forTeam],
  );

  const forName = useCallback((name: string) => run(() => createNamedReport(name, { orgId: activeOrgId })), [run, activeOrgId]);

  return { busy, forTeam, forLeagueTeam, forName };
}
