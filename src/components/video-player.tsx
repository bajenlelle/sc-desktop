"use client";

import { RefObject } from "react";

interface VideoPlayerProps {
  src: string;
  videoRef: RefObject<HTMLVideoElement | null>;
}

export function VideoPlayer({ src, videoRef }: VideoPlayerProps) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg bg-black"
      style={{ aspectRatio: "16/9" }}
    >
      <video
        ref={videoRef}
        src={src}
        className="h-full w-full"
        controls
        playsInline
      />
    </div>
  );
}
