import { useState, useEffect, useMemo, useRef } from "react";
import { trackEvent } from "@/lib/analytics";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Film, Loader2, X } from "lucide-react";
import { GeneratingSession, type SavePhase } from "@/components/generating-session";
import { SyncPointPicker } from "@/components/sync-point-picker";
import { isSuggestionPending, TipoffSuggestionStrip } from "@/components/tipoff-suggestion-strip";
import { AutoHeight } from "@/components/ui/auto-height";
import { SearchField } from "@/components/ui/search-field";
import { probeVideoDuration } from "@/lib/video-probe";
import { fadeVariants, springs } from "@/lib/motion";
import { useTipoffSuggestion } from "@/lib/use-tipoff-suggestion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { saveMatch, findMatchBySourceGame, findImportedSourceGames } from "@/lib/matches-db";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { OrgMembership } from "@/types/org";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { PurchaseSheet } from "@/components/purchase-sheet";
import { PlayerBadge } from "@/components/import/player-badge";
import { usePlayerAccess } from "@/lib/player-access";
import { activePass, importBadge, parseGameAccess, type GameAccess, type GameBadge } from "@scoutable/shared/lib/player-access";
import { ImportSuccessDialog, type ImportSummary } from "@/components/import-success-dialog";
import { NT_LEAGUE_IDS } from "@scoutable/shared/lib/plan-tier";
import { fetchGameData, getLeagueSchedule, NATIONAL_TEAM_LEAGUES } from "@/lib/basketball-api";
import { useLeagues } from "@/lib/use-leagues";
import { Sentry } from "@/lib/sentry";
import type { ScheduleGame, League, Season, Stage } from "@/lib/basketball-api";
import { LeaguePicker } from "@/components/league-picker";
import { SingleSelectDropdown } from "@/components/ui/multi-select-dropdown";
import type { StoredMatch, SyncPoint, PlayByPlayEvent } from "@/types/match";
import { open } from "@tauri-apps/plugin-dialog";
import { useMyTeam } from "@/lib/my-team";
import { TeamDialog } from "@/components/team-dialog";
import { ImportViewToggle, type ImportView } from "@/components/import/import-view-toggle";
import { ImportedTag, TeamGamesPanel, type PickedFrom } from "@/components/import/team-games-panel";
import { choiceFor, spacesSharingAnswer, teamRoleIn, teamSpaces } from "@scoutable/shared/lib/league-teams";
import { getTeamSources } from "@scoutable/shared/lib/league-teams-db";
import { fromTeamSide, stageForMatchType, teamGames, teamSeasons, type TeamGame, type TeamSeason } from "@scoutable/shared/lib/team-games";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";
import { formatDate } from "@/lib/format-date";

