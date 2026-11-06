"use client";

/**
 * One clip on the report page: its poster (for a clip the coach drew on,
 * the frame they drew on, with the drawing), and on a tap the clip plays right
 * there in the playlists' player (report-player.tsx), with the coach's
 * drawings and slow motion. One clip plays at a time, and a tile that isn't
 * playing holds no video, so a long report loads nothing up front. In print
 * the poster stands in for the video (a video doesn't print).
 */
import { useRef, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Play } from "lucide-react";
import { eventColors } from "@scoutable/shared/lib/events";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import type { ReportClip } from "@scoutable/shared/lib/scouting-report";
import { useMediaElement } from "@/components/player/use-media";
import { cn } from "@/lib/utils";
import { ReportClipPlayer, setActiveReportClip, useActiveReportClip, type ReportClipPlayerHandle } from "./report-player";

export function ClipTile({ clip, src, poster, first }: { clip: ReportClip; src: string | null; poster: string | null; first?: boolean }) {
  const playing = useActiveReportClip() === clip.id;
  const { element: video, ref: videoRef, attach: attachVideo } = useMediaElement<HTMLVideoElement>();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const player = useRef<ReportClipPlayerHandle | null>(null);
  // The badge colours are the apps': the play's type and result decide them.
  const badge = eventColors({ type: clip.type, subType: clip.subType, isSuccessful: clip.made ? 1 : 0 } as PlayByPlayEvent).badge;
  const when = [clip.period, clip.clock.replace(/^0/, "")].filter(Boolean).join(" · ");

  // All in the tap: the player mounts at once (flushSync), and its video gets
  // its source and plays inside the gesture, which is what lets a phone play
  // it with sound.
  function play() {
    if (!src) return;
    flushSync(() => setActiveReportClip(clip.id));
    const el = videoRef.current;
    if (el) {
      if (poster) el.poster = poster;
      el.src = src;
      el.play().catch(() => {});
    }
    boxRef.current?.focus({ preventScroll: true });
  }

  // The player's keys while it has the focus. A focused button keeps Space
  // and Return, and the speed menu its own keys.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const p = player.current;
    if (!playing || !p) return;
    const target = e.target as HTMLElement;
    if (target.closest("[role=menu]")) return;
    if (target !== e.currentTarget && (e.key === " " || e.key === "Enter") && target.closest("button")) return;
    const run = (act: () => void) => {
      e.preventDefault();
      act();
    };
    switch (resolvePlayerKey(e)) {
      case "toggle-play":
        return run(p.togglePlay);
      case "shuttle-pause":
        return run(p.pause);
      case "replay":
        return run(p.replay);
      case "fullscreen":
        return run(p.toggleFullscreen);
      case "nudge-back":
        return run(() => p.nudge(-NUDGE_SECONDS));
      case "nudge-forward":
        return run(() => p.nudge(NUDGE_SECONDS));
      case "nudge-back-far":
        return run(() => p.nudge(-NUDGE_FAR_SECONDS));
      case "nudge-forward-far":
        return run(() => p.nudge(NUDGE_FAR_SECONDS));
      case "escape":
        if (p.exitFullscreen()) e.preventDefault();
        return;
    }
  }

  return (
    <figure id={clip.id} className={cn("report-clip flex flex-col gap-2", first && "report-clip-first")}>
      <div
        ref={boxRef}
        tabIndex={playing ? -1 : undefined}
        onKeyDown={onKeyDown}
        className="relative aspect-video overflow-hidden rounded-window bg-fill-2 ring-1 ring-separator outline-none"
      >
        {!src ? (
          <p className="report-screen-only flex size-full items-center justify-center px-4 text-center text-callout text-muted-foreground">
            Clip unavailable
          </p>
        ) : playing ? (
          <div className="report-screen-only size-full">
            <ReportClipPlayer
              clip={clip}
              title={[clip.label, when].filter(Boolean).join(" · ")}
              src={src}
              video={video}
              videoRef={videoRef}
              attachVideo={attachVideo}
              handleRef={player}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={play}
            aria-label={`Play ${clip.label}${when ? `, ${when}` : ""}`}
            className="report-screen-only group/poster relative block size-full outline-none focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-inset"
          >
            {poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt="" loading="lazy" className="size-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-md transition-transform duration-150 group-hover/poster:scale-105 group-active/poster:scale-95">
                <Play className="size-6 translate-x-0.5 fill-current" />
              </span>
            </span>
          </button>
        )}
        {/* Print: a video doesn't print, its poster does. */}
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" loading="lazy" className="report-print-only size-full object-cover" />
        ) : (
          <div className="report-print-only size-full bg-fill-2" />
        )}
      </div>
      <figcaption className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("report-badge rounded-full px-2 py-0.5 text-caption", badge)}>{clip.label}</span>
          {when && <span className="text-callout text-muted-foreground nums">{when}</span>}
          {clip.game && <span className="text-callout text-muted-foreground">· {clip.game}</span>}
        </div>
        {clip.labels.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {clip.labels.map((l) => (
              <li key={l} className="rounded-full bg-fill-2 px-2 py-0.5 text-caption text-foreground">
                {l}
              </li>
            ))}
          </ul>
        )}
        {clip.note && <p className="report-note whitespace-pre-wrap text-body text-foreground">{clip.note}</p>}
      </figcaption>
    </figure>
  );
}
