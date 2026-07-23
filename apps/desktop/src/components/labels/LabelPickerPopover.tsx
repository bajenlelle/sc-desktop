import { useEffect, useMemo, useRef, useState } from "react";
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
import { LABEL_COLORS, labelDotClasses, labelSwatchClasses } from "@/lib/label-colors";
import type { Label, LabelColor } from "@scoutable/shared/types/labels";
import { cn } from "@/lib/utils";

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
  /**
   * Header shown at the top of the popover so users know which scope they're
   * editing (e.g., "Labels in {playlist name}" or "Bank labels"). Strongly
   * recommended whenever the same picker UI is reused across scopes.
   */
  scopeTitle?: string;
  /** Optional one-liner under scopeTitle. e.g. "Visible only in this playlist". */
  scopeHint?: string;
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
  scopeTitle,
  scopeHint,
}: LabelPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [createColor, setCreateColor] = useState<LabelColor>("violet");
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRenameId(null);
    }
  }, [open]);

  useEffect(() => {
    if (renameId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameId]);

  const trimmedQuery = query.trim();
  const queryLower = trimmedQuery.toLowerCase();

  const filtered = useMemo(() => {
    if (!trimmedQuery) return labels;
    return labels.filter((l) => l.name.toLowerCase().includes(queryLower));
  }, [labels, trimmedQuery, queryLower]);

  const exactMatch = useMemo(
    () => labels.some((l) => l.name.toLowerCase() === queryLower),
    [labels, queryLower],
  );

  const showCreateRow = trimmedQuery.length > 0 && !exactMatch;
  const showEmptyState = labels.length === 0 && !trimmedQuery;

  async function handleCreate() {
    if (!trimmedQuery || exactMatch) return;
    const fresh = await onCreate(trimmedQuery, createColor);
    setQuery("");
    // Auto-assign to the active clip(s).
    await onToggle(fresh.id, "none");
    // Cycle the create color to the next palette entry so consecutive
    // user-created labels look distinct.
    const idx = LABEL_COLORS.indexOf(createColor);
    setCreateColor(LABEL_COLORS[(idx + 1) % LABEL_COLORS.length]);
  }

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          // Let our input claim focus instead of the first focusable child.
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {/* Scope header — clarifies which "labels" the user is editing */}
        {scopeTitle && (
          <div className="border-b px-3 py-2">
            <div className="text-xs font-semibold text-foreground truncate" title={scopeTitle}>
              {scopeTitle}
            </div>
            {scopeHint && (
              <div className="text-[11px] text-muted-foreground mt-0.5">{scopeHint}</div>
            )}
          </div>
        )}

        {/* Search / create input */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or create…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter" && showCreateRow) {
                e.preventDefault();
                void handleCreate();
              }
            }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto py-1">
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

          {filtered.length === 0 && trimmedQuery && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No matches. Press Enter to create.
            </div>
          )}

          {filtered.map((label) => {
            const state = triState(label.id, assignedAllIds, assignedSomeIds);
            const isRenaming = renameId === label.id;
            return (
              <div
                key={label.id}
                className="group flex items-center gap-2 px-2 py-1.5 hover:bg-accent/40"
              >
                <button
                  type="button"
                  onClick={() => void onToggle(label.id, state)}
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
                        className="h-6 w-6 rounded p-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground flex items-center justify-center"
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
                        className="h-6 w-6 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground flex items-center justify-center"
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
                        onSelect={(e) => {
                          e.preventDefault();
                          if (
                            window.confirm(
                              `Delete "${label.name}"? This removes it from every clip you've tagged.`,
                            )
                          ) {
                            void onDelete(label.id);
                          }
                        }}
                        className="text-red-500 focus:text-red-500"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>

        {/* Create row */}
        {showCreateRow && (
          <div className="border-t flex items-center gap-2 px-2 py-1.5 hover:bg-accent/40">
            <button
              type="button"
              onClick={() => void handleCreate()}
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
                  className="h-6 w-6 rounded text-muted-foreground hover:bg-accent hover:text-foreground flex items-center justify-center"
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
      </PopoverContent>
    </Popover>
  );
}
