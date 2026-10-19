import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarIcon, Check, ChevronLeft, ChevronsUpDown, Film, Loader2, MinusCircle, Plus, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { DeleteMatchDialog } from "@/components/delete-match-dialog";
import { EmptyState } from "@/components/empty-state";
import { formatMSSd, SyncPointPicker } from "@/components/sync-point-picker";
import { isSuggestionPending, TipoffSuggestionStrip } from "@/components/tipoff-suggestion-strip";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Callout, FormRow, GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/format-date";
import { getMatch, updateMatchMeta, updateSyncPoint, updateVideoUrl } from "@/lib/matches-db";
import { springs } from "@/lib/motion";
import { listPlaylists } from "@/lib/playlists-db";
import { isLocalPath } from "@/lib/stream";
import { useTipoffSuggestion } from "@/lib/use-tipoff-suggestion";
import { cn } from "@/lib/utils";
import { probeVideoPath, videoBasename, type VideoFileStatus } from "@/lib/video-probe";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { StoredMatch, SyncPoint } from "@/types/match";

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

/**
 * A sync change re-cuts every clip of this game, so shipped uploads were
 * invalidated (their r2_url cleared): recipients can't see those clips again
 * until the coach re-uploads them with the new sync.
 */
function notifyClearedShippedClips(count: number) {
  if (count === 0) return;
  toast.info(`${count} shared clip${count === 1 ? "" : "s"} from this game will re-render with the new tip-off`, {
    description: "They're hidden from recipients until re-uploaded: in Shared playlists, use Upload missing clips.",
    duration: 10000,
  });
}

const TEAM_COLORS = [
  { label: "Black", hex: "#111111" },
  { label: "White", hex: "#ffffff" },
  { label: "Grey", hex: "#6b7280" },
  { label: "Red", hex: "#dc2626" },
  { label: "Orange", hex: "#ea580c" },
  { label: "Gold", hex: "#ca8a04" },
  { label: "Green", hex: "#16a34a" },
  { label: "Blue", hex: "#2563eb" },
  { label: "Navy", hex: "#1e3a8a" },
  { label: "Purple", hex: "#7c3aed" },
];

