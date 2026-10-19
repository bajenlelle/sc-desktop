import { useEffect, useRef } from "react";
import { releaseVideo } from "@/lib/release-video";

/**
 * One <video> element for the life of the editor. The stage that shows it
 * appends it on mount and removes it on unmount, so switching layouts
 * (Split ⇄ Theater remount their panels) or flipping fullscreen moves the
 * same element instead of recreating it: playback, currentTime, playbackRate
 * and every listener survive. The removal and re-insertion happen in the
 * same commit, before the media element's "not in a document" step runs.
 */
export function usePersistentVideo(): HTMLVideoElement {
  const ref = useRef<HTMLVideoElement | null>(null);
  if (!ref.current) {
    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.className = "h-full w-full";
    ref.current = video;
  }
  // When the editor goes, the element goes with it: give back its decoder
  // (see release-video.ts). By then the stage has taken it off the page.
  useEffect(() => {
    const video = ref.current;
    return () => {
      if (video && !video.isConnected) releaseVideo(video);
    };
  }, []);
  return ref.current;
}
