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
  const [failure, setFailure] = useState<MediaFailure | null>(null);
  const onLoadFailureRef = useRef(onLoadFailure);
  onLoadFailureRef.current = onLoadFailure;
  // Free-tier corner mark: free users can't export, and this closes the
  // screen-record workaround. Rendered only once the plan is known so it
  // never flashes for paying users.
  const { activeOrgPlan, profileLoading } = useAuth();
  const showWatermark = !profileLoading && activeOrgPlan === "free";

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
      {/*
        A paused <video> keeps its last frame in both WKWebView and WebView2.
        A JPEG "freeze-frame" overlay used to be snapshotted here on every
        pause (and every clip change); it only added a 30 ms pop-in at JPEG
        quality. Don't bring it back without reproducing a black frame first.
      */}
      <video ref={videoRef} src={src} className="h-full w-full" playsInline />
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
