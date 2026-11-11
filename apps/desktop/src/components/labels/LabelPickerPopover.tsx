import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, MoreHorizontal, Plus, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trackEvent } from "@/lib/analytics";
import { LABEL_COLORS, labelDotClasses, labelSwatchClasses } from "@/lib/label-colors";
import { getRecentLabelIds, rememberLabelUsed } from "@/lib/recent-labels";
import { labelPickerOrder } from "@scoutable/shared/lib/label-order";
import { clamp } from "@scoutable/shared/lib/motion-math";
import type { Label, LabelColor } from "@scoutable/shared/types/labels";
import { cn } from "@/lib/utils";

/** The "Create …" row's place among the rows the arrows move through. */
const CREATE = "__create__";

export type LabelTriState = "all" | "some" | "none";

interface LabelPickerPopoverProps {
  trigger: React.ReactNode;
  labels: Label[];
  /** Label IDs assigned to ALL of the active clip(s). */
  assignedAllIds: Set<string>;
  /** Label IDs assigned to SOME but not all clips (bulk mode only). */
  assignedSomeIds?: Set<string>;
  /** Click on a label toggles it. Use `state` to decide add vs remove. */
  onToggle: (labelId: string, state: LabelTriState) => Promise<void> | void;
  onCreate: (name: string, color: LabelColor) => Promise<Label>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: LabelColor) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** Optional: shown when there are zero labels in the active org. */
  onSeedDefaults?: () => Promise<void>;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  /** Set by a surface that opens the picker itself (the game view's G key); it opens on its trigger otherwise. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function triState(
  id: string,
  all: Set<string>,
  some?: Set<string>,
): LabelTriState {
  if (all.has(id)) return "all";
  if (some?.has(id)) return "some";
  return "none";
}

function StateIndicator({ state }: { state: LabelTriState }) {
  if (state === "all") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-primary text-primary-foreground">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (state === "some") {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-primary/30">
        <span className="h-0.5 w-2 rounded-full bg-primary" />
      </span>
    );
  }
  return <span className="h-4 w-4 rounded-sm border border-border" />;
}

function ColorSwatchGrid({
  selected,
  onPick,
}: {
  selected?: LabelColor;
  onPick: (c: LabelColor) => void;
}) {
  return (
    <div className="grid grid-cols-6 gap-1 p-1">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className={cn(
            "h-6 w-6 rounded-md transition-transform hover:scale-110",
            labelSwatchClasses[c],
            selected === c && "ring-2 ring-offset-1 ring-offset-popover ring-primary",
          )}
          aria-label={`Color: ${c}`}
        />
      ))}
    </div>
  );
}

/**
 * Puts labels on a clip (or on several, in bulk). Built for doing it over and
 * over: the labels used last are at the top and the one used last is where
 * Enter starts, so "the same label again" is open, Enter. Typing narrows the
 * list and Enter takes the best match; the arrows move through it. Enter is
 * "this one, done" and closes the picker; a click leaves it open for a second
 * label. A new label is only made from the "Create" row, which Enter reaches
 * by itself when nothing matches.
 */
