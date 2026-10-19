"use client";

import * as React from "react";
import { Folder, ListVideo } from "lucide-react";
import { folderMoveTargets, type FolderMoveSubject, type FolderMoveTarget } from "@scoutable/shared/lib/folder-tree";
import type { PlaylistFolder } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pressable } from "@/lib/pressable";
import { cn } from "@/lib/utils";
import { isPendingFolder, TOP_LEVEL_NAME } from "./folder-nav";

/** What is moving: a playlist (and the folder it is in) or a folder, with the name the title uses. */
export type MoveRequest =
  | { kind: "playlist"; id: string; name: string; folderId?: string }
  | { kind: "folder"; id: string; name: string };

function subjectOf(request: MoveRequest): FolderMoveSubject {
  return request.kind === "playlist" ? { kind: "playlist", folderId: request.folderId } : { kind: "folder", id: request.id };
}

const NOTE: Record<Exclude<FolderMoveTarget["disabled"], false>, string | null> = {
  current: "Current",
  self: null,
  inside: null,
};

/**
 * Move to…: every place the playlist or folder can go, as the tree the
 * sidebar would show (the top level first, folders indented by depth).
 * Where it is now is greyed out and marked; a folder can't go into itself
 * or anything under it. One click moves it and closes the dialog (the move
 * can be undone from its toast). ↑ and ↓ walk the list; Return picks.
 */
export function MoveToDialog({
  open,
  request,
  folders,
  onClose,
  onMove,
}: {
  open: boolean;
  /** Kept while the dialog leaves, so it closes as it was. */
  request: MoveRequest | null;
  folders: PlaylistFolder[];
  onClose: () => void;
  onMove: (request: MoveRequest, folderId: string | null) => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const targets = React.useMemo(
    () => (request ? folderMoveTargets(folders.filter((f) => !isPendingFolder(f.id)), subjectOf(request)) : []),
    [request, folders],
  );

  function pick(target: FolderMoveTarget) {
    if (!open || !request || target.disabled) return;
    onMove(request, target.folderId);
    onClose();
  }

  // ↑/↓ between the rows that can be picked, as a list does.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="button"]:not([aria-disabled="true"])') ?? []);
    if (rows.length === 0) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at < 0 ? 0 : Math.min(rows.length - 1, at + 1)) : at < 0 ? rows.length - 1 : Math.max(0, at - 1);
    rows[next].focus();
  }

  return (
    <Dialog open={open && request !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          // Start on the first place it can go, not on the dialog itself.
          const first = listRef.current?.querySelector<HTMLElement>('[role="button"]:not([aria-disabled="true"])');
          if (first) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="truncate">Move “{request?.name}”</DialogTitle>
          <DialogDescription>Choose where it goes.</DialogDescription>
        </DialogHeader>
        <div
          ref={listRef}
          role="group"
          aria-label="Folders"
          onKeyDown={onKeyDown}
          className="max-h-[min(24rem,55dvh)] divide-y divide-separator overflow-y-auto rounded-window bg-card ring-1 ring-separator"
        >
          {targets.map((target) => {
            const disabled = target.disabled !== false;
            const note = target.disabled ? NOTE[target.disabled] : null;
            return (
              <div
                key={target.folderId ?? "top"}
                {...pressable(() => pick(target), { disabled })}
                className={cn(
                  "flex min-h-11 w-full cursor-default items-center gap-3 py-2 pr-4 text-left outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection",
                  disabled ? "opacity-50" : "hover:bg-fill-1 active:bg-fill-2",
                )}
                // One step of indent per level, as the desktop's sidebar does.
                style={{ paddingLeft: 16 + target.depth * 18 }}
              >
                <span className="flex shrink-0 items-center text-primary [&_svg]:size-4">
                  {target.folder ? <Folder className="fill-primary/15" /> : <ListVideo />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {target.folder ? (
                    target.folder.name
                  ) : (
                    <>
                      {TOP_LEVEL_NAME} <span className="text-muted-foreground">(top level)</span>
                    </>
                  )}
                </span>
                {note && <span className="shrink-0 text-callout text-muted-foreground">{note}</span>}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
