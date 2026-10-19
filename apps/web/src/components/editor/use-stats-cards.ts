"use client";

/**
 * Stats cards in the editor: which clips can start one (their game has the
 * league's stats), the inspector for a new card or one being edited, and the
 * one-time suggestion in a personal space. A new card's player and game are
 * the desktop's defaults (stats-card-defaults.ts); the card goes in through
 * the editor's own optimistic card insert, and stats_card_inserted fires
 * once it is in.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getMatch } from "@scoutable/shared/lib/matches-db";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { cardContent, opponentLabel, type StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import { statsCardSuggestion, statsCardTarget, type StatsClip } from "@scoutable/shared/lib/stats-card-defaults";
import { isClipItem, type PlayByPlayEvent, type Playlist, type StoredMatch } from "@scoutable/shared/types/match";
import { trackStatsCardInserted, type StatsCardEntry } from "@/components/stats-card/analytics";
import { trackEvent } from "@/lib/analytics";
import { loadGameStats, makeGameCard, seasonOf, statsKindOf } from "@/lib/stats-card-data";
import { createClient } from "@/lib/supabase/client";
import { useLeagues } from "@/lib/use-leagues";

/** The desktop's key: playlists whose suggestion was dismissed, a per-viewer convenience. */
const HINT_KEY = "scoutable_stats_card_hint_dismissed";
/** Why "Add stats card" is off, in the desktop's words. */
export const NO_STATS_REASON = "Needs clips from a game with league play-by-play";

function readDismissed(): ReadonlySet<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HINT_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Storage unavailable: the suggestion just comes back next time.
  }
}

/** What the inspector opens with, kept (closed) after it closes so its words stay put on the way out. */
export interface StatsInspectorRequest {
  /** Each opening's own: the dialog starts afresh even while the last one is still leaving. */
  id: number;
  open: boolean;
  /** The game the card reads, with its plays. */
  match: StoredMatch;
  events: PlayByPlayEvent[];
  games: StoredMatch[];
  defaultScope: "game" | "season";
  /** A new card goes before `beforeKey` (null: at the end); an edit names its card. */
  target: { kind: "new"; beforeKey: string | null; entry: StatsCardEntry } | { kind: "edit"; cardId: string; spec: StatsCardSpec };
}

