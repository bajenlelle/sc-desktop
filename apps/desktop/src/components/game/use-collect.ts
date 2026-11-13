import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { heldForPlayers, playlistIsShared } from "@scoutable/shared/lib/playlist-sharing";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import { mergeEventsIntoMatches } from "@scoutable/shared/lib/playlist-matches";
import { isClipItem, type Playlist, type PlaylistClipItem, type PlaylistItem, type StoredMatch } from "@/types/match";
import { trackEvent } from "@/lib/analytics";
import { listEventsForMatches, listMatchesByIds } from "@/lib/matches-db";
import { appendClips, createPlaylist, listPlaylists, writePlaylistItems } from "@/lib/playlists-db";
import { getCollectTarget, setAddClipsScope, setCollectTarget } from "@/lib/prefs";
import { Sentry } from "@/lib/sentry";
import { DEFAULT_POST_ROLL, DEFAULT_PRE_ROLL, demoShipBlockReason, eventLookup, shipPlaylistClips } from "@/lib/ship-clips";

/** Where an add came from: a row's plus, the Now bar (or A), "Add all", a row's menu, or the selected plays. */
export type CollectVia = "row" | "now_bar" | "bulk" | "menu" | "selection";

/** One toast for the whole view: the latest add replaces the one before, and its Undo is the only one on offer. */
const COLLECT_TOAST = "game-collect";

/** This session's last playlists read, by `${orgId}|${includeUnscoped}`: the next visit shows them at once and reads again behind. */
let lastList: { key: string; list: Playlist[] } | null = null;

/**
 * Each playlist's writes in flight, by playlist id, for the whole app: a game
 * a tab switch just left may still be writing, and the next game's read and
 * writes wait for it.
 */
const chains = new Map<string, Promise<void>>();

/** Forgets the last read, so another user signing in never sees this one's playlists. */
export function forgetPlaylistsRead(): void {
  lastList = null;
  chains.clear();
}

/**
 * Collecting a game's plays into a playlist from the game view: one target,
 * chosen once, then one press per play.
 *
 * Every add shows at once and is written behind it, one write after another
 * per playlist, so plays added in quick succession land in the order they
 * were pressed, here or in the game a tab switch just left. A failed write is
 * taken back and said. Undo (the toast's, or a row's menu) removes what this
 * visit added: a clip that was in the playlist before may carry notes, a
 * trim or an upload, and this view has no history to put those back from.
 *
 * A row's menu adds to any playlist once (`addToPlaylist`, `createAndAddTo`)
 * without changing the target.
 *
 * The playlists start from this session's last read in the same space (no
 * flash of "Choose playlist…" on a tab switch) and are read again behind.
 * Writes wait for that fresh read: what the server holds is the only base a
 * write goes from, and adds shown on the earlier list are shown again on the
 * fresh one.
 *
 * When players already have a playlist, the new clips are held: `held`
 * counts them per shared playlist, and `send` cuts and uploads them from
 * here, without leaving the game (`lib/ship-clips.ts`, the editor's path).
 * `openPlaylist` opens one in the editor, with the way back to this game.
 */
