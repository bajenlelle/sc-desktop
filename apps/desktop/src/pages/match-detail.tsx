import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarIcon, Check, ChevronLeft, ChevronsUpDown, Film, Loader2, MinusCircle, Plus, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { DeleteMatchDialog } from "@/components/delete-match-dialog";
import { EmptyState } from "@/components/empty-state";
import { formatMSSd, SyncPointPicker, type SeekRequest } from "@/components/sync-point-picker";
import { formatSpan, QuarterSyncPanel, quarterCopy } from "@/components/quarter-sync";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics";
import {
  clearAllPeriodSyncs,
  describePeriodSyncs,
  setPeriodSync,
  videoLooksCut,
} from "@scoutable/shared/lib/period-sync";
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
import { probeVideoDuration, probeVideoPath, videoBasename, type VideoFileStatus } from "@/lib/video-probe";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { StoredMatch, SyncPoint } from "@/types/match";
import { afterSyncChange } from "@/lib/sync-change";

interface RosterEntry {
  jerseyNumber: string;
  playerName: string;
}

/**
 * A sync change re-cuts the clips it moves in the background (see
 * afterSyncChange). Uploads from before clips recorded where they were cut
 * can't be compared, so those were invalidated (r2_url cleared): recipients
 * can't see them again until the coach re-uploads them.
 */
