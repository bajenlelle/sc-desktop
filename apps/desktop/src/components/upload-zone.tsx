import { useState, useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { useNavigate } from "react-router-dom";
import { Film, X, Loader2, Search, ChevronRight } from "lucide-react";
import { GeneratingSession } from "@/components/generating-session";
import { SyncPointPicker } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { saveMatch, countMatchesThisMonth } from "@/lib/matches-db";
import { getSubscriptionStatus } from "@/lib/profile-db";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { fetchBoxscore, fetchPlayByPlay, fetchPlayByPlaySportradar, fetchSchedule, fetchScheduleSportradar, LEAGUES, NATIONAL_TEAM_LEAGUES } from "@/lib/basketball-api";
import type { ScheduleGame, League } from "@/lib/basketball-api";
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

function getMonthlyImportLimit(sub: { isActive: boolean; plan: string | null } | null): number | null {
  if (!sub || !sub.isActive) return 2;
  if (sub.plan === "rookie") return 10;
  return null;
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

export function UploadZone({ isNationalTeam = false }: { isNationalTeam?: boolean }) {
  const navigate = useNavigate();

  const leagueList = isNationalTeam
    ? NATIONAL_TEAM_LEAGUES
    : LEAGUES.filter((l) => l.id !== "austria-zweite-liga");

  // League + schedule picker state
  const [selectedLeague, setSelectedLeague] = useState<League>(leagueList[0]);
  const [scheduleGames, setScheduleGames] = useState<ScheduleGame[]>([]);
  const [scheduleStatus, setScheduleStatus] = useState<"loading" | "idle" | "error">("loading");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGame, setSelectedGame] = useState<ScheduleGame | null>(null);
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);

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
  const [pendingNavigate, setPendingNavigate] = useState<string | null>(null);
  // Navigate once both the animation and the save are done
  useEffect(() => {
    if (animationDone && pendingNavigate) {
      navigate("/playlists");
    }
  }, [animationDone, pendingNavigate, navigate]);


  useEffect(() => {
    setScheduleStatus("loading");
    setScheduleGames([]);
    const promise = selectedLeague.provider === "sportradar"
      ? fetchScheduleSportradar(selectedLeague.fixturesUrl!)
      : fetchSchedule(selectedLeague.baseUrl, selectedLeague.scheduleParams);
    promise
      .then((games) => { setScheduleGames(games); setScheduleStatus("idle"); })
      .catch(() => setScheduleStatus("error"));
  }, [selectedLeague]);

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
    if (league.id === selectedLeague.id) return;
    setSelectedLeague(league);
    setSelectedGame(null);
    setSearchQuery("");
  }

  async function handleSelectGame(game: ScheduleGame) {
    setSelectedGame(game);
    setFetchStatus("loading");
    setFetchError(null);

    // Seed names and date from schedule data immediately so the match is always
    // populated even if the boxscore API call fails or the user submits quickly.
    const fallbackHome = game.homeTeamInfo.names.long;
    const fallbackAway = game.awayTeamInfo.names.long;
    setHomeTeam(fallbackHome);
    setAwayTeam(fallbackAway);
    setMatchTitle(`${fallbackHome} vs ${fallbackAway}`);
    const fallbackDate = new Date(game.rawStartDateTime);
    if (!isNaN(fallbackDate.getTime())) {
      setMatchDate(fallbackDate.toISOString().slice(0, 10));
    }

    if (selectedLeague.provider !== "sportradar") {
      try {
        const [data, pbp] = await Promise.all([
          fetchBoxscore(game.uuid, selectedLeague.baseUrl),
          fetchPlayByPlay(game.uuid, selectedLeague.baseUrl).catch(() => null),
        ]);

        const boxData = data as {
          stats: {
            homeTeamValue: Array<{ NR: number | string; info: { team: string; playerId: number } }>;
            awayTeamValue: Array<{ NR: number | string; info: { team: string; playerId: number } }>;
          };
          players: {
            homeTeamValue: Record<string, { fullName: string }>;
            awayTeamValue: Record<string, { fullName: string }>;
          };
          date?: string | null;
        };

        // Override with boxscore names if present (may be more canonical than schedule names)
        const home = boxData.stats.homeTeamValue[0]?.info.team || fallbackHome;
        const away = boxData.stats.awayTeamValue[0]?.info.team || fallbackAway;

        setHomeTeam(home);
        setAwayTeam(away);
        setMatchTitle(`${home} vs ${away}`);

        const dateStr = boxData.date ?? game.rawStartDateTime;
        if (dateStr) {
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime())) {
            setMatchDate(parsed.toISOString().slice(0, 10));
          }
        }

        const homePlayers = boxData.players?.homeTeamValue ?? {};
        const awayPlayers = boxData.players?.awayTeamValue ?? {};

        type StatsEntry = typeof boxData.stats.homeTeamValue[0];
        const toRoster = (
          entries: StatsEntry[],
          playerMap: Record<string, { fullName: string }>
        ): RosterEntry[] =>
          entries.map((s) => ({
            jerseyNumber: String(s.NR),
            playerName: playerMap[String(s.info.playerId)]?.fullName ?? "",
          }));

        const newHome = toRoster(boxData.stats.homeTeamValue, homePlayers);
        const newAway = toRoster(boxData.stats.awayTeamValue, awayPlayers);

        setHomeRoster(newHome.length ? newHome : [{ jerseyNumber: "", playerName: "" }]);
        setAwayRoster(newAway.length ? newAway : [{ jerseyNumber: "", playerName: "" }]);

        if (pbp) {
          setPlayByPlayEvents(pbp.events ?? []);
          setTipoffRealWorldTime(pbp.tipoffRealWorldTime ?? null);
        }

        setFetchStatus("idle");
      } catch (err) {
        setFetchStatus("error");
        setFetchError(err instanceof Error ? err.message : "Failed to fetch game data.");
        // Team names/date are already set from schedule data above — no further action needed.
      }
    } else {
      try {
        const pbp = await fetchPlayByPlaySportradar(game.uuid, game.seasonId ?? "");
        setPlayByPlayEvents(pbp.events);
        setTipoffRealWorldTime(null);
      } catch {
        // PBP is optional for Austrian games — names/date already set
      }
      setFetchStatus("idle");
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
    const [sub, count] = await Promise.all([getSubscriptionStatus(), countMatchesThisMonth()]);
    const limit = getMonthlyImportLimit(sub);
    if (limit !== null && count >= limit) {
      setImportLimitInfo({ count, limit });
      setImportLimitDialogOpen(true);
      return;
    }

    if (!selectedGame) {
      setSubmitError("Select a game first to continue.");
      return;
    }

    setSubmitError(null);
    setSubmitStatus("saving");
    setGeneratingVisible(true);
    setAnimationDone(false);
    setPendingNavigate(null);

    let syncPoint: SyncPoint | undefined;
    if (syncSeconds !== null) {
      syncPoint = {
        syncVideoTime: syncSeconds,
        syncRealWorldTime: tipoffRealWorldTime ?? "",
      };
    }

    const matchId = crypto.randomUUID();
    const storedMatch: StoredMatch = {
      id: matchId,
      title: matchTitle || `${homeTeam} vs ${awayTeam}`,
      date: matchDate || new Date().toISOString().slice(0, 10),
      homeTeam: { name: homeTeam, color: homeColor },
      awayTeam: { name: awayTeam, color: awayColor },
      homeRoster,
      awayRoster,
      videoUrl: videoPath ?? undefined,
      syncPoint,
      events: playByPlayEvents,
    };

    try {
      await saveMatch(storedMatch);
      trackEvent('game_synced', {
        game_id: matchId,
        has_video: !!videoPath,
        has_sync_point: !!syncPoint,
        has_play_by_play: playByPlayEvents.length > 0,
        event_count: playByPlayEvents.length,
      })
    } catch (err) {
      setSubmitStatus("error");
      setGeneratingVisible(false);
      setSubmitError(err instanceof Error ? err.message : "Failed to save match.");
      return;
    }

    setSubmitStatus("idle");
    setPendingNavigate(matchId);
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

  return (
    <>
    <UpgradeDialog
      open={importLimitDialogOpen}
      onClose={() => setImportLimitDialogOpen(false)}
      featureName="Monthly import limit reached"
      description={importLimitInfo
        ? `You've used all ${importLimitInfo.limit} game imports for this month on your current plan. Upgrade to Rookie for 10 imports/month, or Pro for unlimited.`
        : undefined}
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
            {/* League selector */}
            <div className="flex rounded-lg border border-border p-1 gap-1">
              {leagueList.map((league) => (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => handleLeagueChange(league)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                    selectedLeague.id === league.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {league.name}
                </button>
              ))}
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

      {/* Submit */}
      <Button
        className="w-full py-6 text-base font-semibold"
        onClick={handleSubmit}
        disabled={isSubmitting || !selectedGame || !videoPath || syncSeconds === null}
      >
        {submitStatus === "saving" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Importing…
          </>
        ) : (
          "Import Game"
        )}
      </Button>

      <GeneratingSession
        isVisible={generatingVisible}
        onComplete={() => setAnimationDone(true)}
      />
    </div>
    </>
  );
}
