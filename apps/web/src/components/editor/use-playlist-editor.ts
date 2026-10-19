"use client";

/**
 * The editor's data and every write it makes. The playlist is held as the
 * owner sees it after each edit (optimistic, through the shared
 * playlist-edits reducers) and put back with a toast when a write fails.
 * Games come as light rows; a game's play-by-play loads when the playlist
 * references it or the add-clips panel shows it. The owner's cloud copies
 * place each clip in its game's video (syncByMatch), and shipping is asked
 * for whenever an edit changes what recipients should see.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { moveBlock, snapGapToGroupBoundary } from "@scoutable/shared/lib/clip-groups";
import { playlistRolls, type RollPair } from "@scoutable/shared/lib/clip-timing";
import type { ExportPurpose } from "@scoutable/shared/lib/game-video-wire";
import { pickGameVideoRow, type GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { itemsIndexForGap } from "@scoutable/shared/lib/list-reorder";
import { getMatch, listEventsForMatches, listMatchesLight } from "@scoutable/shared/lib/matches-db";
import {
  appendClips,
  clampRolls,
  insertCardAt,
  itemKey,
  pinnedPair,
  removeKeys,
  restoreRemoved,
  withCardDuration,
  withCardText,
  withClipOffsets,
  withNote,
  withoutShippedFile,
} from "@scoutable/shared/lib/playlist-edits";
import { collectClipMatchIds } from "@scoutable/shared/lib/playlist-matches";
import {
  addClips as dbAddClips,
  clearShippedClip,
  deletePlaylist as dbDeletePlaylist,
  getPlaylist,
  insertTextCard,
  removeClips,
  reorderItems,
  updateClip,
  updatePlaylist,
  updateTextCard,
} from "@scoutable/shared/lib/playlists-db";
import {
  isClipItem,
  type PlayByPlayEvent,
  type Playlist,
  type PlaylistClipItem,
  type PlaylistItem,
  type PlaylistTextCard,
  type StoredMatch,
  type SyncPoint,
} from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { trackEvent } from "@/lib/analytics";
import { useMyGameVideos } from "@/lib/game-videos";
import { createClient } from "@/lib/supabase/client";
import { useShip } from "./use-ship";

export type EditorStatus = "loading" | "ready" | "missing";

/** What the URL asked the editor to do on arrival, read once and then dropped from it. */
export interface EditorIntents {
  /** `?rename=1`: a playlist just created; its name wants typing. */
  rename: boolean;
  /** `?add=<matchId>`: open the add-clips panel on that game. */
  addMatchId: string | null;
  /** `?export=download|share`: open the export dialog for that (Home's export nudge). */
  exportPurpose: ExportPurpose | null;
}

function exportIntent(value: string | null): ExportPurpose | null {
  return value === "download" || value === "share" ? value : null;
}

/** The owner's cloud copies, as the editor reads them. */
export interface EditorCloud {
  /** The row that speaks for each game the viewer has uploaded, in any state. */
  videoByMatch: Map<string, GameVideo>;
  /** Games with a ready copy: their clips play, and the server can cut them. */
  readyMatchIds: Set<string>;
  /** The sync that places a ready game's plays in its copy (a game without one can't play yet). */
  syncByMatch: Map<string, SyncPoint>;
  loaded: boolean;
}

const ROLL_SAVE_MS = 600;
/** A clip's note is saved this long after the last keystroke. */
const NOTE_SAVE_MS = 600;

