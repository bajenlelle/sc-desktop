"use client";

import { useState } from "react";
import type { PlaylistFolder } from "@scoutable/shared/types/match";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TOP_LEVEL_NAME } from "./folder-nav";

/** What the dialog is for: a new folder inside `parent` (null: the top level), or renaming one. */
export type FolderNameRequest =
  | { mode: "create"; parent: PlaylistFolder | null }
  | { mode: "rename"; folder: PlaylistFolder };

const MAX_NAME_LENGTH = 120;

/**
 * Naming a folder: one field, Return saves, Escape cancels. The write is the
 * caller's (optimistic: the dialog closes at once and the list shows the
 * result; a failure puts things back with a toast).
 */
export function FolderNameDialog({
  open,
  request,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Kept while the dialog leaves, so it closes as it was. */
  request: FolderNameRequest | null;
  onClose: () => void;
  onSubmit: (request: FolderNameRequest, name: string) => void;
}) {
  // What the user has typed, for the request it was typed for: another
  // request opens on its own starting name, with no state to sync.
  const [draft, setDraft] = useState<{ request: FolderNameRequest; name: string } | null>(null);
  const initial = request?.mode === "rename" ? request.folder.name : "";
  const name = request && draft?.request === request ? draft.name : initial;
  const trimmed = name.trim();

  function submit() {
    if (!open || !request || !trimmed) return;
    if (request.mode === "rename" && trimmed === request.folder.name) {
      onClose();
      return;
    }
    onSubmit(request, trimmed);
    onClose();
  }

  const creating = request?.mode === "create";
  const where = request?.mode === "create" ? (request.parent?.name ?? TOP_LEVEL_NAME) : null;

  return (
    <Dialog open={open && request !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{creating ? "New folder" : "Rename folder"}</DialogTitle>
            {creating ? (
              <DialogDescription>In {where}</DialogDescription>
            ) : (
              <DialogDescription className="sr-only">Type a new name for the folder.</DialogDescription>
            )}
          </DialogHeader>
          <Input
            aria-label="Folder name"
            placeholder="Folder name"
            value={name}
            onChange={(e) => request && setDraft({ request, name: e.target.value })}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            maxLength={MAX_NAME_LENGTH}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              {creating ? "Create folder" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
