"use client";

import { RefObject, useEffect, useRef } from "react";

interface VideoPlayerProps {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
}

export function VideoPlayer({ src, videoRef }: VideoPlayerProps) {
  const imgRef = useRef<HTMLImageElement>(null);

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

    video.addEventListener("pause", captureFrame);
    // Hide as soon as play() is called so we don't sit on a stale frame
    // while the video advances to the new clip position.
    video.addEventListener("play", hideFrame);
    video.addEventListener("emptied", hideFrame);

    return () => {
      video.removeEventListener("pause", captureFrame);
      video.removeEventListener("play", hideFrame);
      video.removeEventListener("emptied", hideFrame);
    };
  }, [videoRef]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: "16/9" }}
    >
      <video
        ref={videoRef}
        src={src}
        // CORS mode for remote (R2) sources so the pause freeze-frame canvas
        // isn't tainted — R2 serves Access-Control-Allow-Origin: *. Local
        // stream:// playback stays in no-cors mode, untouched.
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
    </div>
  );
}