function notifyClearedShippedClips(count: number) {
  if (count === 0) return;
  toast.info(`${count} older shared clip${count === 1 ? "" : "s"} from this game are hidden until uploaded again`, {
    description: "They were shared before clips recorded where they're cut. In Shared playlists, use Upload missing clips.",
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
  /** Which moment the picker sets: 1 = the game's sync point, 2+ = a quarter's own. */
  const [activePeriod, setActivePeriod] = useState(1);
  const [quarterSeek, setQuarterSeek] = useState<SeekRequest | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  /** Typed quarter times, for a game whose video isn't on this computer. */
  const [periodInputs, setPeriodInputs] = useState<Record<string, string>>({});

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
  // The recording's length tells whether the play-by-play runs past its end (a video that skips the breaks).
  const probeUrl = storedMatch?.videoUrl && isLocalPath(storedMatch.videoUrl) && videoStatus === "ok" ? storedMatch.videoUrl : null;
  useEffect(() => {
    setVideoDuration(null);
    if (!probeUrl) return;
    let cancelled = false;
    void probeVideoDuration(probeUrl).then((d) => {
      if (!cancelled) setVideoDuration(d);
    });
    return () => {
      cancelled = true;
    };
  }, [probeUrl]);
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

  /** Saves a new sync for the game; its clips in the coach's playlists follow in the background. */
  async function saveSync(next: SyncPoint) {
    if (!storedMatch) return false;
    const before = storedMatch.syncPoint;
    try {
      const { clearedShippedClips } = await updateSyncPoint(matchId, next);
      const updated = { ...storedMatch, syncPoint: next };
      setStoredMatch((m) => (m ? { ...m, syncPoint: next } : m));
      flashSaved("saved");
      notifyClearedShippedClips(clearedShippedClips);
      void afterSyncChange(updated, before);
      return true;
    } catch {
      flashSaved("error");
      return false;
    }
  }

  async function saveSyncPoint(secs: number) {
    if (!storedMatch) return false;
    // Spread keeps the anchor (which moment the time refers to) and the quarters.
    return saveSync({
      ...storedMatch.syncPoint,
      syncVideoTime: secs,
      syncRealWorldTime: storedMatch.syncPoint?.syncRealWorldTime ?? "",
    });
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
  // Profixio games anchor on the first made basket, not the tip-off.
  const syncAnchor = storedMatch.syncPoint?.anchor;
  const firstBasket = syncAnchor?.kind === "first_basket";
  const anchorTitle = firstBasket ? "First basket" : "Tip-off";
  const anchorNoun = firstBasket ? "the first basket" : "tip-off";

  // Quarter by quarter, for a video that skips the breaks between quarters.
  const sync = storedMatch.syncPoint;
  const cutDetection = sync ? videoLooksCut({ durationSeconds: videoDuration, events: storedMatch.events, sync }) : null;
  const breaksCut = sync?.breaksCut ?? cutDetection?.cut ?? false;
  const periodRows = sync ? describePeriodSyncs(sync, storedMatch.events) : [];
  const activeRow = adjustingTipoff && breaksCut && activePeriod >= 2 ? (periodRows.find((r) => r.period === activePeriod) ?? null) : null;

  /** Opens the picker on a moment: at its set time, else a beat before where it should be. */
  function openPeriod(period: number, s: SyncPoint | undefined = sync) {
    setActivePeriod(period);
    setAdjustingTipoff(true);
    if (!s || !storedMatch) return;
    const row = period >= 2 ? describePeriodSyncs(s, storedMatch.events).find((r) => r.period === period) : null;
    const target =
      period <= 1
        ? s.syncVideoTime
        : row?.set
          ? row.videoTime
          : row?.suggested != null
            ? Math.max(0, row.suggested - 2)
            : (row?.videoTime ?? null);
    if (target !== null) setQuarterSeek({ seconds: target, nonce: Date.now() });
  }

  function closePicker() {
    setAdjustingTipoff(false);
    setActivePeriod(1);
  }

  async function savePeriod(period: number, secs: number) {
    const row = periodRows.find((r) => r.period === period);
    if (!sync || !row?.anchor) return false;
    const next: SyncPoint = { ...setPeriodSync(sync, period, secs, row.anchor), breaksCut: true };
    if (!(await saveSync(next))) return false;
    trackEvent("period_sync_set", {
      surface: "game_page",
      period,
      anchor_kind: row.anchor.kind,
      predicted_delta_s: row.suggested !== null ? Math.round((secs - row.suggested) * 10) / 10 : null,
    });
    return next;
  }

  /** The next quarter without its own sync after `period`, if any. */
  function nextUnset(period: number, s: SyncPoint) {
    return describePeriodSyncs(s, storedMatch!.events).find((r) => r.period > period && !r.set)?.period ?? null;
  }

  async function toggleBreaksCut(on: boolean) {
    if (!sync) return;
    trackEvent("sync_cut_mode_toggled", { surface: "game_page", on, detected: !!cutDetection?.cut });
    if (on) {
      const next: SyncPoint = { ...sync, breaksCut: true };
      if ((await saveSync(next)) && canPick) {
        const first = nextUnset(1, next);
        if (first !== null) openPeriod(first, next);
      }
    } else if (sync.periods && Object.keys(sync.periods).length > 0) {
      setConfirmClearOpen(true);
    } else {
      closePicker();
      void saveSync({ ...sync, breaksCut: false });
    }
  }

  async function clearQuarters() {
    setConfirmClearOpen(false);
    if (!sync) return;
    if (await saveSync({ ...clearAllPeriodSyncs(sync), breaksCut: false })) {
      trackEvent("period_sync_cleared", { surface: "game_page", period: "all" });
      closePicker();
    }
  }

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
          <GroupHeader title="Sync" />
          {canPick ? (
            <>
              {tipoffSet && (
                <GroupedList>
                  <div className="flex min-h-11 items-center gap-3 px-4 py-2">
                    <span className="flex-1 text-sm">
                      {anchorTitle} at <span className="font-medium nums">{formatMSSd(storedMatch.syncPoint!.syncVideoTime)}</span>
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => (adjustingTipoff ? closePicker() : openPeriod(1))}
                    >
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
                      {/* One picker for the game's sync point and each quarter's own. */}
                      <SyncPointPicker
                        videoPath={storedMatch.videoUrl!}
                        tipoffHint={syncHint ?? undefined}
                        anchorKind={firstBasket ? "first_basket" : "tipoff"}
                        anchorDetail={
                          activeRow
                            ? activeRow.anchor?.label
                            : syncAnchor
                              ? `${syncAnchor.label}${syncHint ? `, ${syncHint}` : ""}`
                              : undefined
                        }
                        initialSeconds={storedMatch.syncPoint?.syncVideoTime}
                        copy={activeRow ? quarterCopy(activeRow) : undefined}
                        note={activeRow ? null : undefined}
                        confirmedSeconds={
                          activeRow ? (activeRow.set ? activeRow.videoTime : null) : (storedMatch.syncPoint?.syncVideoTime ?? null)
                        }
                        seekRequest={activeRow || quarterSeek ? quarterSeek : tipoffSuggestion.seekRequest}
                        onUserAction={activeRow ? undefined : tipoffSuggestion.noteUserAction}
                        hasPendingSuggestion={!activeRow && isSuggestionPending(tipoffSuggestion.state)}
                        suggestionSlot={
                          activeRow ? undefined : (
                            <TipoffSuggestionStrip
                              state={tipoffSuggestion.state}
                              onAccept={tipoffSuggestion.accept}
                              onReject={tipoffSuggestion.reject}
                              onCancel={tipoffSuggestion.cancel}
                            />
                          )
                        }
                        onConfirm={async (secs) => {
                          if (activeRow) {
                            const next = await savePeriod(activeRow.period, secs);
                            if (next) {
                              const after = nextUnset(activeRow.period, next);
                              if (after !== null) openPeriod(after, next);
                              else closePicker();
                            }
                            return;
                          }
                          if (await saveSyncPoint(secs)) {
                            tipoffSuggestion.recordResolved(secs);
                            void tipoffSuggestion.saveConfirmed(secs);
                            closePicker();
                          }
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              {tipoffSet && periodRows.length > 0 && (
                <div className="pt-4">
                  <QuarterSyncPanel
                    q1Label={syncAnchor?.label ?? "Tip-off"}
                    q1Time={storedMatch.syncPoint!.syncVideoTime}
                    rows={periodRows}
                    active={adjustingTipoff ? activePeriod : 0}
                    breaksCut={breaksCut}
                    detection={cutDetection}
                    onToggle={(on) => void toggleBreaksCut(on)}
                    onSelect={(p) => openPeriod(p)}
                    onSkip={(p) => {
                      trackEvent("period_sync_skipped", { surface: "game_page", period: p });
                      const after = sync ? nextUnset(p, sync) : null;
                      if (after !== null) openPeriod(after);
                      else closePicker();
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <GroupedList>
                <FormRow label="Video time" htmlFor="sync-point" description={`m:ss at ${anchorNoun}`}>
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
                {/* A video that skips the breaks: each quarter's own time, typed. */}
                {tipoffSet &&
                  breaksCut &&
                  periodRows.map((row) => {
                    const key = String(row.period);
                    const typed = periodInputs[key] ?? (row.set && row.videoTime !== null ? formatMMSS(row.videoTime) : "");
                    const secs = parseMMSS(typed);
                    return (
                      <FormRow
                        key={key}
                        label={`${row.name} video time`}
                        htmlFor={`sync-${key}`}
                        description={row.anchor ? `m:ss at ${row.anchor.label}` : undefined}
                      >
                        <Input
                          id={`sync-${key}`}
                          placeholder={row.suggested !== null ? formatSpan(row.suggested) : `Follows ${row.follows === 1 ? "Q1" : `Q${row.follows}`}`}
                          aria-invalid={typed !== "" && secs === null}
                          className={cn(inlineField, "w-24 text-right nums")}
                          value={typed}
                          onChange={(e) => setPeriodInputs((prev) => ({ ...prev, [key]: e.target.value }))}
                          onBlur={() => {
                            if (secs !== null && (!row.set || secs !== row.videoTime)) void savePeriod(row.period, secs);
                          }}
                        />
                      </FormRow>
                    );
                  })}
              </GroupedList>
              <GroupFooter className={cn(syncInput !== "" && manualSecs === null && "text-destructive")}>
                {syncInput !== "" && manualSecs === null
                  ? "Use minutes and seconds, like 0:35."
                  : syncHint
                    ? syncAnchor
                      ? `The reference is ${syncAnchor.label}, logged at ${syncHint}. Enter the video time for that moment.`
                      : `The tip-off happened at ${syncHint}. Enter the video time for that moment.`
                    : `Link the video to set ${anchorNoun === "tip-off" ? "the tip-off" : anchorNoun} by watching it instead.`}
              </GroupFooter>
              {tipoffSet && periodRows.length > 0 && (
                <div className="pt-4">
                  <QuarterSyncPanel
                    q1Label={syncAnchor?.label ?? "Tip-off"}
                    q1Time={storedMatch.syncPoint!.syncVideoTime}
                    rows={[]}
                    active={0}
                    breaksCut={breaksCut}
                    detection={cutDetection}
                    onToggle={(on) => void toggleBreaksCut(on)}
                    onSelect={() => {}}
                    onSkip={() => {}}
                  />
                </div>
              )}
            </>
          )}
          <Dialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove the quarter syncs?</DialogTitle>
                <DialogDescription>
                  Every quarter follows the {anchorTitle.toLowerCase()} again. Clips from later quarters move back to where
                  a video that holds the whole game would have them.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmClearOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => void clearQuarters()}>
                  Remove
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
