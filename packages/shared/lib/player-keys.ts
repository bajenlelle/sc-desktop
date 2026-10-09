/**
 * The editor's playback keys, QuickTime and Final Cut conventions: arrows
 * move through clips and nudge within one, J/K/L shuttle, Space toggles.
 * The clip list adds a macOS table's keys: Shift extends the selection,
 * ⌘↑/⌘↓ and Home/End jump to the ends, Return plays the focused row,
 * Shift+F10 opens its menu, T trims the playing clip. Every native menu
 * accelerator is a ⌘-chord, so
 * chords are left alone except ⌘A and ⌘↑/⌘↓, which the list claims.
 */
export type PlayerKeyAction =
  | "next"
  | "prev"
  | "extend-next"
  | "extend-prev"
  | "first"
  | "last"
  | "extend-first"
  | "extend-last"
  | "play-focused"
  | "row-menu"
  | "trim"
  | "nudge-back"
  | "nudge-forward"
  | "nudge-back-far"
  | "nudge-forward-far"
  | "shuttle-back"
  | "shuttle-pause"
  | "shuttle-forward"
  | "replay"
  | "toggle-play"
  | "fullscreen"
  | "escape"
  | "remove"
  | "select-all";

export interface KeyChord {
  code: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function resolvePlayerKey(e: KeyChord): PlayerKeyAction | null {
  const chord = e.metaKey || e.ctrlKey;
  if (chord) {
    if (e.altKey) return null;
    if (e.code === "KeyA" && !e.shiftKey) return "select-all";
    // ⌘ only: Control-arrows belong to Mission Control.
    if (e.metaKey && !e.ctrlKey && e.code === "ArrowUp") return e.shiftKey ? "extend-first" : "first";
    if (e.metaKey && !e.ctrlKey && e.code === "ArrowDown") return e.shiftKey ? "extend-last" : "last";
    return null;
  }
  if (e.altKey) return null;
  switch (e.code) {
    case "ArrowDown":
      return e.shiftKey ? "extend-next" : "next";
    case "ArrowUp":
      return e.shiftKey ? "extend-prev" : "prev";
    case "Home":
      return e.shiftKey ? "extend-first" : "first";
    case "End":
      return e.shiftKey ? "extend-last" : "last";
    case "Enter":
    case "NumpadEnter":
      return e.shiftKey ? null : "play-focused";
    case "F10":
      return e.shiftKey ? "row-menu" : null;
    case "ContextMenu":
      return "row-menu";
    case "ArrowLeft":
      return e.shiftKey ? "nudge-back-far" : "nudge-back";
    case "ArrowRight":
      return e.shiftKey ? "nudge-forward-far" : "nudge-forward";
    case "KeyJ":
      return "shuttle-back";
    case "KeyK":
      return "shuttle-pause";
    case "KeyL":
      return "shuttle-forward";
    case "KeyR":
      return "replay";
    case "KeyT":
      return e.shiftKey ? null : "trim";
    case "Space":
      return "toggle-play";
    case "KeyF":
      return "fullscreen";
    case "Escape":
      return "escape";
    case "Backspace":
    case "Delete":
      return "remove";
    default:
      return null;
  }
}

/** Seconds moved by a nudge, in the direction of the arrow. */
export const NUDGE_SECONDS = 2;
export const NUDGE_FAR_SECONDS = 10;
/** L cycles through these; a further press wraps to the first. */
export const SHUTTLE_RATES = [1, 1.5, 2] as const;

export function nextShuttleRate(current: number): number {
  const i = SHUTTLE_RATES.indexOf(current as (typeof SHUTTLE_RATES)[number]);
  return SHUTTLE_RATES[(i + 1) % SHUTTLE_RATES.length];
}