export function useCollect({
  match,
  orgId,
  includeUnscoped,
}: {
  match: StoredMatch;
  orgId: string | null;
  includeUnscoped: boolean;
}) {
  const navigate = useNavigate();
  const key = `${orgId}|${includeUnscoped}`;
  const [playlists, setPlaylists] = useState<Playlist[] | null>(() => (lastList?.key === key ? lastList.list : null));
  /** This space's read has landed: until then the list shown may be the earlier one. */
  const [readLanded, setReadLanded] = useState(false);
  /** The space the shown list was read in, so a list is never kept under another's key. */
  const listKey = useRef<string | null>(playlists ? key : null);
  /** Changes shown before the read landed, made again on the list it brings; null once it has. */
  const early = useRef<((list: Playlist[] | null) => Playlist[] | null)[] | null>([]);
  /** Settles once the read has set `saved`: every write waits for it. */
  const loadedRef = useRef<Promise<void>>(Promise.resolve());
  /** The playlists this space's read found; null until it lands (or when it failed). */
  const readIds = useRef<ReadonlySet<string> | null>(null);
  /** The space this hook is in now; a read for an earlier one doesn't touch `saved`. */
  const keyNow = useRef(key);
  keyNow.current = key;
  const [targetId, setTargetId] = useState<string | null>(() => getCollectTarget(match.id));
  const [pickerOpen, setPickerOpenState] = useState(false);
  /** The control that asked for the picker (a row's plus, the Now bar's Add): it opens from there. Null: from its own button. */
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  /** `${playlistId}|${clipKey}` of every clip this visit added. */
  const [addedHere, setAddedHere] = useState<ReadonlySet<string>>(() => new Set());
  const [addedTotal, setAddedTotal] = useState(0);
  /** The playlist whose held clips are being cut and uploaded now, if any. */
  const [sending, setSending] = useState<string | null>(null);
  const pendingRef = useRef<{ plays: readonly TimedPlay[]; via: CollectVia; moment: string | null; onAdded?: () => void } | null>(null);
  /** What the server holds for each playlist: the base every write goes from. */
  const saved = useRef(new Map<string, PlaylistItem[]>());
  const saidHeld = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const cached = lastList?.key === key ? lastList.list : null;
    listKey.current = cached ? key : null;
    early.current = [];
    readIds.current = null;
    setReadLanded(false);
    setPlaylists(cached);
    // After the writes still in flight (from the game just left, too): never a base about to change.
    const read = Promise.all([...chains.values()].map((c) => c.catch(() => {})))
      .then(() => listPlaylists(orgId ?? undefined, { includeUnscoped }))
      .then((list) => {
        // Set even when the page has gone, so writes made before it left still land. Merged: a playlist made
        // here while the read was out keeps its entry.
        if (keyNow.current === key) {
          for (const p of list) saved.current.set(p.id, p.items);
          readIds.current = new Set(list.map((p) => p.id));
        }
        if (cancelled) return;
        const edits = early.current ?? [];
        early.current = null;
        listKey.current = key;
        setPlaylists(edits.reduce<Playlist[] | null>((l, change) => change(l), list));
        setReadLanded(true);
      });
    loadedRef.current = read.catch(() => {});
    read.catch(() => {
      if (cancelled) return;
      early.current = null;
      listKey.current = null;
      setPlaylists([]);
    });
    return () => {
      cancelled = true;
    };
  }, [key, orgId, includeUnscoped]);

  // Kept current through every add, for the next visit.
  useEffect(() => {
    if (playlists && listKey.current) lastList = { key: listKey.current, list: playlists };
  }, [playlists]);

  const target = useMemo(() => playlists?.find((p) => p.id === targetId) ?? null, [playlists, targetId]);

  // A remembered playlist that is gone (deleted, or in another space) is forgotten; an earlier list can't say so.
  useEffect(() => {
    if (readLanded && playlists && targetId && !playlists.some((p) => p.id === targetId)) {
      setTargetId(null);
      setCollectTarget(match.id, null);
    }
  }, [readLanded, playlists, targetId, match.id]);

  /** Changes the shown list; before the read lands, also made again on the list it brings. */
  const edit = useCallback((change: (list: Playlist[] | null) => Playlist[] | null) => {
    early.current?.push(change);
    setPlaylists(change);
  }, []);

  const mutate = useCallback(
    (playlistId: string, change: (items: PlaylistItem[]) => PlaylistItem[]) => {
      edit((prev) => prev?.map((p) => (p.id === playlistId ? { ...p, items: change(p.items) } : p)) ?? prev);
    },
    [edit],
  );

  /** A playlist made here, first in the list (once: the read may already bring it). */
  const addCreated = useCallback(
    (created: Playlist) => edit((prev) => (prev?.some((p) => p.id === created.id) ? prev : [created, ...(prev ?? [])])),
    [edit],
  );

  const enqueue = useCallback((playlistId: string, job: () => Promise<void>) => {
    // A playlist's first write here waits for this page's read: never from the earlier list.
    const before = chains.get(playlistId);
    const next = (before ? Promise.all([before, loadedRef.current]) : loadedRef.current).then(job).catch(() => {});
    chains.set(playlistId, next);
    void next.then(() => {
      if (chains.get(playlistId) === next) chains.delete(playlistId);
    });
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

  /**
   * Adds plays to one playlist. Never touches the target: the target's adds and a menu's one-time adds both come through here.
   * `toTarget` says which, from the caller: the add that sets the target runs before `targetId` has caught up.
   */
  const addToPlaylist = useCallback(
    (playlist: Playlist, plays: readonly TimedPlay[], via: CollectVia, moment: string | null, toTarget = false) => {
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
      // Made again on the fresh list, which may already hold a clip added elsewhere meanwhile.
      mutate(playlist.id, (items) => {
        const there = new Set(items.filter(isClipItem).map(itemKey));
        return [...items, ...fresh.filter((c) => !there.has(itemKey(c)))];
      });
      setAddedHere((prev) => new Set([...prev, ...keys.map((k) => `${playlist.id}|${k}`)]));
      enqueue(playlist.id, async () => {
        const base = saved.current.get(playlist.id);
        // The read landed without it: deleted (or moved) since the earlier list was shown.
        const gone = !base && readIds.current !== null && !readIds.current.has(playlist.id);
        try {
          // The read failed: the server's copy is unknown, and a write from a guess could misplace the clips.
          if (!base) throw new Error("Playlist not read");
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
              to_target: toTarget,
            });
          }
          // The editor's Add clips starts on this game next time.
          setAddClipsScope(playlist.id, { gameIds: [match.id], teams: [] });
        } catch (e) {
          if (!gone) Sentry.captureException(e);
          const failed = new Set(keys);
          mutate(playlist.id, (items) => items.filter((i) => !(isClipItem(i) && failed.has(itemKey(i)))));
          setAddedHere((prev) => new Set([...prev].filter((k) => !failed.has(k.slice(playlist.id.length + 1)))));
          if (gone) {
            toast.error("That playlist is gone", { id: COLLECT_TOAST, description: "It was deleted or moved elsewhere." });
            return;
          }
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
    [match.id, mutate, enqueue, undo],
  );

  /**
   * Adds plays to the target; with none chosen yet, opens the picker (from
   * `anchor`, the control that was pressed, or its own button when null) and
   * adds them once one is. `onAdded` runs once the plays went in: at once
   * with a target, after the choice without one, never when the picker is
   * dismissed (a selection they came from stays).
   */
  const add = useCallback(
    (plays: readonly TimedPlay[], via: CollectVia, moment: string | null = null, anchor: HTMLElement | null = null, onAdded?: () => void) => {
      if (plays.length === 0) return;
      if (target) {
        addToPlaylist(target, plays, via, moment, true);
        onAdded?.();
        return;
      }
      pendingRef.current = { plays, via, moment, onAdded };
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
      if (pending) {
        addToPlaylist(playlist, pending.plays, pending.via, pending.moment, true);
        pending.onAdded?.();
      }
    },
    [match.id, addToPlaylist],
  );

  const createTarget = useCallback(
    async (name: string) => {
      const created = await createPlaylist(name, undefined, orgId ?? undefined);
      trackEvent("playlist_created", { playlist_id: created.id, in_folder: false, surface: "game_view" });
      saved.current.set(created.id, []);
      addCreated(created);
      chooseTarget(created, "new");
    },
    [orgId, addCreated, chooseTarget],
  );

  /** A new playlist with these plays in it, once: the target stays as it is. Throws when the create fails. */
  const createAndAddTo = useCallback(
    async (name: string, plays: readonly TimedPlay[], via: CollectVia, moment: string | null) => {
      const created = await createPlaylist(name, undefined, orgId ?? undefined);
      trackEvent("playlist_created", { playlist_id: created.id, in_folder: false, surface: "game_view" });
      saved.current.set(created.id, []);
      addCreated(created);
      addToPlaylist(created, plays, via, moment, false);
    },
    [orgId, addCreated, addToPlaylist],
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

  /** Opens a playlist in the editor, which gets the way back to this game. */
  const openPlaylist = useCallback(
    (playlistId: string) => {
      navigate("/playlists", { state: { restore: { playlistId }, from: { matchId: match.id, title: match.title } } });
    },
    [match.id, match.title, navigate],
  );

  /**
   * Cuts and uploads a shared playlist's held clips from here, as the editor
   * would on arrival, so the coach stays in the game. One at a time; the
   * writes still out for that playlist land first, so every add is in the
   * copy that is cut. Progress and the outcome are one toast.
   */
  const send = useCallback(
    async (playlistId: string) => {
      const waiting = held.find((h) => h.playlist.id === playlistId);
      if (!waiting || sending) return;
      const { playlist, count } = waiting;
      trackEvent("collect_sent", { clips: count, target: playlistId === targetId, in_place: true });
      setSending(playlistId);
      const id = `${COLLECT_TOAST}-send-${playlistId}`;
      toast.loading(`Sending ${count} ${count === 1 ? "clip" : "clips"} to ${playlist.name}…`, { id });
      try {
        await (chains.get(playlistId) ?? Promise.resolve());
        // What the server holds, so a clip whose add is still out is never cut without its row.
        const items = saved.current.get(playlistId) ?? playlist.items;
        const toShip: Playlist = { ...playlist, items };
        // The playlist may hold clips of other games: their footage and plays are read for the cut.
        const otherIds = [...new Set(items.filter(isClipItem).map((c) => c.matchId).filter((m) => m !== match.id))];
        const others = otherIds.length > 0
          ? mergeEventsIntoMatches(await listMatchesByIds(otherIds), await listEventsForMatches(otherIds))
          : [];
        const games = [match, ...others];
        const matchLookup = new Map(games.map((m) => [m.id, m]));
        const demoBlock = demoShipBlockReason(toShip, matchLookup);
        if (demoBlock) {
          toast.error("Couldn't send the clips", { id, description: demoBlock });
          return;
        }
        const result = await shipPlaylistClips(toShip, {
          matchLookup,
          eventByKey: eventLookup(games),
          preRoll: DEFAULT_PRE_ROLL,
          postRoll: DEFAULT_POST_ROLL,
          toastId: id,
          onProgress: (done, total) => toast.loading(`Sending clips to ${playlist.name} · ${done} of ${total}`, { id }),
          onUploaded: (uploaded) => {
            // The shown and the saved copies both learn the files, so `held` counts down and no later write forgets them.
            const byKey = new Map(uploaded.map((u) => [`${u.matchId}:${u.eventId}`, u.r2Url]));
            const patch = (list: PlaylistItem[]) =>
              list.map((i) => (isClipItem(i) && byKey.has(itemKey(i)) ? { ...i, r2Url: byKey.get(itemKey(i)) } : i));
            mutate(playlistId, patch);
            const base = saved.current.get(playlistId);
            if (base) saved.current.set(playlistId, patch(base));
          },
          success: (shipped) => ({ title: `Sent ${shipped} ${shipped === 1 ? "clip" : "clips"} to ${playlist.name}` }),
        });
        // Nothing went up and nothing failed: the files were there already (another computer sent them).
        if (result && result.shipped === 0 && result.failures.length === 0) {
          toast(`Everything in ${playlist.name} is sent already`, { id, duration: 3000 });
        }
      } catch (e) {
        Sentry.captureException(e);
        toast.error("Couldn't send the clips", { id, description: e instanceof Error ? e.message : String(e) });
      } finally {
        setSending(null);
      }
    },
    [held, sending, targetId, match, mutate],
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
    sending,
    send,
    openPlaylist,
    openTarget,
    /** How many clips this visit added (net of undos), for the closing event. */
    addedTotal,
    suggestedName: match.title,
  };
}

export type Collect = ReturnType<typeof useCollect>;
