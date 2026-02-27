import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, CalendarIcon, Film, FolderOpen } from "lucide-react";
import { format, parseISO } from "date-fns";
import { DeleteMatchDialog } from "@/components/delete-match-dialog";
import { SyncPointPicker } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getMatch, updateMatchMeta, updateVideoUrl, updateSyncPoint } from "@/lib/matches-db";
import { listPlaylists } from "@/lib/playlists-db";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { cn } from "@/lib/utils";
import type { StoredMatch, SyncPoint } from "@/types/match";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

// ---------------------------------------------------------------------------
// Colour palette (copied from edit-match-dialog)
// ---------------------------------------------------------------------------

const TEAM_COLORS = [
  { label: "Black",  hex: "#111111" },
  { label: "White",  hex: "#ffffff" },
  { label: "Gray",   hex: "#6b7280" },
  { label: "Red",    hex: "#dc2626" },
  { label: "Orange", hex: "#ea580c" },
  { label: "Gold",   hex: "#ca8a04" },
  { label: "Green",  hex: "#16a34a" },
  { label: "Blue",   hex: "#2563eb" },
  { label: "Navy",   hex: "#1e3a8a" },
  { label: "Purple", hex: "#7c3aed" },
];

function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TEAM_COLORS.map((c) => (
        <button
          key={c.hex}
          type="button"
          title={c.label}
          onClick={() => onChange(c.hex)}
          className={cn(
            "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
            value === c.hex
              ? "border-primary ring-2 ring-primary/70 ring-offset-1"
              : "border-border",
            c.hex === "#ffffff" && "border-border"
          )}
          style={{ backgroundColor: c.hex }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync-point helpers
// ---------------------------------------------------------------------------

function parseMMSS(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s) || s >= 60) return null;
  return m * 60 + s;
}

function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// MatchDetailPage
// ---------------------------------------------------------------------------

export function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const matchId = id!;
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { from?: string; matchId?: string; playlistId?: string } | null;
  const fromPlaylists = locationState?.from === "/playlists";

  // --- loaded data ---
  const [storedMatch, setStoredMatch] = useState<StoredMatch | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [clipCount, setClipCount] = useState(0);

  // --- editable field state ---
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [homeColor, setHomeColor] = useState("");
  const [awayColor, setAwayColor] = useState("");
  const [syncInput, setSyncInput] = useState("");
  const [homeRoster, setHomeRoster] = useState<RosterEntry[]>([]);
  const [awayRoster, setAwayRoster] = useState<RosterEntry[]>([]);
  const [saveIndicator, setSaveIndicator] = useState<string | null>(null);

  // --- video ---
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // --- load match ---
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dbMatch, loadedPlaylists] = await Promise.all([
          getMatch(matchId),
          listPlaylists(),
        ]);
        if (cancelled) return;
        if (dbMatch) {
          setStoredMatch(dbMatch);
          setTitle(dbMatch.title);
          setDate(dbMatch.date);
          setHomeColor(dbMatch.homeTeam.color);
          setAwayColor(dbMatch.awayTeam.color);
          setSyncInput(dbMatch.syncPoint ? formatMMSS(dbMatch.syncPoint.syncVideoTime) : "");
          setHomeRoster(
            dbMatch.homeRoster.length ? dbMatch.homeRoster : [{ jerseyNumber: "", playerName: "" }]
          );
          setAwayRoster(
            dbMatch.awayRoster.length ? dbMatch.awayRoster : [{ jerseyNumber: "", playerName: "" }]
          );
          const count = loadedPlaylists
            .flatMap((p) => p.clips)
            .filter((c) => c.matchId === matchId).length;
          setClipCount(count);
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [matchId]);

  // --- derive localVideoUrl from storedMatch ---
  useEffect(() => {
    if (!storedMatch?.videoUrl || localVideoUrl) return;
    const url = storedMatch.videoUrl;
    setLocalVideoUrl(isLocalPath(url) ? streamFileSrc(url) : url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedMatch]);

  // --- cleanup blob URLs ---
  useEffect(() => {
    return () => {
      setLocalVideoUrl((prev) => {
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // --- Tauri native drag-drop ---
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

  // --- file picker ---
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
      // Non-fatal
    }
  }, [matchId]);

  // --- auto-save helper ---
  async function saveField(updates: Parameters<typeof updateMatchMeta>[1]) {
    if (!matchId) return;
    try {
      await updateMatchMeta(matchId, updates);
      setSaveIndicator("Saved");
      setTimeout(() => setSaveIndicator(null), 1500);
    } catch {
      setSaveIndicator("Error saving");
      setTimeout(() => setSaveIndicator(null), 2000);
    }
  }

  // --- roster helpers ---
  function updateRosterRow(
    roster: RosterEntry[],
    setter: (r: RosterEntry[]) => void,
    index: number,
    field: keyof RosterEntry,
    value: string
  ) {
    const updated = [...roster];
    updated[index] = { ...updated[index], [field]: value };
    setter(updated);
  }

  function addRosterRow(roster: RosterEntry[], setter: (r: RosterEntry[]) => void) {
    setter([...roster, { jerseyNumber: "", playerName: "" }]);
  }

  function removeRosterRow(roster: RosterEntry[], setter: (r: RosterEntry[]) => void, index: number) {
    setter(roster.filter((_, i) => i !== index));
  }

  // ---------------------------------------------------------------------------
  // Loading / not-found states
  // ---------------------------------------------------------------------------

  if (notFound) {
    return (
      <div className="p-6">
        <div className="py-24 text-center">
          <p className="text-muted-foreground">Game not found.</p>
          <Link to="/matches">
            <Button variant="ghost" size="sm" className="mt-4">
              Back to Library
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!storedMatch) {
    return (
      <div className="p-6">
        <div className="py-24 text-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const videoFileName = storedMatch.videoUrl
    ? storedMatch.videoUrl.split("/").pop() ?? storedMatch.videoUrl
    : null;

  const syncHint = storedMatch.syncPoint?.syncRealWorldTime
    ? (() => {
        const d = new Date(storedMatch.syncPoint.syncRealWorldTime);
        return isNaN(d.getTime())
          ? null
          : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      })()
    : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 pt-6 pb-2">
      <div className="mx-auto max-w-4xl flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={() => {
            if (fromPlaylists) {
              navigate("/playlists", {
                state: { restore: { matchId: locationState!.matchId, playlistId: locationState!.playlistId } },
              });
            } else {
              navigate("/matches");
            }
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          {fromPlaylists ? "Back to Playlists" : "Back to Library"}
        </Button>

        {saveIndicator && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 transition-opacity">
            {saveIndicator}
          </span>
        )}
      </div>
      </div>

      <div className="flex-1 px-6 pb-10">
      <div className="mx-auto max-w-4xl space-y-8">
        {/* ── Game identity header ──────────────────────────────────────── */}
        <section className="space-y-3 pt-2">
          {/* Matchup identity row */}
          <div className="flex items-center gap-3 text-sm font-medium text-muted-foreground">
            {homeColor && (
              <span className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: homeColor }} />
            )}
            <span>{storedMatch.homeTeam.name}</span>
            <span className="text-border">vs</span>
            <span>{storedMatch.awayTeam.name}</span>
            {awayColor && (
              <span className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: awayColor }} />
            )}
            <span className="text-border">·</span>
            {storedMatch.events.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs">
                <Film className="h-3.5 w-3.5" />
                {storedMatch.events.length} clips
              </span>
            )}
            {clipCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="text-xs">{clipCount} clips in playlists</span>
              </>
            )}
          </div>

          {/* Editable title */}
          <div className="space-y-1">
            <Label htmlFor="game-title" className="text-xs text-muted-foreground">Title</Label>
            <input
              id="game-title"
              className="w-full bg-transparent text-2xl font-bold tracking-tight text-foreground border-b border-transparent hover:border-border focus:border-primary focus:outline-none transition-colors pb-0.5"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => saveField({ title })}
            />
          </div>

          {/* Date picker */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-44 justify-start gap-2 font-normal"
                >
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  {date
                    ? format(parseISO(date), "d MMM yyyy")
                    : <span className="text-muted-foreground">Pick a date</span>
                  }
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date ? parseISO(date) : undefined}
                  onSelect={(day) => {
                    if (!day) return;
                    const iso = format(day, "yyyy-MM-dd");
                    setDate(iso);
                    saveField({ date: iso });
                  }}
                  autoFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </section>

        {/* ── Teams ────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/70">Teams</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Home */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Home</p>
                <p className="font-semibold text-foreground">{storedMatch.homeTeam.name}</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Team colour</p>
                <ColorPicker
                  value={homeColor}
                  onChange={(hex) => {
                    setHomeColor(hex);
                    saveField({ homeTeam: { name: storedMatch.homeTeam.name, color: hex } });
                  }}
                />
              </div>
            </div>

            {/* Away */}
            <div className="rounded-lg border border-border p-4 space-y-3">
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Away</p>
                <p className="font-semibold text-foreground">{storedMatch.awayTeam.name}</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Team colour</p>
                <ColorPicker
                  value={awayColor}
                  onChange={(hex) => {
                    setAwayColor(hex);
                    saveField({ awayTeam: { name: storedMatch.awayTeam.name, color: hex } });
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Video & Sync ──────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/70">Video &amp; Sync</h2>

          {/* Video file */}
          {videoFileName ? (
            <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate text-sm text-foreground/80 font-mono">{videoFileName}</span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
                onClick={handlePickVideoFile}
              >
                Change
              </button>
            </div>
          ) : (
            <div
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 transition-colors",
                dragActive
                  ? "border-primary bg-primary/10"
                  : "border-border bg-muted hover:border-primary/50 hover:bg-primary/5"
              )}
              onDragOver={(e) => e.preventDefault()}
            >
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground/80">
                  {dragActive ? "Drop video file here" : "Drop a file or click to select"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Your video stays on your machine — nothing is uploaded
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={handlePickVideoFile}
              >
                Choose video file…
              </button>
            </div>
          )}

          {/* Sync point */}
          {storedMatch.videoUrl ? (
            <SyncPointPicker
              videoPath={storedMatch.videoUrl}
              tipoffHint={syncHint ?? undefined}
              initialSeconds={storedMatch.syncPoint?.syncVideoTime}
              onConfirm={async (secs) => {
                const sp: SyncPoint = {
                  syncVideoTime: secs,
                  syncRealWorldTime: storedMatch.syncPoint?.syncRealWorldTime ?? "",
                };
                try {
                  await updateSyncPoint(matchId, sp);
                  setStoredMatch((m) => m ? { ...m, syncPoint: sp } : m);
                  setSaveIndicator("Saved");
                  setTimeout(() => setSaveIndicator(null), 1500);
                } catch {
                  setSaveIndicator("Error saving");
                  setTimeout(() => setSaveIndicator(null), 2000);
                }
              }}
            />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="sync-point" className="text-xs text-muted-foreground">
                Video time at tip-off (MM:SS)
              </Label>
              {syncHint && (
                <p className="text-xs text-primary">
                  Tip-off real-world time was <strong>{syncHint}</strong> — enter the video timestamp for that moment.
                </p>
              )}
              <div className="flex items-center gap-3">
                <Input
                  id="sync-point"
                  placeholder="0:35"
                  className="w-28 font-mono"
                  value={syncInput}
                  onChange={(e) => setSyncInput(e.target.value)}
                  onBlur={() => {
                    if (!syncInput) return;
                    const secs = parseMMSS(syncInput);
                    if (secs === null) return;
                    const sp: SyncPoint | null = storedMatch.syncPoint
                      ? { syncVideoTime: secs, syncRealWorldTime: storedMatch.syncPoint.syncRealWorldTime }
                      : null;
                    if (sp) {
                      updateSyncPoint(matchId, sp)
                        .then(() => {
                          setSaveIndicator("Saved");
                          setTimeout(() => setSaveIndicator(null), 1500);
                        })
                        .catch(() => {});
                    }
                  }}
                />
                {syncInput && parseMMSS(syncInput) === null && (
                  <p className="text-xs text-red-500">Use MM:SS format (e.g. 0:35)</p>
                )}
                {syncInput && parseMMSS(syncInput) !== null && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">Sync set at {syncInput}</p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ── Rosters ───────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground/70">Rosters</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Home roster */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground/80 font-medium">{storedMatch.homeTeam.name || "Home"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-primary hover:text-primary/80"
                  onClick={() => addRosterRow(homeRoster, setHomeRoster)}
                >
                  + Add player
                </Button>
              </div>
              <div className="space-y-2">
                {homeRoster.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="#"
                      className="w-16 text-center"
                      value={entry.jerseyNumber}
                      onChange={(e) => updateRosterRow(homeRoster, setHomeRoster, i, "jerseyNumber", e.target.value)}
                      onBlur={() => saveField({ homeRoster })}
                    />
                    <Input
                      placeholder="Player name"
                      className="flex-1"
                      value={entry.playerName}
                      onChange={(e) => updateRosterRow(homeRoster, setHomeRoster, i, "playerName", e.target.value)}
                      onBlur={() => saveField({ homeRoster })}
                    />
                    {homeRoster.length > 1 && (
                      <button
                        type="button"
                        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                        onClick={() => {
                          removeRosterRow(homeRoster, setHomeRoster, i);
                          // save after state settles
                          setTimeout(() => saveField({ homeRoster: homeRoster.filter((_, idx) => idx !== i) }), 0);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Away roster */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground/80 font-medium">{storedMatch.awayTeam.name || "Away"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-primary hover:text-primary/80"
                  onClick={() => addRosterRow(awayRoster, setAwayRoster)}
                >
                  + Add player
                </Button>
              </div>
              <div className="space-y-2">
                {awayRoster.map((entry, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="#"
                      className="w-16 text-center"
                      value={entry.jerseyNumber}
                      onChange={(e) => updateRosterRow(awayRoster, setAwayRoster, i, "jerseyNumber", e.target.value)}
                      onBlur={() => saveField({ awayRoster })}
                    />
                    <Input
                      placeholder="Player name"
                      className="flex-1"
                      value={entry.playerName}
                      onChange={(e) => updateRosterRow(awayRoster, setAwayRoster, i, "playerName", e.target.value)}
                      onBlur={() => saveField({ awayRoster })}
                    />
                    {awayRoster.length > 1 && (
                      <button
                        type="button"
                        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
                        onClick={() => {
                          removeRosterRow(awayRoster, setAwayRoster, i);
                          setTimeout(() => saveField({ awayRoster: awayRoster.filter((_, idx) => idx !== i) }), 0);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Danger zone ───────────────────────────────────────────────── */}
        <section className="border-t border-border pt-6 space-y-2">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Danger zone</p>
          <div className="flex items-center gap-4">
            <DeleteMatchDialog
              matchId={matchId}
              matchTitle={title}
              trigger={
                <Button variant="destructive" size="sm">
                  Delete game
                </Button>
              }
              onDeleted={() => navigate("/matches")}
            />
            <p className="text-xs text-muted-foreground">This will permanently remove the game and all its clips.</p>
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}
