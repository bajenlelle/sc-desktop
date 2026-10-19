"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { collectSubtreeIds, wouldCreateCycle } from "@scoutable/shared/lib/folder-tree";
import { createFolder, deleteFolder, updateFolder } from "@scoutable/shared/lib/matches-db";
import { updatePlaylist } from "@scoutable/shared/lib/playlists-db";
import type { Playlist, PlaylistFolder } from "@scoutable/shared/types/match";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { isPendingFolder, PENDING_FOLDER_PREFIX, TOP_LEVEL_NAME } from "./folder-nav";

/** How a move was asked for, for analytics: a drag, Move to…, or a toast's Undo. */
export type MoveVia = "drag" | "menu" | "undo";

export interface FolderOps {
  /** A folder inside `parentId` (null: the top level), shown at once and saved behind it. */
  createFolder: (name: string, parentId: string | null) => void;
  renameFolder: (id: string, name: string) => void;
  moveFolder: (id: string, parentId: string | null, via: MoveVia) => void;
  /**
   * The folder and everything under it; the playlists inside move to the top
   * level, as the database does. `undoable` (an empty folder) offers Undo.
   */
  deleteFolder: (id: string, opts?: { undoable?: boolean }) => void;
  movePlaylist: (id: string, folderId: string | null, via: MoveVia) => void;
  /**
   * The React key for a folder row: a folder created here keeps the key it
   * had while it was being saved, so its row doesn't leave and arrive again
   * when the database hands back the real id.
   */
  rowKey: (folderId: string) => string;
}

/** The database's refusals in words (the triggers' tokens); null for anything else. */
function reasonFor(e: unknown): string | null {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("folder_cycle")) return "A folder can’t go inside itself.";
  if (message.includes("folder_org_mismatch") || message.includes("parent_org_mismatch")) return "That folder belongs to another space.";
  if (message.includes("folder_too_deep")) return "Folders can’t be nested that deep.";
  return null;
}

/**
 * Every folder change on the Playlists page, optimistic as the rest of the
 * web: the lists change at once, the write follows, and a failed write puts
 * things back with a toast that says so (and offers Try again). Moves and
 * deleting an empty folder offer Undo in their toast. Writes go through the
 * shared helpers under the owner's RLS, as the desktop's do.
 */
