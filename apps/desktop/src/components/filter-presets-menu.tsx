import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { hasActiveFilters, type ClipFilters } from "@scoutable/shared/lib/clip-filters";
import { presetFilters, sameFilters, type FilterPreset } from "@scoutable/shared/lib/filter-presets";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TriggerButton } from "@/components/ui/multi-select-dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type SaveAnswer = "ok" | "duplicate_name";

const NAME_MAX = 40;

function TakenMessage({ name }: { name: string }) {
  return <p className="px-2 pb-1 text-subheadline text-destructive">You already have a preset called “{name.trim()}”.</p>;
}

/**
 * The coach's saved filters, in Add clips and the game view's filter sheet:
 * pressing one applies it, and the current filters are saved under a name.
 * A preset keeps plays, shot types, situations and labels, never the team or
 * players (lib/filter-presets.ts): the trigger names the preset those four
 * groups match, whatever team or player is chosen. Laid out like
 * the label picker (LabelPickerPopover): rows, a "…" menu on hover with
 * Rename and Delete, rename in place. Deleting is immediate with Undo (the
 * hook's toast); a name already taken is refused here, inline.
 */
export function FilterPresetsMenu({
  presets,
  current,
  onApply,
  onSave,
  onRename,
  onDelete,
  modal,
}: {
  presets: FilterPreset[];
  current: ClipFilters;
  onApply: (p: FilterPreset) => void;
  onSave: (name: string) => Promise<SaveAnswer>;
  onRename: (id: string, name: string) => Promise<SaveAnswer>;
  onDelete: (p: FilterPreset) => void;
  /** Inside a sheet or dialog, so the list scrolls (see components/ui/popover.tsx). */
  modal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  /** The name a write was refused for, shown under its field until the name changes. */
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const matching = presets.find((p) => sameFilters(p.filters, current)) ?? null;
  // Nothing to save when only a team or players are chosen: a preset keeps neither.
  const canSave = hasActiveFilters(presetFilters(current));

  useEffect(() => {
    if (!open) {
      setAdding(false);
      setNewName("");
      setRenameId(null);
      setTaken(null);
    }
  }, [open]);

  useEffect(() => {
    if (renameId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renameId]);

  async function submitNew() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    const answer = await onSave(name);
    setBusy(false);
    if (answer === "duplicate_name") {
      setTaken(name);
      return;
    }
    setAdding(false);
    setNewName("");
    setTaken(null);
  }

  async function submitRename() {
    if (!renameId || busy) return;
    const preset = presets.find((p) => p.id === renameId);
    const name = renameValue.trim();
    // An empty or unchanged name writes nothing.
    if (!preset || !name || name === preset.name) {
      setRenameId(null);
      setTaken(null);
      return;
    }
    setBusy(true);
    const answer = await onRename(renameId, name);
    setBusy(false);
    if (answer === "duplicate_name") {
      setTaken(name);
      return;
    }
    setRenameId(null);
    setTaken(null);
  }

  const row = (p: FilterPreset) => {
    const isRenaming = renameId === p.id;
    const isMatch = matching?.id === p.id;
    return (
      <div key={p.id}>
        <div className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-fill-2 has-[>button:focus-visible]:bg-fill-2 has-[>button:active]:bg-fill-3">
          {isRenaming ? (
            <Input
              ref={renameInputRef}
              value={renameValue}
              maxLength={NAME_MAX}
              aria-label="Preset name"
              onChange={(e) => {
                setRenameValue(e.target.value);
                setTaken(null);
              }}
              onBlur={() => void submitRename()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenameId(null);
                  setTaken(null);
                }
              }}
              className="h-6 flex-1 px-1"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                onApply(p);
                setOpen(false);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm outline-none"
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {isMatch && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          )}
          {!isRenaming && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-fill-2 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
                  aria-label={`${p.name}: actions`}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setAdding(false);
                    setTaken(null);
                    setRenameValue(p.name);
                    setRenameId(p.id);
                  }}
                >
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => onDelete(p)}
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {isRenaming && taken && <TakenMessage name={taken} />}
      </div>
    );
  };

  return (
    <Popover modal={modal} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TriggerButton label={matching?.name ?? "Presets"} active={matching !== null} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-1"
        onEscapeKeyDown={(e) => {
          // Escape leaves a name field first, then the menu.
          if (adding || renameId) {
            e.preventDefault();
            setAdding(false);
            setRenameId(null);
            setTaken(null);
          }
        }}
      >
        <div className="max-h-72 overflow-y-auto">
          {presets.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No presets yet. Choose some filters, then save them here.</p>
          ) : (
            presets.map(row)
          )}
        </div>
        <div className="mx-1 my-1 h-px bg-separator" />
        {adding ? (
          <>
            <form
              className="flex items-center gap-1.5 p-1"
              onSubmit={(e) => {
                e.preventDefault();
                void submitNew();
              }}
            >
              <Input
                autoFocus
                value={newName}
                maxLength={NAME_MAX}
                placeholder="Preset name"
                aria-label="Preset name"
                onChange={(e) => {
                  setNewName(e.target.value);
                  setTaken(null);
                }}
                className="h-7 flex-1"
              />
              <Button type="submit" size="xs" disabled={!newName.trim() || busy}>
                Save
              </Button>
            </form>
            {taken && <TakenMessage name={taken} />}
          </>
        ) : (
          <button
            type="button"
            disabled={!canSave}
            title={canSave ? undefined : "Presets keep plays, shot types, situations and labels. Choose some first."}
            onClick={() => {
              setRenameId(null);
              setTaken(null);
              setAdding(true);
            }}
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-2 focus-visible:bg-fill-2 active:bg-fill-3 disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
          >
            Save current filters…
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
