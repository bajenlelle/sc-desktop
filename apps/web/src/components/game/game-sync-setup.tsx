"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { setGameVideoSync } from "@scoutable/shared/lib/game-video-client";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { FALLBACK_FRAME_SECONDS, SyncPicker, type SeekRequest } from "@/components/game/sync-picker";
import { TipoffSuggestionStrip } from "@/components/game/tipoff-suggestion-strip";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

/** A time this close to the converter's is the converter's, confirmed. */
const CONFIRM_TOLERANCE_S = 0.3;

/** A wall-clock time as the coach's local hh:mm, for "look for … at 16:30". */
function localClock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Setting a browser-imported game's sync on the web, through the function's
 * one action (`sync_set`), which writes the game's sync point, a confirmed
 * hint for this recording and the row's status together.
 *
 * `setup`: the game has no sync yet. The strip above the picker says what
 * the converter found (a suggestion to take in one press, or nothing), and
 * "Set tip-off here" saves the frame the user chose.
 * `check`: the converter applied a confident tip-off; the picker opens on
 * it and the user either agrees (within a third of a second) or moves it.
 */
export function GameSyncSetup({
  match,
  video,
  src,
  onSourceStale,
  mode,
  appliedSeconds = null,
  onSynced,
  keyContainer,
}: {
  match: StoredMatch;
  video: GameVideo;
  src: string;
  onSourceStale: () => Promise<string | null>;
  mode: "setup" | "check";
  /** `check` mode: the tip-off the converter applied. */
  appliedSeconds?: number | null;
  /** The sync was written: reload the game. */
  onSynced: () => void;
  keyContainer?: React.RefObject<HTMLElement | null>;
}) {
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const savedRef = useRef(false);

  const anchorKind = video.anchorKind === "first_basket" ? "first_basket" : "tipoff";
  const clock = localClock(video.anchorRealWorldTime ?? match.syncPoint?.syncRealWorldTime ?? null);
  const anchorDetail =
    anchorKind === "first_basket" && video.anchorLabel ? `${video.anchorLabel}${clock ? `, ${clock}` : ""}` : clock ? `the tip-off around ${clock}` : undefined;
  const reference = mode === "check" ? appliedSeconds : video.syncStatus === "suggested" ? video.suggestedTipoffSeconds : null;
  const frameSeconds = video.fps && video.fps > 1 && video.fps < 241 ? 1 / video.fps : FALLBACK_FRAME_SECONDS;

  async function confirm(seconds: number) {
    if (savedRef.current || confirming) return;
    setConfirming(true);
    const agrees = reference !== null && Math.abs(seconds - reference) <= CONFIRM_TOLERANCE_S;
    const result = await setGameVideoSync(createClient(), {
      videoId: video.id,
      status: agrees ? "confirmed" : "manual",
      seconds,
    });
    setConfirming(false);
    if (!result.ok) {
      if (result.error === "sync_locked") {
        toast.info("This game's sync was set in the desktop app", { description: "Change it there if it needs moving." });
        onSynced();
        return;
      }
      toast.error("Couldn't save the tip-off", {
        description: result.error === "not_authenticated" ? "You're signed out. Sign in and try again." : "Try again in a moment.",
      });
      return;
    }
    savedRef.current = true;
    trackEvent("tipoff_check_resolved", {
      action: agrees ? "looks_right" : reference !== null ? "adjusted" : "set_manually",
      delta_s: reference !== null ? Math.round((seconds - reference) * 10) / 10 : null,
      mode,
    });
    onSynced();
  }

  return (
    <SyncPicker
      src={src}
      onSourceStale={onSourceStale}
      anchorKind={anchorKind}
      anchorDetail={anchorDetail}
      initialSeconds={reference ?? undefined}
      frameSeconds={frameSeconds}
      seekRequest={seekRequest}
      onConfirm={confirm}
      confirming={confirming}
      hasPendingSuggestion={mode === "setup" && !dismissed && video.syncStatus === "suggested"}
      suggestionSlot={
        mode === "setup" ? (
          <TipoffSuggestionStrip
            video={video}
            dismissed={dismissed}
            onUse={(seconds) => setSeekRequest({ seconds, nonce: Date.now(), confirm: true })}
            onSetManually={() => setDismissed(true)}
          />
        ) : undefined
      }
      keyContainer={keyContainer}
    />
  );
}
