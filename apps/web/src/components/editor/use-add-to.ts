"use client";

/**
 * Copying clips into another of the user's playlists, the desktop's "Add
 * to": the candidates are the user's own playlists in this playlist's space
 * (read as the popover opens, each described by its folder's path); the
 * target is read again just before the copy so its clips and clip length are
 * current; the copies keep their length on the target's pair and go on the
 * end; a shared target has the server cut its new clips (the M3a rule: ship
 * only when shared). A playlist named in the search is made in this one's
 * folder, as the desktop does.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { folderPathNames, placedFolderId } from "@scoutable/shared/lib/folder-tree";
import { shipPlaylist } from "@scoutable/shared/lib/game-video-client";
import { clipsForCopy, pinnedPair } from "@scoutable/shared/lib/playlist-edits";
import { addClips, createPlaylist, getPlaylist, listPlaylists, updatePlaylist } from "@scoutable/shared/lib/playlists-db";
import { isClipItem, type Playlist, type PlaylistClipItem, type PlaylistFolder } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import type { AddToCandidate } from "./add-to-popover";

const RETRY = "Check your connection and try again.";

function clipsWord(n: number): string {
  return n === 1 ? "clip" : "clips";
}

/** A clip's own length goes with it as offsets; on a playlist that never saved its pair, the pair is saved first (the pin rule). */
async function pinIfNeeded(target: Playlist, copies: readonly PlaylistClipItem[]): Promise<void> {
  const pin = copies.some((c) => (c.preRollOffset ?? 0) !== 0 || (c.postRollOffset ?? 0) !== 0) ? pinnedPair(target) : null;
  if (pin) await updatePlaylist(createClient(), target.id, { preRoll: pin.pre, postRoll: pin.post });
}

