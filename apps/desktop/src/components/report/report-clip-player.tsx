import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { VideoPlayer } from "@/components/video-player";
import { ClipScrubber } from "@/components/editor/clip-scrubber";
import { ControlButton } from "@/components/editor/transport-bar";
import { streamFileSrc } from "@/lib/stream";
import { cn } from "@/lib/utils";
import type { ReportClipSource } from "@scoutable/shared/lib/report-clip-source";

const NONE_MESSAGE: Record<Extract<ReportClipSource, { kind: "none" }>["reason"], string> = {
  no_video: "The game’s video isn’t on this computer.",
  no_sync: "This game isn’t synced to its video yet.",
};

/** Top-left, across from the tile's ⋯ menu, in the same material. */
function StopButton({ onClose, className }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Stop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      className={cn(
        "absolute top-1.5 left-1.5 z-30 flex size-7 items-center justify-center rounded-md bg-background/85 text-foreground shadow-xs ring-1 ring-separator backdrop-blur-sm transition-opacity duration-100 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection",
        className,
      )}
    >
      <X className="size-4" />
    </button>
  );
}

/**
 * A clip of the scouting report playing in its own tile. The tile is the
 * only one holding a <video>: the report renders this for the playing clip
 * alone, and VideoPlayer gives its element back when the tile stops, so the
 * other tiles stay placeholders and nothing is left decoding in the
 * background.
 */
export function ReportClipPlayer({
  source,
  onClose,
  autoFocus = false,
  className,
}: {
  source: ReportClipSource;
  onClose: () => void;
  /** Take the keyboard on opening (a click on the tile; not a row in the side panel, which keeps it). */
  autoFocus?: boolean;
  /** On the tile's box: the selection's and the side panel's ring. */
  className?: string;
}) {
  if (source.kind === "none") return <NothingToPlay message={NONE_MESSAGE[source.reason]} onClose={onClose} autoFocus={autoFocus} className={className} />;
  const src = source.kind === "local" ? streamFileSrc(source.path) : source.url;
  const clip = source.kind === "local" ? { start: source.start, end: source.end } : null;
  // A new source is a new player: the old element is released, the new one starts at the top.
  return <ClipVideo key={`${src}|${clip?.start}|${clip?.end}`} src={src} clip={clip} onClose={onClose} autoFocus={autoFocus} className={className} />;
}

function NothingToPlay({ message, onClose, autoFocus, className }: { message: string; onClose: () => void; autoFocus: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={cn(
        "relative flex aspect-video items-center justify-center rounded-window bg-fill-2 p-6 text-center ring-1 ring-separator outline-none transition-shadow duration-300 focus-visible:ring-2 focus-visible:ring-selection",
        className,
      )}
    >
      <p className="max-w-[30ch] text-callout text-muted-foreground [text-wrap:balance]">{message}</p>
      <StopButton onClose={onClose} />
    </div>
  );
}

/**
 * The footage with a small bar over its foot: play/pause and the scrubber.
 * The game's own video plays the clip's stretch (`clip`) and stops at its end;
 * an uploaded copy plays from 0 to the end of the file. At the end the last
 * frame stays, with Replay over it.
 */
function ClipVideo({
  src,
  clip,
  onClose,
  autoFocus,
  className,
}: {
  src: string;
  /** The clip within the game's video; null for an uploaded copy (the whole file). */
  clip: { start: number; end: number } | null;
  onClose: () => void;
  autoFocus: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);
  const start = clip?.start ?? 0;
  const end = clip?.end ?? duration;

  // Once, when the player opens (a new source is a new player).
  useEffect(() => {
    setVideo(videoRef.current);
    if (autoFocus) rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // play() rejects when the source can't play; VideoPlayer already says why.
    const begin = () => {
      setDuration(v.duration || 0);
      if (clip) v.currentTime = clip.start;
      v.play().catch(() => {});
    };
    const onDuration = () => setDuration(v.duration || 0);
    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
    };
    const onPause = () => setPlaying(false);
    // The game's video runs on past the clip: stop at its end (or past it, timeupdate is coarse).
    const onTimeUpdate = () => {
      if (!clip || v.seeking || v.currentTime < clip.end) return;
      if (!v.paused) v.pause();
      setEnded(true);
    };
    const onEnded = () => setEnded(true);
    v.addEventListener("loadedmetadata", begin);
    v.addEventListener("durationchange", onDuration);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("ended", onEnded);
    if (v.readyState >= 1) begin();
    return () => {
      v.removeEventListener("loadedmetadata", begin);
      v.removeEventListener("durationchange", onDuration);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("ended", onEnded);
    };
    // The source and the clip are the player's key: they never change under a mounted player.
  }, []);

  function replay() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = start;
    setEnded(false);
    v.play().catch(() => {});
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (ended) replay();
    else if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seek(t: number) {
    const v = videoRef.current;
    if (!v) return;
    const to = Math.min(Math.max(t, start), end);
    v.currentTime = to;
    if (to < end) setEnded(false);
  }

  // Space plays and pauses while the player has focus; a focused button keeps its own Space.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== " " || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    togglePlay();
  }

  // Shown while paused, and while the pointer is over the tile or a control has the keyboard.
  const chrome = cn("transition-opacity duration-150 focus-within:opacity-100", playing ? "opacity-0 group-hover/player:opacity-100" : "opacity-100");

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        "group/player relative isolate aspect-video overflow-hidden rounded-window bg-black ring-1 ring-separator outline-none transition-shadow duration-300 focus-visible:ring-2 focus-visible:ring-selection",
        className,
      )}
    >
      {/* A click on the footage plays and pauses, like any player. */}
      <div onClick={togglePlay} className="h-full w-full [&>div]:rounded-none">
        <VideoPlayer src={src} videoRef={videoRef} onLoadFailure={(f) => setFailed(f !== null)} />
      </div>

      {ended && !failed && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
          <button
            type="button"
            onClick={replay}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/60 px-3.5 py-1.5 text-callout font-medium text-white ring-1 ring-white/15 backdrop-blur-md transition-colors duration-100 outline-none hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <RotateCcw className="size-4" />
            Replay
          </button>
        </div>
      )}

      <StopButton onClose={onClose} className={failed ? undefined : chrome} />

      {!failed && (
        <div className={cn("dark absolute inset-x-2 bottom-2 z-30 flex items-center gap-1 rounded-lg bg-black/55 py-0.5 pr-2 pl-0.5 text-white ring-1 ring-white/10 backdrop-blur-xl", chrome)}>
          <ControlButton label={playing ? "Pause" : "Play"} shortcut="Space" onClick={togglePlay} className="size-7 [&_svg]:size-4">
            {playing ? <Pause className="fill-current" /> : <Play className="translate-x-px fill-current" />}
          </ControlButton>
          {video && end > start ? <ClipScrubber video={video} start={start} end={end} onSeek={seek} className="min-w-0 flex-1" /> : <div className="h-6 flex-1" />}
        </div>
      )}
    </div>
  );
}
