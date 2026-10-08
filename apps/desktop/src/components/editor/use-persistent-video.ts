import { useRef } from "react";

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
  return ref.current;
}
