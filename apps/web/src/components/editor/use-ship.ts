"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { shipPlaylist } from "@scoutable/shared/lib/game-video-client";
import {
  getLiveRenderJob,
  getRenderJob,
  isRenderJobLive,
  renderJobCounts,
  type RenderJob,
} from "@scoutable/shared/lib/render-jobs-db";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";

/** What asked for the clips to be cut; the first cause of a burst is the one reported. */
export type ShipTrigger = "share" | "add" | "trim" | "rolls" | "retry";
export type ShipPhase = "idle" | "requesting" | "running" | "done" | "failed";

export interface ShipState {
  phase: ShipPhase;
  /** Clips cut so far, and how many the job cuts. */
  done: number;
  total: number;
  /** Clips the finished job could not cut. */
  failed: number;
  /** Games whose clips were left out: no cloud copy the owner may cut from. */
  noCopyMatchIds: string[];
}

const IDLE: ShipState = { phase: "idle", done: 0, total: 0, failed: 0, noCopyMatchIds: [] };
/** Edits in a burst (a trim, then another) become one request. */
const COALESCE_MS = 1500;
const POLL_MS = 3000;

function failureText(token: string): string {
  switch (token) {
    case "feature_disabled":
      return "Cloud game videos are turned off right now.";
    case "not_owner":
      return "Only the playlist's owner can prepare its clips.";
    case "invalid_request":
      return "The sample game's clips can't be shared.";
    default:
      return "Check your connection and try again.";
  }
}

/**
 * Asks the server to cut the playlist's clips from the cloud copies so the
 * people it is shared with can watch, and follows the job it starts. The
 * owner's own playback never waits for this (they watch windows of their
 * copies); recipients see each clip once its file lands.
 *
 * Requests coalesce over a moment and are no-ops unless the playlist has
 * recipients. A project without a renderer answers `renderer_unavailable`:
 * said once, quietly, and not asked again this visit. A finished job
 * re-reads the playlist (the files' URLs landed) and says so; one with
 * failures offers to try again.
 */
