"use client";

import { useCallback, useSyncExternalStore } from "react";
import { trackEvent } from "@/lib/analytics";
import { getEditorLayout, setEditorLayout, type EditorLayoutPref } from "@/lib/prefs";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The editor's arrangement on wide windows, remembered in localStorage:
 * "split" puts the list beside the player, "theater" the player across the
 * top. Read as an external store, so the server renders the default and the
 * client takes the remembered one without a mismatch.
 */
export function useEditorLayout(): [EditorLayoutPref, (next: EditorLayoutPref) => void] {
  const layout = useSyncExternalStore(subscribe, getEditorLayout, () => "split" as EditorLayoutPref);
  const setLayout = useCallback((next: EditorLayoutPref) => {
    if (next === getEditorLayout()) return;
    setEditorLayout(next);
    trackEvent("editor_layout_changed", { layout: next });
    for (const l of listeners) l();
  }, []);
  return [layout, setLayout];
}