export function useStatsCards({
  playlist,
  matches,
  eventByKey,
  eventsLoaded,
  activeKey,
  personal,
  enabled,
  insertCard,
  updateCard,
  onInserted,
}: {
  playlist: Playlist | null;
  matches: ReadonlyMap<string, StoredMatch>;
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  eventsLoaded: ReadonlySet<string>;
  /** The row on the stage: its player wins a tie for a new card's player. */
  activeKey: string | null;
  /** A personal space: the only place the suggestion appears. */
  personal: boolean;
  enabled: boolean;
  insertCard: (beforeKey: string | null, entry: StatsCardEntry, stats: { spec: StatsCardSpec; text: string }) => Promise<string | null>;
  updateCard: (cardId: string, change: { text: string; card: StatsCardSpec }) => void | Promise<void>;
  /** A new card is in the playlist: the editor shows it. */
  onInserted: (cardId: string) => void;
}) {
  const leagues = useLeagues();

  /** The clips whose game has stats, in playlist order, with their plays. */
  const statsClips = useMemo(() => {
    const out: (StatsClip & { key: string })[] = [];
    for (const item of playlist?.items ?? []) {
      if (!isClipItem(item) || statsKindOf(matches.get(item.matchId)) === null) continue;
      const key = itemKey(item);
      const event = eventByKey.get(key);
      if (event) out.push({ key, matchId: item.matchId, event });
    }
    return out;
  }, [playlist, matches, eventByKey]);
  const statsClipByKey = useMemo(() => new Map(statsClips.map((c) => [c.key, c])), [statsClips]);
  /** Their games, once each, in playlist order: the inspector's Game and Season choices. */
  const statsGames = useMemo(() => {
    const out: StoredMatch[] = [];
    const seen = new Set<string>();
    for (const c of statsClips) {
      const m = matches.get(c.matchId);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }, [statsClips, matches]);

  const latest = useRef({ playlist, matches, eventsLoaded, statsGames, leagues, insertCard, updateCard, onInserted });
  useLayoutEffect(() => {
    latest.current = { playlist, matches, eventsLoaded, statsGames, leagues, insertCard, updateCard, onInserted };
  });

  const disabledReason = statsClips.length === 0 ? NO_STATS_REASON : null;
  /** A clip row offers "Insert stats card above" when its game has stats and its play a player. */
  const canStartFrom = useCallback((key: string) => !!statsClipByKey.get(key)?.event.player, [statsClipByKey]);

  // ---------------------------------------------------------------------------
  // The inspector
  // ---------------------------------------------------------------------------

  const [request, setRequest] = useState<StatsInspectorRequest | null>(null);
  const seqRef = useRef(0);
  const requestRef = useRef(request);
  useLayoutEffect(() => {
    requestRef.current = request;
  });
  const closeInspector = useCallback(() => setRequest((r) => (r ? { ...r, open: false } : r)), []);

  /**
   * A new card. From a clip's row: that clip's player in its game, the
   * game's line. Otherwise the player with the most clips in their
   * most-clipped game, season averages first when the clips span games.
   */
  const openNew = useCallback(
    ({ beforeKey, entry, anchorKey = null }: { beforeKey: string | null; entry: StatsCardEntry; anchorKey?: string | null }) => {
      const anchor = anchorKey ? (statsClipByKey.get(anchorKey) ?? null) : null;
      // The suggestion named its player without the stage's say; the card must agree with it.
      const playing = entry === "suggestion" || !activeKey ? null : statsClipByKey.get(activeKey)?.event.player;
      const target = statsCardTarget(statsClips, { anchor, activePlayerId: playing ? String(playing.playerId) : null });
      const match = target ? matches.get(target.matchId) : undefined;
      if (!target || !match) {
        toast("None of these clips has a player", { description: "A stats card shows one player's numbers." });
        return;
      }
      setRequest({ id: ++seqRef.current, open: true, match, events: target.events, games: statsGames, defaultScope: target.defaultScope, target: { kind: "new", beforeKey, entry } });
    },
    [statsClipByKey, statsClips, statsGames, matches, activeKey],
  );

  /** The game an existing card is edited against: a game card's own; for a season card, one of the player's games in that season. */
  const cardMatch = useCallback(async (spec: StatsCardSpec): Promise<StoredMatch | null> => {
    const { matches: known, eventsLoaded: loaded, statsGames: games, leagues: catalog } = latest.current;
    if (spec.scope === "game") {
      const id = spec.game.matchId;
      const m = known.get(id);
      if (m && loaded.has(id)) return m;
      // Not among the playlist's games (its clips left): read it with its plays.
      const read = await getMatch(createClient(), id).catch(() => null);
      return read ?? games[0] ?? null;
    }
    const inSeason = games.filter((m) => seasonOf(m, catalog)?.competitionId === spec.season.competitionId);
    const theirs = inSeason.find((m) => m.events.some((e) => String(e.player?.playerId) === spec.player.id));
    return theirs ?? inSeason[0] ?? games[0] ?? null;
  }, []);

  /** An existing stats card into the inspector (its row's Edit, Return or a double-click). */
  const openEdit = useCallback(
    async (cardId: string) => {
      const card = latest.current.playlist?.items.find((i) => !isClipItem(i) && i.id === cardId);
      if (!card || isClipItem(card) || !card.card) return;
      const spec = card.card;
      const match = await cardMatch(spec);
      if (!match) {
        toast.error("This card can't be edited here", { description: "Its game isn't in this space's Library." });
        return;
      }
      setRequest({ id: ++seqRef.current, open: true, match, events: [], games: latest.current.statsGames, defaultScope: spec.scope, target: { kind: "edit", cardId, spec } });
    },
    [cardMatch],
  );

  /** The inspector's Add card or Save card (it closes itself after). */
  const saveInspector = useCallback(async (spec: StatsCardSpec, text: string) => {
    const r = requestRef.current;
    if (!r) return;
    if (r.target.kind === "edit") {
      void latest.current.updateCard(r.target.cardId, { text, card: spec });
      return;
    }
    const { beforeKey, entry } = r.target;
    const id = await latest.current.insertCard(beforeKey, entry, { spec, text });
    if (!id) return;
    trackStatsCardInserted(spec, entry);
    latest.current.onInserted(id);
  }, []);

  // ---------------------------------------------------------------------------
  // The suggestion
  // ---------------------------------------------------------------------------

  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(readDismissed);
  const hasStatsCard = !!playlist?.items.some((i) => !isClipItem(i) && !!i.card);
  const hint = useMemo(
    () => (enabled && playlist ? statsCardSuggestion(statsClips, { personal, dismissed: dismissed.has(playlist.id), hasStatsCard }) : null),
    [enabled, playlist, statsClips, personal, dismissed, hasStatsCard],
  );

  // One game's numbers, read once for the suggestion's line: "24 PTS · 8 REB · 5 AST vs AIK".
  const lineKey = hint?.lineMatchId ? `${hint.lineMatchId}:${hint.playerId}` : null;
  const [line, setLine] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!lineKey || !hint?.lineMatchId) return;
    const match = latest.current.matches.get(hint.lineMatchId);
    if (!match) return;
    const playerId = hint.playerId;
    let cancelled = false;
    loadGameStats(match, leagues)
      .then((stats) => {
        const option = stats?.players.find((p) => p.player.id === playerId);
        if (cancelled || !stats || !option) return;
        const card = makeGameCard(match, stats, option, null);
        const numbers = cardContent(card).cells.map((c) => `${c.value} ${c.label}`).join(" · ");
        setLine({ key: lineKey, text: `${numbers} ${opponentLabel(card.game)}` });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // The key stands for the game and the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, leagues]);

  const dismissSuggestion = useCallback(() => {
    const id = latest.current.playlist?.id;
    if (!id) return;
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      writeDismissed(next);
      return next;
    });
    trackEvent("stats_card_suggestion_dismissed", { origin: "web" });
  }, []);

  const firstKey = playlist?.items[0] ? itemKey(playlist.items[0]) : null;
  const suggestion = hint
    ? {
        severalGames: hint.severalGames,
        line: line && line.key === lineKey ? line.text : null,
        /** The inspector for a new card, which goes in at the start. */
        add: () => openNew({ beforeKey: firstKey, entry: "suggestion" }),
        dismiss: dismissSuggestion,
      }
    : null;

  return {
    leagues,
    disabledReason,
    canStartFrom,
    openNew,
    openEdit,
    inspector: request,
    closeInspector,
    saveInspector,
    suggestion,
  };
}

export type UseStatsCards = ReturnType<typeof useStatsCards>;
