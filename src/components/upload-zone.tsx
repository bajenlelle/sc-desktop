import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Film, X, Loader2, Clock, Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { saveMatch } from "@/lib/matches-db";
import { fetchBoxscore, fetchPlayByPlay, fetchSchedule } from "@/lib/basketball-api";
import type { ScheduleGame } from "@/lib/basketball-api";
import type { StoredMatch, SyncPoint, PlayByPlayEvent } from "@/types/match";
import { open } from "@tauri-apps/plugin-dialog";

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
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
        {step}
      </span>
      <div>
        <span className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        {subtitle && (
          <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">{subtitle}</span>
        )}
      </div>
    </div>
  );
}

/** Parse "MM:SS" or "M:SS" string to total seconds */
function parseMMSS(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s) || s >= 60) return null;
  return m * 60 + s;
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
          ? "bg-indigo-50 dark:bg-indigo-950 ring-1 ring-indigo-300 dark:ring-indigo-700"
          : "hover:bg-slate-50 dark:hover:bg-slate-800"
      )}
    >
      <div className="min-w-[80px] text-xs text-slate-400 dark:text-slate-500 shrink-0">{date}</div>
      <div className="flex flex-1 items-center gap-2 min-w-0">
        {game.homeTeamInfo.icon && (
          <img src={game.homeTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
        )}
        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
          {game.homeTeamInfo.names.short}
        </span>
        <span className="shrink-0 text-xs font-bold text-slate-600 dark:text-slate-300">
          {game.homeTeamInfo.score}–{game.awayTeamInfo.score}
        </span>
        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
          {game.awayTeamInfo.names.short}
        </span>
        {game.awayTeamInfo.icon && (
          <img src={game.awayTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
        )}
      </div>
      <div className="shrink-0 text-xs text-slate-400 dark:text-slate-500 hidden sm:block truncate max-w-[100px]">
        {game.venueInfo?.name}
      </div>
      {loading && selected ? (
        <Loader2 className="h-4 w-4 animate-spin shrink-0 text-indigo-500" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
      )}
    </button>
  );
}