/** A colour well that opens the palette: the swatch is the value, the menu the choices. */
function ColorWell({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const current = TEAM_COLORS.find((c) => c.hex === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${current?.label ?? (value ? "custom" : "no colour")}`}
          className="flex h-7 items-center gap-2 rounded-md bg-card pr-1.5 pl-1 shadow-xs ring-1 ring-separator outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] data-[state=open]:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <span className="size-5 rounded-[4px] ring-1 ring-inset ring-black/15" style={{ backgroundColor: value || "transparent" }} />
          <span className="text-sm">{current?.label ?? (value ? "Custom" : "None")}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1.5">
          {TEAM_COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              aria-label={c.label}
              aria-pressed={value === c.hex}
              onClick={() => {
                onChange(c.hex);
                setOpen(false);
              }}
              className="flex size-8 items-center justify-center rounded-md outline-none transition-transform duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection"
            >
              <span
                className="flex size-6 items-center justify-center rounded-full ring-1 ring-inset ring-black/15"
                style={{ backgroundColor: c.hex }}
              >
                {value === c.hex && <Check className={cn("size-3.5 stroke-[3]", c.hex === "#ffffff" ? "text-black" : "text-white")} />}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
  const s = Math.round(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Fields that sit inside a grouped row: no field chrome until focused. */
const inlineField =
  "h-8 border-0 bg-transparent px-1.5 shadow-none ring-0 focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-selection";

function RosterGroup({
  title,
  roster,
  onChange,
  onCommit,
}: {
  title: string;
  roster: RosterEntry[];
  onChange: (next: RosterEntry[]) => void;
  /** Saves the given roster (blur, add, remove). */
  onCommit: (next: RosterEntry[]) => void;
}) {
  const update = (i: number, field: keyof RosterEntry, value: string) => {
    const next = [...roster];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  return (
    <section>
      <GroupHeader title={title} />
      <GroupedList>
        {roster.map((entry, i) => (
          <div key={i} className="flex min-h-11 items-center gap-1 px-2.5 py-1 focus-within:bg-fill-1/60">
            <Input
              aria-label="Number"
              placeholder="#"
              className={cn(inlineField, "w-12 text-right nums")}
              value={entry.jerseyNumber}
              onChange={(e) => update(i, "jerseyNumber", e.target.value)}
              onBlur={() => onCommit(roster)}
            />
            <Input
              aria-label="Player name"
              placeholder="Player name"
              className={cn(inlineField, "flex-1")}
              value={entry.playerName}
              onChange={(e) => update(i, "playerName", e.target.value)}
              onBlur={() => onCommit(roster)}
            />
            {roster.length > 1 && (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Remove ${entry.playerName || "player"}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  const next = roster.filter((_, idx) => idx !== i);
                  onChange(next);
                  onCommit(next);
                }}
              >
                <MinusCircle />
              </Button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...roster, { jerseyNumber: "", playerName: "" }])}
          className="flex min-h-10 w-full items-center gap-2 px-4 text-left text-sm text-primary outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
        >
          <Plus className="size-4" />
          Add player
        </button>
      </GroupedList>
    </section>
  );
}

export function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const matchId = id!;
  const navigate = useNavigate();
  const { activeOrgId, activeOrgIsPersonal } = useAuth();

  const [storedMatch, setStoredMatch] = useState<StoredMatch | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [clipCount, setClipCount] = useState(0);

  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [homeColor, setHomeColor] = useState("");
  const [awayColor, setAwayColor] = useState("");
  const [syncInput, setSyncInput] = useState("");
  const [homeRoster, setHomeRoster] = useState<RosterEntry[]>([]);
  const [awayRoster, setAwayRoster] = useState<RosterEntry[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "error" | null>(null);
  /** Adjusting a tip-off that is already set reveals the picker. */
  const [adjustingTipoff, setAdjustingTipoff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dbMatch, loadedPlaylists] = await Promise.all([
          getMatch(matchId),
          listPlaylists(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }),
        ]);
        if (cancelled) return;
        if (!dbMatch) {
          setNotFound(true);
          return;
        }
        setStoredMatch(dbMatch);
        setTitle(dbMatch.title);
        setDate(dbMatch.date);
        setHomeColor(dbMatch.homeTeam.color);
        setAwayColor(dbMatch.awayTeam.color);
        setSyncInput(dbMatch.syncPoint ? formatMMSS(dbMatch.syncPoint.syncVideoTime) : "");
        setHomeRoster(dbMatch.homeRoster.length ? dbMatch.homeRoster : [{ jerseyNumber: "", playerName: "" }]);
        setAwayRoster(dbMatch.awayRoster.length ? dbMatch.awayRoster : [{ jerseyNumber: "", playerName: "" }]);
        setClipCount(
          loadedPlaylists
            .flatMap((p) => p.items.filter((i) => i.type === "clip"))
            .filter((c) => (c as { matchId: string }).matchId === matchId).length,
        );
      } catch {
        setNotFound(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, activeOrgId]);

  // Is the referenced local file actually on this machine?
  const [videoStatus, setVideoStatus] = useState<VideoFileStatus | null>(null);
  // Shared hints for the linked recording; the detector only runs while the game has no tip-off.
  const tipoffSuggestion = useTipoffSuggestion(
    storedMatch?.videoUrl && isLocalPath(storedMatch.videoUrl) && videoStatus === "ok" ? storedMatch.videoUrl : null,
    storedMatch?.sourceGameId,
    { surface: "game_page", autoDetect: !storedMatch?.syncPoint, existingSeconds: storedMatch?.syncPoint?.syncVideoTime },
  );
  useEffect(() => {
    const url = storedMatch?.videoUrl;
    if (!url || !isLocalPath(url)) {
      setVideoStatus(url ? "ok" : null);
      return;
    }
    let cancelled = false;
    void probeVideoPath(url).then(({ status }) => {
      if (!cancelled) setVideoStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [storedMatch?.videoUrl]);

  const handlePickVideoFile = useCallback(async () => {
    const result = await openFileDialog({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v"] }],
    });
    if (typeof result !== "string") return;
    try {
      await updateVideoUrl(matchId, result);
      setStoredMatch((m) => (m ? { ...m, videoUrl: result } : m));
      setVideoStatus("ok");
    } catch (e) {
      toast.error("Couldn't save the video link", { description: e instanceof Error ? e.message : String(e) });
    }
  }, [matchId]);

  const flashSaved = (state: "saved" | "error") => {
    setSaveState(state);
    window.setTimeout(() => setSaveState((s) => (s === state ? null : s)), state === "saved" ? 1500 : 2500);
  };

  async function saveField(updates: Parameters<typeof updateMatchMeta>[1]) {
    try {
      await updateMatchMeta(matchId, updates);
      flashSaved("saved");
    } catch {
      flashSaved("error");
    }
  }

  async function saveSyncPoint(secs: number) {
    if (!storedMatch) return false;
    const sp: SyncPoint = { syncVideoTime: secs, syncRealWorldTime: storedMatch.syncPoint?.syncRealWorldTime ?? "" };
    try {
      const { clearedShippedClips } = await updateSyncPoint(matchId, sp);
      setStoredMatch((m) => (m ? { ...m, syncPoint: sp } : m));
      flashSaved("saved");
      notifyClearedShippedClips(clearedShippedClips);
      return true;
    } catch {
      flashSaved("error");
      return false;
    }
  }

  if (notFound || !storedMatch) {
    return (
      <Page>
        <Toolbar
          title="Game"
          leading={
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={() => navigate("/matches")}>
              <ChevronLeft />
              Library
            </Button>
          }
        />
        <PageContent width="narrow">
          {notFound ? (
            <EmptyState
              icon={<Film />}
              title="Game not found"
              body="It may have been deleted, or it belongs to another space."
              action={
                <Button variant="outline" size="sm" onClick={() => navigate("/matches")}>
                  Back to Library
                </Button>
              }
            />
          ) : (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          )}
        </PageContent>
      </Page>
    );
  }

  const videoFileName = storedMatch.videoUrl ? videoBasename(storedMatch.videoUrl) : null;
  const videoMissing = !!videoFileName && videoStatus !== null && videoStatus !== "ok";
  const canPick = !!storedMatch.videoUrl && (!isLocalPath(storedMatch.videoUrl) || videoStatus === "ok");
  const syncHint = storedMatch.syncPoint?.syncRealWorldTime
    ? (() => {
        const d = new Date(storedMatch.syncPoint.syncRealWorldTime);
        return isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      })()
    : null;
  const tipoffSet = !!storedMatch.syncPoint;
  const showPicker = canPick && (!tipoffSet || adjustingTipoff);
  const manualSecs = parseMMSS(syncInput);

  return (
    <Page>
      <Toolbar
        title={title || storedMatch.title}
        subtitle={[`${storedMatch.homeTeam.name} – ${storedMatch.awayTeam.name}`, date ? formatDate(parseISO(date)) : null]
          .filter(Boolean)
          .join(" · ")}
        leading={
          <Button variant="ghost" size="sm" className="-ml-1 shrink-0 text-muted-foreground" onClick={() => navigate("/matches")}>
            <ChevronLeft />
            Library
          </Button>
        }
        actions={
          <AnimatePresence>
            {saveState && (
              <motion.span
                key={saveState}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className={cn("text-callout", saveState === "saved" ? "text-muted-foreground" : "text-destructive")}
              >
                {saveState === "saved" ? "Saved" : "Couldn't save"}
              </motion.span>
            )}
          </AnimatePresence>
        }
      />
      <PageContent width="narrow" className="space-y-7">
        <section>
          <GroupHeader title="Game" />
          <GroupedList>
            <FormRow label="Title" htmlFor="game-title">
              <Input
                id="game-title"
                className={cn(inlineField, "text-right")}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== storedMatch.title && void saveField({ title })}
              />
            </FormRow>
            <FormRow label="Date">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-7 items-center gap-2 rounded-md bg-card px-2.5 text-sm shadow-xs ring-1 ring-separator outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] data-[state=open]:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
                  >
                    <CalendarIcon className="size-4 text-muted-foreground" />
                    <span className="nums">{date ? formatDate(parseISO(date)) : "Pick a date"}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={date ? parseISO(date) : undefined}
                    onSelect={(day) => {
                      if (!day) return;
                      const iso = format(day, "yyyy-MM-dd");
                      setDate(iso);
                      void saveField({ date: iso });
                    }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </FormRow>
            <FormRow label="Home" description={storedMatch.homeTeam.name}>
              <ColorWell
                label="Home colour"
                value={homeColor}
                onChange={(hex) => {
                  setHomeColor(hex);
                  void saveField({ homeTeam: { name: storedMatch.homeTeam.name, color: hex } });
                }}
              />
            </FormRow>
            <FormRow label="Away" description={storedMatch.awayTeam.name}>
              <ColorWell
                label="Away colour"
                value={awayColor}
                onChange={(hex) => {
                  setAwayColor(hex);
                  void saveField({ awayTeam: { name: storedMatch.awayTeam.name, color: hex } });
                }}
              />
            </FormRow>
          </GroupedList>
          <GroupFooter className="nums">
            {storedMatch.events.length} plays from the official record
            {clipCount > 0 && `, ${clipCount} of them in playlists`}.
          </GroupFooter>
        </section>

        <section>
          <GroupHeader title="Video" />
          {storedMatch.isDemo ? (
            <GroupedList>
              <div className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-muted-foreground">
                <Film className="size-4 shrink-0" />
                The sample game's video streams from Scoutable.
              </div>
            </GroupedList>
          ) : videoMissing ? (
            <Callout
              tone="warning"
              icon={<VideoOff />}
              action={
                <Button size="sm" onClick={handlePickVideoFile}>
                  Locate…
                </Button>
              }
            >
              <p className="font-medium">Can't find {videoFileName}</p>
              <p className="mt-0.5 text-muted-foreground">
                {videoStatus === "unreadable"
                  ? "Scoutable isn't allowed to read the file. Choose it again to grant access."
                  : "It may have been moved or renamed, or it's on another computer. Games use the file where it is; nothing is uploaded."}
              </p>
            </Callout>
          ) : (
            <GroupedList>
              <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                <Film className="size-4 shrink-0 text-muted-foreground" />
                <span className={cn("min-w-0 flex-1 truncate text-sm", !videoFileName && "text-muted-foreground")}>
                  {videoFileName ?? "No video yet"}
                </span>
                <Button size="xs" variant={videoFileName ? "outline" : "default"} onClick={handlePickVideoFile}>
                  {videoFileName ? "Change…" : "Choose video…"}
                </Button>
              </div>
            </GroupedList>
          )}
          {!videoFileName && !storedMatch.isDemo && (
            <GroupFooter>Your video stays on this computer; only a few stills go to Scoutable to find the tip-off.</GroupFooter>
          )}
        </section>

        <section>
          <GroupHeader title="Tip-off" />
          {canPick ? (
            <>
              {tipoffSet && (
                <GroupedList>
                  <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                    <span className="flex-1 text-sm">
                      Tip-off at <span className="font-medium nums">{formatMSSd(storedMatch.syncPoint!.syncVideoTime)}</span>
                    </span>
                    <Button size="xs" variant="outline" onClick={() => setAdjustingTipoff((v) => !v)}>
                      {adjustingTipoff ? "Done" : "Adjust…"}
                    </Button>
                  </div>
                </GroupedList>
              )}
              <AnimatePresence initial={false}>
                {showPicker && (
                  <motion.div
                    key="picker"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={springs.standard}
                    className="overflow-hidden"
                  >
                    <div className={cn(tipoffSet && "pt-4")}>
                      <SyncPointPicker
                        videoPath={storedMatch.videoUrl!}
                        tipoffHint={syncHint ?? undefined}
                        initialSeconds={storedMatch.syncPoint?.syncVideoTime}
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
                        onConfirm={async (secs) => {
                          if (await saveSyncPoint(secs)) {
                            tipoffSuggestion.recordResolved(secs);
                            void tipoffSuggestion.saveConfirmed(secs);
                            setAdjustingTipoff(false);
                          }
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          ) : (
            <>
              <GroupedList>
                <FormRow label="Video time" htmlFor="sync-point" description="m:ss at tip-off">
                  <Input
                    id="sync-point"
                    placeholder="0:35"
                    aria-invalid={syncInput !== "" && manualSecs === null}
                    className={cn(inlineField, "w-24 text-right nums")}
                    value={syncInput}
                    onChange={(e) => setSyncInput(e.target.value)}
                    onBlur={() => {
                      // Saves whenever the time is valid, including the first time.
                      if (manualSecs !== null && manualSecs !== storedMatch.syncPoint?.syncVideoTime) void saveSyncPoint(manualSecs);
                    }}
                  />
                </FormRow>
              </GroupedList>
              <GroupFooter className={cn(syncInput !== "" && manualSecs === null && "text-destructive")}>
                {syncInput !== "" && manualSecs === null
                  ? "Use minutes and seconds, like 0:35."
                  : syncHint
                    ? `The tip-off happened at ${syncHint}. Enter the video time for that moment.`
                    : "Link the video to set the tip-off by watching it instead."}
              </GroupFooter>
            </>
          )}
        </section>

        <RosterGroup
          title={`${storedMatch.homeTeam.name || "Home"} roster`}
          roster={homeRoster}
          onChange={setHomeRoster}
          onCommit={(r) => void saveField({ homeRoster: r })}
        />
        <RosterGroup
          title={`${storedMatch.awayTeam.name || "Away"} roster`}
          roster={awayRoster}
          onChange={setAwayRoster}
          onCommit={(r) => void saveField({ awayRoster: r })}
        />

        <section>
          <GroupedList>
            <DeleteMatchDialog
              matchId={matchId}
              matchTitle={title}
              isDemo={storedMatch.isDemo}
              trigger={
                <button
                  type="button"
                  className="flex min-h-11 w-full items-center px-4 text-left text-sm text-destructive outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
                >
                  Delete game…
                </button>
              }
              onDeleted={() => navigate("/matches")}
            />
          </GroupedList>
          <GroupFooter>Permanently removes the game and all its clips. It can't be undone.</GroupFooter>
        </section>
      </PageContent>
    </Page>
  );
}
