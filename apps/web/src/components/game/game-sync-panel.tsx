"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { setGameVideoPeriods, setGameVideoSync } from "@scoutable/shared/lib/game-video-client";
import { syncPeriodsPayloadOf } from "@scoutable/shared/lib/game-video-wire";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import {
  clearAllPeriodSyncs,
  clearPeriodSync,
  describePeriodSyncs,
  nextUnsetPeriod,
  normalizeSyncPoint,
  setPeriodSync,
  videoLooksCut,
} from "@scoutable/shared/lib/period-sync";
import type { StoredMatch, SyncPoint } from "@scoutable/shared/types/match";
import { QuarterSyncPanel } from "@/components/game/quarter-sync-panel";
import { FALLBACK_FRAME_SECONDS, SyncPicker, type SeekRequest } from "@/components/game/sync-picker";
import { TipoffSuggestionStrip } from "@/components/game/tipoff-suggestion-strip";
import { quarterCopy } from "@/components/sync/sync-words";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

/** A time this close to the converter's applied one confirms it rather than replacing it. */
const CONFIRM_TOLERANCE_S = 0.3;

/** The game's sync point as stored now (a tip-off write may also have moved its reference). */
export async function readSyncPoint(matchId: string): Promise<SyncPoint | null> {
  const { data } = await createClient().from("matches").select("sync_point").eq("id", matchId).maybeSingle();
  const raw = (data as { sync_point?: SyncPoint | null } | null)?.sync_point;
  return raw && typeof raw.syncVideoTime === "number" ? normalizeSyncPoint(raw) : null;
}

/** Why a sync write didn't land, in the words the toasts use. */
export function syncWriteError(token: string): { title: string; description: string } {
  switch (token) {
    case "not_authenticated":
      return { title: "Couldn't save the sync", description: "You're signed out. Sign in and try again." };
    case "not_found":
      return { title: "Couldn't save the sync", description: "Only the person who uploaded this game's video can change its sync." };
    case "no_sync":
      return { title: "Set the tip-off first", description: "Each quarter's sync builds on the game's tip-off." };
    case "wrong_status":
      return { title: "Couldn't save the sync", description: "The video is being replaced. Try again once it's ready." };
    case "invalid_request":
      return { title: "Couldn't save the sync", description: "That puts a quarter outside the video. Set it again." };
    default:
      return { title: "Couldn't save the sync", description: "Try again in a moment." };
  }
}

/** A wall-clock time as the coach's local hh:mm, for "look for … at 16:30". */
function localClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const tenths = (n: number) => Math.round(n * 10) / 10;

/**
 * The game's sync on the web, the desktop game page's Sync section: one
 * picker for the tip-off and for each quarter's own start, and below it the
 * quarter-by-quarter panel for a video that skips the breaks (switched on by
 * videoLooksCut, or by the coach). The tip-off goes through `sync_set` (the
 * uploader's manual set always applies, also after the video was replaced);
 * the quarters through `sync_periods_set`. Every write re-cuts the shared
 * clips it moves on the server and reports the new sync point to the page.
 */
