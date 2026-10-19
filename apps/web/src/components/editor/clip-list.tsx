"use client";

import * as React from "react";
import { ListPlus, ListVideo, Plus, Tag } from "lucide-react";
import { computeGroupRuns, snapGapToGroupBoundary } from "@scoutable/shared/lib/clip-groups";
import type { ExportPurpose } from "@scoutable/shared/lib/game-video-wire";
import { dragBlockKeys } from "@scoutable/shared/lib/list-reorder";
import { itemKey, selectionGroupAction } from "@scoutable/shared/lib/playlist-edits";
import type { Label } from "@scoutable/shared/types/labels";
import { isClipItem, type Playlist, type PlaylistClipItem } from "@scoutable/shared/types/match";
import { LabelPickerContent, LabelPickerPopover } from "@/components/labels/label-picker-popover";
import { triStateOf, type LabelActions, type LabelTriState } from "@/components/labels/use-labels";
import { Button } from "@/components/ui/button";
import { useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AddToContent, AddToPopover } from "./add-to-popover";
import { EditorCardRow } from "./editor-card-row";
import { EditorClipRow } from "./editor-clip-row";
import type { EditorRow } from "./editor-rows";
import type { RowPopover } from "./row-parts";
import { PILL_LABEL, PillButton, SelectionBar } from "./selection-bar";
import type { UseAddTo } from "./use-add-to";
import type { ClipSelection } from "./use-clip-selection";
import type { UseExport } from "./use-export";
import { useListDrag } from "./use-list-drag";

/** The clips' labels in this playlist, and what the picker does with them. */
export interface EditorLabels {
  labels: readonly Label[];
  /** Label ids per clip key. */
  byClip: ReadonlyMap<string, ReadonlySet<string>>;
  /** One label on or off for these clip keys; `bulk` when a selection asked. */
  toggle: (keys: readonly string[], labelId: string, state: LabelTriState, bulk: boolean) => void;
  actions: LabelActions;
  scopeTitle: string;
  scopeHint: string;
}

/** Stats cards from the list: which clips can start one, and the inspector. */
export interface EditorStatsEntries {
  /** A clip's game has stats and its play a player. */
  canStartFrom: (key: string) => boolean;
  /** Some clip in the playlist can start a card. */
  available: boolean;
  /** "Insert stats card above" the row; a clip's row starts the card from that clip. */
  onInsertAbove: (key: string, fromClip: boolean) => void;
  onEdit: (cardId: string) => void;
}

const NO_LABELS: ReadonlySet<string> = new Set();