export function UploadZone() {
  const navigate = useNavigate();

  // Schedule picker state
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
  const [dragVideoFile, setDragVideoFile] = useState<File | null>(null);

  const [syncInput, setSyncInput] = useState("");
  const [submitStatus, setSubmitStatus] = useState<"idle" | "saving" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetchSchedule()
      .then((games) => {
        setScheduleGames(games);
        setScheduleStatus("idle");
      })
      .catch(() => setScheduleStatus("error"));
  }, []);

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

    try {
      const [data, pbp] = await Promise.all([
        fetchBoxscore(game.uuid),
        fetchPlayByPlay(game.uuid).catch(() => null),
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
  }

  async function handlePickVideo() {
    const result = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v"] }],
    });
    if (typeof result === "string") {
      setVideoPath(result);
      setDragVideoFile(null);
    }
  }

  async function handleSubmit() {
    if (!selectedGame) {
      setSubmitError("Please select a game first (Step 1).");
      return;
    }

    setSubmitError(null);
    setSubmitStatus("saving");

    let syncPoint: SyncPoint | undefined;
    if (syncInput && tipoffRealWorldTime) {
      const secs = parseMMSS(syncInput);
      if (secs !== null) {
        syncPoint = {
          syncVideoTime: secs,
          syncRealWorldTime: tipoffRealWorldTime,
        };
      }
    }

    const storedMatch: StoredMatch = {
      id: selectedGame.uuid,
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
    } catch (err) {
      setSubmitStatus("error");
      setSubmitError(err instanceof Error ? err.message : "Failed to save match.");
      return;
    }

    setSubmitStatus("idle");
    navigate(`/matches/${selectedGame.uuid}`);
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
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New Match</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Pick a completed game to import data, then optionally link a local video file.
        </p>
      </div>

      {/* Step 1 — Pick a Game */}
      <div className="space-y-3">
        <StepLabel step={1} title="Pick a Game" />
        <Card>
          <CardContent className="p-4 space-y-3">
            {selectedGame ? (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-indigo-50 dark:bg-indigo-950 px-3 py-2.5">
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  {selectedGame.homeTeamInfo.icon && (
                    <img src={selectedGame.homeTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  )}
                  <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {selectedGame.homeTeamInfo.names.short}
                  </span>
                  <span className="shrink-0 text-xs font-bold text-slate-600 dark:text-slate-300">
                    {selectedGame.homeTeamInfo.score}–{selectedGame.awayTeamInfo.score}
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {selectedGame.awayTeamInfo.names.short}
                  </span>
                  {selectedGame.awayTeamInfo.icon && (
                    <img src={selectedGame.awayTeamInfo.icon} alt="" className="h-5 w-5 shrink-0 object-contain" />
                  )}
                  <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 ml-1">
                    {new Date(selectedGame.rawStartDateTime).toLocaleDateString("sv-SE")}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-7 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  onClick={() => setSelectedGame(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by team or date…"
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {scheduleStatus === "loading" && (
                  <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
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
                  <div className="max-h-72 overflow-y-auto rounded-md divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredGames.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-400">No games found.</p>
                    ) : (
                      filteredGames.map((game) => (
                        <GameRow
                          key={game.uuid}
                          game={game}
                          selected={selectedGame?.uuid === game.uuid}
                          loading={fetchStatus === "loading" && selectedGame?.uuid === game.uuid}
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
              <p className="text-xs text-slate-400">Fetching game data…</p>
            )}
            {playByPlayEvents.length > 0 && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                {playByPlayEvents.length} play-by-play events loaded.
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
          subtitle="Enables local playback and seek-to-event"
        />
        <Card>
          <CardContent className="space-y-5 p-6">
            {/* Video file picker */}
            <div className="space-y-2">
              <Label>Video file</Label>
              <div
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 transition-colors",
                  dragActive
                    ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950"
                    : videoPath || dragVideoFile
                      ? "border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
                      : "border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700"
                )}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragActive(false);
                  const file = e.dataTransfer.files[0];
                  if (file && file.type.startsWith("video/")) {
                    const tauriPath = (file as unknown as { path?: string }).path;
                    if (typeof tauriPath === "string") {
                      // Tauri exposes the absolute path on dropped File objects
                      setVideoPath(tauriPath);
                      setDragVideoFile(null);
                    } else {
                      setDragVideoFile(file);
                      setVideoPath(null);
                    }
                  }
                }}
              >
                {videoPath ? (
                  <>
                    <Film className="mb-3 h-8 w-8 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 text-center break-all">
                      {basename(videoPath)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400 truncate max-w-full">{videoPath}</p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      onClick={() => setVideoPath(null)}
                    >
                      <X className="mr-1 inline h-3 w-3" />
                      Remove
                    </button>
                  </>
                ) : dragVideoFile ? (
                  <>
                    <Film className="mb-3 h-8 w-8 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      {dragVideoFile.name}
                    </p>
                    <button
                      type="button"
                      className="mt-2 text-xs text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                      onClick={() => setDragVideoFile(null)}
                    >
                      <X className="mr-1 inline h-3 w-3" />
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <Film className="mb-3 h-8 w-8 text-slate-400 dark:text-slate-500" />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {dragActive ? "Drop video file here" : "Choose or drop a video file"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
                  className="text-xs text-slate-400 hover:text-slate-600"
                  onClick={handlePickVideo}
                >
                  Change file…
                </Button>
              )}
            </div>

            {/* Sync point */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Enter the video timestamp (MM:SS) when the{" "}
                <strong className="text-slate-700 dark:text-slate-300">tip-off</strong> occurs in
                your recording. This one calibration point syncs every event to the correct video
                position.
              </p>
              {tipoffLocalHint && (
                <p className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400">
                  <Clock className="h-3.5 w-3.5" />
                  Tip-off real-world time was{" "}
                  <strong>{tipoffLocalHint}</strong> — find this moment in your video.
                </p>
              )}
              {!tipoffRealWorldTime && (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Select a game to see the tip-off time hint.
                </p>
              )}
              <div className="flex items-center gap-3">
                <div className="space-y-1">
                  <Label htmlFor="sync-time">Video time at tip-off</Label>
                  <Input
                    id="sync-time"
                    placeholder="0:35"
                    className="w-28 font-mono"
                    value={syncInput}
                    onChange={(e) => setSyncInput(e.target.value)}
                  />
                </div>
                {syncInput && parseMMSS(syncInput) === null && (
                  <p className="mt-5 text-xs text-red-500">Use MM:SS format (e.g. 0:35)</p>
                )}
                {syncInput && parseMMSS(syncInput) !== null && (
                  <p className="mt-5 text-xs text-emerald-600 dark:text-emerald-400">
                    Sync point set at {syncInput}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Submit error */}
      {submitStatus === "error" && submitError && (
        <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
          {submitError}
        </p>
      )}

      {/* Submit */}
      <Button
        className="w-full bg-indigo-600 py-6 text-base font-semibold hover:bg-indigo-700"
        onClick={handleSubmit}
        disabled={isSubmitting || !selectedGame}
      >
        {submitStatus === "saving" ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          "Save & Open Match"
        )}
      </Button>
    </div>
  );
}