// The import view a space last chose, on this computer. Only "all" is stored:
// a space with a team opens on its own games unless the user switched away.
const importViewKey = (orgId: string) => `scoutable_import_view:${orgId}`;
function readImportView(orgId: string | null): ImportView | null {
  if (!orgId) return null;
  try {
    return localStorage.getItem(importViewKey(orgId)) === "all" ? "all" : null;
  } catch {
    return null;
  }
}
function writeImportView(orgId: string | null, view: ImportView) {
  if (!orgId) return;
  try {
    if (view === "all") localStorage.setItem(importViewKey(orgId), "all");
    else localStorage.removeItem(importViewKey(orgId));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}

const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

function StepLabel({
  step,
  title,
  subtitle,
  done = false,
}: {
  step: number;
  title: string;
  subtitle?: string;
  /** The step is complete: its number becomes a check. */
  done?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="relative flex size-6 shrink-0 items-center justify-center">
        <AnimatePresence initial={false} mode="popLayout">
          {done ? (
            <motion.span
              key="done"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={springs.settle}
              className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          ) : (
            <motion.span
              key="todo"
              variants={fadeVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="flex size-6 items-center justify-center rounded-full bg-fill-2 text-xs font-semibold text-muted-foreground nums"
            >
              {step}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-title-3 text-foreground">{title}</span>
        {subtitle && <span className="truncate text-callout text-muted-foreground">{subtitle}</span>}
      </div>
    </div>
  );
}

/** h:mm:ss for a recording's length. */
function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}


function basename(path: string): string {
  return path.replace(/.*[\\/]/, "");
}


function GameRow({
  game,
  selected,
  loading,
  imported = false,
  badge,
  onClick,
}: {
  game: ScheduleGame;
  selected: boolean;
  loading: boolean;
  imported?: boolean;
  /** Player passes: replaces the Imported tag when given. */
  badge?: GameBadge | null;
  onClick: () => void;
}) {
  const date = formatDate(game.rawStartDateTime);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left outline-none transition-[background-color,transform] duration-100 active:scale-[0.995] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection",
        selected ? "bg-selection/15" : "hover:bg-fill-1 active:bg-fill-2"
      )}
    >
      <div className="min-w-[84px] shrink-0 text-callout text-muted-foreground nums">{date}</div>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        {game.homeTeamInfo.icon && (
          <img src={game.homeTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
        )}
        <span className="truncate text-sm font-medium text-foreground">
          {game.homeTeamInfo.names.short}
        </span>
        <span className="shrink-0 text-xs font-semibold text-foreground/80 nums">
          {game.homeTeamInfo.score}–{game.awayTeamInfo.score}
        </span>
        <span className="truncate text-sm font-medium text-foreground">
          {game.awayTeamInfo.names.short}
        </span>
        {game.awayTeamInfo.icon && (
          <img src={game.awayTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
        )}
      </div>
      <div className="shrink-0 text-xs text-muted-foreground hidden sm:block truncate max-w-[100px]">
        {game.venueInfo?.name}
      </div>
      {badge !== undefined ? badge && <PlayerBadge badge={badge} /> : imported && <ImportedTag />}
      {loading && selected ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
      )}
    </button>
  );
}

export function UploadZone({
  ntMemberships = [],
  hasClubAccess = false,
}: {
  ntMemberships?: OrgMembership[];
  hasClubAccess?: boolean;
}) {
  const { activeOrgId, activeOrg, activeOrgPlan, myOrgs, profile } = useAuth();
  const { choices, loaded: teamsLoaded } = useMyTeam();
  const { access: playerAccess, playerMode } = usePlayerAccess();

  const hasNtAccess = ntMemberships.length > 0;
  // Club leagues come from the edge function (see use-leagues); national teams
  // stay bundled — no competitionId, no data source decided.
  const clubLeagues = useLeagues();
  // Memoised so the selection effect below fires when the catalogue actually
  // changes, not on every render.
  const leagueList = useMemo(
    () => [
      ...(hasClubAccess ? clubLeagues : []),
      ...(hasNtAccess ? NATIONAL_TEAM_LEAGUES : []),
    ],
    [clubLeagues, hasClubAccess, hasNtAccess],
  );

  // League + season + stage picker state
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);

  // Select the first league once the list arrives (access props load async),
  // and re-resolve the current selection by id when the served catalogue
  // replaces the bundled one — otherwise selectedSeason keeps pointing at the
  // old object, and at whatever competitionId it carried.
  useEffect(() => {
    if (leagueList.length === 0) return;
    const league =
      (selectedLeague && leagueList.find((l) => l.id === selectedLeague.id)) ?? leagueList[0];
    const season =
      (selectedSeason && league.seasons.find((s) => s.id === selectedSeason.id)) ??
      league.seasons[0];
    const stage =
      (selectedStage && season?.stages.find((s) => s.id === selectedStage.id)) ??
      season?.stages[0];
    setSelectedLeague(league);
    setSelectedSeason(season ?? null);
    setSelectedStage(stage ?? null);
  }, [leagueList]);
  // ── Your games: the space's team, its seasons, and its games ──
  const activeChoice = choiceFor(choices, activeOrgId);
  // National-team spaces import from their own leagues; they have no team.
  const team = hasClubAccess ? activeChoice?.team ?? null : null;
  const teamId = team?.id ?? null;
  const [view, setView] = useState<ImportView>("all");
  const viewDecidedFor = useRef<string | null>(null);
  // Decide once per space and team: their own games, unless this space chose
  // "All games" before. Setting a team from the prompt switches to it.
  useEffect(() => {
    if (!teamsLoaded) return;
    const key = `${activeOrgId}:${teamId}`;
    if (viewDecidedFor.current === key) return;
    viewDecidedFor.current = key;
    setView(teamId && readImportView(activeOrgId) !== "all" ? "team" : "all");
  }, [teamsLoaded, activeOrgId, teamId]);

  const [teamSeasonList, setTeamSeasonList] = useState<TeamSeason[] | null>(null);
  const [teamSeason, setTeamSeason] = useState<TeamSeason | null>(null);
  useEffect(() => {
    setTeamSeasonList(null);
    if (!teamId || clubLeagues.length === 0) return;
    let cancelled = false;
    getTeamSources(createClient(), teamId)
      .then((sources) => {
        if (cancelled) return;
        const list = teamSeasons(sources, clubLeagues);
        setTeamSeasonList(list);
        const key = (s: TeamSeason) => `${s.league.id}/${s.season.id}`;
        setTeamSeason((prev) => list.find((s) => prev && key(s) === key(prev)) ?? list[0] ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[import] team seasons", err);
        Sentry.captureException(err);
        setView("all"); // the full picker still works
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, clubLeagues]);

  const [teamSchedule, setTeamSchedule] = useState<ScheduleGame[]>([]);
  const [teamStatus, setTeamStatus] = useState<"loading" | "idle" | "error">("loading");
  useEffect(() => {
    if (view !== "team" || !teamSeason) return;
    let cancelled = false;
    setTeamStatus("loading");
    getLeagueSchedule(teamSeason.league, teamSeason.season, null)
      .then((games) => {
        if (cancelled) return;
        setTeamSchedule(games);
        setTeamStatus("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[schedule]", err);
        Sentry.captureException(err);
        setTeamStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [view, teamSeason]);
  const myGames = useMemo(
    () => (teamSeason ? teamGames(teamSchedule, teamSeason.teamIds) : []),
    [teamSchedule, teamSeason],
  );
  // The team's ids across every season, to tell whether any picked game is theirs.
  const allTeamIds = useMemo(
    () => new Set((teamSeasonList ?? []).flatMap((s) => [...s.teamIds])),
    [teamSeasonList],
  );

  // Player passes: the live pass team's ids in the pass's season, so each
  // listed game can say whether the pass covers it (same rule as the import
  // trigger). The pass team can differ from "Your team" after a move.
  const livePass = playerMode && playerAccess ? activePass(playerAccess) : null;
  const [passTeamIds, setPassTeamIds] = useState<{ key: string; ids: Set<string> } | null>(null);
  const passKey = livePass ? `${livePass.teamId}/${livePass.seasonId}` : null;
  useEffect(() => {
    if (!livePass || !passKey) return;
    let cancelled = false;
    getTeamSources(createClient(), livePass.teamId)
      .then((sources) => {
        if (cancelled) return;
        const ids = new Set(sources.filter((s) => s.source === "genius" && s.seasonId === livePass.seasonId).map((s) => s.sourceTeamId));
        setPassTeamIds({ key: passKey, ids });
      })
      .catch((err) => console.error("[import] pass team sources", err));
    return () => {
      cancelled = true;
    };
    // passKey captures the pass's team and season
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passKey]);
  const coveredIds = passKey && passTeamIds?.key === passKey ? passTeamIds.ids : null;
  const badgeFor = (game: ScheduleGame): GameBadge | null =>
    playerMode && playerAccess
      ? importBadge(
          { imported: importedIds.has(game.uuid), covered: !!coveredIds && fromTeamSide(game, coveredIds) !== null },
          playerAccess,
        )
      : null;

  // Purchase sheet (player passes): opened by the precheck or the server's
  // import_limit_reached; a purchase that arrives resumes the import.
  const [purchaseSheetOpen, setPurchaseSheetOpen] = useState(false);
  const [sheetGame, setSheetGame] = useState<GameAccess | null>(null);
  const submitRef = useRef<() => Promise<void>>(async () => {});

  // How the picked game was found, for game_synced.
  const pickedFromRef = useRef<PickedFrom | "all_list">("all_list");
  const [teamPromptOpen, setTeamPromptOpen] = useState(false);

  // The full list opens on the team's league too, until the user picks another.
  const leagueTouched = useRef(false);
  const teamLeagueId = team?.leagueId ?? null;
  useEffect(() => {
    if (!teamLeagueId || leagueTouched.current) return;
    const league = leagueList.find((l) => l.id === teamLeagueId);
    if (!league || league.id === selectedLeague?.id) return;
    setSelectedLeague(league);
    setSelectedSeason(league.seasons[0] ?? null);
    setSelectedStage(league.seasons[0]?.stages[0] ?? null);
  }, [teamLeagueId, leagueList]);

  const [scheduleGames, setScheduleGames] = useState<ScheduleGame[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState<"loading" | "idle" | "error">("loading");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<ScheduleGame | null>(null);
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);
  // The same fixture already imported into this space — re-importing updates
  // that row in place instead of creating an identically-named duplicate.
  const [existingMatch, setExistingMatch] = useState<{ id: string; title: string } | null>(null);

  // Match data state
  const [matchTitle, setMatchTitle] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [homeColor, setHomeColor] = useState("");
  const [awayColor, setAwayColor] = useState("");

  const [homeRoster, setHomeRoster] = useState<RosterEntry[]>([
    { jerseyNumber: "", playerName: "" },
  ]);
  const [awayRoster, setAwayRoster] = useState<RosterEntry[]>([
    { jerseyNumber: "", playerName: "" },
  ]);

  const [playByPlayEvents, setPlayByPlayEvents] = useState<PlayByPlayEvent[]>([]);
  const [tipoffRealWorldTime, setTipoffRealWorldTime] = useState<string | null>(null);

  // Video state
  const [videoPath, setVideoPath] = useState<string | null>(null);
  // The picked file's length, for its card ("1:45:10"); null while unknown.
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  useEffect(() => {
    setVideoDuration(null);
    if (!videoPath) return;
    let cancelled = false;
    void probeVideoDuration(videoPath).then((d) => {
      if (!cancelled) setVideoDuration(d);
    });
    return () => {
      cancelled = true;
    };
  }, [videoPath]);
  const [syncSeconds, setSyncSeconds] = useState<number | null>(null);
  // Shared hint lookup, then automatic detection, for the linked recording.
  const tipoffSuggestion = useTipoffSuggestion(videoPath, selectedGame?.uuid, { surface: "import" });
  const [submitStatus, setSubmitStatus] = useState<"idle" | "saving" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [importLimitDialogOpen, setImportLimitDialogOpen] = useState(false);
  const [importLimitInfo, setImportLimitInfo] = useState<{ count: number; limit: number } | null>(null);
  // The save, as it really happens: "saving" while saveMatch runs, "done"
  // for a beat once it has, then the confirmation dialog takes over.
  const [savePhase, setSavePhase] = useState<SavePhase | null>(null);
  const saveStartedRef = useRef(0);
  const handoverTimers = useRef<number[]>([]);
  useEffect(() => () => handoverTimers.current.forEach((t) => window.clearTimeout(t)), []);
  const [importedSummary, setImportedSummary] = useState<ImportSummary | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);

  useEffect(() => {
    if (!selectedLeague || !selectedSeason || !selectedStage) return;
    // Guarded like the duplicate-detection effect below: without it a fast
    // league switch can land the previous league's schedule.
    let cancelled = false;
    setScheduleStatus("loading");
    setScheduleGames([]);
    getLeagueSchedule(selectedLeague, selectedSeason, selectedStage)
      .then((games) => {
        if (cancelled) return;
        setScheduleGames(games);
        setScheduleStatus("idle");
      })
      .catch((err) => {
        if (cancelled) return;
        // The user sees "Failed to load schedule"; without this we'd never
        // know it happened, which is how a whole league sat empty unnoticed.
        console.error("[schedule]", err);
        Sentry.captureException(err);
        setScheduleStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLeague, selectedSeason, selectedStage]);

  // Duplicate detection: same fixture (stable league uuid) in this space.
  useEffect(() => {
    const uuid = selectedGame?.uuid;
    if (!uuid) {
      setExistingMatch(null);
      return;
    }
    let cancelled = false;
    findMatchBySourceGame(uuid, activeOrgId ?? undefined)
      .then((m) => {
        if (!cancelled) setExistingMatch(m ? { id: m.id, title: m.title } : null);
      })
      .catch(() => {
        if (!cancelled) setExistingMatch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGame?.uuid, activeOrgId]);

  // "Imported" tags for whichever list is showing.
  const visibleIdsKey = (view === "team" ? myGames.map((g) => g.game.uuid) : scheduleGames.map((g) => g.uuid)).join(",");
  const [importedIds, setImportedIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const ids = visibleIdsKey ? visibleIdsKey.split(",") : [];
    let cancelled = false;
    findImportedSourceGames(ids, activeOrgId ?? undefined).then((set) => {
      if (!cancelled) setImportedIds(set);
    });
    return () => {
      cancelled = true;
    };
  }, [visibleIdsKey, activeOrgId]);

  const filteredGames = scheduleGames.filter((g) => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return (
      g.homeTeamInfo.names.short.toLowerCase().includes(q) ||
      g.homeTeamInfo.names.long.toLowerCase().includes(q) ||
      g.awayTeamInfo.names.short.toLowerCase().includes(q) ||
      g.awayTeamInfo.names.long.toLowerCase().includes(q) ||
      new Date(g.rawStartDateTime).toLocaleDateString("sv-SE").includes(q)
    );
  });

  function handleLeagueChange(league: League) {
    if (selectedLeague && league.id === selectedLeague.id) return;
    leagueTouched.current = true;
    setSelectedLeague(league);
    setSelectedSeason(league.seasons[0] ?? null);
    setSelectedStage(league.seasons[0]?.stages[0] ?? null);
    setSelectedGame(null);
    setSearchQuery("");
  }

  function handleSeasonChange(seasonId: string | null) {
    const season = selectedLeague?.seasons.find((s) => s.id === seasonId);
    if (!season || season.id === selectedSeason?.id) return;
    leagueTouched.current = true;
    setSelectedSeason(season);
    setSelectedStage(season.stages[0] ?? null);
    setSelectedGame(null);
    setSearchQuery("");
  }

  function handleStageChange(stageId: string | null) {
    const stage = selectedSeason?.stages.find((s) => s.id === stageId);
    if (!stage || stage.id === selectedStage?.id) return;
    leagueTouched.current = true;
    setSelectedStage(stage);
    setSelectedGame(null);
    setSearchQuery("");
  }

  function changeView(next: ImportView) {
    if (next === view) return;
    setView(next);
    writeImportView(activeOrgId, next);
    trackEvent("import_view_changed", { view: next });
  }

  /** A game from "Your games": its league, season and stage come from the game. */
  function handlePickTeamGame(tg: TeamGame, from: PickedFrom) {
    if (!teamSeason?.season.competitionId) return; // Genius seasons only
    const { league, season } = teamSeason;
    setSelectedLeague(league);
    setSelectedSeason(season);
    setSelectedStage(stageForMatchType(season, tg.game.matchType));
    pickedFromRef.current = from;
    void handleSelectGame(tg.game, season);
  }

  function clearSelectedGame() {
    setSelectedGame(null);
    setFetchStatus("idle");
    setFetchError(null);
    setPlayByPlayEvents([]);
    setTipoffRealWorldTime(null);
    setHomeRoster([{ jerseyNumber: "", playerName: "" }]);
    setAwayRoster([{ jerseyNumber: "", playerName: "" }]);
  }

  async function handleSelectGame(game: ScheduleGame, seasonOverride?: Season) {
    const season = seasonOverride ?? selectedSeason;
    if (!season) return;
    if (!seasonOverride) pickedFromRef.current = "all_list";
    setSelectedGame(game);
    setFetchStatus("loading");
    setFetchError(null);

    // Seed names and date from schedule data immediately so the match is always
    // populated even if the game-data call fails or the user submits quickly.
    const fallbackHome = game.homeTeamInfo.names.long;
    const fallbackAway = game.awayTeamInfo.names.long;
    setHomeTeam(fallbackHome);
    setAwayTeam(fallbackAway);
    setMatchTitle(`${fallbackHome} vs ${fallbackAway}`);
    const fallbackDate = new Date(game.rawStartDateTime);
    if (!isNaN(fallbackDate.getTime())) {
      setMatchDate(fallbackDate.toISOString().slice(0, 10));
    }

    try {
      const data = await fetchGameData(season, game);

      const home = data.homeName || fallbackHome;
      const away = data.awayName || fallbackAway;
      setHomeTeam(home);
      setAwayTeam(away);
      setMatchTitle(`${home} vs ${away}`);
      if (data.date) setMatchDate(data.date);

      setHomeRoster(data.homeRoster.length ? data.homeRoster : [{ jerseyNumber: "", playerName: "" }]);
      setAwayRoster(data.awayRoster.length ? data.awayRoster : [{ jerseyNumber: "", playerName: "" }]);

      setPlayByPlayEvents(data.events);
      setTipoffRealWorldTime(data.tipoffRealWorldTime);

      // Schedule filtering hides PBP-less games, so this is belt-and-braces —
      // but if it ever happens, say so instead of showing an empty timeline.
      if (data.pbpStatus === "empty") {
        setFetchStatus("error");
        setFetchError("No play-by-play is available for this game, so clips can't be created from it.");
        return;
      }

      setFetchStatus("idle");
    } catch (err) {
      setFetchStatus("error");
      setFetchError(err instanceof Error ? err.message : "Failed to fetch game data.");
      // Team names/date are already set from schedule data above — no further action needed.
    }
  }

  async function handlePickVideo() {
    const result = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v"] }],
    });
    if (typeof result === "string") {
      setVideoPath(result);
    }
  }

  async function handleSubmit() {
    if (!selectedLeague) return;
    const isNtLeague = NT_LEAGUE_IDS.includes(selectedLeague.id);

    // UX precheck only — the real gate is the import trigger's
    // import_limit_reached, handled in the saveMatch catch below. Updates of
    // an existing game never touch the quota (upsert, not insert).
    if (playerMode && activeOrgId && !existingMatch && selectedGame) {
      // Player passes: ask about this game (season pass, free game, bought
      // game); a failed check falls through to the server's gate.
      const { data, error } = await createClient().rpc("check_game_access", {
        p_org_id: activeOrgId,
        p_game_key: selectedGame.uuid,
        p_league_id: selectedLeague.id,
      });
      if (!error && data) {
        const ga = parseGameAccess(data);
        if (!ga.allowed) {
          setSheetGame(ga);
          setPurchaseSheetOpen(true);
          return;
        }
      }
    } else if (!isNtLeague && activeOrgId && !existingMatch) {
      const { data } = await createClient().rpc("get_import_quota", { p_org_id: activeOrgId });
      const quota = data as { limit: number | null; used: number; remaining: number | null } | null;
      if (quota?.limit != null && (quota.remaining ?? 0) <= 0) {
        setImportLimitInfo({ count: quota.used, limit: quota.limit });
        setImportLimitDialogOpen(true);
        return;
      }
    }

    if (!selectedGame) {
      setSubmitError("Select a game first to continue.");
      return;
    }

    setSubmitError(null);
    setSubmitStatus("saving");
    setSavePhase("saving");
    saveStartedRef.current = performance.now();
    setImportedSummary(null);

    let syncPoint: SyncPoint | undefined;
    if (syncSeconds !== null) {
      syncPoint = {
        syncVideoTime: syncSeconds,
        syncRealWorldTime: tipoffRealWorldTime ?? "",
      };
    }

    // Re-imports keep the existing row id — saveMatch upserts, so the game
    // updates in place and playlist clips (keyed on match_id + event_id)
    // keep working. A fresh id would create an identically-named duplicate.
    const matchId = existingMatch?.id ?? crypto.randomUUID();
    const storedMatch: StoredMatch = {
      id: matchId,
      // Stable across re-imports of the same fixture — dedupes the quota log.
      sourceGameId: selectedGame?.uuid,
      title: matchTitle || `${homeTeam} vs ${awayTeam}`,
      date: matchDate || new Date().toISOString().slice(0, 10),
      homeTeam: { name: homeTeam, color: homeColor },
      awayTeam: { name: awayTeam, color: awayColor },
      homeRoster,
      awayRoster,
      videoUrl: videoPath ?? undefined,
      syncPoint,
      events: playByPlayEvents,
      leagueId: selectedLeague.id,
      seasonId: selectedSeason?.id,
      stageId: selectedStage?.id,
      orgId: activeOrgId ?? undefined,
    };

    try {
      await saveMatch(storedMatch, { refreshEvents: !!existingMatch });
      trackEvent('game_synced', {
        game_id: matchId,
        // Which fixture: team names and league are public, so they can live in analytics.
        title: storedMatch.title,
        league: selectedLeague.name,
        season: selectedSeason?.label ?? null,
        source_game_id: storedMatch.sourceGameId ?? null,
        match_date: storedMatch.date,
        has_video: !!videoPath,
        has_sync_point: !!syncPoint,
        has_play_by_play: playByPlayEvents.length > 0,
        event_count: playByPlayEvents.length,
        reimport: !!existingMatch,
        tipoff_suggestion: tipoffSuggestion.source,
        picked_from: pickedFromRef.current,
        team_game: !!selectedGame && fromTeamSide(selectedGame, allTeamIds) !== null,
      })
      if (syncPoint) {
        // The confirmed offset becomes this recording's shared hint; never blocks the import.
        tipoffSuggestion.recordResolved(syncPoint.syncVideoTime);
        void tipoffSuggestion.saveConfirmed(syncPoint.syncVideoTime);
      }
    } catch (err) {
      setSubmitStatus("error");
      setSavePhase(null);
      // Server-side quota gate (the precheck can race a concurrent import).
      if (err instanceof Error && err.message.includes("import_limit_reached")) {
        setSubmitError(null);
        if (playerMode && activeOrgId && selectedGame) {
          const { data } = await createClient().rpc("check_game_access", {
            p_org_id: activeOrgId,
            p_game_key: selectedGame.uuid,
            p_league_id: selectedLeague.id,
          });
          setSheetGame(data ? parseGameAccess(data) : null);
          setPurchaseSheetOpen(true);
          return;
        }
        setImportLimitInfo(null);
        setImportLimitDialogOpen(true);
        return;
      }
      trackEvent("game_sync_failed", { error: String(err).slice(0, 200) });
      setSubmitError(err instanceof Error ? err.message : "Failed to save match.");
      return;
    }

    setSubmitStatus("idle");
    setImportedSummary({
      matchId,
      title: storedMatch.title,
      clipCount: playByPlayEvents.length,
      hasVideo: !!videoPath,
      hasSyncPoint: !!syncPoint,
      isUpdate: !!existingMatch,
    });
    // Long enough to read (a fast save would only flash), then a beat on
    // "Ready" before the confirmation takes the overlay's place.
    const shown = performance.now() - saveStartedRef.current;
    handoverTimers.current.push(
      window.setTimeout(() => {
        setSavePhase("done");
        handoverTimers.current.push(
          window.setTimeout(() => {
            setSavePhase(null);
            setSuccessOpen(true);
          }, 450),
        );
      }, Math.max(0, 600 - shown)),
    );
  }

  submitRef.current = handleSubmit;

  const tipoffLocalHint = tipoffRealWorldTime
    ? (() => {
        const d = new Date(tipoffRealWorldTime);
        return isNaN(d.getTime())
          ? null
          : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      })()
    : null;

  const isSubmitting = submitStatus === "saving";

  if (!selectedLeague) return null;

  return (
    <>
    {teamPromptOpen && activeOrg && (
      <TeamDialog
        mode="change"
        surface="import"
        org={activeOrg}
        otherSpaces={sortOrgsClubFirst(teamSpaces(myOrgs)).filter((o) => o.orgId !== activeOrg.orgId)}
        defaultChecked={spacesSharingAnswer(teamSpaces(myOrgs), choices, activeOrg.orgId).filter((id) => id !== activeOrg.orgId)}
        initialTeamId={null}
        role={teamRoleIn(activeOrg, profile?.declaredRole)}
        onDone={() => setTeamPromptOpen(false)}
        onDismiss={() => setTeamPromptOpen(false)}
      />
    )}
    <UpgradeDialog
      open={importLimitDialogOpen}
      onClose={() => setImportLimitDialogOpen(false)}
      analyticsFeature="import_limit"
      analyticsSource="import_limit_dialog"
      featureName={activeOrgPlan === "rookie" ? "Monthly import limit reached" : "Free import limit reached"}
      description={activeOrgPlan === "rookie"
        ? `You've used all ${importLimitInfo?.limit ?? 6} Rookie imports for this month — they reset on the 1st. Upgrade to Pro and never count imports again.`
        : `That was the last of your ${importLimitInfo?.limit ?? 3} free games. Keep importing with Rookie — 6 games every month plus MP4 export. Cancel anytime.`}
    />
    <PurchaseSheet
      open={purchaseSheetOpen}
      onClose={() => setPurchaseSheetOpen(false)}
      title="Import this game"
      surface="import"
      game={sheetGame}
      gameKey={selectedGame?.uuid ?? null}
      analyticsFeature="import_limit"
      onPurchased={() => void submitRef.current()}
      onSetTeam={() => {
        setPurchaseSheetOpen(false);
        setTeamPromptOpen(true);
      }}
    />
    <div className="mx-auto max-w-2xl space-y-8 pt-2">
      {/* Step 1 — Pick a game */}
      <div className="space-y-3">
        <StepLabel step={1} title="Pick a game" done={!!selectedGame && playByPlayEvents.length > 0} />
        <Card className="py-4">
          <CardContent className="px-4">
          <AutoHeight innerClassName="space-y-3">
            {!selectedGame && team && (
              <ImportViewToggle team={team} view={view} onChange={changeView} />
            )}
            {!selectedGame && !team && hasClubAccess && teamsLoaded && !activeChoice?.unlistedTeam && activeOrg && (
              <p className="text-xs text-muted-foreground">
                See your team&apos;s games first.{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => setTeamPromptOpen(true)}
                >
                  Set your team
                </button>
              </p>
            )}

            {view === "team" && team && !selectedGame ? (
              <TeamGamesPanel
                team={team}
                seasons={teamSeasonList}
                selected={teamSeason}
                onSeasonChange={setTeamSeason}
                status={teamStatus}
                games={myGames}
                importedIds={importedIds}
                onPick={handlePickTeamGame}
                onShowAll={() => changeView("all")}
                badgeFor={playerMode ? badgeFor : undefined}
              />
            ) : (
            <>
            {/* League · Season · Stage.
                Season and Stage stay hidden while there's only one option —
                no dead controls for single-season leagues. A game picked from
                "Your games" shows on its own: the pickers belong to All games. */}
            {!(view === "team" && team) && (
            <div className="flex flex-wrap items-center gap-2">
              <LeaguePicker
                leagues={leagueList}
                value={selectedLeague}
                onChange={handleLeagueChange}
              />
              {selectedLeague.seasons.length > 1 && (
                <SingleSelectDropdown
                  options={selectedLeague.seasons.map((s) => ({ value: s.id, label: s.label }))}
                  value={selectedSeason?.id ?? null}
                  onChange={handleSeasonChange}
                  placeholder="Season"
                  required
                />
              )}
              {(selectedSeason?.stages.length ?? 0) > 1 && (
                <SingleSelectDropdown
                  options={(selectedSeason?.stages ?? []).map((s) => ({ value: s.id, label: s.label }))}
                  value={selectedStage?.id ?? null}
                  onChange={handleStageChange}
                  placeholder="Stage"
                  required
                />
              )}
            </div>
            )}

            <AnimatePresence mode="popLayout" initial={false}>
            {selectedGame ? (
              <motion.div
                key="picked"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={springs.standard}
                className="flex items-center justify-between gap-3 rounded-lg bg-primary/8 px-3 py-2.5 ring-1 ring-primary/20"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ ...springs.settle, delay: 0.05 }}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </motion.span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {selectedGame.homeTeamInfo.icon && (
                        <img src={selectedGame.homeTeamInfo.icon} alt="" className="size-5 shrink-0 object-contain" />
                      )}
                      <span className="truncate text-sm font-semibold text-foreground">
                        {selectedGame.homeTeamInfo.names.short}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-foreground/80 nums">
                        {selectedGame.homeTeamInfo.score}–{selectedGame.awayTeamInfo.score}
                      </span>
                      <span className="truncate text-sm font-semibold text-foreground">
                        {selectedGame.awayTeamInfo.names.short}
                      </span>
                      {selectedGame.awayTeamInfo.icon && (
                        <img src={selectedGame.awayTeamInfo.icon} alt="" className="size-5 shrink-0 object-contain" />
                      )}
                    </div>
                    <p className="truncate text-subheadline text-muted-foreground nums">
                      {formatDate(selectedGame.rawStartDateTime)}
                      {selectedGame.venueInfo?.name ? ` · ${selectedGame.venueInfo.name}` : ""}
                    </p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={clearSelectedGame}>
                  Change
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="list"
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-3"
              >
                <SearchField
                  placeholder="Search by team or date"
                  aria-label="Search games"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />

                {scheduleStatus === "loading" && (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="text-sm">Loading schedule…</span>
                  </div>
                )}

                {scheduleStatus === "error" && (
                  <p className="py-4 text-center text-sm text-destructive">
                    Failed to load schedule. Check your connection.
                  </p>
                )}

                {scheduleStatus === "idle" && (
                  <div className="-mx-1 max-h-72 overflow-y-auto">
                    {filteredGames.length === 0 ? (
                      // An empty schedule (early in a season, before any game
                      // is COMPLETE) reads differently from a search miss.
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        {scheduleGames.length === 0 && (selectedLeague?.seasons.length ?? 0) > 1
                          ? `No completed games in ${selectedSeason?.label ?? "this season"} yet — switch season above to import earlier games.`
                          : "No games found."}
                      </p>
                    ) : (
                      filteredGames.map((game: ScheduleGame) => (
                        <GameRow
                          key={game.uuid}
                          game={game}
                          selected={false}
                          loading={false}
                          imported={importedIds.has(game.uuid)}
                          badge={playerMode ? badgeFor(game) : undefined}
                          onClick={() => handleSelectGame(game)}
                        />
                      ))
                    )}
                  </div>
                )}
              </motion.div>
            )}
            </AnimatePresence>
            </>
            )}

            {fetchStatus === "error" && fetchError && (
              <p className="text-callout text-destructive">{fetchError}</p>
            )}
            {fetchStatus === "loading" && selectedGame && (
              <p className="flex items-center gap-2 text-callout text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Fetching the play-by-play…
              </p>
            )}
            {playByPlayEvents.length > 0 && (
              <p className="text-callout text-emerald-700 dark:text-emerald-400">
                {playByPlayEvents.length} plays ready to clip.
              </p>
            )}
          </AutoHeight>
          </CardContent>
        </Card>
      </div>

      {/* Step 2 — Video and tip-off */}
      <div className="space-y-3">
        <StepLabel
          step={2}
          title="Video and tip-off"
          subtitle="Plays from your computer"
          done={!!videoPath && syncSeconds !== null}
        />
        <Card className="py-4">
          <CardContent className="px-4">
          <AutoHeight innerClassName="space-y-4">
            {/* Click-to-pick only: OS file drops are disabled app-wide
                (dragDropEnabled: false), so the target is a button, not a
                drop zone. Once picked it becomes the file's card. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {videoPath ? (
                <motion.div
                  key="file"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={springs.standard}
                  className="flex items-center gap-3 rounded-lg bg-fill-1 px-3 py-2.5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
                    <Film className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={videoPath}>
                      {basename(videoPath)}
                    </p>
                    <p className="truncate text-subheadline text-muted-foreground nums" title={videoPath}>
                      {videoDuration !== null ? `${formatDuration(videoDuration)} · ` : ""}
                      {videoPath.replace(/[\\/][^\\/]*$/, "")}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={handlePickVideo}>
                    Change…
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove video"
                    title="Remove video"
                    onClick={() => setVideoPath(null)}
                  >
                    <X />
                  </Button>
                </motion.div>
              ) : (
                <motion.button
                  key="pick"
                  type="button"
                  variants={fadeVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  onClick={handlePickVideo}
                  className="flex w-full flex-col items-center justify-center gap-1 rounded-lg bg-fill-1 px-6 py-8 text-center outline-none transition-[background-color,transform] duration-150 hover:bg-fill-2 active:scale-[0.99] active:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection"
                >
                  <Film className="mb-1 size-7 text-muted-foreground" />
                  <span className="text-headline text-foreground">Choose the game's video…</span>
                  <span className="max-w-md text-callout text-muted-foreground">
                    MP4, MOV, AVI or MKV. It plays from your computer; a few stills from the first minutes go to Scoutable to find the tip-off.
                  </span>
                </motion.button>
              )}
            </AnimatePresence>

            {/* Sync point */}
            {videoPath && (
              <div className="border-t border-separator pt-4">
                <SyncPointPicker
                  videoPath={videoPath}
                  tipoffHint={tipoffLocalHint ?? undefined}
                  onConfirm={(secs) => setSyncSeconds(secs)}
                  seekRequest={tipoffSuggestion.seekRequest}
                  onUserAction={tipoffSuggestion.noteUserAction}
                  hasPendingSuggestion={isSuggestionPending(tipoffSuggestion.state)}
                  suggestionSlot={
                    <TipoffSuggestionStrip
                      state={tipoffSuggestion.state}
                      onAccept={tipoffSuggestion.accept}
                      onReject={tipoffSuggestion.reject}
                      onCancel={tipoffSuggestion.cancel}
                    />
                  }
                />
              </div>
            )}
          </AutoHeight>
          </CardContent>
        </Card>
      </div>

      {existingMatch && (
        <p className="rounded-lg bg-fill-1 px-4 py-3 text-sm text-foreground">
          Already in your library as{" "}
          <span className="font-semibold">{existingMatch.title}</span>. Importing again
          updates that game — events and rosters refresh, and your playlists keep working.
        </p>
      )}

      {/* What the button is waiting for, in one line that changes in place. */}
      <div className="flex items-center gap-4">
        <div className="relative min-h-5 min-w-0 flex-1">
          <AnimatePresence mode="popLayout" initial={false}>
            {(() => {
              const status: { key: string; text: string; tone: "muted" | "error" } =
                submitStatus === "error" && submitError
                  ? { key: "error", text: submitError, tone: "error" }
                  : !selectedGame
                    ? { key: "game", text: "Pick a game to continue.", tone: "muted" }
                    : !videoPath
                      ? { key: "video", text: "Choose the game's video to continue.", tone: "muted" }
                      : syncSeconds === null
                        ? { key: "sync", text: "Set the tip-off to continue.", tone: "muted" }
                        : { key: "ready", text: existingMatch ? "Ready to update." : "Ready to import.", tone: "muted" };
              return (
                <motion.p
                  key={status.key}
                  variants={fadeVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  role={status.tone === "error" ? "alert" : "status"}
                  className={cn("text-sm", status.tone === "error" ? "text-destructive" : "text-muted-foreground")}
                >
                  {status.text}
                </motion.p>
              );
            })()}
          </AnimatePresence>
        </div>
        <Button
          size="lg"
          className="shrink-0"
          onClick={handleSubmit}
          disabled={isSubmitting || !selectedGame || !videoPath || syncSeconds === null}
        >
          {submitStatus === "saving" ? (
            <>
              <Loader2 className="animate-spin" />
              {existingMatch ? "Updating…" : "Importing…"}
            </>
          ) : existingMatch ? (
            "Update game"
          ) : (
            "Import game"
          )}
        </Button>
      </div>

      <GeneratingSession
        phase={savePhase}
        eventCount={playByPlayEvents.length}
        isUpdate={!!existingMatch}
      />

      <ImportSuccessDialog open={successOpen} summary={importedSummary} />
    </div>
    </>
  );
}