export function usePlaylistEditor(playlistId: string) {
  const { user, profileLoading, activeOrgIsPersonal } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Keyed by playlist, so a navigation to another one reads as loading at
  // once, without a write at the start of the load.
  const [loaded, setLoaded] = useState<{ id: string; status: Exclude<EditorStatus, "loading"> } | null>(null);
  const status: EditorStatus = loaded?.id === playlistId ? loaded.status : "loading";
  const [playlist, setPlaylistState] = useState<Playlist | null>(null);
  const playlistRef = useRef<Playlist | null>(null);
  const setPlaylist = useCallback((next: Playlist | null) => {
    playlistRef.current = next;
    setPlaylistState(next);
  }, []);
  /** Applies a reducer to the current playlist, state and ref together, so a write that follows reads the edit. */
  const patch = useCallback(
    (fn: (p: Playlist) => Playlist) => {
      const cur = playlistRef.current;
      if (!cur) return;
      setPlaylist(fn(cur));
    },
    [setPlaylist],
  );

  const [matches, setMatches] = useState<Map<string, StoredMatch>>(() => new Map());
  const [eventsLoaded, setEventsLoaded] = useState<Set<string>>(() => new Set());
  const eventsLoadedRef = useRef<Set<string>>(new Set());
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Arrival: the URL's intents, read once and stripped
  // ---------------------------------------------------------------------------

  const [intents, setIntents] = useState<EditorIntents>(() => ({
    rename: searchParams.get("rename") === "1",
    addMatchId: searchParams.get("add"),
    exportPurpose: exportIntent(searchParams.get("export")),
  }));
  useEffect(() => {
    if (searchParams.has("rename") || searchParams.has("add") || searchParams.has("export")) router.replace(pathname, { scroll: false });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const consumeIntents = useCallback(() => setIntents({ rename: false, addMatchId: null, exportPurpose: null }), []);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const markEventsLoaded = useCallback((ids: readonly string[]) => {
    for (const id of ids) eventsLoadedRef.current.add(id);
    setEventsLoaded(new Set(eventsLoadedRef.current));
  }, []);

  // Keyed on the user's id, not the user object: every auth event (a token
  // refresh, the tab coming back) hands out a new object, and a reload here
  // would drop the plays the add-clips panel had loaded.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (profileLoading || !userId) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const pl = await getPlaylist(supabase, playlistId);
      if (cancelled) return;
      if (!pl) {
        setPlaylist(null);
        setLoaded({ id: playlistId, status: "missing" });
        return;
      }
      // The playlist's own space decides which games the picker offers; a
      // playlist from before spaces, or one in the personal space, also
      // admits legacy games without one.
      const own = await listMatchesLight(supabase, pl.orgId, {
        ownOnly: true,
        includeUnscoped: !pl.orgId || activeOrgIsPersonal,
      }).catch(() => [] as StoredMatch[]);
      if (cancelled) return;
      const map = new Map(own.map((m) => [m.id, m]));
      const referenced = collectClipMatchIds([pl]);
      const known = referenced.filter((id) => map.has(id));
      // A clip of a game someone else imported (a club game a colleague
      // added): its row and plays come separately.
      const unknown = referenced.filter((id) => !map.has(id));
      const [eventsByMatch, extra] = await Promise.all([
        listEventsForMatches(supabase, known).catch(() => ({}) as Record<string, PlayByPlayEvent[]>),
        Promise.all(unknown.map((id) => getMatch(supabase, id).catch(() => null))),
      ]);
      if (cancelled) return;
      for (const id of known) {
        const m = map.get(id);
        if (m) map.set(id, { ...m, events: eventsByMatch[id] ?? [] });
      }
      for (const m of extra) if (m) map.set(m.id, m);
      eventsLoadedRef.current = new Set([...known, ...extra.filter((m): m is StoredMatch => !!m).map((m) => m.id)]);
      setEventsLoaded(new Set(eventsLoadedRef.current));
      setMatches(map);
      setPlaylist(pl);
      setLoaded({ id: playlistId, status: "ready" });
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, profileLoading, userId, activeOrgIsPersonal, setPlaylist]);

  /** Loads the play-by-play of games the editor hasn't got yet (the picked game in the add-clips panel). */
  const ensureEventsFor = useCallback(
    async (matchIds: readonly string[]) => {
      const waits: Promise<void>[] = [];
      const need: string[] = [];
      for (const id of matchIds) {
        if (eventsLoadedRef.current.has(id)) continue;
        const inflight = inflightRef.current.get(id);
        if (inflight) waits.push(inflight);
        else need.push(id);
      }
      if (need.length > 0) {
        const supabase = createClient();
        const p = listEventsForMatches(supabase, need)
          .then((byMatch) => {
            if (!alive.current) return;
            setMatches((prev) => {
              const next = new Map(prev);
              for (const id of need) {
                const m = next.get(id);
                if (m) next.set(id, { ...m, events: byMatch[id] ?? [] });
              }
              return next;
            });
            markEventsLoaded(need);
          })
          .catch(() => {
            if (alive.current) toast.error("Couldn't load the game's plays");
          })
          .finally(() => {
            for (const id of need) inflightRef.current.delete(id);
          });
        for (const id of need) inflightRef.current.set(id, p);
        waits.push(p);
      }
      await Promise.all(waits);
    },
    [markEventsLoaded],
  );

  /** Reads the playlist again and takes the files' URLs from it, leaving local edits as they are. */
  const refreshShipped = useCallback(async () => {
    const fresh = await getPlaylist(createClient(), playlistId);
    if (!fresh || !alive.current) return;
    const urls = new Map<string, string | undefined>();
    for (const item of fresh.items) if (isClipItem(item)) urls.set(itemKey(item), item.r2Url);
    patch((p) => ({
      ...p,
      items: p.items.map((item) => {
        if (!isClipItem(item)) return item;
        const url = urls.get(itemKey(item));
        if (url === item.r2Url) return item;
        const next: PlaylistClipItem = { ...item };
        if (url) next.r2Url = url;
        else delete next.r2Url;
        return next;
      }),
    }));
  }, [playlistId, patch]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const isOwner = !!user && !!playlist && playlist.createdBy === user.id;

  const eventByKey = useMemo(() => {
    const map = new Map<string, PlayByPlayEvent>();
    for (const m of matches.values()) for (const e of m.events) map.set(`${m.id}:${e.eventId}`, e);
    return map;
  }, [matches]);

  const cloudRows = useMyGameVideos({ enabled: status === "ready" });
  const cloud = useMemo<EditorCloud>(() => {
    const byMatchRows = new Map<string, GameVideo[]>();
    for (const g of cloudRows.games ?? []) {
      const list = byMatchRows.get(g.matchId) ?? [];
      list.push(g);
      byMatchRows.set(g.matchId, list);
    }
    const videoByMatch = new Map<string, GameVideo>();
    const readyMatchIds = new Set<string>();
    const syncByMatch = new Map<string, SyncPoint>();
    for (const [matchId, rows] of byMatchRows) {
      const row = pickGameVideoRow(rows);
      if (!row) continue;
      videoByMatch.set(matchId, row);
      if (row.status !== "ready") continue;
      readyMatchIds.add(matchId);
      const sync = matches.get(matchId)?.syncPoint;
      if (sync) syncByMatch.set(matchId, sync);
    }
    return { videoByMatch, readyMatchIds, syncByMatch, loaded: cloudRows.games !== null };
  }, [cloudRows.games, matches]);

  const rolls = useMemo<RollPair>(() => playlistRolls(playlist), [playlist]);

  // ---------------------------------------------------------------------------
  // Shipping
  // ---------------------------------------------------------------------------

  const ship = useShip({
    playlistId,
    enabled: status === "ready" && isOwner,
    hasRecipients: () => {
      const p = playlistRef.current;
      return !!p && ((p.teamIds?.length ?? 0) > 0 || (p.userIds?.length ?? 0) > 0);
    },
    onDone: refreshShipped,
  });
  const { requestShip } = ship;

  /** The share dialog wrote the recipients: keep them, and have the clips cut when there are any. */
  const onShared = useCallback(
    (_target: Playlist, teamIds: string[], userIds: string[]) => {
      patch((p) => ({ ...p, teamIds, userIds, teamId: teamIds[0] }));
      if (teamIds.length > 0 || userIds.length > 0) requestShip("share");
    },
    [patch, requestShip],
  );

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  const rename = useCallback(
    async (name: string) => {
      const before = playlistRef.current;
      const next = name.trim();
      if (!before || !next || next === before.name) return;
      patch((p) => ({ ...p, name: next }));
      try {
        await updatePlaylist(createClient(), before.id, { name: next });
        trackEvent("playlist_renamed", { playlist_id: before.id });
      } catch {
        patch((p) => (p.name === next ? { ...p, name: before.name } : p));
        toast.error("Couldn't rename the playlist");
      }
    },
    [patch],
  );

  const rollTimerRef = useRef<number | null>(null);
  const setRolls = useCallback(
    (next: Partial<RollPair>) => {
      const before = playlistRef.current;
      if (!before) return;
      const current = playlistRolls(before);
      const pair = clampRolls(next.pre ?? current.pre, next.post ?? current.post);
      if (pair.pre === current.pre && pair.post === current.post && before.preRoll !== undefined) return;
      patch((p) => ({ ...p, preRoll: pair.pre, postRoll: pair.post }));
      if (rollTimerRef.current !== null) window.clearTimeout(rollTimerRef.current);
      rollTimerRef.current = window.setTimeout(() => {
        rollTimerRef.current = null;
        updatePlaylist(createClient(), before.id, { preRoll: pair.pre, postRoll: pair.post })
          .then(() => {
            trackEvent("playlist_clip_length_changed", { playlist_id: before.id, pre: pair.pre, post: pair.post });
            // Recipients get the new length: stale cuts are replaced in place.
            requestShip("rolls");
          })
          .catch(() => {
            patch((p) => ({ ...p, preRoll: before.preRoll, postRoll: before.postRoll }));
            toast.error("Couldn't save the clip length");
          });
      }, ROLL_SAVE_MS);
    },
    [patch, requestShip],
  );

  const addClips = useCallback(
    async (clips: readonly PlaylistClipItem[]) => {
      const before = playlistRef.current;
      if (!before) return;
      const { playlist: next, added } = appendClips(before, clips);
      if (added.length === 0) {
        toast("Already in this playlist");
        return;
      }
      setPlaylist(next);
      try {
        await dbAddClips(createClient(), before.id, added, before.items.length);
      } catch {
        const addedKeys = new Set(added.map(itemKey));
        patch((p) => ({ ...p, items: p.items.filter((i) => !addedKeys.has(itemKey(i))) }));
        toast.error("Couldn't add the clips", { description: "Check your connection and try again." });
        return;
      }
      for (const clip of added) trackEvent("clip_added_to_playlist", { playlist_id: before.id, match_id: clip.matchId, origin: "web" });
      requestShip("add");
    },
    [patch, setPlaylist, requestShip],
  );

  /** A text card before the item under `beforeKey` (or at the end); answers the new card's id for the row to focus. */
  const insertCard = useCallback(
    async (beforeKey: string | null, entry: "menu" | "row"): Promise<string | null> => {
      const before = playlistRef.current;
      if (!before) return null;
      const card: PlaylistTextCard = { type: "text", id: crypto.randomUUID(), text: "", durationSeconds: 5 };
      const next = insertCardAt(before, card, beforeKey);
      const position = next.items.findIndex((i) => i === card);
      setPlaylist(next);
      try {
        const supabase = createClient();
        await insertTextCard(supabase, before.id, card.id, card.text, card.durationSeconds, position);
        await reorderItems(supabase, before.id, next.items);
      } catch {
        patch((p) => ({ ...p, items: p.items.filter((i) => isClipItem(i) || i.id !== card.id) }));
        toast.error("Couldn't add the card", { description: "Check your connection and try again." });
        return null;
      }
      trackEvent("text_card_inserted", { entry, origin: "web" });
      return card.id;
    },
    [patch, setPlaylist],
  );

  const updateCard = useCallback(
    async (cardId: string, change: { text?: string; durationSeconds?: number }) => {
      const before = playlistRef.current;
      if (!before) return;
      const was = before.items.find((i): i is PlaylistTextCard => !isClipItem(i) && i.id === cardId);
      if (!was) return;
      patch((p) => {
        let next = p;
        if (change.text !== undefined) next = withCardText(next, cardId, change.text);
        if (change.durationSeconds !== undefined) next = withCardDuration(next, cardId, change.durationSeconds);
        return next;
      });
      try {
        await updateTextCard(createClient(), before.id, cardId, change);
      } catch {
        patch((p) => ({ ...p, items: p.items.map((i) => (!isClipItem(i) && i.id === cardId ? was : i)) }));
        toast.error("Couldn't save the card");
      }
    },
    [patch],
  );

  /** Removals waiting for their toast to close; left-over ones are written when the editor goes. */
  const pendingCommitsRef = useRef<Set<() => void>>(new Set());
  useEffect(
    () => () => {
      for (const commit of pendingCommitsRef.current) commit();
      pendingCommitsRef.current.clear();
    },
    [],
  );

  /**
   * Removes the items under `keys` at once and offers Undo for the life of
   * the toast; the rows leave the server only once it is gone. A group a
   * removal broke dissolves with it (normalizeGroups), which the reorder
   * write records.
   */
  const removeItems = useCallback(
    (keys: ReadonlySet<string>) => {
      const before = playlistRef.current;
      if (!before || keys.size === 0) return;
      const { playlist: next, removed } = removeKeys(before, keys);
      if (removed.length === 0) return;
      const survivors = before.items.filter((i) => !keys.has(itemKey(i)));
      const groupsChanged = next.items.some((it, i) => it !== survivors[i]);
      setPlaylist(next);
      const clipKeys = removed
        .map((r) => r.item)
        .filter(isClipItem)
        .map((c) => ({ matchId: c.matchId, eventId: c.eventId }));
      const cardIds = removed.map((r) => r.item).filter((i): i is PlaylistTextCard => !isClipItem(i)).map((c) => c.id);
      const count = removed.length;
      let undone = false;
      let committed = false;
      const commit = () => {
        pendingCommitsRef.current.delete(commit);
        if (undone || committed) return;
        committed = true;
        trackEvent("clips_removed", { playlist_id: before.id, count, undone: false });
        void (async () => {
          const supabase = createClient();
          await removeClips(supabase, before.id, clipKeys, cardIds);
          // removeClips only deletes rows: a dissolved survivor's group_id must be written.
          if (groupsChanged) await reorderItems(supabase, before.id, next.items);
        })().catch(() => {
          if (alive.current) toast.error("Couldn't remove the items", { description: "They are back in the list." });
          patch((p) => restoreRemoved(p, removed));
        });
      };
      pendingCommitsRef.current.add(commit);
      const what = count === 1 ? (clipKeys.length === 1 ? "Clip removed" : "Text card removed") : `${count} items removed`;
      toast(what, {
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            pendingCommitsRef.current.delete(commit);
            trackEvent("clips_removed", { playlist_id: before.id, count, undone: true });
            // The pre-removal order comes back whole, groups included.
            patch((p) => restoreRemoved(p, removed));
          },
        },
        onAutoClose: commit,
        onDismiss: commit,
      });
    },
    [patch, setPlaylist],
  );

  /**
   * The lifted block lands in display gap `gap` (counted in `displayKeys`,
   * the rows as shown). Groups stay whole: a gap inside a foreign group snaps
   * to its edge. The order is written in one RPC and put back if it fails.
   */
  const reorder = useCallback(
    (gap: number, blockKeys: readonly string[], displayKeys: readonly string[], via: "pointer" | "keyboard") => {
      const before = playlistRef.current;
      if (!before || blockKeys.length === 0) return;
      const keys = before.items.map(itemKey);
      const groupIdOf = new Map<string, string>();
      for (const item of before.items) if (item.groupId) groupIdOf.set(itemKey(item), item.groupId);
      const blockSet = new Set(blockKeys);
      const itemsGap = snapGapToGroupBoundary(itemsIndexForGap(gap, displayKeys, keys), before.items, itemKey, groupIdOf, blockSet);
      const blockIndices: number[] = [];
      keys.forEach((k, i) => {
        if (blockSet.has(k)) blockIndices.push(i);
      });
      const items = moveBlock(before.items, blockIndices, itemsGap);
      if (items.every((it, i) => it === before.items[i])) return;
      const next = { ...before, items };
      setPlaylist(next);
      trackEvent("clips_reordered", { playlist_id: before.id, block_size: blockKeys.length, via });
      const write = () =>
        reorderItems(createClient(), before.id, items).catch(() => {
          toast.error("Couldn't save the new order", {
            action: { label: "Try again", onClick: () => void write() },
          });
        });
      void write();
    },
    [setPlaylist],
  );

  /**
   * The one way a clip's own length changes (a trim, Reset): applied at
   * once, saved, and put back with a toast if the save fails. The first
   * offset on a playlist without a saved pair pins the pair first, so a
   * later default can't move the clip. A file recipients already have was
   * cut at the old length: it is cleared and, in a shared playlist, cut again.
   */
  const commitClipOffsets = useCallback(
    async (key: string, pre: number, post: number) => {
      const before = playlistRef.current;
      if (!before) return;
      const clip = before.items.find((i): i is PlaylistClipItem => isClipItem(i) && itemKey(i) === key);
      if (!clip) return;
      const supabase = createClient();
      const pin = pinnedPair(before);
      if (pin) {
        patch((p) => ({ ...p, preRoll: pin.pre, postRoll: pin.post }));
        updatePlaylist(supabase, before.id, { preRoll: pin.pre, postRoll: pin.post }).catch(() => {
          // The clip's write below reports; the pin is tried again with the next offset.
        });
      }
      const shippedUrl = clip.r2Url;
      patch((p) => withoutShippedFile(withClipOffsets(p, key, { preRollOffset: pre, postRollOffset: post }), key));
      try {
        await updateClip(supabase, before.id, clip.matchId, clip.eventId, { preRollOffset: pre, postRollOffset: post });
      } catch {
        // Put back only what this change set: a later one may have landed since.
        patch((p) => ({
          ...p,
          items: p.items.map((i) =>
            isClipItem(i) && itemKey(i) === key && (i.preRollOffset ?? 0) === pre && (i.postRollOffset ?? 0) === post ? clip : i,
          ),
        }));
        toast.error("Couldn't save the clip's length");
        return;
      }
      if (!shippedUrl) {
        requestShip("trim");
        return;
      }
      const clearUpload = async () => {
        try {
          await clearShippedClip(supabase, before.id, clip.matchId, clip.eventId, shippedUrl);
          requestShip("trim");
        } catch {
          patch((p) => ({
            ...p,
            items: p.items.map((i) => (isClipItem(i) && itemKey(i) === key && !i.r2Url ? { ...i, r2Url: shippedUrl } : i)),
          }));
          toast.error("Recipients still see the old cut", {
            description: "The new length is saved, but the shared clip couldn't be replaced.",
            action: {
              label: "Try again",
              onClick: () => {
                patch((p) => withoutShippedFile(p, key));
                void clearUpload();
              },
            },
          });
        }
      };
      await clearUpload();
    },
    [patch, requestShip],
  );

  const noteTimersRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const timers = noteTimersRef.current;
    return () => {
      for (const t of timers.values()) window.clearTimeout(t);
    };
  }, []);
  /** The clip's note, shown at once and saved a moment after the last keystroke. */
  const setNote = useCallback(
    (key: string, note: string, opts: { flush?: boolean } = {}) => {
      const before = playlistRef.current;
      if (!before) return;
      const clip = before.items.find((i): i is PlaylistClipItem => isClipItem(i) && itemKey(i) === key);
      if (!clip) return;
      patch((p) => withNote(p, key, note));
      const timers = noteTimersRef.current;
      const pending = timers.get(key);
      if (pending !== undefined) window.clearTimeout(pending);
      const save = () => {
        timers.delete(key);
        const trimmed = note.trim();
        if (trimmed === (clip.note ?? "").trim()) return;
        updateClip(createClient(), before.id, clip.matchId, clip.eventId, { note: trimmed || null })
          .then(() => trackEvent("clip_note_saved", { playlist_id: before.id, length: trimmed.length }))
          .catch(() => {
            if (alive.current) toast.error("Couldn't save the note");
          });
      };
      if (opts.flush) save();
      else timers.set(key, window.setTimeout(save, NOTE_SAVE_MS));
    },
    [patch],
  );

  const [deleting, setDeleting] = useState(false);
  const deletePlaylist = useCallback(async () => {
    const before = playlistRef.current;
    if (!before) return;
    setDeleting(true);
    try {
      await dbDeletePlaylist(createClient(), before.id);
      trackEvent("playlist_deleted", { playlist_id: before.id, clips: before.items.filter(isClipItem).length });
      router.push("/playlists");
    } catch {
      setDeleting(false);
      toast.error("Couldn't delete the playlist", { description: "Check your connection and try again." });
    }
  }, [router]);

  return {
    status,
    playlist,
    isOwner,
    matches,
    eventsLoaded,
    eventByKey,
    cloud,
    rolls,
    intents,
    consumeIntents,
    ensureEventsFor,
    ship,
    onShared,
    rename,
    setRolls,
    addClips,
    insertCard,
    updateCard,
    removeItems,
    reorder,
    commitClipOffsets,
    setNote,
    deletePlaylist,
    deleting,
  };
}

export type PlaylistEditorApi = ReturnType<typeof usePlaylistEditor>;

/** The keys of the playlist's items, in order: the list's display order. */
export function itemKeysOf(playlist: Playlist | null): string[] {
  return playlist ? playlist.items.map(itemKey) : [];
}

export type { PlaylistItem };
