import { useState, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { Film, X, Loader2, Search, ChevronRight } from "lucide-react";
import { GeneratingSession } from "@/components/generating-session";
import { SyncPointPicker } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { saveMatch, findMatchBySourceGame } from "@/lib/matches-db";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { OrgMembership } from "@/types/org";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { ImportSuccessDialog, type ImportSummary } from "@/components/import-success-dialog";
import { NT_LEAGUE_IDS } from "@scoutable/shared/lib/plan-tier";
import { fetchGameData, getLeagueSchedule, LEAGUES, NATIONAL_TEAM_LEAGUES } from "@/lib/basketball-api";
import type { ScheduleGame, League, Season, Stage } from "@/lib/basketball-api";
import { LeaguePicker } from "@/components/league-picker";
import { SingleSelectDropdown } from "@/components/ui/multi-select-dropdown";
import type { StoredMatch, SyncPoint, PlayByPlayEvent } from "@/types/match";
import { open } from "@tauri-apps/plugin-dialog";

const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

function StepLabel({
  step,
  title,
  subtitle,
}: {
  step: number;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-1">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
        {step}
      </span>
      <div>
        <span className="text-base font-semibold text-foreground">{title}</span>
        {subtitle && (
          <span className="ml-2 text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
    </div>
  );
}


function basename(path: string): string {
  return path.replace(/.*[\\/]/, "");
}


function GameRow({
  game,
  selected,
  loading,
  onClick,
}: {
  game: ScheduleGame;
  selected: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  const date = new Date(game.rawStartDateTime).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        selected
          ? "bg-primary/10 ring-1 ring-primary/50"
          : "hover:bg-muted"
      )}
    >
      <div className="min-w-[80px] text-xs text-muted-foreground shrink-0">{date}</div>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        {game.homeTeamInfo.icon && (
          <img src={game.homeTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
        )}
        <span className="truncate text-sm font-medium text-foreground">
          {game.homeTeamInfo.names.short}
        </span>
        <span className="shrink-0 text-xs font-bold text-foreground/80">
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
      {loading && selected ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0 text-primary" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40" />
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
  const { activeOrgId, activeOrgPlan } = useAuth();

  const hasNtAccess = ntMemberships.length > 0;
  const leagueList = [
    ...(hasClubAccess ? LEAGUES : []),
    ...(hasNtAccess ? NATIONAL_TEAM_LEAGUES : []),
  ];

  // League + season + stage picker state
  const [selectedLeague, setSelectedLeague] = useState<League | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);

  // Auto-select first league once leagueList is populated (props load async)
  useEffect(() => {
    if (leagueList.length > 0 && selectedLeague === null) {
      const first = leagueList[0];
      setSelectedLeague(first);
      setSelectedSeason(first.seasons[0] ?? null);
      setSelectedStage(first.seasons[0]?.stages[0] ?? null);
    }
  }, [leagueList.length]);
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
  const [dragActive, setDragActive] = useState(false);
  const [syncSeconds, setSyncSeconds] = useState<number | null>(null);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "saving" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [importLimitDialogOpen, setImportLimitDialogOpen] = useState(false);
  const [importLimitInfo, setImportLimitInfo] = useState<{ count: number; limit: number } | null>(null);
  const [generatingVisible, setGeneratingVisible] = useState(false);
  const [animationDone, setAnimationDone] = useState(false);
  const [importedSummary, setImportedSummary] = useState<ImportSummary | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  // Hand over to the success dialog once both the animation and the save are
  // done — it owns navigation from here (previously this redirected straight
  // to /playlists with no confirmation).
  useEffect(() => {
    if (animationDone && importedSummary) {
      setGeneratingVisible(false);
      setSuccessOpen(true);
    }
  }, [animationDone, importedSummary]);


  useEffect(() => {
    if (!selectedLeague || !selectedSeason || !selectedStage) return;
    setScheduleStatus("loading");
    setScheduleGames([]);
    getLeagueSchedule(selectedLeague, selectedSeason, selectedStage)
      .then((games) => { setScheduleGames(games); setScheduleStatus("idle"); })
      .catch(() => setScheduleStatus("error"));
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
    setSelectedLeague(league);
    setSelectedSeason(league.seasons[0] ?? null);
    setSelectedStage(league.seasons[0]?.stages[0] ?? null);
    setSelectedGame(null);
    setSearchQuery("");
  }

  function handleSeasonChange(seasonId: string | null) {
    const season = selectedLeague?.seasons.find((s) => s.id === seasonId);
    if (!season || season.id === selectedSeason?.id) return;
    setSelectedSeason(season);
    setSelectedStage(season.stages[0] ?? null);
    setSelectedGame(null);
    setSearchQuery("");
  }

  function handleStageChange(stageId: string | null) {
    const stage = selectedSeason?.stages.find((s) => s.id === stageId);
    if (!stage || stage.id === selectedStage?.id) return;
    setSelectedStage(stage);
    setSelectedGame(null);
    setSearchQuery("");
  }

  async function handleSelectGame(game: ScheduleGame) {
    if (!selectedLeague || !selectedSeason) return;
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
      const data = await fetchGameData(selectedSeason, game);

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
    if (!isNtLeague && activeOrgId && !existingMatch) {
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
    setGeneratingVisible(true);
    setAnimationDone(false);
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
        has_video: !!videoPath,
        has_sync_point: !!syncPoint,
        has_play_by_play: playByPlayEvents.length > 0,
        event_count: playByPlayEvents.length,
        reimport: !!existingMatch,
      })
    } catch (err) {
      setSubmitStatus("error");
      setGeneratingVisible(false);
      // Server-side quota gate (the precheck can race a concurrent import).
      if (err instanceof Error && err.message.includes("import_limit_reached")) {
        setImportLimitInfo(null);
        setImportLimitDialogOpen(true);
        setSubmitError(null);
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
  }

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
    <UpgradeDialog
      open={importLimitDialogOpen}
      onClose={() => setImportLimitDialogOpen(false)}
      analyticsFeature="import_limit"
      analyticsSource="import_limit_dialog"
      featureName={activeOrgPlan === "rookie" ? "Monthly import limit reached" : "Free import limit reached"}
      description={activeOrgPlan === "rookie"
        ? `You've used all ${importLimitInfo?.limit ?? 10} Rookie imports for this month — they reset on the 1st. Upgrade to Pro and never count imports again.`
        : `That was the last of your ${importLimitInfo?.limit ?? 3} free games. Keep importing with Rookie — 10 games every month plus MP4 export, free for 14 days, cancel anytime.`}
    />
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">Import Game</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a game. Link a video. Start clipping.
        </p>
      </div>

      {/* Step 1 — Pick a Game */}
      <div className="space-y-3">
        <StepLabel step={1} title="Pick a Game" />
        <Card>
          <CardContent className="p-4 space-y-3">
            {/* League · Season · Stage.
                Season and Stage stay hidden while there's only one option —
                no dead controls for single-season leagues. */}
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

            {selectedGame ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-primary/10 px-3 py-2.5">
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  {selectedGame.homeTeamInfo.icon && (
                    <img src={selectedGame.homeTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  )}
                  <span className="truncate text-sm font-semibold text-foreground">
                    {selectedGame.homeTeamInfo.names.short}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-foreground/80">
                    {selectedGame.homeTeamInfo.score}–{selectedGame.awayTeamInfo.score}
                  </span>
                  <span className="truncate text-sm font-semibold text-foreground">
                    {selectedGame.awayTeamInfo.names.short}
                  </span>
                  {selectedGame.awayTeamInfo.icon && (
                    <img src={selectedGame.awayTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  )}
                  <span className="text-xs text-muted-foreground shrink-0 ml-1">
                    {new Date(selectedGame.rawStartDateTime).toLocaleDateString("sv-SE")}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setSelectedGame(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by team or date…"
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {scheduleStatus === "loading" && (
                  <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm">Loading schedule…</span>
                  </div>
                )}

                {scheduleStatus === "error" && (
                  <p className="py-4 text-center text-sm text-red-500">
                    Failed to load schedule. Check your connection.
                  </p>
                )}

                {scheduleStatus === "idle" && (
                  <div className="max-h-72 overflow-y-auto rounded-md divide-y divide-border">
                    {filteredGames.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">No games found.</p>
                    ) : (
                      filteredGames.map((game: ScheduleGame) => (
                        <GameRow
                          key={game.uuid}
                          game={game}
                          selected={false}
                          loading={false}
                          onClick={() => handleSelectGame(game)}
                        />
                      ))
                    )}
                  </div>
                )}
              </>
            )}

            {fetchStatus === "error" && fetchError && (
              <p className="text-xs text-red-500 dark:text-red-400">{fetchError}</p>
            )}
            {fetchStatus === "loading" && selectedGame && !selectedGame && (
              <p className="text-xs text-muted-foreground">Fetching game data…</p>
            )}
            {playByPlayEvents.length > 0 && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Game imported — {playByPlayEvents.length} clips ready.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Step 2 — Video & Sync */}
      <div className="space-y-3">
        <StepLabel
          step={2}
          title="Video & Sync"
          subtitle="Link a video for local playback and event seeking"
        />
        <Card>
          <CardContent className="space-y-5 p-6">
            {/* Video file picker */}
            <div className="space-y-2">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => { e.preventDefault(); setDragActive(false); }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors",
                  dragActive
                    ? "border-primary bg-primary/10"
                    : videoPath
                      ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
                      : "border-border bg-muted/30 hover:border-primary/50 hover:bg-primary/5"
                )}
              >
                {videoPath ? (
                  <>
                    <Film className="mb-3 h-8 w-8 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 text-center break-all">
                      {basename(videoPath)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground truncate max-w-full">{videoPath}</p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      onClick={() => setVideoPath(null)}
                    >
                      <X className="mr-1 inline h-3 w-3" />
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <Film className="mb-3 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground/80">
                      {dragActive ? "Drop video file here" : "Choose or drop a video file"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      MP4, MOV, AVI, MKV — plays locally, nothing is uploaded
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={handlePickVideo}
                    >
                      Choose video file…
                    </Button>
                  </>
                )}
              </div>
              {videoPath && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={handlePickVideo}
                >
                  Change file…
                </Button>
              )}
            </div>

            {/* Sync point */}
            {videoPath && (
              <div className="border-t border-border pt-4 space-y-3">
                <SyncPointPicker
                  videoPath={videoPath}
                  tipoffHint={tipoffLocalHint ?? undefined}
                  onConfirm={(secs) => setSyncSeconds(secs)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Submit error */}
      {submitStatus === "error" && submitError && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
          {submitError}
        </p>
      )}

      {/* Video required notice */}
      {selectedGame && !videoPath && (
        <p className="flex items-center gap-2 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-400">
          <span>⚠</span>
          Attach a video file above to enable import.
        </p>
      )}

      {/* Tip-off required notice */}
      {videoPath && syncSeconds === null && (
        <p className="flex items-center gap-2 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-400">
          <span>⚠</span>
          Set the tip-off point above to enable import.
        </p>
      )}

      {existingMatch && (
        <p className="rounded-md bg-primary/5 border border-primary/20 px-4 py-3 text-sm text-foreground">
          Already in your library as{" "}
          <span className="font-semibold">{existingMatch.title}</span>. Importing again
          updates that game — events and rosters refresh, and your playlists keep working.
        </p>
      )}

      {/* Submit */}
      <Button
        className="w-full py-6 text-base font-semibold"
        onClick={handleSubmit}
        disabled={isSubmitting || !selectedGame || !videoPath || syncSeconds === null}
      >
        {submitStatus === "saving" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {existingMatch ? "Updating…" : "Importing…"}
          </>
        ) : existingMatch ? (
          "Update Existing Game"
        ) : (
          "Import Game"
        )}
      </Button>

      <GeneratingSession
        isVisible={generatingVisible}
        onComplete={() => setAnimationDone(true)}
      />

      <ImportSuccessDialog open={successOpen} summary={importedSummary} />
    </div>
    </>
  );
}
