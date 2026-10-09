"use client";

import { useCallback, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/**
 * A media element held two ways: in state, so effects and subscriptions
 * follow it, and in a ref, for changing it (seeking, its source, its rate):
 * React treats state as read-only.
 */
export function useMediaElement<T extends HTMLMediaElement>(): {
  element: T | null;
  ref: RefObject<T | null>;
  attach: (el: T | null) => void;
} {
  const ref = useRef<T | null>(null);
  const [element, setElement] = useState<T | null>(null);
  const attach = useCallback((el: T | null) => {
    ref.current = el;
    setElement(el);
  }, []);
  return { element, ref, attach };
}

/**
 * Subscribes React to a media element instead of mirroring it in state: the
 * element is the source of truth, and a render reads it as it is now.
 */
function useMediaValue<T>(
  video: HTMLVideoElement | null,
  events: readonly string[],
  read: (video: HTMLVideoElement) => T,
  fallback: T,
): T {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!video) return () => {};
      for (const e of events) video.addEventListener(e, notify);
      return () => {
        for (const e of events) video.removeEventListener(e, notify);
      };
    },
    [video, events],
  );
  return useSyncExternalStore(
    subscribe,
    () => (video ? read(video) : fallback),
    () => fallback,
  );
}

const PAUSE_EVENTS = ["play", "pause", "ended", "emptied"] as const;
const DURATION_EVENTS = ["loadedmetadata", "durationchange", "emptied"] as const;

const readPaused = (v: HTMLVideoElement) => v.paused;
const readDuration = (v: HTMLVideoElement) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);

/** Whether the element is paused (true before there is one). */
export function useMediaPaused(video: HTMLVideoElement | null): boolean {
  return useMediaValue(video, PAUSE_EVENTS, readPaused, true);
}

/** The loaded file's length in seconds, or null until it is known. */
export function useMediaDuration(video: HTMLVideoElement | null): number | null {
  return useMediaValue(video, DURATION_EVENTS, readDuration, null);
}
