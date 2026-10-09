"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Seeking a video as fast as it can decode, for a scrubber thumb that
 * previews the frame under the finger: at most one seek per display frame,
 * none while the decoder is still busy with the last one, and always to the
 * latest position asked for (stale ones are dropped).
 */
export function useFrameSeek(video: HTMLVideoElement | null, seek: (t: number) => void) {
  const state = useRef<{ pending: number | null; raf: number }>({ pending: null, raf: 0 });
  const seekRef = useRef(seek);
  const videoRef = useRef(video);
  useLayoutEffect(() => {
    seekRef.current = seek;
    videoRef.current = video;
  });

  const flush = useCallback(function flush() {
    const s = state.current;
    s.raf = 0;
    if (s.pending === null) return;
    if (videoRef.current?.seeking) {
      s.raf = requestAnimationFrame(flush);
      return;
    }
    const t = s.pending;
    s.pending = null;
    seekRef.current(t);
  }, []);

  /** Asks for a position; it is seeked to on a coming frame unless a newer one replaces it. */
  const schedule = useCallback(
    (t: number) => {
      const s = state.current;
      s.pending = t;
      if (!s.raf) s.raf = requestAnimationFrame(flush);
    },
    [flush],
  );

  /** The pointer let go: whatever is still pending is seeked to now. */
  const settle = useCallback(() => {
    const s = state.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.raf = 0;
    if (s.pending === null) return;
    const t = s.pending;
    s.pending = null;
    seekRef.current(t);
  }, []);

  useEffect(() => {
    const s = state.current;
    return () => {
      if (s.raf) cancelAnimationFrame(s.raf);
    };
  }, []);

  return { schedule, settle };
}
