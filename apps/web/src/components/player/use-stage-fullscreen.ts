"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function fullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function subscribe(notify: () => void) {
  document.addEventListener("fullscreenchange", notify);
  document.addEventListener("webkitfullscreenchange", notify);
  return () => {
    document.removeEventListener("fullscreenchange", notify);
    document.removeEventListener("webkitfullscreenchange", notify);
  };
}

/**
 * Full screen for the player. Where the browser can put an element full
 * screen (desktop browsers, iPad, Android) the stage itself goes, so its
 * controls and menus come along. iPhone Safari can only do that for a bare
 * <video>, which would lose the text cards and the queue, so there the
 * stage becomes a layer over the whole window instead, with the page's
 * scrolling locked beneath it.
 */
export function useStageFullscreen(stage: HTMLElement | null) {
  const element = useSyncExternalStore(subscribe, fullscreenElement, () => null);
  const native = element !== null && element === stage;
  const [layer, setLayer] = useState(false);

  useEffect(() => {
    if (!layer) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [layer]);

  const exit = useCallback(async () => {
    setLayer(false);
    if (fullscreenElement() === null) return;
    const doc = document as WebkitDocument;
    try {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else await doc.webkitExitFullscreen?.();
    } catch {
      // Already left (Esc beat us to it).
    }
  }, []);

  const enter = useCallback(async () => {
    if (!stage) return;
    const doc = document as WebkitDocument;
    const el = stage as WebkitElement;
    const canNative = doc.fullscreenEnabled || doc.webkitFullscreenEnabled;
    if (canNative) {
      try {
        if (el.requestFullscreen) await el.requestFullscreen();
        else await el.webkitRequestFullscreen?.();
        return;
      } catch {
        // Refused (an iframe without permission): the layer still works.
      }
    }
    setLayer(true);
  }, [stage]);

  const active = native || layer;
  const toggle = useCallback(() => {
    void (active ? exit() : enter());
  }, [active, enter, exit]);

  // Leaving the player leaves its full screen with it.
  useEffect(
    () => () => {
      if (fullscreenElement() !== null && fullscreenElement() === stage) void exit();
    },
    [stage, exit],
  );

  return { active, native, layer, toggle, exit };
}
