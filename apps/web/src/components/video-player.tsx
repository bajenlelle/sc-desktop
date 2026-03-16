"use client";

import { forwardRef } from "react";

interface VideoPlayerProps {
  src: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(
  function VideoPlayer({ src, videoRef }, _ref) {
    return (
      <video
        ref={videoRef}
        src={src}
        controls
        className="w-full aspect-video bg-black"
        playsInline
      />
    );
  }
);
