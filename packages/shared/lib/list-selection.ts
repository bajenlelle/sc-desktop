/**
 * Keyboard focus and multi-selection over an ordered list of row keys, the
 * way a macOS table behaves: a focus that the arrows move, an anchor that
 * Shift ranges grow from, and a selection that ⌘ toggles row by row.
 *
 * Pure: the editor's clip list holds the state, these decide what a key or
 * a click does to it.
 */

/** Rows to move (negative is up), or straight to the first or last row. */
export type FocusMove = number | "first" | "last";

/**
 * Where focus lands after a move: `move` rows away, clamped to the ends, or
 * the first or last row. With no focus (or a focus no longer in the list),
 * a move down starts at the top and a move up at the bottom. Null for an
 * empty list.
 */
export function moveFocus(order: readonly string[], focus: string | null, move: FocusMove): string | null {
  if (order.length === 0) return null;
  if (move === "first") return order[0];
  if (move === "last") return order[order.length - 1];
  const i = focus === null ? -1 : order.indexOf(focus);
  if (i === -1) return move < 0 ? order[order.length - 1] : order[0];
  return order[Math.min(order.length - 1, Math.max(0, i + move))];
}

/**
 * The keys from `anchor` to `focus`, both included, in list order. Just the
 * focus when the anchor isn't in the list; nothing when the focus isn't.
 */
export function rangeKeys(order: readonly string[], anchor: string | null, focus: string): string[] {
  const f = order.indexOf(focus);
  if (f === -1) return [];
  const a = anchor === null ? -1 : order.indexOf(anchor);
  if (a === -1) return [focus];
  return order.slice(Math.min(a, f), Math.max(a, f) + 1);
}

/**
 * Shift+arrow or Shift-click: the range from the anchor follows the focus.
 * The range the previous focus made is taken back first, so moving back
 * toward the anchor shrinks it, while rows selected some other way (⌘-click)
 * stay selected.
 */
export function extendSelection({
  order,
  selected,
  anchor,
  previousFocus,
  focus,
}: {
  order: readonly string[];
  selected: ReadonlySet<string>;
  anchor: string;
  previousFocus: string | null;
  focus: string;
}): Set<string> {
  const next = new Set(selected);
  if (previousFocus !== null) {
    for (const key of rangeKeys(order, anchor, previousFocus)) next.delete(key);
  }
  for (const key of rangeKeys(order, anchor, focus)) next.add(key);
  return next;
}

export interface ListSelection {
  selected: Set<string>;
  anchor: string | null;
  focus: string | null;
}

/**
 * What a click on a row does to the selection. ⌘ toggles the row and moves
 * the anchor to it; Shift selects from the anchor to the row, leaving the
 * anchor where it was. A plain click moves focus and anchor (in the editor it
 * plays the clip): on a row outside the selection it lets go of the
 * selection, as a click elsewhere does in Finder; on a row inside it, the
 * selection stays, so the picked rows can be watched one by one.
 */
export function clickSelection({
  order,
  selected,
  anchor,
  focus,
  key,
  shift,
  toggle,
}: {
  order: readonly string[];
  selected: ReadonlySet<string>;
  anchor: string | null;
  focus: string | null;
  key: string;
  shift: boolean;
  toggle: boolean;
}): ListSelection {
  if (shift) {
    const hasAnchor = anchor !== null && order.includes(anchor);
    const from = hasAnchor ? anchor : key;
    return {
      selected: extendSelection({ order, selected, anchor: from, previousFocus: hasAnchor ? focus : null, focus: key }),
      anchor: from,
      focus: key,
    };
  }
  if (!toggle) {
    const keep = selected.size === 0 || selected.has(key);
    return { selected: keep ? new Set(selected) : new Set<string>(), anchor: key, focus: key };
  }
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return { selected: next, anchor: key, focus: key };
}

/**
 * The selection without rows that are no longer shown (a filter hid them,
 * or they were removed). The same set comes back when nothing was dropped,
 * so a state setter can leave the state as it is.
 */
export function pruneSelection<S extends ReadonlySet<string>>(selected: S, visible: readonly string[]): S | Set<string> {
  if (selected.size === 0) return selected;
  const shown = new Set(visible);
  let dropped = false;
  for (const key of selected) {
    if (!shown.has(key)) {
      dropped = true;
      break;
    }
  }
  if (!dropped) return selected;
  return new Set([...selected].filter((key) => shown.has(key)));
}

/**
 * Where focus goes once the focused row is removed: the row that took its
 * place, or the one above when it was the last. Null when the list empties.
 */
export function focusAfterRemoval(order: readonly string[], removed: ReadonlySet<string>, focus: string | null): string | null {
  if (focus === null) return null;
  const i = order.indexOf(focus);
  if (i === -1) return null;
  for (let j = i; j < order.length; j++) if (!removed.has(order[j])) return order[j];
  for (let j = i - 1; j >= 0; j--) if (!removed.has(order[j])) return order[j];
  return null;
}
