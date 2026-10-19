"use client";

import type { PlaylistFolder } from "@scoutable/shared/types/match";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TOP_LEVEL_NAME } from "./folder-nav";

export interface DeleteFolderRequest {
  folder: PlaylistFolder;
  /** subtreeStats: folders under it, playlists anywhere in it. */
  stats: { folderCount: number; playlistCount: number };
}

/**
 * What deleting a folder does, in the database's own terms: the folders
 * inside it go with it (parent_id ON DELETE CASCADE) and every playlist in
 * any of them moves to the top level (playlists.folder_id ON DELETE SET
 * NULL), its clips and sharing untouched.
 */
export function deleteFolderConsequences(stats: DeleteFolderRequest["stats"]): string {
  const parts: string[] = [];
  const { folderCount: folders, playlistCount: playlists } = stats;
  if (folders > 0) {
    parts.push(folders === 1 ? "The folder inside it is deleted too." : `The ${folders} folders inside it are deleted too.`);
  }
  if (playlists > 0) {
    parts.push(
      playlists === 1
        ? `Its playlist moves to the top level of ${TOP_LEVEL_NAME}; its clips and sharing don’t change.`
        : `Its ${playlists} playlists move to the top level of ${TOP_LEVEL_NAME}; their clips and sharing don’t change.`,
    );
  }
  parts.push("This can’t be undone.");
  return parts.join(" ");
}

/**
 * The confirmation before deleting a folder that has something in it (an
 * empty one goes at once, with Undo in its toast): it says what happens to
 * the folders and playlists inside, and offers the destructive action last.
 */
export function DeleteFolderDialog({
  open,
  request,
  onClose,
  onConfirm,
}: {
  open: boolean;
  request: DeleteFolderRequest | null;
  onClose: () => void;
  onConfirm: (folder: PlaylistFolder) => void;
}) {
  return (
    <ConfirmDialog
      open={open && request !== null}
      onOpenChange={(next) => !next && onClose()}
      title={`Delete “${request?.folder.name ?? ""}”?`}
      description={request ? deleteFolderConsequences(request.stats) : undefined}
      confirmLabel="Delete folder"
      destructive
      onConfirm={() => {
        if (request) onConfirm(request.folder);
        onClose();
      }}
    />
  );
}
