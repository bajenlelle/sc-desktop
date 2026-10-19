"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  clickSelection,
  extendSelection,
  focusAfterRemoval,
  moveFocus,
  pruneSelection,
  type FocusMove,
} from "@scoutable/shared/lib/list-selection";

/**
 * The list's focus and multi-selection, the way a macOS table behaves
 * (list-selection.ts decides, this holds): a focus the arrows move, an
 * anchor Shift ranges grow from, a selection ⌘ toggles row by row. The
 * focus ring shows only once the keyboard has been used, and goes at the
 * next pointer press anywhere.
 */
export function useClipSelection(order: readonly string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [keyboardNav, setKeyboardNav] = useState(false);

  const orderRef = useRef(order);
  const stateRef = useRef({ selected, anchor, focus });
  useLayoutEffect(() => {
    orderRef.current = order;
    stateRef.current = { selected, anchor, focus };
  });

  // Rows that left the list leave the selection.
  const orderKey = order.join("\u0000");
  useEffect(() => {
    setSelected((prev) => pruneSelection(prev, orderRef.current) as Set<string>);
  }, [orderKey]);

  useEffect(() => {
    if (!keyboardNav) return;
    const off = () => setKeyboardNav(false);
    window.addEventListener("pointerdown", off, true);
    return () => window.removeEventListener("pointerdown", off, true);
  }, [keyboardNav]);

  /** A click on a row: ⌘ toggles it, Shift ranges from the anchor, plain moves focus and anchor. */
  const click = useCallback((key: string, mods: { shift: boolean; toggle: boolean }) => {
    const s = stateRef.current;
    const next = clickSelection({ order: orderRef.current, selected: s.selected, anchor: s.anchor, focus: s.focus, key, ...mods });
    setSelected(next.selected);
    setAnchor(next.anchor);
    setFocus(next.focus);
  }, []);

  /** Whatever starts playing becomes the row the keys work from. */
  const focusOn = useCallback((key: string | null) => {
    setFocus(key);
    setAnchor(key);
  }, []);

  /** Arrows, Home/End, ⌘↑/⌘↓: the new focus (the caller plays it), or null for an empty list. */
  const move = useCallback((by: FocusMove, fallback: string | null = null): string | null => {
    const s = stateRef.current;
    const to = moveFocus(orderRef.current, s.focus ?? fallback, by);
    if (to === null) return null;
    setKeyboardNav(true);
    setFocus(to);
    setAnchor(to);
    return to;
  }, []);

  /** Shift+arrows: the range from the anchor follows the focus; nothing plays. */
  const extend = useCallback((by: FocusMove, fallback: string | null = null): string | null => {
    const order = orderRef.current;
    const s = stateRef.current;
    const from = s.focus ?? fallback;
    const to = moveFocus(order, from, by);
    if (to === null) return null;
    const shown = (key: string | null): key is string => key !== null && order.includes(key);
    const anchorKey = shown(s.anchor) ? s.anchor : shown(from) ? from : to;
    setSelected(extendSelection({ order, selected: s.selected, anchor: anchorKey, previousFocus: shown(from) ? from : null, focus: to }));
    setKeyboardNav(true);
    setAnchor(anchorKey);
    setFocus(to);
    return to;
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(orderRef.current));
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  /** Where focus goes once rows are removed: the row that took the place, or the one above. */
  const afterRemoval = useCallback((removed: ReadonlySet<string>) => {
    const after = focusAfterRemoval(orderRef.current, removed, stateRef.current.focus);
    setFocus(after);
    setAnchor(after);
    setSelected(new Set());
  }, []);

  return { selected, anchor, focus, keyboardNav, click, focusOn, move, extend, selectAll, clear, afterRemoval, setKeyboardNav };
}

export type ClipSelection = ReturnType<typeof useClipSelection>;
