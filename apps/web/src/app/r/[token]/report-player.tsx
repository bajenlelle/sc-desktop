"use client";

/**
 * A scouting report's clip in the playlists' player: the watch view's
 * PlayerStage in its one-clip form (play and pause, Replay, speed, full
 * screen, and the timeline with the coach's drawings and slow motion). A
 * drawing freezes its frame and stays in full screen on every device, the
 * iPhone's full-window layer included. The clip's note stays in the caption
 * under it, as before.
 *
 * One clip plays at a time across the page, and the viewer's speed carries
 * from one clip to the next: both live here, outside React, for every tile to
 * read. The page is outside the signed-in app, so the player brings the app's
 * providers along (its tooltips and motion), as the watch view has them.
 */
import { useCallback, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref, type RefObject } from "react";
import type { ReportClip } from "@scoutable/shared/lib/scouting-report";
import { AppProviders } from "@/components/providers";
import { DrawingLayer } from "@/components/player/drawing-layer";
import { PlayerStage, type PlayerStageHandle } from "@/components/player/player-stage";
import { useClipEffects } from "@/components/player/use-clip-effects";
import { useMediaDuration } from "@/components/player/use-media";
import { useStageFullscreen } from "@/components/player/use-stage-fullscreen";

let activeClip: string | null = null;
let viewerSpeed = 1;
const listeners = new Set<() => void>();

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

function notifyAll() {
  for (const notify of listeners) notify();
}

/** The id of the clip playing on the page, or null. */
export function useActiveReportClip(): string | null {
  return useSyncExternalStore(subscribe, () => activeClip, () => null);
}

/** Plays this clip's tile; the one that was playing goes back to its poster. */
export function setActiveReportClip(id: string | null) {
  if (activeClip === id) return;
  activeClip = id;
  notifyAll();
}

function useViewerSpeed(): number {
  return useSyncExternalStore(subscribe, () => viewerSpeed, () => 1);
}

function setViewerSpeed(speed: number) {
  viewerSpeed = speed;
  notifyAll();
}

/** What the tile asks of its player from the keyboard. */
export interface ReportClipPlayerHandle {
  togglePlay: () => void;
  pause: () => void;
  replay: () => void;
  nudge: (seconds: number) => void;
  toggleFullscreen: () => void;
  /** Leaves full screen; false when the player wasn't in it. */
  exitFullscreen: () => boolean;
}

const NO_DRAWINGS: NonNullable<ReportClip["drawings"]> = [];
const NO_SLOWS: NonNullable<ReportClip["slowMotion"]> = [];
const noop = () => {};

export function ReportClipPlayer({
  clip,
  title,
  src,
  video,
  videoRef,
  attachVideo,
  handleRef,
}: {
  clip: ReportClip;
  /** The full-screen bar's line: the play and when it happened. */
  title: string;
  /** The clip file the tile set on the video (the source of the rate it keeps). */
  src: string;
  /** The tile's video element (useMediaElement): the tile gives it its source and plays it, inside the tap. */
  video: HTMLVideoElement | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  attachVideo: (el: HTMLVideoElement | null) => void;
  handleRef?: Ref<ReportClipPlayerHandle>;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const stageHandle = useRef<PlayerStageHandle | null>(null);
  const fullscreen = useStageFullscreen(stage);
  const duration = useMediaDuration(video);
  const speed = useViewerSpeed();
  // The coach's drawings freeze their frames and slow motion slows its stretch, in the clip file's time.
  const effects = useClipEffects(video, { drawings: clip.drawings ?? NO_DRAWINGS, slows: clip.slowMotion ?? NO_SLOWS }, speed, true);
  const cancelHold = effects.cancel;

  const seek = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el || duration === null) return;
      cancelHold();
      el.currentTime = Math.min(Math.max(t, 0), Math.max(0, duration - 0.05));
    },
    [videoRef, duration, cancelHold],
  );

  const replay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    cancelHold();
    el.currentTime = 0;
    el.play().catch(() => {});
  }, [videoRef, cancelHold]);

  useImperativeHandle(
    handleRef,
    () => ({
      togglePlay: () => stageHandle.current?.togglePlay(),
      pause: () => {
        cancelHold();
        videoRef.current?.pause();
      },
      replay,
      nudge: (seconds) => {
        const el = videoRef.current;
        if (el) seek(el.currentTime + seconds);
      },
      toggleFullscreen: fullscreen.toggle,
      exitFullscreen: () => {
        if (!fullscreen.active) return false;
        void fullscreen.exit();
        return true;
      },
    }),
    [cancelHold, videoRef, replay, seek, fullscreen],
  );

  return (
    <AppProviders>
      <PlayerStage
        handleRef={stageHandle}
        attachVideo={attachVideo}
        video={video}
        videoRef={videoRef}
        stageRef={setStage}
        stage={stage}
        src={src}
        duration={duration}
        onSeek={seek}
        hold={{ active: effects.holding !== null, cancel: cancelHold }}
        drawings={clip.drawings}
        slows={clip.slowMotion}
        fullscreen={fullscreen}
        title={title}
        single
        transport={{ isQueueActive: true, canPrev: false, canNext: false, onPrev: noop, onNext: noop, onReplay: replay, onStop: noop }}
        speed={speed}
        onSpeedChange={setViewerSpeed}
      >
        {effects.shown && <DrawingLayer key={effects.shown.id} shapes={effects.shown.shapes} />}
      </PlayerStage>
    </AppProviders>
  );
}