export function GameSyncPanel({
  match,
  video,
  src,
  onSourceStale,
  durationSeconds,
  initialPeriod = 1,
  onChanged,
  keyContainer,
}: {
  /** The game with its play-by-play and a sync point. */
  match: StoredMatch & { syncPoint: SyncPoint };
  /** The viewer's ready copy of it. */
  video: GameVideo;
  src: string;
  onSourceStale: () => Promise<string | null>;
  durationSeconds: number | null;
  /** Open on a quarter instead of the tip-off (the "skips the breaks" banner opens the first unset one). */
  initialPeriod?: number;
  /** A write landed: the page shows the game with this sync from now on. */
  onChanged: (next: SyncPoint) => void;
  keyContainer?: React.RefObject<HTMLElement | null>;
}) {
  const events = match.events;
  const [sync, setSync] = useState<SyncPoint>(match.syncPoint);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  const cutDetection = useMemo(() => videoLooksCut({ durationSeconds, events, sync }), [durationSeconds, events, sync]);
  const breaksCut = sync.breaksCut ?? cutDetection.cut;
  const rows = useMemo(() => describePeriodSyncs(sync, events), [sync, events]);

  // Where a moment's picker opens: its set time, else a beat before where it should be.
  function targetOf(s: SyncPoint, period: number): number | null {
    if (period <= 1) return s.syncVideoTime;
    const row = describePeriodSyncs(s, events).find((r) => r.period === period);
    if (!row) return null;
    if (row.set) return row.videoTime;
    return row.suggested !== null ? Math.max(0, row.suggested - 2) : row.videoTime;
  }

  const [activePeriod, setActivePeriod] = useState(() => (initialPeriod >= 2 && rows.some((r) => r.period === initialPeriod) ? initialPeriod : 1));
  // Where the picker opens; later moves go through `seek`.
  const [firstTarget] = useState(() => targetOf(match.syncPoint, activePeriod));
  const [seek, setSeek] = useState<SeekRequest | null>(null);
  const activeRow = breaksCut && activePeriod >= 2 ? (rows.find((r) => r.period === activePeriod) ?? null) : null;

  function openPeriod(period: number, s: SyncPoint = sync) {
    setActivePeriod(period);
    const target = targetOf(s, period);
    if (target !== null) setSeek({ seconds: target, nonce: Date.now() });
  }

  async function writePeriods(next: SyncPoint): Promise<SyncPoint | null> {
    setSaving(true);
    const result = await setGameVideoPeriods(createClient(), { videoId: video.id, syncPoint: syncPeriodsPayloadOf(next) });
    setSaving(false);
    if (!result.ok) {
      const copy = syncWriteError(result.error);
      toast.error(copy.title, { description: copy.description });
      return null;
    }
    const saved = normalizeSyncPoint(result.data.syncPoint as unknown as SyncPoint);
    setSync(saved);
    onChanged(saved);
    return saved;
  }

  async function saveTipoff(seconds: number) {
    if (saving) return;
    const before = sync.syncVideoTime;
    const agrees = video.syncStatus === "applied" && Math.abs(seconds - before) <= CONFIRM_TOLERANCE_S;
    setSaving(true);
    const result = await setGameVideoSync(createClient(), { videoId: video.id, status: agrees ? "confirmed" : "manual", seconds });
    if (!result.ok) {
      setSaving(false);
      const copy = syncWriteError(result.error);
      toast.error(copy.title, { description: copy.description });
      return;
    }
    const saved = (await readSyncPoint(match.id)) ?? { ...sync, syncVideoTime: result.data.seconds };
    setSaving(false);
    setSync(saved);
    onChanged(saved);
    trackEvent("tipoff_check_resolved", { action: agrees ? "looks_right" : "adjusted", delta_s: tenths(seconds - before), mode: "adjust", origin: "web" });
    // A video that skips the breaks: the quarters come next, as at import.
    if ((saved.breaksCut ?? videoLooksCut({ durationSeconds, events, sync: saved }).cut) && !saved.periods) {
      const first = nextUnsetPeriod(saved, events, 1);
      if (first !== null) openPeriod(first, saved);
    }
  }

  async function saveQuarter(period: number, seconds: number) {
    const row = rows.find((r) => r.period === period);
    if (!row?.anchor || saving) return;
    const saved = await writePeriods({ ...setPeriodSync(sync, period, seconds, row.anchor), breaksCut: true });
    if (!saved) return;
    trackEvent("period_sync_set", {
      surface: "game_page",
      origin: "web",
      period,
      anchor_kind: row.anchor.kind,
      predicted_delta_s: row.suggested !== null ? tenths(seconds - row.suggested) : null,
    });
    const after = nextUnsetPeriod(saved, events, period);
    if (after !== null) openPeriod(after, saved);
  }

  async function toggle(on: boolean) {
    trackEvent("sync_cut_mode_toggled", { surface: "game_page", origin: "web", on, detected: cutDetection.cut });
    if (on) {
      const saved = await writePeriods({ ...sync, breaksCut: true });
      const first = saved ? nextUnsetPeriod(saved, events, 1) : null;
      if (saved && first !== null) openPeriod(first, saved);
      return;
    }
    if (sync.periods && Object.keys(sync.periods).length > 0) {
      setConfirmClear(true);
      return;
    }
    if (await writePeriods({ ...sync, breaksCut: false })) openPeriod(1);
  }

  async function clearAll() {
    const saved = await writePeriods({ ...clearAllPeriodSyncs(sync), breaksCut: false });
    setConfirmClear(false);
    if (!saved) return;
    trackEvent("period_sync_cleared", { surface: "game_page", origin: "web", period: "all" });
    openPeriod(1, saved);
  }

  async function clearOne(period: number) {
    const saved = await writePeriods(clearPeriodSync(sync, period));
    if (!saved) return;
    trackEvent("period_sync_cleared", { surface: "game_page", origin: "web", period });
    openPeriod(period, saved);
  }

  function skip(period: number) {
    trackEvent("period_sync_skipped", { surface: "game_page", origin: "web", period });
    const after = nextUnsetPeriod(sync, events, period);
    if (after !== null) openPeriod(after);
  }

  const firstBasket = video.anchorKind === "first_basket" || (!video.anchorKind && sync.anchor?.kind === "first_basket");
  const clock = localClock(video.anchorRealWorldTime ?? sync.syncRealWorldTime);
  const q1Detail = firstBasket
    ? `${video.anchorLabel ?? sync.anchor?.label ?? "the first basket"}${clock ? `, ${clock}` : ""}`
    : clock
      ? `the tip-off around ${clock}`
      : undefined;
  const frameSeconds = video.fps && video.fps > 1 && video.fps < 241 ? 1 / video.fps : FALLBACK_FRAME_SECONDS;
  const offerSuggestion = !activeRow && !suggestionDismissed && video.syncStatus === "suggested" && video.suggestedTipoffSeconds !== null;

  return (
    <div className="space-y-5">
      <SyncPicker
        src={src}
        onSourceStale={onSourceStale}
        anchorKind={firstBasket ? "first_basket" : "tipoff"}
        anchorDetail={activeRow ? (activeRow.anchor?.label ?? undefined) : q1Detail}
        copy={activeRow ? quarterCopy(activeRow) : undefined}
        note={activeRow ? null : undefined}
        initialSeconds={firstTarget}
        confirmedSeconds={activeRow ? (activeRow.set ? activeRow.videoTime : null) : sync.syncVideoTime}
        frameSeconds={frameSeconds}
        seekRequest={seek}
        onConfirm={(seconds) => (activeRow ? saveQuarter(activeRow.period, seconds) : saveTipoff(seconds))}
        confirming={saving}
        hasPendingSuggestion={offerSuggestion}
        suggestionSlot={
          offerSuggestion ? (
            <TipoffSuggestionStrip
              video={video}
              onUse={(seconds) => setSeek({ seconds, nonce: Date.now(), confirm: true })}
              onSetManually={() => setSuggestionDismissed(true)}
            />
          ) : undefined
        }
        keyContainer={keyContainer}
      />
      {rows.length > 0 && (
        <QuarterSyncPanel
          q1Label={firstBasket ? (sync.anchor?.label ?? "First basket") : "Tip-off"}
          q1Time={sync.syncVideoTime}
          rows={rows}
          active={breaksCut ? activePeriod : 0}
          breaksCut={breaksCut}
          detection={cutDetection}
          busy={saving}
          onToggle={(on) => void toggle(on)}
          onSelect={(p) => openPeriod(p)}
          onSkip={skip}
          onClear={(p) => void clearOne(p)}
        />
      )}
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Remove the quarter syncs?"
        description={`Every quarter follows the ${firstBasket ? "first basket" : "tip-off"} again. Clips from later quarters move back to where a video that holds the whole game would have them.`}
        confirmLabel="Remove quarter syncs"
        destructive
        busy={saving}
        onConfirm={clearAll}
      />
    </div>
  );
}
