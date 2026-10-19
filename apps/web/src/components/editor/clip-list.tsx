"use client";

import * as React from "react";
import { ListVideo, Plus } from "lucide-react";
import { computeGroupRuns, snapGapToGroupBoundary } from "@scoutable/shared/lib/clip-groups";
import { dragBlockKeys } from "@scoutable/shared/lib/list-reorder";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { isClipItem, type Playlist, type PlaylistClipItem } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { EditorCardRow } from "./editor-card-row";
import { EditorClipRow } from "./editor-clip-row";
import type { EditorRow } from "./editor-rows";
import { SelectionBar } from "./selection-bar";
import type { ClipSelection } from "./use-clip-selection";
import { useListDrag } from "./use-list-drag";

/**
 * The playlist's items as a list a coach works in: a click plays a row, ⌘
 * and Shift tick rows, the checkboxes tick without playing, a row lifts
 * under the pointer to be reordered (a finger lifts it by its grip), and
 * each row has Remove on hover and a ⋯ menu that a right-click and
 * Shift+F10 open too. The selection bar floats over the bottom while
 * anything is ticked. The grid is the keys' focus target: pressing a row
 * moves focus here, so the arrows take over from where the pointer was.
 */
export function ClipList({
  rows,
  playlist,
  isOwner,
  isMultiMatch,
  activeKey,
  selection,
  menuKey,
  onMenuKeyChange,
  onPlayRow,
  onTrim,
  onInsertCardAbove,
  onRemove,
  onReorder,
  onCardText,
  onCardDuration,
  autoFocusCardId,
  gridRef,
  onAddClips,
}: {
  rows: EditorRow[];
  playlist: Playlist;
  isOwner: boolean;
  isMultiMatch: boolean;
  /** The row on the stage (playing, or being trimmed). */
  activeKey: string | null;
  selection: ClipSelection;
  /** The row whose ⋯ menu is open (Shift+F10 opens the focused row's from outside). */
  menuKey: string | null;
  onMenuKeyChange: (key: string | null) => void;
  onPlayRow: (key: string) => void;
  onTrim: (key: string) => void;
  onInsertCardAbove: (key: string) => void;
  onRemove: (keys: ReadonlySet<string>) => void;
  onReorder: (gap: number, blockKeys: readonly string[], displayKeys: readonly string[], via: "pointer" | "keyboard") => void;
  onCardText: (cardId: string, text: string) => void;
  onCardDuration: (cardId: string, seconds: number) => void;
  /** A card just added: its text field takes focus. */
  autoFocusCardId: string | null;
  /** The grid, for the keys' focus target and the drag engine's. */
  gridRef: React.RefObject<HTMLDivElement | null>;
  onAddClips: () => void;
}) {
  const baseId = React.useId();
  const reduced = useReducedMotionSafe();
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const order = React.useMemo(() => rows.map((r) => r.key), [rows]);
  const groupIdOf = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of playlist.items) if (item.groupId) map.set(itemKey(item), item.groupId);
    return map;
  }, [playlist.items]);
  const groupRuns = React.useMemo(() => computeGroupRuns(playlist.items, itemKey, groupIdOf), [playlist.items, groupIdOf]);

  const orderRef = React.useRef(order);
  const selectedRef = React.useRef(selection.selected);
  const itemsRef = React.useRef(playlist.items);
  React.useLayoutEffect(() => {
    orderRef.current = order;
    selectedRef.current = selection.selected;
    itemsRef.current = playlist.items;
  });

  const drag = useListDrag({
    listRef,
    focusRef: gridRef,
    reducedMotion: reduced,
    canStart: () => isOwner,
    blockFor: (anchorKey) => dragBlockKeys(anchorKey, selectedRef.current, orderRef.current, groupIdOf),
    snapGap: (gap, blockKeys) => snapGapToGroupBoundary(gap, itemsRef.current, itemKey, groupIdOf, new Set(blockKeys)),
    onDrop: ({ gap, blockKeys }) => onReorder(gap, blockKeys, orderRef.current, "pointer"),
    onDragStateChange: setDragging,
  });

  // The list changed under a lifted row (an edit from elsewhere landed): re-measure.
  const orderKey = order.join("\u0000");
  React.useLayoutEffect(() => {
    if (dragging) drag.invalidate();
  }, [orderKey, dragging, drag]);

  // Keep the playing row in view as the queue advances.
  React.useEffect(() => {
    if (!activeKey) return;
    listRef.current
      ?.querySelector(`[data-row-key="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [activeKey, reduced]);

  // A card just added comes into view.
  React.useEffect(() => {
    if (!autoFocusCardId) return;
    listRef.current
      ?.querySelector(`[data-row-key="${CSS.escape(`text:${autoFocusCardId}`)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [autoFocusCardId, reduced]);

  /** The row: plain plays it, ⌘ ticks it, Shift ticks the range from the anchor. */
  function rowClick(key: string, e: React.MouseEvent) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      selection.click(key, { shift: e.shiftKey, toggle: !e.shiftKey });
      return;
    }
    selection.click(key, { shift: false, toggle: false });
    onPlayRow(key);
  }

  /** The checkbox: a tick, or with Shift the range from the anchor. */
  function rowSelect(key: string, e: React.MouseEvent) {
    selection.click(key, { shift: e.shiftKey, toggle: !e.shiftKey });
  }

  const anySelected = selection.selected.size > 0;
  const focusId = selection.focus !== null && order.includes(selection.focus) ? `${baseId}-${selection.focus}` : undefined;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-fill-1 text-muted-foreground">
          <ListVideo className="size-6" />
        </span>
        <div>
          <p className="text-headline">No clips yet</p>
          <p className="mt-1 text-callout text-muted-foreground">Pick plays from a game&apos;s play-by-play; they play from your cloud copy of the game.</p>
        </div>
        {isOwner && (
          <Button size="sm" onClick={onAddClips}>
            <Plus />
            Add clips
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative @container">
      <div
        ref={(el) => {
          listRef.current = el;
          gridRef.current = el;
        }}
        role="grid"
        aria-label="Clips"
        aria-multiselectable
        aria-activedescendant={focusId}
        tabIndex={0}
        className={cn("flex flex-col outline-none", dragging && "cursor-grabbing")}
      >
        {rows.map((row, index) => {
          const key = row.key;
          const run = groupRuns.get(key);
          const shared = {
            domId: `${baseId}-${key}`,
            index,
            isActive: activeKey === key,
            focused: selection.keyboardNav && selection.focus === key,
            isSelected: selection.selected.has(key),
            anySelected,
            menuOpen: menuKey === key,
            onMenuOpenChange: (open: boolean) => onMenuKeyChange(open ? key : menuKey === key ? null : menuKey),
            onSelect: (e: React.MouseEvent) => rowSelect(key, e),
            onClick: (e: React.MouseEvent) => rowClick(key, e),
            drag: { rowKey: key, onPointerDown: (e: React.PointerEvent) => drag.onRowPointerDown(e, key) },
            onInsertTextCardAbove: () => onInsertCardAbove(key),
            onRemove: () => onRemove(new Set([key])),
            groupPos: run?.pos,
            groupSize: run?.size,
          };
          if (isClipItem(row.item)) {
            return (
              <EditorClipRow
                key={key}
                row={row as EditorRow & { item: PlaylistClipItem }}
                isMultiMatch={isMultiMatch}
                onTrim={row.watch?.kind === "window" ? () => onTrim(key) : undefined}
                {...shared}
              />
            );
          }
          const card = row.item;
          return (
            <EditorCardRow
              key={key}
              card={card}
              onTextSave={(text) => onCardText(card.id, text)}
              onDurationChange={(s) => onCardDuration(card.id, s)}
              autoFocusText={autoFocusCardId === card.id}
              {...shared}
            />
          );
        })}
      </div>
      <SelectionBar count={selection.selected.size} onRemove={() => onRemove(selection.selected)} onClear={selection.clear} />
    </div>
  );
}
