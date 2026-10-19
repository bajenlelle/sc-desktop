"use client";

/**
 * The editor's keys, the desktop's map (player-keys.ts) under one key
 * scope: Space plays, J/K/L shuttle, ←/→ nudge, ↑/↓ walk the list and play
 * the row there, Shift with them extends the selection, Home/End and ⌘↑/⌘↓
 * jump to the ends, Return plays the focused row, Shift+F10 opens its menu,
 * T trims the playing clip, R replays, M mutes, F is full screen, ⌘A selects
 * every row, Delete removes the selection (or the row the ring is on), Esc
 * leaves full screen or lets go of the selection. ⌥↑/⌥↓ move the focused
 * row (with its selection or group) one slot, and N starts a new playlist
 * (in this playlist's folder). Return on a stats card opens it for editing.
 * Fields keep their keys; the trim bar and the add-clips panel register
 * their own scopes on top while they are open.
 */
import type { RefObject } from "react";
import { dragBlockKeys } from "@scoutable/shared/lib/list-reorder";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { nudgeGap } from "@scoutable/shared/lib/playlist-edits";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import type { ClipSelection } from "./use-clip-selection";
import type { EditorPlayback } from "./use-editor-playback";
import type { PlaylistEditorApi } from "./use-playlist-editor";

export function useEditorKeys({
  enabled,
  order,
  groupIdOf,
  selection,
  playback,
  editor,
  gridRef,
  openRowMenu,
  removeKeys,
  onNewPlaylist,
  onTrimRefused,
  onEditRow,
}: {
  enabled: boolean;
  /** The rows' keys in display order. */
  order: readonly string[];
  groupIdOf: ReadonlyMap<string, string>;
  selection: ClipSelection;
  playback: EditorPlayback;
  editor: Pick<PlaylistEditorApi, "reorder">;
  /** The list's focus target; Return and the menu key answer only from it (or from nothing). */
  gridRef: RefObject<HTMLElement | null>;
  openRowMenu: (key: string) => void;
  removeKeys: (keys: ReadonlySet<string>) => void;
  onNewPlaylist: () => void;
  /** T on a clip that can't be trimmed here (its game has no cloud copy). */
  onTrimRefused: () => void;
  /** Return on a row that opens for editing rather than playing (a stats card); true when it did. */
  onEditRow?: (key: string) => boolean;
}) {
  useKeyScope("editor", enabled);
  useHotkeys(
    "editor",
    (e) => {
      // ⌥↑/⌥↓: the focused row, with its selection or group, one slot up or down.
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.code === "ArrowUp" || e.code === "ArrowDown")) {
        const focus = selection.focus;
        if (!focus || !order.includes(focus)) return;
        e.preventDefault();
        const block = dragBlockKeys(focus, selection.selected, order, groupIdOf);
        const gap = nudgeGap(order, block, e.code === "ArrowUp" ? -1 : 1);
        if (gap === null) return;
        editor.reorder(gap, block, order, "keyboard");
        selection.setKeyboardNav(true);
        return;
      }
      if (e.code === "KeyN" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        onNewPlaylist();
        return;
      }
      const action = resolvePlayerKey(e);
      if (!action) return;
      const video = playback.videoRef.current;
      switch (action) {
        case "toggle-play":
          e.preventDefault();
          playback.stageHandle.current?.togglePlay();
          return;
        case "replay":
          e.preventDefault();
          playback.q.replay();
          return;
        case "trim":
          if (!playback.activeKey) return;
          e.preventDefault();
          if (!playback.startTrim()) onTrimRefused();
          return;
        case "toggle-mute":
          e.preventDefault();
          playback.toggleMute();
          return;
        case "fullscreen":
          e.preventDefault();
          playback.fullscreen.toggle();
          return;
        case "escape":
          if (playback.fullscreen.active) {
            e.preventDefault();
            void playback.fullscreen.exit();
            return;
          }
          if (selection.selected.size > 0) {
            e.preventDefault();
            selection.clear();
          }
          return;
        case "nudge-back":
          e.preventDefault();
          playback.nudge(-NUDGE_SECONDS);
          return;
        case "nudge-forward":
          e.preventDefault();
          playback.nudge(NUDGE_SECONDS);
          return;
        case "nudge-back-far":
          e.preventDefault();
          playback.nudge(-NUDGE_FAR_SECONDS);
          return;
        case "nudge-forward-far":
          e.preventDefault();
          playback.nudge(NUDGE_FAR_SECONDS);
          return;
        case "shuttle-back":
          // Browsers have no reverse playback; stepping back is the honest version.
          e.preventDefault();
          playback.nudge(-5);
          return;
        case "shuttle-pause":
          e.preventDefault();
          video?.pause();
          return;
        case "shuttle-forward":
          e.preventDefault();
          playback.setSpeed(nextShuttleRate(playback.speed));
          if (playback.activePlay && video?.paused) video.play().catch(() => {});
          return;
        case "remove":
          if (selection.selected.size > 0) {
            e.preventDefault();
            removeKeys(selection.selected);
            return;
          }
          // Only a row the ring is showing on: a stray Delete never takes a
          // clip nobody saw was focused.
          if (!selection.keyboardNav || selection.focus === null) return;
          e.preventDefault();
          removeKeys(new Set([selection.focus]));
          return;
        case "select-all":
          if (order.length === 0) return;
          e.preventDefault();
          selection.selectAll();
          return;
        case "next":
        case "prev":
        case "first":
        case "last": {
          if (order.length === 0) return;
          e.preventDefault();
          const to = selection.move(action === "next" ? 1 : action === "prev" ? -1 : action, playback.activeKey);
          if (to !== null) playback.playRow(to);
          return;
        }
        case "extend-next":
        case "extend-prev":
        case "extend-first":
        case "extend-last":
          if (order.length === 0) return;
          e.preventDefault();
          selection.extend(
            action === "extend-next" ? 1 : action === "extend-prev" ? -1 : action === "extend-first" ? "first" : "last",
            playback.activeKey,
          );
          return;
        case "play-focused":
        case "row-menu": {
          // Return and the menu key belong to whatever has focus, a toolbar
          // button say; the list answers only when it has focus itself (or
          // nothing does).
          const fromList = e.target === document.body || e.target === gridRef.current;
          if (!fromList || selection.focus === null) return;
          e.preventDefault();
          if (action === "row-menu") openRowMenu(selection.focus);
          else if (!onEditRow?.(selection.focus)) playback.playRow(selection.focus, { holdCard: true });
          return;
        }
      }
    },
    enabled,
  );
}