export function LabelPickerPopover({
  trigger,
  labels,
  assignedAllIds,
  assignedSomeIds,
  onToggle,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
  onSeedDefaults,
  align = "end",
  side = "bottom",
  open: openProp,
  onOpenChange,
}: LabelPickerPopoverProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [query, setQuery] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [createColor, setCreateColor] = useState<LabelColor>("violet");
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  /** What had the keyboard when the picker opened: it gets it back. */
  const openerRef = useRef<Element | null>(null);
  /** The row the arrows or the pointer chose; null while Enter still starts where the order says. */
  const [moved, setMoved] = useState<string | null>(null);
  const movedByKey = useRef(false);
  // Read once per opening: the order holds while the picker is open, so no row moves under the pointer.
  const recentAtOpen = useMemo(() => (open ? getRecentLabelIds() : []), [open]);

  // The labels put on during this opening, in order. They count as used when the picker closes, so one
  // that was clicked and taken off again doesn't become what Enter starts at.
  const putOn = useRef<string[]>([]);
  const rememberPutOn = () => {
    for (const id of putOn.current) rememberLabelUsed(id);
    putOn.current = [];
  };

  useEffect(() => {
    if (!open) {
      rememberPutOn();
      setQuery("");
      setRenameId(null);
      setMoved(null);
    }
  }, [open]);
  // A picker that is taken away while open (a row's) closes without the effect above.
  useEffect(() => rememberPutOn, []);

  useEffect(() => {
    if (renameId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameId]);

  const trimmedQuery = query.trim();
  const queryLower = trimmedQuery.toLowerCase();

  const order = useMemo(() => labelPickerOrder(labels, recentAtOpen, trimmedQuery), [labels, recentAtOpen, trimmedQuery]);
  const rows = useMemo(() => [...order.recent, ...order.rest], [order]);

  const exactMatch = useMemo(
    () => labels.some((l) => l.name.toLowerCase() === queryLower),
    [labels, queryLower],
  );

  const showCreateRow = trimmedQuery.length > 0 && !exactMatch;
  const showEmptyState = labels.length === 0 && !trimmedQuery;

  // What Enter acts on: the row that was moved to, else the label used last (the best match while
  // searching), else "Create" when nothing matches.
  const ids = useMemo(() => [...rows.map((l) => l.id), ...(showCreateRow ? [CREATE] : [])], [rows, showCreateRow]);
  const active = moved && ids.includes(moved) ? moved : (order.first ?? (showCreateRow ? CREATE : null));
  const optionId = (id: string) => `${listId}-${id}`;

  useEffect(() => {
    if (!movedByKey.current) return;
    movedByKey.current = false;
    listRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function toggle(label: Label, by: "key" | "pointer") {
    const state = triState(label.id, assignedAllIds, assignedSomeIds);
    putOn.current = putOn.current.filter((id) => id !== label.id);
    if (state !== "all") {
      putOn.current.push(label.id);
      trackEvent("label_picked", { by, position: rows.indexOf(label), recent: order.recent.includes(label), searched: trimmedQuery !== "", created: false });
    }
    void onToggle(label.id, state);
    // Enter is "this one, done". A click leaves the picker open for a second label.
    if (by === "key") setOpen(false);
  }

  async function handleCreate(by: "key" | "pointer") {
    if (!trimmedQuery || exactMatch) return;
    const fresh = await onCreate(trimmedQuery, createColor);
    setQuery("");
    setMoved(null);
    // Auto-assign to the active clip(s).
    await onToggle(fresh.id, "none");
    if (by === "key") rememberLabelUsed(fresh.id);
    else putOn.current.push(fresh.id);
    trackEvent("label_picked", { by, position: rows.length, recent: false, searched: true, created: true });
    // Cycle the create color to the next palette entry so consecutive
    // user-created labels look distinct.
    const idx = LABEL_COLORS.indexOf(createColor);
    setCreateColor(LABEL_COLORS[(idx + 1) % LABEL_COLORS.length]);
    if (by === "key") setOpen(false);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (ids.length === 0) return;
      const at = active ? ids.indexOf(active) : -1;
      movedByKey.current = true;
      setMoved(ids[clamp(at + (e.key === "ArrowDown" ? 1 : -1), 0, ids.length - 1)]);
      return;
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (active === CREATE) void handleCreate("key");
      else {
        const label = rows.find((l) => l.id === active);
        if (label) toggle(label, "key");
      }
    }
  }

  const [deleteTarget, setDeleteTarget] = useState<Label | null>(null);

  async function handleRenameSubmit() {
    if (!renameId) return;
    const next = renameValue.trim();
    if (!next) {
      setRenameId(null);
      return;
    }
    const original = labels.find((l) => l.id === renameId);
    if (original && original.name !== next) {
      await onRename(renameId, next);
    }
    setRenameId(null);
  }

  const renderRow = (label: Label) => {
    const state = triState(label.id, assignedAllIds, assignedSomeIds);
    const isRenaming = renameId === label.id;
    return (
      <div
        key={label.id}
        role="presentation"
        data-active={active === label.id || undefined}
        // One highlight for the pointer and the arrows, as in a menu. A move, not an enter: a list
        // that scrolls under a resting pointer doesn't take the highlight from the keys.
        onPointerMove={() => {
          if (moved !== label.id) setMoved(label.id);
        }}
        className="group flex items-center gap-2 px-2 py-1.5 data-[active]:bg-fill-2"
      >
        <button
          type="button"
          id={optionId(label.id)}
          role="option"
          aria-selected={state === "all"}
          onClick={() => toggle(label, "pointer")}
          className="flex flex-1 items-center gap-2 text-left"
          disabled={isRenaming}
        >
          <StateIndicator state={state} />
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", labelDotClasses[label.color])} />
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => void handleRenameSubmit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleRenameSubmit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameId(null);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-transparent text-sm outline-none ring-1 ring-primary rounded px-1"
            />
          ) : (
            <span className="flex-1 truncate text-sm">{label.name}</span>
          )}
        </button>

        {!isRenaming && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-6 w-6 rounded p-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-fill-2 hover:text-foreground flex items-center justify-center"
                aria-label="Change color"
              >
                <span className={cn("h-3 w-3 rounded-full", labelSwatchClasses[label.color])} />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-auto p-1">
              <ColorSwatchGrid
                selected={label.color}
                onPick={(c) => void onRecolor(label.id, c)}
              />
            </PopoverContent>
          </Popover>
        )}

        {!isRenaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="h-6 w-6 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-fill-2 hover:text-foreground flex items-center justify-center"
                aria-label="Label actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start">
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setRenameValue(label.name);
                  setRenameId(label.id);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setDeleteTarget(label)}
                className="text-destructive focus:bg-destructive focus:text-white"
              >
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  return (
    <>
    {/* Modal, so its list scrolls inside the Add clips sheet (see components/ui/popover.tsx). */}
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          // Let our input claim focus instead of the first focusable child.
          e.preventDefault();
          openerRef.current = document.activeElement;
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          // Focus goes back to where it was, not to the trigger: opened by a key or a click (which
          // focuses nothing on macOS), the trigger would otherwise wear a focus ring at the next key.
          e.preventDefault();
          const opener = openerRef.current;
          openerRef.current = null;
          if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
        }}
      >

        {/* Search / create input */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active ? optionId(active) : undefined}
            // macOS's correction bubble takes the arrows and Enter for itself, and "pi" is not a word to fix.
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // A new search starts at its best match, at the top of the list.
              setMoved(null);
              listRef.current?.scrollTo({ top: 0 });
            }}
            placeholder="Search or create…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={onSearchKeyDown}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setMoved(null);
              }}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* List: the labels used last, then the rest in the vocabulary's order; "Create" stays in view under it. */}
        <div id={listId} role="listbox" aria-label="Labels" aria-multiselectable>
        <div ref={listRef} role="presentation" className="max-h-72 overflow-y-auto py-1">
          {showEmptyState && onSeedDefaults && (
            <div className="px-3 py-4 text-center text-sm text-muted-foreground">
              <p className="mb-2">No labels yet in your vocabulary.</p>
              <button
                type="button"
                onClick={() => void onSeedDefaults()}
                className="text-xs font-medium text-primary hover:underline"
              >
                Add default basketball labels
              </button>
            </div>
          )}

          {rows.length === 0 && trimmedQuery && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matches. Press Enter to create.
            </div>
          )}

          {order.recent.length > 0 && (
            <p role="presentation" className="px-3 pt-1 pb-0.5 text-caption text-muted-foreground">
              Recent
            </p>
          )}
          {order.recent.map(renderRow)}
          {order.recent.length > 0 && order.rest.length > 0 && <div role="presentation" className="mx-2 my-1 h-px bg-separator" />}
          {order.rest.map(renderRow)}
        </div>

        {/* Create row */}
        {showCreateRow && (
          <div
            role="presentation"
            data-active={active === CREATE || undefined}
            onPointerMove={() => {
              if (moved !== CREATE) setMoved(CREATE);
            }}
            className="border-t flex items-center gap-2 px-2 py-1.5 data-[active]:bg-fill-2"
          >
            <button
              type="button"
              id={optionId(CREATE)}
              role="option"
              aria-selected={false}
              onClick={() => void handleCreate("pointer")}
              className="flex flex-1 items-center gap-2 text-left"
            >
              <span className="flex h-4 w-4 items-center justify-center text-primary">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", labelDotClasses[createColor])} />
              <span className="flex-1 truncate text-sm">
                Create &ldquo;<span className="font-medium">{trimmedQuery}</span>&rdquo;
              </span>
            </button>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="h-6 w-6 rounded text-muted-foreground hover:bg-fill-2 hover:text-foreground flex items-center justify-center"
                  aria-label="Pick color"
                >
                  <span className={cn("h-3 w-3 rounded-full", labelSwatchClasses[createColor])} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-auto p-1">
                <ColorSwatchGrid
                  selected={createColor}
                  onPick={(c) => setCreateColor(c)}
                />
              </PopoverContent>
            </Popover>
          </div>
        )}
        </div>
      </PopoverContent>
    </Popover>

    {/* Deleting a label takes it off every clip, so it asks first. */}
    <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{deleteTarget?.name}”?</DialogTitle>
          <DialogDescription>It comes off every clip you've tagged with it.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const target = deleteTarget;
              setDeleteTarget(null);
              if (target) void onDelete(target.id);
            }}
          >
            Delete label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