export function useFolderOps({
  orgId,
  folders,
  playlists,
  setFolders,
  setPlaylists,
}: {
  orgId: string | null;
  folders: PlaylistFolder[];
  playlists: Playlist[] | null;
  setFolders: Dispatch<SetStateAction<PlaylistFolder[]>>;
  setPlaylists: Dispatch<SetStateAction<Playlist[] | null>>;
}): FolderOps {
  // The latest lists, for operations that run after the render they were made in.
  const latest = useRef({ orgId, folders, playlists });
  useLayoutEffect(() => {
    latest.current = { orgId, folders, playlists };
  });
  // Real id -> the pending id its row was keyed by.
  const [aliases, setAliases] = useState<ReadonlyMap<string, string>>(new Map());

  const ops = useMemo(() => {
    const nameOf = (folderId: string | null) =>
      folderId === null ? TOP_LEVEL_NAME : (latest.current.folders.find((f) => f.id === folderId)?.name ?? "the folder");

    function create(name: string, parentId: string | null, restoring = false) {
      const scope = latest.current.orgId ?? undefined;
      const pending: PlaylistFolder = {
        id: `${PENDING_FOLDER_PREFIX}${crypto.randomUUID()}`,
        name,
        sortOrder: 0,
        parentId: parentId ?? undefined,
        orgId: scope,
      };
      setFolders((prev) => [...prev, pending]);
      createFolder(createClient(), name, parentId ?? undefined, scope)
        .then((folder) => {
          setAliases((prev) => new Map(prev).set(folder.id, pending.id));
          setFolders((prev) => prev.map((f) => (f.id === pending.id ? folder : f)));
          if (!restoring) trackEvent("folder_created", { nested: parentId !== null, origin: "web" });
        })
        .catch((e) => {
          console.error("[playlists] create folder failed", e);
          setFolders((prev) => prev.filter((f) => f.id !== pending.id));
          toast.error("Couldn't create the folder", {
            description: reasonFor(e) ?? `“${name}” wasn’t saved.`,
            action: { label: "Try again", onClick: () => create(name, parentId, restoring) },
          });
        });
    }

    function rename(id: string, name: string) {
      const folder = latest.current.folders.find((f) => f.id === id);
      if (!folder || folder.name === name || isPendingFolder(id)) return;
      const before = folder.name;
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
      updateFolder(createClient(), id, { name }).catch((e) => {
        console.error("[playlists] rename folder failed", e);
        setFolders((prev) => prev.map((f) => (f.id === id && f.name === name ? { ...f, name: before } : f)));
        toast.error("Couldn't rename the folder", {
          description: reasonFor(e) ?? `It’s still called “${before}”.`,
          action: { label: "Try again", onClick: () => rename(id, name) },
        });
      });
    }

    function moveFolder(id: string, parentId: string | null, via: MoveVia) {
      const { folders: all } = latest.current;
      const folder = all.find((f) => f.id === id);
      if (!folder || isPendingFolder(id)) return;
      const from = folder.parentId ?? null;
      if (from === parentId) return;
      if (wouldCreateCycle(all, id, parentId)) {
        toast.error("A folder can’t go inside itself");
        return;
      }
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, parentId: parentId ?? undefined } : f)));
      const shown =
        via === "undo"
          ? undefined
          : toast(`“${folder.name}” moved to ${nameOf(parentId)}`, {
              action: { label: "Undo", onClick: () => moveFolder(id, from, "undo") },
            });
      updateFolder(createClient(), id, { parentId })
        .then(() => trackEvent("folder_moved", { via, to_top_level: parentId === null, origin: "web" }))
        .catch((e) => {
          console.error("[playlists] move folder failed", e);
          if (shown !== undefined) toast.dismiss(shown);
          setFolders((prev) =>
            prev.map((f) => (f.id === id && (f.parentId ?? null) === parentId ? { ...f, parentId: from ?? undefined } : f)),
          );
          toast.error(`Couldn't move “${folder.name}”`, {
            description: reasonFor(e) ?? "It’s back where it was.",
            action: { label: "Try again", onClick: () => moveFolder(id, parentId, via) },
          });
        });
    }

    function remove(id: string, opts?: { undoable?: boolean }) {
      const { folders: all, playlists: lists } = latest.current;
      const folder = all.find((f) => f.id === id);
      if (!folder || isPendingFolder(id)) return;
      // The database's cascade: the subtree goes, its playlists move to the top level.
      const ids = collectSubtreeIds(all, id);
      const removed = all.filter((f) => ids.has(f.id));
      const moved = new Map<string, string>();
      for (const p of lists ?? []) if (p.folderId !== undefined && ids.has(p.folderId)) moved.set(p.id, p.folderId);
      setFolders((prev) => prev.filter((f) => !ids.has(f.id)));
      setPlaylists((prev) => prev?.map((p) => (p.folderId !== undefined && ids.has(p.folderId) ? { ...p, folderId: undefined } : p)) ?? prev);
      const shown = opts?.undoable
        ? toast(`“${folder.name}” deleted`, {
            // It was empty, so a folder of the same name in the same place is all there is to bring back.
            action: { label: "Undo", onClick: () => create(folder.name, folder.parentId ?? null, true) },
          })
        : undefined;
      deleteFolder(createClient(), id)
        .then(() => trackEvent("folder_deleted", { subfolders: removed.length - 1, playlists: moved.size, origin: "web" }))
        .catch((e) => {
          console.error("[playlists] delete folder failed", e);
          if (shown !== undefined) toast.dismiss(shown);
          setFolders((prev) => [...prev.filter((f) => !ids.has(f.id)), ...removed]);
          setPlaylists(
            (prev) => prev?.map((p) => (moved.has(p.id) && p.folderId === undefined ? { ...p, folderId: moved.get(p.id) } : p)) ?? prev,
          );
          toast.error(`Couldn't delete “${folder.name}”`, { description: reasonFor(e) ?? "It’s back, with everything that was in it." });
        });
    }

    function movePlaylist(id: string, folderId: string | null, via: MoveVia) {
      const playlist = latest.current.playlists?.find((p) => p.id === id);
      if (!playlist || (folderId !== null && isPendingFolder(folderId))) return;
      const from = playlist.folderId ?? null;
      if (from === folderId) return;
      setPlaylists((prev) => prev?.map((p) => (p.id === id ? { ...p, folderId: folderId ?? undefined } : p)) ?? prev);
      const shown =
        via === "undo"
          ? undefined
          : toast(`“${playlist.name}” moved to ${nameOf(folderId)}`, {
              action: { label: "Undo", onClick: () => movePlaylist(id, from, "undo") },
            });
      updatePlaylist(createClient(), id, { folderId })
        .then(() => trackEvent("playlist_moved", { playlist_id: id, via, to_top_level: folderId === null, origin: "web" }))
        .catch((e) => {
          console.error("[playlists] move playlist failed", e);
          if (shown !== undefined) toast.dismiss(shown);
          setPlaylists(
            (prev) => prev?.map((p) => (p.id === id && (p.folderId ?? null) === folderId ? { ...p, folderId: from ?? undefined } : p)) ?? prev,
          );
          toast.error(`Couldn't move “${playlist.name}”`, {
            description: reasonFor(e) ?? "It’s back where it was.",
            action: { label: "Try again", onClick: () => movePlaylist(id, folderId, via) },
          });
        });
    }

    return {
      createFolder: (name: string, parentId: string | null) => create(name, parentId),
      renameFolder: rename,
      moveFolder,
      deleteFolder: remove,
      movePlaylist,
    };
  }, [setFolders, setPlaylists]);

  const rowKey = useCallback((folderId: string) => aliases.get(folderId) ?? folderId, [aliases]);

  return useMemo(() => ({ ...ops, rowKey }), [ops, rowKey]);
}
