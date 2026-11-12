import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { heldForPlayers, playlistIsShared } from "@scoutable/shared/lib/playlist-sharing";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { isClipItem, type Playlist, type PlaylistClipItem, type PlaylistItem, type StoredMatch } from "@/types/match";
import { trackEvent } from "@/lib/analytics";
import { appendClips, createPlaylist, listPlaylists, writePlaylistItems } from "@/lib/playlists-db";
import { getCollectTarget, setAddClipsScope, setCollectTarget } from "@/lib/prefs";
import { Sentry } from "@/lib/sentry";

/** Where an add came from: a row's plus, the Now bar (or A), "Add all", a row's menu, or the selected plays. */
export type CollectVia = "row" | "now_bar" | "bulk" | "menu" | "selection";

/** One toast for the whole view: the latest add replaces the one before, and its Undo is the only one on offer. */
const COLLECT_TOAST = "game-collect";

/**
 * Collecting a game's plays into a playlist from the game view: one target,
 * chosen once, then one press per play.
 *
 * Every add shows at once and is written behind it, one write after another
 * per playlist, so plays added in quick succession land in the order they
 * were pressed. A failed write is taken back and said. Undo (the toast's, or
 * a row's menu) removes what this visit added: a clip that was in the
 * playlist before may carry notes, a trim or an upload, and this view has no
 * history to put those back from.
 *
 * A row's menu adds to any playlist once (`addToPlaylist`, `createAndAddTo`)
 * without changing the target.
 *
 * Nothing is cut or uploaded here. When players already have a playlist, the
 * new clips are held: `held` counts them per shared playlist and
 * `openPlaylist` hands one to the editor with its upload-on-arrival state.
 */
