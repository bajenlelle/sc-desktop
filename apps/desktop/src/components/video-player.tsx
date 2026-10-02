"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import {
  classifyMediaError,
  mediaFailureMessage,
  type MediaFailure,
} from "@scoutable/shared/lib/media-failure";
import { useAuth } from "@/lib/auth-context";
import { Sentry } from "@/lib/sentry";
import { Wordmark } from "@/components/logo";

interface VideoPlayerProps {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The source can't be shown (null again once a new source starts loading). */
  onLoadFailure?: (failure: MediaFailure | null) => void;
}

/** Local footage comes over the stream protocol — stream:// on macOS, http://stream.localhost on Windows. */
function isLocalSource(src: string): boolean {
  return src.startsWith("stream://") || src.includes("stream.localhost");
}

export function VideoPlayer({ src, videoRef, onLoadFailure }: VideoPlayerProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [failure, setFailure] = useState<MediaFailure | null>(null);
  const onLoadFailureRef = useRef(onLoadFailure);
  onLoadFailureRef.current = onLoadFailure;
  // Free-tier corner mark: free users can't export, and this closes the
  // screen-record workaround. Rendered only once the plan is known so it
  // never flashes for paying users.
  const { activeOrgPlan, profileLoading } = useAuth();
  const showWatermark = !profileLoading && activeOrgPlan === "free";

  useEffect(() => {
    const video = videoRef.current;
    const img = imgRef.current;
    if (!video || !img) return;

    // WKWebView releases the decoded frame buffer when paused, causing a black
    // screen. On pause we snapshot the current frame into an off-screen canvas
    // (never part of the DOM) and hand the JPEG data-URL to an <img> overlay.
    // Using an <img> instead of an in-DOM <canvas> avoids the compositing-layer
    // conflict that prevented video.play() from working after the first fix.
    function captureFrame() {
      if (!video || !img || video.videoWidth === 0) return;
      const offscreen = document.createElement("canvas");
      offscreen.width = video.videoWidth;
      offscreen.height = video.videoHeight;
      const ctx = offscreen.getContext("2d");
      if (!ctx) return;
      try {
        ctx.drawImage(video, 0, 0);
        img.src = offscreen.toDataURL("image/jpeg", 0.9);
        img.style.display = "block";
      } catch {
        // A non-CORS-approved source taints the canvas and toDataURL throws
        // SecurityError. Degrade to no freeze-frame (brief black on pause)
        // rather than an uncaught error on every pause.
      }
    }

    function hideFrame() {
      if (img) img.style.display = "none";
    }

    // A paused seek repaints the <video> underneath but not the overlay. On
    // Windows, where the canvas isn't tainted and the overlay really shows,
    // that left users picking a tip-off or crop keyframe on a stale picture.
    function onSeeked() {
      if (video?.paused) captureFrame();
    }

    video.addEventListener("pause", captureFrame);
    // Hide as soon as play() is called so we don't sit on a stale frame
    // while the video advances to the new clip position.
    video.addEventListener("play", hideFrame);
    video.addEventListener("emptied", hideFrame);
    video.addEventListener("seeking", hideFrame);
    video.addEventListener("seeked", onSeeked);

    return () => {
      video.removeEventListener("pause", captureFrame);
      video.removeEventListener("play", hideFrame);
      video.removeEventListener("emptied", hideFrame);
      video.removeEventListener("seeking", hideFrame);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [videoRef]);

  // Why the box is black, when it is. Every player used to go silently dark —
  // the sync picker disabled its button with a tooltip, the others said
  // "playing" over nothing — and the only report was an unhandled play()
  // rejection with no stack.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function report(kind: MediaFailure | null) {
      setFailure(kind);
      onLoadFailureRef.current?.(kind);
      if (!kind) return;
      Sentry.captureMessage("video failed to load", {
        level: "warning",
        tags: {
          kind,
          media_error_code: String(video?.error?.code ?? 0),
          ext: src.match(/\.([a-z0-9]{1,5})(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? "none",
          local: String(isLocalSource(src)),
        },
      });
    }

    function onError() {
      report(classifyMediaError(video?.error?.code));
    }
    // Audio decodes but the video codec doesn't (iPhone HEVC on Windows):
    // no error event at all, just a picture-less element.
    function onLoadedMetadata() {
      if (video && video.videoWidth === 0) report("no_picture");
    }
    function onLoadStart() {
      report(null);
    }

    video.addEventListener("error", onError);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("loadstart", onLoadStart);
    // Failed before this effect attached (a synchronous source rejection).
    if (video.error) onError();

    return () => {
      video.removeEventListener("error", onError);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("loadstart", onLoadStart);
    };
  }, [videoRef, src]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: "16/9" }}
    >
      <video
        ref={videoRef}
        src={src}
        // CORS mode for anything served over http — remote R2 sources, and on
        // Windows local playback too, since Tauri routes the stream protocol
        // through http://stream.localhost there. Both answer
        // Access-Control-Allow-Origin: *, so the pause freeze-frame canvas
        // isn't tainted. macOS stream:// playback stays in no-cors mode.
        crossOrigin={src.startsWith("http") ? "anonymous" : undefined}
        className="h-full w-full"
        playsInline
      />
      {/* Frame-hold overlay — hidden while playing, shown on pause */}
      <img
        ref={imgRef}
        aria-hidden
        alt=""
        className="absolute inset-0 h-full w-full pointer-events-none"
        style={{ display: "none", objectFit: "contain" }}
      />
      {failure && (
        <div
          role="alert"
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-6 text-center text-sm text-white"
        >
          <p className="max-w-sm">
            {mediaFailureMessage(failure, { remote: !isLocalSource(src) })}
          </p>
        </div>
      )}
      {showWatermark && (
        // Bare letterforms + cyan dot (no box). The `dark` wrapper forces the
        // light fill regardless of app theme — footage is the background.
        // Sized relative to the player so it reads the same in the small
        // browser panel and full theater mode.
        <div
          aria-hidden
          className="dark pointer-events-none absolute bottom-[7%] right-[2.5%] z-20 w-[18%] min-w-28 max-w-60 opacity-70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] select-none"
        >
          <Wordmark className="h-auto w-full" />
        </div>
      )}
    </div>
  );
}
