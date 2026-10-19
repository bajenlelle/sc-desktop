"use client";

import * as React from "react";
import { Check, Loader2, MoreHorizontal, Plus } from "lucide-react";
import type { Label, LabelColor } from "@scoutable/shared/types/labels";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import { LABEL_COLORS, colorName, labelDotClasses, labelSwatchClasses } from "./label-colors";
import type { LabelActions, LabelTriState } from "./use-labels";

export type { LabelTriState };

export interface LabelPickerProps {
  labels: readonly Label[];
  /** Labels on every clip the picker is for. */
  assignedAllIds: ReadonlySet<string>;
  /** Labels on some of them (a selection of several). */
  assignedSomeIds?: ReadonlySet<string>;
  /** A label pressed: its state says which way it goes ("all" comes off, the others go on). */
  onToggle: (labelId: string, state: LabelTriState) => void;
  actions: LabelActions;
  /** Which labels these are ("Labels in Turnovers"), since the same picker serves two scopes. */
  scopeTitle?: string;
  scopeHint?: string;
}

/** Hover-only controls in a label's line; always there on touch screens and for keyboard focus. */
const LINE_REVEAL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100";

function triState(id: string, all: ReadonlySet<string>, some?: ReadonlySet<string>): LabelTriState {
  if (all.has(id)) return "all";
  if (some?.has(id)) return "some";
  return "none";
}

function StateBox({ state }: { state: LabelTriState }) {
  if (state === "all") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-primary text-primary-foreground">
        <Check className="size-3 stroke-[3]" />
      </span>
    );
  }
  if (state === "some") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-primary/30">
        <span className="h-0.5 w-2 rounded-full bg-primary" />
      </span>
    );
  }
  return <span className="size-4 shrink-0 rounded-[4px] ring-1 ring-separator-strong ring-inset" />;
}

function Swatches({ selected, onPick }: { selected?: LabelColor; onPick: (c: LabelColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="grid grid-cols-6 gap-1.5">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={selected === c}
          aria-label={colorName(c)}
          onClick={() => onPick(c)}
          className={cn(
            "size-6 rounded-full outline-none transition-transform duration-100 hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-2 focus-visible:ring-offset-popover pointer-coarse:size-8",
            labelSwatchClasses[c],
            selected === c && "ring-2 ring-primary ring-offset-2 ring-offset-popover",
          )}
        />
      ))}
    </div>
  );
}