export function useShip({
  playlistId,
  enabled,
  hasRecipients,
  onDone,
}: {
  playlistId: string;
  enabled: boolean;
  /** Read at request time, so a share that just landed counts. */
  hasRecipients: () => boolean;
  /** A job finished: the clips' files are in place. */
  onDone: () => void | Promise<void>;
}) {
  const [state, setState] = useState<ShipState>(IDLE);
  const hasRecipientsRef = useRef(hasRecipients);
  const onDoneRef = useRef(onDone);
  useLayoutEffect(() => {
    hasRecipientsRef.current = hasRecipients;
    onDoneRef.current = onDone;
  });

  const alive = useRef(true);
  const coalesceRef = useRef<number | null>(null);
  const pendingTriggerRef = useRef<ShipTrigger | null>(null);
  const pollRef = useRef<number | null>(null);
  /** Each run gets a generation so a poll from an earlier run is dropped. */
  const generationRef = useRef(0);
  const unavailableRef = useRef(false);
  const requestRef = useRef<(trigger: ShipTrigger) => void>(() => {});
  /** `follow` hands a requeued job to itself through this, so it needn't name itself before it exists. */
  const followRef = useRef<(jobId: string, total: number, generation: number) => void>(() => {});

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) window.clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (coalesceRef.current !== null) window.clearTimeout(coalesceRef.current);
      stopPolling();
    };
  }, [stopPolling]);

  const finish = useCallback((job: RenderJob, total: number) => {
    const counts = renderJobCounts(job, total);
    if (job.status === "failed") {
      setState({ phase: "failed", ...counts, noCopyMatchIds: [] });
      toast.error("Couldn't prepare the clips", {
        description: failureText(job.error ?? ""),
        action: { label: "Try again", onClick: () => requestRef.current("retry") },
      });
      return;
    }
    setState({ phase: "done", ...counts, noCopyMatchIds: [] });
    void onDoneRef.current();
    if (counts.failed > 0) {
      toast.error(
        counts.failed === 1
          ? `1 of ${counts.total} clips couldn't be prepared`
          : `${counts.failed} of ${counts.total} clips couldn't be prepared`,
        {
          description: "Recipients see the others. Try again to cut the rest.",
          action: { label: "Try again", onClick: () => requestRef.current("retry") },
        },
      );
    } else if ((job.result?.shipped ?? 0) > 0) {
      toast.success("Clips shared", {
        description: `${job.result!.shipped} ${job.result!.shipped === 1 ? "clip is" : "clips are"} ready for recipients.`,
      });
    }
  }, []);

  /** Follows a job until it settles, then any job the server queued after it. */
  const follow = useCallback(
    (jobId: string, total: number, generation: number) => {
      stopPolling();
      const tick = async () => {
        if (!alive.current || generation !== generationRef.current) return;
        if (document.hidden) {
          pollRef.current = window.setTimeout(tick, POLL_MS);
          return;
        }
        const supabase = createClient();
        const job = await getRenderJob(supabase, jobId);
        if (!alive.current || generation !== generationRef.current) return;
        if (!job) {
          // Gone (cleaned up, or never ours): nothing more to follow.
          setState(IDLE);
          return;
        }
        if (isRenderJobLive(job.status)) {
          setState((s) => ({ ...s, phase: "running", ...renderJobCounts(job, total) }));
          pollRef.current = window.setTimeout(tick, POLL_MS);
          return;
        }
        // Edits landed while it ran: the server started a fresh job after it.
        if (job.requeue) {
          const next = await getLiveRenderJob(supabase, playlistId, "ship");
          if (!alive.current || generation !== generationRef.current) return;
          if (next && next.id !== job.id) {
            setState((s) => ({ ...s, phase: "running", ...renderJobCounts(next, next.result?.total || total) }));
            followRef.current(next.id, next.result?.total || total, generation);
            return;
          }
        }
        finish(job, total);
      };
      pollRef.current = window.setTimeout(tick, POLL_MS);
    },
    [playlistId, stopPolling, finish],
  );
  useLayoutEffect(() => {
    followRef.current = follow;
  });

  const run = useCallback(
    async (trigger: ShipTrigger) => {
      if (!alive.current) return;
      const generation = ++generationRef.current;
      stopPolling();
      // The last job's counts don't describe this one: "Preparing clips…" until the server says how many.
      setState((s) => ({ ...s, phase: "requesting", done: 0, total: 0, failed: 0 }));
      const result = await shipPlaylist(createClient(), playlistId);
      if (!alive.current || generation !== generationRef.current) return;
      if (!result.ok) {
        if (result.error === "renderer_unavailable") {
          // Said once: the project has no renderer yet; editing goes on.
          if (!unavailableRef.current) {
            unavailableRef.current = true;
            toast("Clips can't be prepared yet", {
              description: "Recipients will see them once clip preparation is switched on for this project.",
            });
          }
          setState(IDLE);
          return;
        }
        setState({ ...IDLE, phase: "failed" });
        toast.error("Couldn't prepare the clips", {
          description: failureText(result.error),
          action: { label: "Try again", onClick: () => requestRef.current("retry") },
        });
        return;
      }
      const { jobId, status, total, noCopy } = result.data;
      const noCopyMatchIds = noCopy.map((n) => n.matchId);
      trackEvent("playlist_ship_requested", { playlist_id: playlistId, trigger, total, no_copy: noCopyMatchIds.length });
      if (jobId === null || status === "done") {
        // Nothing needed cutting: every clip's file is current.
        setState({ phase: "idle", done: total, total, failed: 0, noCopyMatchIds });
        return;
      }
      setState({ phase: "running", done: 0, total, failed: 0, noCopyMatchIds });
      follow(jobId, total, generation);
    },
    [playlistId, stopPolling, follow],
  );

  const requestShip = useCallback(
    (trigger: ShipTrigger) => {
      if (!enabled) return;
      if (unavailableRef.current && trigger !== "retry") return;
      if (trigger === "retry") unavailableRef.current = false;
      if (!hasRecipientsRef.current()) return;
      pendingTriggerRef.current ??= trigger;
      if (coalesceRef.current !== null) return;
      coalesceRef.current = window.setTimeout(() => {
        coalesceRef.current = null;
        const cause = pendingTriggerRef.current ?? trigger;
        pendingTriggerRef.current = null;
        void run(cause);
      }, COALESCE_MS);
    },
    [enabled, run],
  );
  useLayoutEffect(() => {
    requestRef.current = requestShip;
  });

  // Arriving on a playlist whose clips are being cut (a reload mid-job):
  // pick the job up where it is.
  useEffect(() => {
    if (!enabled || !hasRecipientsRef.current()) return;
    let cancelled = false;
    void getLiveRenderJob(createClient(), playlistId, "ship").then((job) => {
      if (cancelled || !job || !alive.current || generationRef.current !== 0) return;
      const generation = ++generationRef.current;
      const total = job.result?.total ?? 0;
      setState({ phase: "running", ...renderJobCounts(job, total), noCopyMatchIds: [] });
      follow(job.id, total, generation);
    });
    return () => {
      cancelled = true;
    };
    // Once per playlist, when the editor is ready for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, playlistId]);

  const retry = useCallback(() => requestShip("retry"), [requestShip]);

  return { ...state, requestShip, retry };
}

export type UseShip = ReturnType<typeof useShip>;