export function useAddTo({ playlist, folders }: { playlist: Playlist | null; folders: readonly PlaylistFolder[] }) {
  const router = useRouter();
  const { activeOrgId, activeOrgIsPersonal } = useAuth();
  const orgId = playlist?.orgId ?? activeOrgId ?? undefined;
  const includeUnscoped = !playlist?.orgId || activeOrgIsPersonal;
  const listKey = playlist ? `${playlist.id}|${orgId ?? ""}|${includeUnscoped}` : null;
  const [lists, setLists] = useState<{ key: string; playlists: Playlist[] } | null>(null);

  // The playlist as it is when a copy runs, not as it was when the popover opened.
  const playlistRef = useRef(playlist);
  useLayoutEffect(() => {
    playlistRef.current = playlist;
  });

  /** Reads the candidates again (each time the popover opens: a playlist made elsewhere shows up). */
  const load = useCallback(() => {
    if (!listKey) return;
    void listPlaylists(createClient(), orgId, { includeUnscoped }).then((rows) => setLists({ key: listKey, playlists: rows }));
  }, [listKey, orgId, includeUnscoped]);

  const paths = useMemo(() => folderPathNames([...folders]), [folders]);
  const knownFolders = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const candidates = useMemo<AddToCandidate[] | null>(() => {
    if (!lists || lists.key !== listKey) return null;
    return lists.playlists
      .filter((p) => p.id !== playlist?.id)
      .map((p) => {
        const folderId = placedFolderId(knownFolders, p.folderId);
        return {
          playlist: p,
          path: folderId ? (paths.get(folderId) ?? []).join(" / ") || null : null,
          clipCount: p.items.filter(isClipItem).length,
        };
      });
  }, [lists, listKey, playlist?.id, knownFolders, paths]);

  /** The candidate list after clips landed in `target` (its count), or with a new playlist on top. */
  const remember = useCallback(
    (target: Playlist, copies: readonly PlaylistClipItem[]) => {
      setLists((prev) => {
        if (!prev || prev.key !== listKey) return prev;
        const at = prev.playlists.findIndex((p) => p.id === target.id);
        const next = { ...target, items: [...target.items, ...copies] };
        return { ...prev, playlists: at < 0 ? [next, ...prev.playlists] : prev.playlists.map((p, i) => (i === at ? next : p)) };
      });
    },
    [listKey],
  );

  const open = useCallback((target: Playlist) => ({ label: "Open", onClick: () => router.push(`/playlists/${encodeURIComponent(target.id)}`) }), [router]);

  /** The server cuts the new clips for the people the target is shared with; a project without a renderer stays quiet. */
  const ship = useCallback(function ship(target: Playlist) {
    void shipPlaylist(createClient(), target.id).then((result) => {
      if (result.ok || result.error === "renderer_unavailable") return;
      toast.error(`Couldn't prepare the clips in “${target.name}”`, {
        description: "The people it's shared with don't see the new clips yet.",
        action: { label: "Try again", onClick: () => ship(target) },
      });
    });
  }, []);

  /** Copies the clips under `keys` (cards stay) into `target`; true once they are in, or were already. */
  const add = useCallback(
    async (target: Playlist, keys: ReadonlySet<string>): Promise<boolean> => {
      const source = playlistRef.current;
      if (!source) return false;
      const supabase = createClient();
      const fresh = await getPlaylist(supabase, target.id);
      if (!fresh) {
        toast.error("Couldn't add the clips", { description: RETRY });
        return false;
      }
      const picked = source.items.filter((i) => isClipItem(i) && keys.has(`${i.matchId}:${i.eventId}`)).length;
      const copies = clipsForCopy(source, keys, fresh);
      if (copies.length === 0) {
        toast(`Already in “${fresh.name}”`, { action: open(fresh) });
        return true;
      }
      try {
        await pinIfNeeded(fresh, copies);
        await addClips(supabase, fresh.id, copies, fresh.items.length);
      } catch {
        toast.error("Couldn't add the clips", { description: RETRY });
        return false;
      }
      for (const clip of copies) trackEvent("clip_added_to_playlist", { playlist_id: fresh.id, match_id: clip.matchId, origin: "web" });
      remember(fresh, copies);
      if ((fresh.teamIds?.length ?? 0) + (fresh.userIds?.length ?? 0) > 0) ship(fresh);
      const skipped = picked - copies.length;
      toast.success(copies.length === 1 ? `Clip added to “${fresh.name}”` : `${copies.length} clips added to “${fresh.name}”`, {
        description: skipped > 0 ? `${skipped} ${skipped === 1 ? "was" : "were"} there already.` : undefined,
        action: open(fresh),
      });
      return true;
    },
    [open, remember, ship],
  );

  /** A new playlist of that name, in this playlist's folder, with the clips under `keys`; true once it exists with them. */
  const create = useCallback(
    async (name: string, keys: ReadonlySet<string>): Promise<boolean> => {
      const source = playlistRef.current;
      if (!source) return false;
      const supabase = createClient();
      let created: Playlist;
      try {
        created = await createPlaylist(supabase, name, source.folderId, source.orgId ?? activeOrgId ?? undefined);
      } catch {
        toast.error("Couldn't create the playlist", { description: RETRY });
        return false;
      }
      trackEvent("playlist_created", { origin: "web", playlist_id: created.id, in_folder: !!source.folderId });
      const copies = clipsForCopy(source, keys, created);
      try {
        await pinIfNeeded(created, copies);
        await addClips(supabase, created.id, copies, 0);
      } catch {
        // The playlist is there now: it stays in the list to add to again.
        remember(created, []);
        toast.error(`Couldn't add the clips to “${name}”`, { description: "The playlist was created. Try adding them again." });
        return false;
      }
      for (const clip of copies) trackEvent("clip_added_to_playlist", { playlist_id: created.id, match_id: clip.matchId, origin: "web" });
      remember(created, copies);
      toast.success(`Created “${name}” and added the ${clipsWord(copies.length)}`, { action: open(created) });
      return true;
    },
    [activeOrgId, open, remember],
  );

  return { candidates, load, add, create };
}

export type UseAddTo = ReturnType<typeof useAddTo>;
