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
import { placedFolderId } from "@scoutable/shared/lib/folder-tree";
import type { ExportPurpose } from "@scoutable/shared/lib/game-video-wire";
import { pickGameVideoRow, type GameVideo } from "@scoutable/shared/lib/game-videos-db";
import { itemsIndexForGap } from "@scoutable/shared/lib/list-reorder";
import { listEventsForMatches, listFolders, listMatchesByIds, listMatchesLight } from "@scoutable/shared/lib/matches-db";
import {
  appendClips,
  clampRolls,
  groupItems,
  insertCardAt,
  itemKey,
  pinnedPair,
  removeKeys,
  restoreRemoved,
  restoreStructure,
  ungroupItems,
  withCardDuration,
  withCardSpec,
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
import type { StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import {
  isClipItem,
  type PlayByPlayEvent,
  type Playlist,
  type PlaylistClipItem,
  type PlaylistFolder,
  type PlaylistItem,
  type PlaylistTextCard,
  type StoredMatch,
  type SyncPoint,
} from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { playlistsHref } from "@/components/folders/folder-nav";
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
  const { user, profileLoading, activeOrgId, activeOrgIsPersonal } = useAuth();
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
  /** The space's folders: where Back goes, where N makes the next playlist, the paths Add to shows. */
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
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
    // The History API, which the router follows, not router.replace: that
    // asks the server for the page again just to drop a query string.
    if (searchParams.has("rename") || searchParams.has("add") || searchParams.has("export")) window.history.replaceState(null, "", pathname);
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
  // Only a guess at the playlist's space (below): switching spaces doesn't reload the editor.
  const activeOrgRef = useRef(activeOrgId);
  useEffect(() => {
    activeOrgRef.current = activeOrgId;
  }, [activeOrgId]);
  useEffect(() => {
    if (profileLoading || !userId) return;
    let cancelled = false;
    const supabase = createClient();
    // The playlist's own space decides which games the picker offers; a
    // playlist from before spaces, or one in the personal space, also
    // admits legacy games without one. Its folders come along. It almost
    // always lives in the active space, so that space's games and folders
    // are read alongside it, and read again only when it lives elsewhere.
    const readSpace = (orgId: string | undefined, includeUnscoped: boolean) =>
      Promise.all([
        listMatchesLight(supabase, orgId, { ownOnly: true, includeUnscoped }).catch(() => [] as StoredMatch[]),
        listFolders(supabase, orgId, { includeUnscoped }).catch(() => [] as PlaylistFolder[]),
      ]);
    const guessOrg = activeOrgRef.current ?? undefined;
    const guess = readSpace(guessOrg, activeOrgIsPersonal);
    (async () => {
      const pl = await getPlaylist(supabase, playlistId);
      if (cancelled) return;
      if (!pl) {
        setPlaylist(null);
        setLoaded({ id: playlistId, status: "missing" });
        return;
      }
      const includeUnscoped = !pl.orgId || activeOrgIsPersonal;
      const referenced = collectClipMatchIds([pl]);
      // The plays don't depend on whose games they are: read them now, with the games.
      const events = listEventsForMatches(supabase, referenced).catch(() => ({}) as Record<string, PlayByPlayEvent[]>);
      const sameSpace = (pl.orgId ?? undefined) === guessOrg && includeUnscoped === activeOrgIsPersonal;
      const [own, folderRows] = await (sameSpace ? guess : readSpace(pl.orgId, includeUnscoped));
      if (cancelled) return;
      const map = new Map(own.map((m) => [m.id, m]));
      // A clip of a game someone else imported (a club game a colleague
      // added): its rows come in one read.
      const unknown = referenced.filter((id) => !map.has(id));
      const [eventsByMatch, extra] = await Promise.all([
        events,
        listMatchesByIds(supabase, unknown).catch(() => [] as StoredMatch[]),
      ]);
      if (cancelled) return;
      for (const m of extra) map.set(m.id, m);
      const loadedIds = referenced.filter((id) => map.has(id));
      for (const id of loadedIds) {
        const m = map.get(id)!;
        map.set(id, { ...m, events: eventsByMatch[id] ?? [] });
      }
      eventsLoadedRef.current = new Set(loadedIds);
      setEventsLoaded(new Set(eventsLoadedRef.current));
      setMatches(map);
      setFolders(folderRows);
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

  // From the start, with the playlist: the rows usually come from the shared memo.
  const cloudRows = useMyGameVideos({ enabled: !profileLoading });
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

  /** The folder the playlist is listed in on the Playlists page; null at the top level (or when its folder is gone). */
  const folderId = useMemo(() => placedFolderId(new Set(folders.map((f) => f.id)), playlist?.folderId), [folders, playlist?.folderId]);
  const folder = useMemo(() => (folderId ? (folders.find((f) => f.id === folderId) ?? null) : null), [folders, folderId]);

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

  /**
   * A card before the item under `beforeKey` (or at the end; never inside a
   * group), a plain text card or, with `stats`, a stats card (5 s, its line
   * as the text). Answers the new card's id for the row to focus. The stats
   * card's analytics are the caller's (trackStatsCardInserted).
   */
  const insertCard = useCallback(
    async (beforeKey: string | null, entry: "menu" | "row" | "suggestion", stats?: { spec: StatsCardSpec; text: string }): Promise<string | null> => {
      const before = playlistRef.current;
      if (!before) return null;
      const card: PlaylistTextCard = {
        type: "text",
        id: crypto.randomUUID(),
        text: stats?.text ?? "",
        durationSeconds: 5,
        ...(stats ? { card: stats.spec } : {}),
      };
      const next = insertCardAt(before, card, beforeKey);
      const position = next.items.findIndex((i) => i === card);
      setPlaylist(next);
      try {
        const supabase = createClient();
        await insertTextCard(supabase, before.id, card.id, card.text, card.durationSeconds, position, stats?.spec);
        await reorderItems(supabase, before.id, next.items);
      } catch {
        patch((p) => ({ ...p, items: p.items.filter((i) => isClipItem(i) || i.id !== card.id) }));
        toast.error(stats ? "Couldn't add the stats card" : "Couldn't add the card", { description: "Check your connection and try again." });
        return null;
      }
      if (!stats) trackEvent("text_card_inserted", { entry, origin: "web" });
      return card.id;
    },
    [patch, setPlaylist],
  );

  const updateCard = useCallback(
    async (cardId: string, change: { text?: string; durationSeconds?: number; card?: StatsCardSpec }) => {
      const before = playlistRef.current;
      if (!before) return;
      const was = before.items.find((i): i is PlaylistTextCard => !isClipItem(i) && i.id === cardId);
      if (!was) return;
      patch((p) => {
        let next = p;
        if (change.text !== undefined) next = withCardText(next, cardId, change.text);
        if (change.durationSeconds !== undefined) next = withCardDuration(next, cardId, change.durationSeconds);
        if (change.card !== undefined) next = withCardSpec(next, cardId, change.card);
        return next;
      });
      try {
        await updateTextCard(createClient(), before.id, cardId, change);
      } catch {
        patch((p) => ({ ...p, items: p.items.map((i) => (!isClipItem(i) && i.id === cardId ? was : i)) }));
        toast.error(change.card ? "Couldn't save the stats card" : "Couldn't save the card");
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
   * The picked items locked together as one group, the desktop's Group:
   * groups the selection touches come along whole, and the members are
   * pulled together at the first one's place. Written as one reorder (the
   * RPC records membership); if the write fails, the order and groups go
   * back as they were, over anything else changed since. False when there
   * was nothing to group.
   */
  const group = useCallback(
    function group(keys: ReadonlySet<string>): boolean {
      const before = playlistRef.current;
      if (!before) return false;
      const res = groupItems(before, keys, crypto.randomUUID());
      if (!res) return false;
      setPlaylist(res.playlist);
      reorderItems(createClient(), before.id, res.playlist.items)
        .then(() => trackEvent("clips_grouped", { playlist_id: before.id, clip_count: res.members.length, origin: "web" }))
        .catch(() => {
          patch((p) => restoreStructure(p, before));
          toast.error("Couldn't group the items", {
            description: "They're back as they were.",
            action: { label: "Try again", onClick: () => void group(keys) },
          });
        });
      return true;
    },
    [patch, setPlaylist],
  );

  /** The group taken apart, its items left where they are; put back if the write fails. */
  const ungroup = useCallback(
    function ungroup(groupId: string): boolean {
      const before = playlistRef.current;
      if (!before) return false;
      const { playlist: next, count } = ungroupItems(before, groupId);
      if (count === 0) return false;
      setPlaylist(next);
      reorderItems(createClient(), before.id, next.items)
        .then(() => trackEvent("clips_ungrouped", { clip_count: count, origin: "web" }))
        .catch(() => {
          patch((p) => restoreStructure(p, before));
          toast.error("Couldn't ungroup the items", {
            description: "They're back as they were.",
            action: { label: "Try again", onClick: () => void ungroup(groupId) },
          });
        });
      return true;
    },
    [patch, setPlaylist],
  );

  /**
   * The one way a clip's own length changes (a trim, Reset, Fix sync's "Just
   * this clip"): applied at once, saved, and put back with a toast if the
   * save fails (`quiet`: no toast, the caller says so). The first offset on
   * a playlist without a saved pair pins the pair first, so a later default
   * can't move the clip. A file recipients already have was cut at the old
   * length: it is cleared and, in a shared playlist, cut again. True once the
   * new length is saved.
   */
  const commitClipOffsets = useCallback(
    async (key: string, pre: number, post: number, opts: { quiet?: boolean } = {}): Promise<boolean> => {
      const before = playlistRef.current;
      if (!before) return false;
      const clip = before.items.find((i): i is PlaylistClipItem => isClipItem(i) && itemKey(i) === key);
      if (!clip) return false;
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
        if (!opts.quiet) toast.error("Couldn't save the clip's length");
        return false;
      }
      if (!shippedUrl) {
        requestShip("trim");
        return true;
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
      return true;
    },
    [patch, requestShip],
  );

  /**
   * A game's sync after Fix sync moved it (the sheet wrote it): the clips'
   * windows follow at once. The server re-cuts the shared clips it reached.
   */
  const applySync = useCallback((matchId: string, syncPoint: SyncPoint) => {
    setMatches((prev) => {
      const m = prev.get(matchId);
      if (!m) return prev;
      const next = new Map(prev);
      next.set(matchId, { ...m, syncPoint });
      return next;
    });
  }, []);

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
      // Back to the folder it was in.
      router.push(playlistsHref(folderId));
    } catch {
      setDeleting(false);
      toast.error("Couldn't delete the playlist", { description: "Check your connection and try again." });
    }
  }, [router, folderId]);

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
    folders,
    folderId,
    folder,
    ship,
    onShared,
    rename,
    setRolls,
    addClips,
    insertCard,
    updateCard,
    removeItems,
    reorder,
    group,
    ungroup,
    commitClipOffsets,
    applySync,
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