/**
 * The playlist's items as a list a coach works in: a click plays a row, ⌘
 * and Shift tick rows, the checkboxes tick without playing, a row lifts
 * under the pointer to be reordered (a finger lifts it by its grip; a group
 * lifts whole), and each row has Remove on hover and a ⋯ menu that a
 * right-click and Shift+F10 open too, from which the labels picker and Add
 * to open in its place. The selection bar floats over the bottom while
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
  onFixSync,
  onInsertCardAbove,
  onRemove,
  onReorder,
  onGroup,
  onUngroup,
  onCardText,
  onCardDuration,
  autoFocusCardId,
  gridRef,
  onAddClips,
  exporter,
  onExport,
  labels,
  addTo,
  stats,
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
  /** "Fix sync…" on a clip whose game the viewer has a ready copy of. */
  onFixSync?: (key: string) => (() => void) | undefined;
  onInsertCardAbove: (key: string) => void;
  onRemove: (keys: ReadonlySet<string>) => void;
  onReorder: (gap: number, blockKeys: readonly string[], displayKeys: readonly string[], via: "pointer" | "keyboard") => void;
  /** Locks the picked rows together; answers whether anything changed. */
  onGroup?: (keys: ReadonlySet<string>) => boolean;
  onUngroup?: (groupId: string) => void;
  onCardText: (cardId: string, text: string) => void;
  onCardDuration: (cardId: string, seconds: number) => void;
  /** A card just added: its text field takes focus. */
  autoFocusCardId: string | null;
  /** The grid, for the keys' focus target and the drag engine's. */
  gridRef: React.RefObject<HTMLDivElement | null>;
  onAddClips: () => void;
  /** The selection bar's Export menu (the owner's). */
  exporter?: UseExport;
  onExport?: (purpose: ExportPurpose) => void;
  labels?: EditorLabels;
  addTo?: UseAddTo;
  stats?: EditorStatsEntries;
}) {
  const baseId = React.useId();
  const reduced = useReducedMotionSafe();
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);
  /** The popover a row's menu opened: waiting for the menu to go, open, or (closed) on its way out. */
  const [rowPopover, setRowPopover] = React.useState<{ key: string; kind: "labels" | "add-to"; open: boolean; pending: boolean } | null>(null);

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

  /** A popover that replaced a row's menu hands the focus back to the list, so the keys carry on. */
  const refocusList = React.useCallback(
    (e: Event) => {
      e.preventDefault();
      gridRef.current?.focus({ preventScroll: true });
    },
    [gridRef],
  );

  /** Picked from a row's menu: it opens once the menu has gone (RowMenu), or after a moment if the menu never says so. */
  function openRowPopover(key: string, kind: "labels" | "add-to") {
    if (kind === "add-to") addTo?.load();
    setRowPopover({ key, kind, open: false, pending: true });
    window.setTimeout(() => setRowPopover((p) => (p && p.key === key && p.kind === kind && p.pending ? { ...p, open: true, pending: false } : p)), 500);
  }

  /** The labels picker or Add to for one row, anchored to its ⋯ button. */
  function rowPopoverFor(key: string): RowPopover | undefined {
    if (!rowPopover || rowPopover.key !== key) return undefined;
    const close = () => setRowPopover((p) => (p && p.key === key ? { ...p, open: false, pending: false } : p));
    const open = () => setRowPopover((p) => (p && p.key === key ? { ...p, open: true, pending: false } : p));
    let content: React.ReactNode = null;
    if (rowPopover.kind === "labels" && labels) {
      content = (
        <LabelPickerContent
          labels={labels.labels}
          assignedAllIds={labels.byClip.get(key) ?? NO_LABELS}
          onToggle={(labelId, state) => labels.toggle([key], labelId, state, false)}
          actions={labels.actions}
          scopeTitle={labels.scopeTitle}
          scopeHint={labels.scopeHint}
          onCloseAutoFocus={refocusList}
        />
      );
    } else if (rowPopover.kind === "add-to" && addTo) {
      const keys = new Set([key]);
      content = (
        <AddToContent
          candidates={addTo.candidates}
          clipCount={1}
          onAdd={(target) => addTo.add(target, keys)}
          onCreate={(name) => addTo.create(name, keys)}
          onDone={close}
          onCloseAutoFocus={refocusList}
        />
      );
    }
    return { open: rowPopover.open, pending: rowPopover.pending, onOpenChange: (next) => (next ? open() : close()), content };
  }

  const anySelected = selection.selected.size > 0;
  const focusId = selection.focus !== null && order.includes(selection.focus) ? `${baseId}-${selection.focus}` : undefined;

  // ----- the selection bar's actions -------------------------------------------

  const groupAction = React.useMemo(() => (onGroup ? selectionGroupAction(playlist, selection.selected) : null), [onGroup, playlist, selection.selected]);
  const groupSelection = React.useCallback(() => {
    if (onGroup?.(selection.selected)) selection.clear();
  }, [onGroup, selection]);
  const selectedClipKeys = React.useMemo(() => order.filter((k) => selection.selected.has(k) && !k.startsWith("text:")), [order, selection.selected]);
  const bulk = React.useMemo(() => (labels ? triStateOf(selectedClipKeys, labels.byClip) : null), [labels, selectedClipKeys]);

  const labelPicker =
    labels && bulk && selectedClipKeys.length > 0 ? (
      <LabelPickerPopover
        side="top"
        align="center"
        trigger={
          <PillButton title="Labels" aria-label="Labels">
            <Tag />
            <span className={PILL_LABEL}>Label</span>
          </PillButton>
        }
        labels={labels.labels}
        assignedAllIds={bulk.all}
        assignedSomeIds={bulk.some}
        onToggle={(labelId, state) => labels.toggle(selectedClipKeys, labelId, state, true)}
        actions={labels.actions}
        scopeTitle={labels.scopeTitle}
        scopeHint={labels.scopeHint}
      />
    ) : null;

  const addToButton =
    addTo && selectedClipKeys.length > 0 ? (
      <AddToPopover
        trigger={
          <PillButton title="Add to another playlist" aria-label="Add to another playlist">
            <ListPlus />
            <span className={PILL_LABEL}>Add to</span>
          </PillButton>
        }
        onOpenChange={(open) => open && addTo.load()}
        candidates={addTo.candidates}
        clipCount={selectedClipKeys.length}
        onAdd={async (target) => {
          const ok = await addTo.add(target, new Set(selectedClipKeys));
          if (ok) selection.clear();
          return ok;
        }}
        onCreate={async (name) => {
          const ok = await addTo.create(name, new Set(selectedClipKeys));
          if (ok) selection.clear();
          return ok;
        }}
      />
    ) : null;

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
          const isSelected = selection.selected.has(key);
          const shared = {
            domId: `${baseId}-${key}`,
            index,
            isActive: activeKey === key,
            focused: selection.keyboardNav && selection.focus === key,
            isSelected,
            anySelected,
            menuOpen: menuKey === key,
            onMenuOpenChange: (open: boolean) => onMenuKeyChange(open ? key : menuKey === key ? null : menuKey),
            onSelect: (e: React.MouseEvent) => rowSelect(key, e),
            onClick: (e: React.MouseEvent) => rowClick(key, e),
            drag: { rowKey: key, onPointerDown: (e: React.PointerEvent) => drag.onRowPointerDown(e, key) },
            onInsertTextCardAbove: () => onInsertCardAbove(key),
            onUngroup: run && onUngroup ? () => onUngroup(run.groupId) : undefined,
            onRemove: () => onRemove(new Set([key])),
            groupPos: run?.pos,
            groupSize: run?.size,
          };
          if (isClipItem(row.item)) {
            const assigned = labels?.byClip.get(key);
            return (
              <EditorClipRow
                key={key}
                row={row as EditorRow & { item: PlaylistClipItem }}
                isMultiMatch={isMultiMatch}
                onTrim={row.watch?.kind === "window" ? () => onTrim(key) : undefined}
                onFixSync={onFixSync?.(key)}
                onInsertStatsCardAbove={stats?.canStartFrom(key) ? () => stats.onInsertAbove(key, true) : undefined}
                onLabels={labels ? () => openRowPopover(key, "labels") : undefined}
                onAddTo={addTo ? () => openRowPopover(key, "add-to") : undefined}
                onGroupSelection={isSelected && selection.selected.size >= 2 && groupAction?.kind === "group" ? groupSelection : undefined}
                selectionCount={selection.selected.size}
                labels={labels && assigned ? labels.labels.filter((l) => assigned.has(l.id)) : undefined}
                menuPopover={rowPopoverFor(key)}
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
              onInsertStatsCardAbove={stats?.available ? () => stats.onInsertAbove(key, false) : undefined}
              onEditStats={card.card && stats ? () => stats.onEdit(card.id) : undefined}
              autoFocusText={autoFocusCardId === card.id}
              {...shared}
            />
          );
        })}
      </div>
      <SelectionBar
        count={selection.selected.size}
        onRemove={() => onRemove(selection.selected)}
        onClear={selection.clear}
        group={
          groupAction
            ? groupAction.kind === "group"
              ? { kind: "group", onClick: groupSelection }
              : { kind: "ungroup", onClick: () => onUngroup?.(groupAction.groupId) }
            : null
        }
        labelPicker={labelPicker}
        addTo={addToButton}
        exporter={isOwner ? exporter : undefined}
        onExport={onExport}
      />
    </div>
  );
}
