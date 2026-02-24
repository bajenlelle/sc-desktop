import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, Film, FolderOpen, Trash2 } from "lucide-react";
import { EditMatchDialog } from "@/components/edit-match-dialog";
import { DeleteMatchDialog } from "@/components/delete-match-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { VideoPlayer } from "@/components/video-player";
import { PlayerStatsTable } from "@/components/player-stats-table";
import { EventTimeline } from "@/components/event-timeline";
import { TeamOverview } from "@/components/team-overview";
import { ClipsView } from "@/components/clips-view";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { getMatchById } from "@/lib/mock-data";
import { getMatch, updatePlaylists, updateVideoUrl } from "@/lib/matches-db";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import type { Match, Playlist, StoredMatch } from "@/types/match";

export function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const matchId = id!;
  const navigate = useNavigate();;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [storedMatch, setStoredMatch] = useState<StoredMatch | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const handlePickVideoFile = useCallback(async () => {
    const result = await openFileDialog({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v"] }],
    });
    if (typeof result !== "string") return;
    setLocalVideoUrl((prev) => {
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      return streamFileSrc(result);
    });
    try {
      await updateVideoUrl(matchId, result);
      setStoredMatch((m) => m ? { ...m, videoUrl: result } : m);
    } catch {
      // Path saved in memory but DB update failed — non-fatal
    }
  }, [matchId]);


  useEffect(() => {
    return () => {
      setLocalVideoUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // Tauri native drag-drop — provides real filesystem paths
  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];
    let unlisten: (() => void) | undefined;

    appWindow.onDragDropEvent((event) => {
      const { type } = event.payload;
      if (type === "enter" || type === "over") {
        setDragActive(true);
      } else if (type === "leave") {
        setDragActive(false);
      } else if (type === "drop") {
        setDragActive(false);
        const dropped = event.payload.paths.find((p) =>
          VIDEO_EXTS.some((ext) => p.toLowerCase().endsWith(`.${ext}`))
        );
        if (dropped) {
          setLocalVideoUrl((prev) => {
            if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
            return streamFileSrc(dropped);
          });
          updateVideoUrl(matchId, dropped).catch(() => {});
          setStoredMatch((m) => m ? { ...m, videoUrl: dropped } : m);
        }
      }
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [matchId]);

  useEffect(() => {
    if (!storedMatch?.videoUrl || localVideoUrl) return;
    const url = storedMatch.videoUrl;
    setLocalVideoUrl(isLocalPath(url) ? streamFileSrc(url) : url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedMatch]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const dbMatch = await getMatch(matchId);
        if (!cancelled && dbMatch) {
          setStoredMatch(dbMatch);
          return;
        }
      } catch {
        // Not authenticated or network error — fall through to mock data
      }

      if (cancelled) return;

      const mockMatch = getMatchById(matchId);
      if (mockMatch && mockMatch.status === "completed") {
        setMatch(mockMatch);
      } else {
        setNotFound(true);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [matchId]);

  if (notFound) {
    return (
      <div className="p-6">
        <div className="py-24 text-center">
          <p className="text-muted-foreground">Session not found.</p>
          <Link to="/matches">
            <Button variant="ghost" size="sm" className="mt-4">
              Back to Sessions
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!match && !storedMatch) {
    return (
      <div className="p-6">
        <div className="py-24 text-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (storedMatch) {
    const formattedDate = new Date(storedMatch.date).toLocaleDateString("sv-SE", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-4">
          <Link to="/matches">
            <Button variant="ghost" size="sm" className="mb-3 gap-1.5 text-muted-foreground">
              <ArrowLeft className="h-4 w-4" />
              Back to Sessions
            </Button>
          </Link>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="group flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {storedMatch.title}
                </h1>
                <Badge className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                  Session
                </Badge>
                <EditMatchDialog
                  match={storedMatch}
                  onSave={(updates) => setStoredMatch((m) => m ? { ...m, ...updates, syncPoint: updates.syncPoint ?? undefined } : m)}
                />
                <DeleteMatchDialog
                  matchId={storedMatch.id}
                  matchTitle={storedMatch.title}
                  trigger={
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                      title="Delete session"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  }
                  onDeleted={() => navigate("/matches")}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {formattedDate}
                </span>
                {storedMatch.events.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Film className="h-3.5 w-3.5" />
                    {storedMatch.events.length} play-by-play events
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm font-medium">
              <div className="flex items-center gap-2">
                {storedMatch.homeTeam.color && (
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: storedMatch.homeTeam.color }}
                  />
                )}
                {storedMatch.homeTeam.name}
              </div>
              <span className="text-border">vs</span>
              <div className="flex items-center gap-2">
                {storedMatch.awayTeam.name}
                {storedMatch.awayTeam.color && (
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: storedMatch.awayTeam.color }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Resizable split — fills remaining height */}
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="match-detail-split"
          className="flex-1 min-h-0 px-6 pb-6"
        >
          {/* LEFT: Tabs (Clips / Roster) */}
          <ResizablePanel defaultSize={55} minSize={25}>
            <div className="flex h-full flex-col overflow-y-auto pr-4">
              <Tabs defaultValue="clips" className="space-y-4">
                <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
                  <TabsTrigger value="clips">Clips</TabsTrigger>
                  <TabsTrigger value="roster">Roster</TabsTrigger>
                </TabsList>

                <TabsContent value="clips">
                  <ClipsView
                    events={storedMatch.events}
                    syncPoint={storedMatch.syncPoint}
                    videoRef={videoRef}
                    homeTeamName={storedMatch.homeTeam.name}
                    awayTeamName={storedMatch.awayTeam.name}
                    homeRoster={storedMatch.homeRoster}
                    awayRoster={storedMatch.awayRoster}
                    playlists={storedMatch.playlists ?? []}
                    onPlaylistsChange={async (p: Playlist[]) => {
                      await updatePlaylists(matchId, p);
                      setStoredMatch((m) => m ? { ...m, playlists: p } : m);
                    }}
                    videoAvailable={!!localVideoUrl}
                  />
                </TabsContent>

                <TabsContent value="roster">
                  <div className="grid gap-6 sm:grid-cols-2">
                    <RosterCard
                      teamName={storedMatch.homeTeam.name}
                      color={storedMatch.homeTeam.color}
                      players={storedMatch.homeRoster}
                    />
                    <RosterCard
                      teamName={storedMatch.awayTeam.name}
                      color={storedMatch.awayTeam.color}
                      players={storedMatch.awayRoster}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle />

          {/* RIGHT: Video */}
          <ResizablePanel defaultSize={45} minSize={25}>
            <div
              className="flex h-full flex-col gap-2 pl-4 space-y-2"
              onDragOver={(e) => e.preventDefault()}
            >
              {localVideoUrl ? (
                <>
                  {dragActive ? (
                    <div className="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10">
                      <p className="text-sm font-semibold text-primary">
                        Drop to replace video
                      </p>
                    </div>
                  ) : (
                    <VideoPlayer src={localVideoUrl} videoRef={videoRef} />
                  )}
                  <div className="flex items-center justify-end">
                    <button
                      type="button"
                      className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={handlePickVideoFile}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      Change video file
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-14 transition-colors ${
                    dragActive
                      ? "border-primary bg-primary/10"
                      : "border-border bg-muted hover:border-primary/50 hover:bg-primary/5"
                  }`}
                >
                  <FolderOpen className="h-9 w-9 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground/80">
                      {dragActive ? "Drop video file here" : "Video plays locally — drop a file or click to select"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Your video stays on your machine, nothing is uploaded
                    </p>
                  </div>
                  <button
                    type="button"
                    className="mt-1 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={handlePickVideoFile}
                  >
                    Choose video file…
                  </button>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  // Mock match (legacy AI-analysed)
  const m = match!;
  const formattedDate = new Date(m.date).toLocaleDateString("sv-SE", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="p-6">
    <div className="space-y-6">
      <div>
        <Link to="/matches">
          <Button variant="ghost" size="sm" className="mb-3 gap-1.5 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Sessions
          </Button>
        </Link>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {m.title}
              </h1>
              <Badge className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                Completed
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {formattedDate}
              </span>
              {m.duration && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {Math.floor(m.duration / 60)} min
                </span>
              )}
              {m.frameCount && (
                <span className="flex items-center gap-1.5">
                  <Film className="h-3.5 w-3.5" />
                  {m.frameCount.toLocaleString()} frames
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm font-medium">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: m.homeTeam.color }} />
              {m.homeTeam.name}
            </div>
            <span className="text-border">vs</span>
            <div className="flex items-center gap-2">
              {m.awayTeam.name}
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: m.awayTeam.color }} />
            </div>
          </div>
        </div>
      </div>

      <VideoPlaceholder />

      <Tabs defaultValue="stats" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
          <TabsTrigger value="stats">Player Stats</TabsTrigger>
          <TabsTrigger value="timeline">Event Timeline</TabsTrigger>
          <TabsTrigger value="team">Team Overview</TabsTrigger>
        </TabsList>

        <TabsContent value="stats">
          {m.playerStats && m.playerStats.length > 0 ? (
            <PlayerStatsTable stats={m.playerStats} homeTeam={m.homeTeam} awayTeam={m.awayTeam} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No player stats available.</p>
          )}
        </TabsContent>

        <TabsContent value="timeline">
          {m.events && m.events.length > 0 ? (
            <EventTimeline events={m.events} homeTeam={m.homeTeam} awayTeam={m.awayTeam} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No events recorded.</p>
          )}
        </TabsContent>

        <TabsContent value="team">
          {m.homeTeamStats && m.awayTeamStats ? (
            <TeamOverview
              home={m.homeTeamStats}
              away={m.awayTeamStats}
              homeColor={m.homeTeam.color}
              awayColor={m.awayTeam.color}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No team stats available.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
    </div>
  );
}

function RosterCard({
  teamName,
  color,
  players,
}: {
  teamName: string;
  color: string;
  players: Array<{ jerseyNumber: string; playerName: string }>;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {color && (
          <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} />
        )}
        <span className="font-semibold text-foreground">{teamName}</span>
      </div>
      <div className="divide-y divide-border">
        {players.map((p, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-8 text-right font-mono text-xs text-muted-foreground">
              #{p.jerseyNumber}
            </span>
            <span className="text-sm text-foreground/80">{p.playerName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