export function useCollect({
  match,
  orgId,
  includeUnscoped,
}: {
  match: Pick<StoredMatch, "id" | "title">;
  orgId: string | null;
  includeUnscoped: boolean;
}) {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [targetId, setTargetId] = useState<string | null>(() => getCollectTarget(match.id));
  const [pickerOpen, setPickerOpenState] = useState(false);
  /** The control that asked for the picker (a row's plus, the Now bar's Add): it opens from there. Null: from its own button. */
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  /** `${playlistId}|${clipKey}` of every clip this visit added. */
  const [addedHere, setAddedHere] = useState<ReadonlySet<string>>(() => new Set());
  const [addedTotal, setAddedTotal] = useState(0);
  const pendingRef = useRef<{ plays: readonly TimedPlay[]; via: CollectVia; moment: string | null } | null>(null);
  /** What the server holds for each playlist: the base every write goes from. */
  const saved = useRef(new Map<string, PlaylistItem[]>());
  const chains = useRef(new Map<string, Promise<void>>());
  const saidHeld = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPlaylists(null);
    void listPlaylists(orgId ?? undefined, { includeUnscoped })
      .then((list) => {
        if (cancelled) return;
        saved.current = new Map(list.map((p) => [p.id, p.items]));
        setPlaylists(list);
      })
      .catch(() => {
        if (!cancelled) setPlaylists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, includeUnscoped]);

  const target = useMemo(() => playlists?.find((p) => p.id === targetId) ?? null, [playlists, targetId]);

  // A remembered playlist that is gone (deleted, or in another space) is forgotten.
  useEffect(() => {
    if (playlists && targetId && !playlists.some((p) => p.id === targetId)) {
      setTargetId(null);
      setCollectTarget(match.id, null);
    }
  }, [playlists, targetId, match.id]);

  const mutate = useCallback((playlistId: string, change: (items: PlaylistItem[]) => PlaylistItem[]) => {
    setPlaylists((prev) => prev?.map((p) => (p.id === playlistId ? { ...p, items: change(p.items) } : p)) ?? prev);
  }, []);

  const enqueue = useCallback((playlistId: string, job: () => Promise<void>) => {
    const next = (chains.current.get(playlistId) ?? Promise.resolve()).then(job).catch(() => {});
    chains.current.set(playlistId, next);
  }, []);

  const undo = useCallback(
    (playlist: Pick<Playlist, "id" | "name">, keys: readonly string[], via: "toast" | "row") => {
      const gone = new Set(keys);
      const isGone = (i: PlaylistItem) => isClipItem(i) && gone.has(itemKey(i));
      let removed: PlaylistItem[] = [];
      mutate(playlist.id, (items) => {
        removed = items.filter(isGone);
        return items.filter((i) => !isGone(i));
      });
      setAddedHere((prev) => new Set([...prev].filter((k) => !gone.has(k.slice(playlist.id.length + 1)))));
      enqueue(playlist.id, async () => {
        const base = saved.current.get(playlist.id) ?? [];
        const without = base.filter((i) => !isGone(i));
        if (without.length === base.length) return; // the add itself never reached the server
        try {
          await writePlaylistItems(playlist.id, base, without);
          saved.current.set(playlist.id, without);
          setAddedTotal((n) => Math.max(0, n - (base.length - without.length)));
          trackEvent("collect_undone", { via, clips: base.length - without.length });
        } catch (e) {
          Sentry.captureException(e);
          mutate(playlist.id, (items) => [...items, ...removed]);
          setAddedHere((prev) => new Set([...prev, ...keys.map((k) => `${playlist.id}|${k}`)]));
          toast.error("Couldn't remove the clip", { id: COLLECT_TOAST, description: "Check the connection and try again." });
        }
      });
      toast(keys.length === 1 ? `Removed from ${playlist.name}` : `${keys.length} clips removed from ${playlist.name}`, {
        id: COLLECT_TOAST,
        duration: 3000,
      });
    },
    [mutate, enqueue],
  );

  /** Adds plays to one playlist. Never touches the target: the target's adds and a menu's one-time adds both come through here. */
  const addToPlaylist = useCallback(
    (playlist: Playlist, plays: readonly TimedPlay[], via: CollectVia, moment: string | null) => {
      const present = new Set(playlist.items.filter(isClipItem).map(itemKey));
      const fresh: PlaylistClipItem[] = [];
      for (const p of plays) {
        if (present.has(p.key)) continue;
        present.add(p.key);
        fresh.push({ type: "clip", matchId: match.id, eventId: p.event.eventId });
      }
      if (fresh.length === 0) {
        toast(plays.length === 1 ? `Already in ${playlist.name}` : `All ${plays.length} are already in ${playlist.name}`, {
          id: COLLECT_TOAST,
          duration: 2000,
        });
        return;
      }
      const keys = fresh.map(itemKey);
      mutate(playlist.id, (items) => [...items, ...fresh]);
      setAddedHere((prev) => new Set([...prev, ...keys.map((k) => `${playlist.id}|${k}`)]));
      enqueue(playlist.id, async () => {
        const base = saved.current.get(playlist.id) ?? [];
        try {
          const added = await appendClips({ id: playlist.id, items: base }, fresh);
          saved.current.set(playlist.id, [...base, ...added]);
          setAddedTotal((n) => n + added.length);
          for (const clip of added) {
            trackEvent("clip_added_to_playlist", {
              playlist_id: playlist.id,
              match_id: clip.matchId,
              surface: "game_view",
              via,
              moment,
              to_target: playlist.id === targetId,
            });
          }
          // The editor's Add clips starts on this game next time.
          setAddClipsScope(playlist.id, { gameId: match.id, teams: [] });
        } catch (e) {
          Sentry.captureException(e);
          const failed = new Set(keys);
          mutate(playlist.id, (items) => items.filter((i) => !(isClipItem(i) && failed.has(itemKey(i)))));
          setAddedHere((prev) => new Set([...prev].filter((k) => !failed.has(k.slice(playlist.id.length + 1)))));
          toast.error(fresh.length === 1 ? "Couldn't add the clip" : "Couldn't add the clips", {
            id: COLLECT_TOAST,
            description: "Check the connection and try again.",
          });
        }
      });
      // Players already have this playlist: say once that new clips wait for the coach.
      const sayHeld = playlistIsShared(playlist) && !saidHeld.current;
      if (sayHeld) saidHeld.current = true;
      toast(fresh.length === 1 ? `Added to ${playlist.name}` : `${fresh.length} clips added to ${playlist.name}`, {
        id: COLLECT_TOAST,
        // Sonner's own description grey is unreadable on the dark themes.
        description: sayHeld ? createElement("span", { className: "text-muted-foreground" }, "Players see new clips once you send them.") : undefined,
        action: { label: "Undo", onClick: () => undo(playlist, keys, "toast") },
      });
    },
    [match.id, targetId, mutate, enqueue, undo],
  );

  /**
   * Adds plays to the target; with none chosen yet, opens the picker (from
   * `anchor`, the control that was pressed) and adds them once one is.
   */
  const add = useCallback(
    (plays: readonly TimedPlay[], via: CollectVia, moment: string | null = null, anchor: HTMLElement | null = null) => {
      if (plays.length === 0) return;
      if (target) {
        addToPlaylist(target, plays, via, moment);
        return;
      }
      pendingRef.current = { plays, via, moment };
      setPickerAnchor(anchor);
      setPickerOpenState(true);
    },
    [target, addToPlaylist],
  );

  /** The picker's own button and its dismissal: opened here it belongs to that button, and closing drops what was waiting. */
  const setPickerOpen = useCallback((open: boolean) => {
    if (!open) pendingRef.current = null;
    else setPickerAnchor(null);
    setPickerOpenState(open);
  }, []);

  const chooseTarget = useCallback(
    (playlist: Playlist, source: "existing" | "new") => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      setTargetId(playlist.id);
      setCollectTarget(match.id, playlist.id);
      setPickerOpenState(false);
      trackEvent("collect_target_set", { source, shared: playlistIsShared(playlist), via: pending?.via ?? "toolbar" });
      if (pending) addToPlaylist(playlist, pending.plays, pending.via, pending.moment);
    },
    [match.id, addToPlaylist],
  );

  const createTarget = useCallback(
    async (name: string) => {
      const created = await createPlaylist(name, undefined, orgId ?? undefined);
      trackEvent("playlist_created", { playlist_id: created.id, in_folder: false, surface: "game_view" });
      saved.current.set(created.id, []);
      setPlaylists((prev) => [created, ...(prev ?? [])]);
      chooseTarget(created, "new");
    },
    [orgId, chooseTarget],
  );

  /** A new playlist with these plays in it, once: the target stays as it is. Throws when the create fails. */
  const createAndAddTo = useCallback(
    async (name: string, plays: readonly TimedPlay[], via: CollectVia, moment: string | null) => {
      const created = await createPlaylist(name, undefined, orgId ?? undefined);
      trackEvent("playlist_created", { playlist_id: created.id, in_folder: false, surface: "game_view" });
      saved.current.set(created.id, []);
      setPlaylists((prev) => [created, ...(prev ?? [])]);
      addToPlaylist(created, plays, via, moment);
    },
    [orgId, addToPlaylist],
  );

  /** The clip keys in the target, for the rows' checks. */
  const inTarget = useMemo(
    () => new Set((target?.items ?? []).filter(isClipItem).map(itemKey)),
    [target],
  );

  /** "added": this visit put it there (it can be taken back here). "in": it was there already. */
  const statusOf = useCallback(
    (key: string): "none" | "in" | "added" => {
      if (!target || !inTarget.has(key)) return "none";
      return addedHere.has(`${target.id}|${key}`) ? "added" : "in";
    },
    [target, inTarget, addedHere],
  );

  const removeAdded = useCallback(
    (play: TimedPlay) => {
      if (target && addedHere.has(`${target.id}|${play.key}`)) undo(target, [play.key], "row");
    },
    [target, addedHere, undo],
  );

  /**
   * Shared playlists whose players are waiting for clips (no uploaded file):
   * the target's, and any other holding this game's. Derived from the
   * playlists, so it survives leaving the page.
   */
  const held = useMemo(() => heldForPlayers(playlists ?? [], match.id, targetId), [playlists, match.id, targetId]);

  /** Opens a playlist in the editor; with held clips, the editor uploads them on arrival. */
  const openPlaylist = useCallback(
    (playlistId: string) => {
      const waiting = held.find((h) => h.playlist.id === playlistId);
      if (waiting) trackEvent("collect_sent", { clips: waiting.count, target: playlistId === targetId });
      navigate("/playlists", { state: { restore: { playlistId }, ...(waiting ? { reship: true } : {}) } });
    },
    [held, targetId, navigate],
  );

  const openTarget = useCallback(() => {
    if (target) openPlaylist(target.id);
  }, [target, openPlaylist]);

  /** The playlists to choose from: those that already hold this game's clips first. */
  const candidates = useMemo(() => {
    const list = playlists ?? [];
    const ofGame = (p: Playlist) => p.items.filter((i) => isClipItem(i) && i.matchId === match.id).length;
    return [...list].sort((a, b) => ofGame(b) - ofGame(a));
  }, [playlists, match.id]);

  return {
    loading: playlists === null,
    candidates,
    target,
    inTarget,
    statusOf,
    add,
    addToPlaylist,
    createAndAddTo,
    removeAdded,
    chooseTarget,
    createTarget,
    pickerOpen,
    pickerAnchor,
    setPickerOpen,
    held,
    openPlaylist,
    openTarget,
    /** How many clips this visit added (net of undos), for the closing event. */
    addedTotal,
    suggestedName: match.title,
  };
}

export type Collect = ReturnType<typeof useCollect>;