/** A colour picked from a small popover beside the dot it changes. */
function ColorButton({ color, label, onPick }: { color: LabelColor; label: string; onPick: (c: LabelColor) => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md outline-none transition-[opacity,background-color,transform] duration-100 hover:bg-fill-2 active:scale-95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-8",
            LINE_REVEAL,
          )}
        >
          <span className={cn("size-3 rounded-full", labelSwatchClasses[color])} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-auto p-2.5">
        <Swatches
          selected={color}
          onPick={(c) => {
            onPick(c);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The picker itself: the scope it edits, a search field that doubles as the
 * name of a new label (Return creates it, in the next colour along, and puts
 * it on the clips), and the space's labels with a tick, a dash for "some of
 * the selection" or nothing; each label's colour and ⋯ (Rename, Delete…)
 * beside it. Renaming happens in place. The desktop's LabelPickerPopover.
 */
function PickerBody({
  labels,
  assignedAllIds,
  assignedSomeIds,
  onToggle,
  actions,
  scopeTitle,
  scopeHint,
  inputRef,
  onRenamingChange,
}: LabelPickerProps & {
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** While a name is being edited, Escape cancels the edit instead of closing the picker. */
  onRenamingChange: (renaming: boolean) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [renameId, setRenameId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [createColor, setCreateColor] = React.useState<LabelColor>("violet");
  const [creating, setCreating] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);
  const renameRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    onRenamingChange(renameId !== null);
    if (renameId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renameId, onRenamingChange]);

  const trimmed = query.trim();
  const q = trimmed.toLocaleLowerCase("sv");
  const shown = trimmed ? labels.filter((l) => l.name.toLocaleLowerCase("sv").includes(q)) : labels;
  const exact = labels.some((l) => l.name.toLocaleLowerCase("sv") === q);
  const canCreate = trimmed.length > 0 && !exact;

  async function create() {
    if (!canCreate || creating) return;
    setCreating(true);
    const made = await actions.create(trimmed.slice(0, 40), createColor);
    setCreating(false);
    if (!made) return;
    setQuery("");
    onToggle(made.id, "none");
    // The next label made here gets the next colour, so a few in a row look apart.
    setCreateColor(LABEL_COLORS[(LABEL_COLORS.indexOf(createColor) + 1) % LABEL_COLORS.length]);
    inputRef.current?.focus();
  }

  function commitRename() {
    const id = renameId;
    if (!id) return;
    setRenameId(null);
    const next = renameValue.trim().slice(0, 40);
    const was = labels.find((l) => l.id === id);
    // A name another label has would be refused by the database; keep the old one.
    const taken = labels.some((l) => l.id !== id && l.name.toLocaleLowerCase("sv") === next.toLocaleLowerCase("sv"));
    if (next && was && next !== was.name && !taken) actions.rename(id, next);
  }

  return (
    <>
      {scopeTitle && (
        <div className="border-b border-separator px-3 pt-2.5 pb-2">
          <p className="truncate text-subheadline font-semibold text-foreground" title={scopeTitle}>
            {scopeTitle}
          </p>
          {scopeHint && <p className="text-caption text-muted-foreground">{scopeHint}</p>}
        </div>
      )}

      <div className="p-2">
        <SearchField
          ref={inputRef}
          value={query}
          maxLength={40}
          placeholder="Search or create…"
          aria-label="Search or create a label"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) {
              e.preventDefault();
              void create();
            }
          }}
        />
      </div>

      <div className="max-h-72 overflow-y-auto overscroll-contain px-1 pb-1">
        {labels.length === 0 && !trimmed && (
          <div className="flex flex-col items-center gap-2 px-3 pt-2 pb-4 text-center">
            <p className="text-callout text-muted-foreground">No labels yet. Type a name to create one, or start with a basketball set.</p>
            <button
              type="button"
              disabled={seeding}
              onClick={async () => {
                setSeeding(true);
                await actions.seedDefaults();
                setSeeding(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-callout font-medium text-primary outline-none transition-[background-color,transform] duration-100 hover:bg-primary/10 active:scale-[0.97] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-selection"
            >
              {seeding && <Loader2 className="size-3.5 animate-spin" />}
              Add basketball labels
            </button>
          </div>
        )}

        {shown.length === 0 && trimmed && <p className="px-2 py-1.5 text-callout text-muted-foreground">No label called that. Return creates it.</p>}

        {shown.map((label) => {
          const state = triState(label.id, assignedAllIds, assignedSomeIds);
          const renaming = renameId === label.id;
          return (
            <div key={label.id} className="group flex min-h-8 items-center gap-1 rounded-md pr-1 hover:bg-fill-1 pointer-coarse:min-h-11">
              {renaming ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
                  <StateBox state={state} />
                  <span className={cn("size-2.5 shrink-0 rounded-full", labelDotClasses[label.color])} />
                  <input
                    ref={renameRef}
                    value={renameValue}
                    maxLength={40}
                    aria-label={`New name for ${label.name}`}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenameId(null);
                      }
                    }}
                    className="min-w-0 flex-1 rounded-[4px] bg-card px-1 text-sm text-foreground outline-none ring-2 ring-selection"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
                  onClick={() => onToggle(label.id, state)}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md px-2 text-left text-sm outline-none transition-transform duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-selection"
                >
                  <StateBox state={state} />
                  <span className={cn("size-2.5 shrink-0 rounded-full", labelDotClasses[label.color])} />
                  <span className="min-w-0 flex-1 truncate">{label.name}</span>
                </button>
              )}

              {!renaming && (
                <>
                  <ColorButton color={label.color} label={`Colour of ${label.name}`} onPick={(c) => actions.recolor(label.id, c)} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`More for ${label.name}`}
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[opacity,background-color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:size-8",
                          LINE_REVEAL,
                        )}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-40">
                      <DropdownMenuItem
                        onSelect={() => {
                          setRenameValue(label.name);
                          setRenameId(label.id);
                        }}
                      >
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => actions.requestDelete(label)} className="text-destructive focus:bg-destructive focus:text-white">
                        Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          );
        })}
      </div>

      {canCreate && (
        <div className="flex min-h-9 items-center gap-1 border-t border-separator px-1 py-1 pointer-coarse:min-h-12">
          <button
            type="button"
            disabled={creating}
            onClick={() => void create()}
            className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md px-2 text-left text-sm outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-selection"
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-primary">
              {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            </span>
            <span className={cn("size-2.5 shrink-0 rounded-full", labelDotClasses[createColor])} />
            <span className="min-w-0 flex-1 truncate">
              Create &ldquo;<span className="font-medium">{trimmed}</span>&rdquo;
            </span>
          </button>
          <ColorButton color={createColor} label="Colour of the new label" onPick={setCreateColor} />
        </div>
      )}
    </>
  );
}

/**
 * The picker's panel, for a Popover the caller holds: anchored to a row's ⋯
 * button when "Labels…" is picked from its menu, so it opens where the
 * menu was and leaves toward it.
 */
export function LabelPickerContent({
  align = "end",
  side = "bottom",
  onCloseAutoFocus,
  ...body
}: LabelPickerProps & {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const renamingRef = React.useRef(false);
  const onRenamingChange = React.useCallback((renaming: boolean) => {
    renamingRef.current = renaming;
  }, []);
  return (
    <PopoverContent
      align={align}
      side={side}
      collisionPadding={8}
      className="w-72 max-w-[calc(100vw-1rem)] p-0"
      onOpenAutoFocus={(e) => {
        // The search field takes focus, not the first button.
        e.preventDefault();
        inputRef.current?.focus({ preventScroll: true });
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={(e) => {
        if (renamingRef.current) e.preventDefault();
      }}
      // A right-click in here is the field's, not the row's behind it.
      onContextMenu={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <PickerBody {...body} inputRef={inputRef} onRenamingChange={onRenamingChange} />
    </PopoverContent>
  );
}

/** The picker on its own trigger: the selection bar's Label button. */
export function LabelPickerPopover({
  trigger,
  align,
  side,
  ...body
}: LabelPickerProps & {
  trigger: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <LabelPickerContent align={align} side={side} {...body} />
    </Popover>
  );
}
