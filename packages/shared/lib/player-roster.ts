/**
 * Who a player card can be about, and where "Add player" puts one.
 *
 * A card can be about anyone in the games the playlist's clips come from, not
 * only the players who have clips: the roster is the clipped players first
 * (most clips first), then everyone else the game data has, from the stored
 * plays and, once loaded, the box score (which also lists players who played
 * without a recorded action). Pure, so the desktop picker and its tests share
 * one definition.
 */
import type { PlayByPlayEvent, PlaylistItem, StoredMatch } from "../types/match";
import { isClipItem } from "../types/match";
import { itemKey } from "./playlist-edits";
import { playerCardsOf } from "./player-card";
import { playerCardTarget } from "./scouting-report";
import { rankPlayersByClips } from "./stats-card";
import { eventPeople, type GameStats } from "./stats-card-data";
import type { StatsClip } from "./stats-card-defaults";

export interface PlayerChoice {
  playerId: string;
  name: string;
  number: string | null;
  teamName: string;
  /** Clips of theirs in the playlist; 0 for a player who is only in the game. */
  clips: number;
  /** The game their numbers are read from first: the one with most of their clips, else a game they played in. */
  matchId: string;
  /** Another player card already has them. */
  taken: boolean;
}

/** A shirt number as a sort key: numbers first, anything else after. */
const jersey = (n: string | null): number => {
  const v = n === null ? NaN : Number(n);
  return Number.isFinite(v) ? v : Infinity;
};

/**
 * Everyone a card can be about: the players with clips in the playlist, most
 * clips first, then the rest of the games' players by team (the team with
 * more clips first), shirt number and name. Games are the ones the playlist's
 * clips come from; a player in several is listed once.
 */
export function playerRoster(input: {
  items: readonly PlaylistItem[];
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  matches: ReadonlyMap<string, StoredMatch>;
  /** Box scores read so far, by game: their players join the roster. */
  boxScores?: ReadonlyMap<string, GameStats>;
}): PlayerChoice[] {
  const { items, eventByKey, matches, boxScores } = input;
  const taken = new Set(playerCardsOf(items).map((c) => c.player.player.id));

  const clips: StatsClip[] = [];
  for (const item of items) {
    if (!isClipItem(item)) continue;
    const event = eventByKey.get(itemKey(item));
    if (event) clips.push({ matchId: item.matchId, event });
  }

  // The game each clipped player has the most clips in (a tie keeps the first).
  const perGame = new Map<string, Map<string, number>>();
  for (const c of clips) {
    if (!c.event.player) continue;
    const id = String(c.event.player.playerId);
    const games = perGame.get(id) ?? new Map<string, number>();
    games.set(c.matchId, (games.get(c.matchId) ?? 0) + 1);
    perGame.set(id, games);
  }
  const bestGame = (id: string): string => {
    let best = "";
    let most = 0;
    for (const [matchId, n] of perGame.get(id) ?? []) {
      if (n > most) {
        best = matchId;
        most = n;
      }
    }
    return best;
  };

  // Everyone the data has for the games the clips come from, in playlist order.
  const known = new Map<string, { name: string; number: string | null; teamName: string; matchId: string }>();
  for (const matchId of new Set(clips.map((c) => c.matchId))) {
    const match = matches.get(matchId);
    if (!match) continue;
    for (const [id, p] of eventPeople(match)) {
      if (!known.has(id)) known.set(id, { name: p.name, number: p.number, teamName: p.teamName, matchId });
    }
    for (const o of boxScores?.get(matchId)?.players ?? []) {
      if (!known.has(o.player.id)) {
        known.set(o.player.id, { name: o.player.name, number: o.player.number, teamName: o.player.teamName, matchId });
      }
    }
  }

  const ranked = rankPlayersByClips(clips.map((c) => c.event)).map(
    (p): PlayerChoice => ({
      playerId: p.playerId,
      name: p.name,
      number: p.number,
      // A play without its team leaves the name blank: the game data knows it.
      teamName: p.teamName || known.get(p.playerId)?.teamName || "",
      clips: p.clips,
      matchId: bestGame(p.playerId),
      taken: taken.has(p.playerId),
    }),
  );

  const clipped = new Set(ranked.map((p) => p.playerId));
  const teamClips = new Map<string, number>();
  for (const p of ranked) teamClips.set(p.teamName, (teamClips.get(p.teamName) ?? 0) + p.clips);
  const rest = [...known]
    .filter(([id]) => !clipped.has(id))
    .map(([id, p]): PlayerChoice => ({ playerId: id, ...p, clips: 0, taken: taken.has(id) }));
  rest.sort(
    (a, b) =>
      (teamClips.get(b.teamName) ?? 0) - (teamClips.get(a.teamName) ?? 0) ||
      a.teamName.localeCompare(b.teamName) ||
      jersey(a.number) - jersey(b.number) ||
      a.name.localeCompare(b.name),
  );
  return [...ranked, ...rest];
}

export type PlayerCardSpot =
  | { ok: true; player: PlayerChoice; matchId: string; insertAt: number }
  | { ok: false; reason: "anchor_has_card" | "anchor_no_player" | "none_free" };

/** Back over the ungrouped clips of one player just above `at`: a card goes above their run, not inside it. */
function aboveRun(
  items: readonly PlaylistItem[],
  at: number,
  playerId: string,
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>,
): number {
  let i = at;
  while (i > 0) {
    const prev = items[i - 1];
    const e = isClipItem(prev) ? eventByKey.get(itemKey(prev)) : undefined;
    if (!isClipItem(prev) || prev.groupId || !e?.player || String(e.player.playerId) !== playerId) break;
    i--;
  }
  return i;
}

/**
 * Where "Add player" puts a card, and for whom. Never refuses because of the
 * position, only when everyone already has a card:
 *  1. From a clip's row menu (`anchor`): that clip's player, right there.
 *  2. A free player in the clips next to the insertion (playerCardTarget).
 *     From the toolbar the card goes above their run of clips.
 *  3. Else the free player with the most clips anywhere in the playlist,
 *     above their first clip (outside any group): this is how a removed card
 *     comes back, since its clips now sit in the card above's section.
 *  4. Else the first free player of the games, at the insertion; the coach
 *     picks who in the inspector.
 * `roster` carries who is taken (playerRoster).
 */
export function pickPlayerCardSpot(
  items: readonly PlaylistItem[],
  insertIndex: number,
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>,
  roster: readonly PlayerChoice[],
  opts: { anchor?: StatsClip | null; activePlayerId?: string | null; fromToolbar?: boolean } = {},
): PlayerCardSpot {
  const byId = new Map(roster.map((p) => [p.playerId, p]));

  if (opts.anchor) {
    const id = opts.anchor.event.player ? String(opts.anchor.event.player.playerId) : null;
    const player = id ? byId.get(id) : undefined;
    if (!player) return { ok: false, reason: "anchor_no_player" };
    if (player.taken) return { ok: false, reason: "anchor_has_card" };
    return { ok: true, player, matchId: opts.anchor.matchId, insertAt: insertIndex };
  }

  const near = playerCardTarget(items, insertIndex, eventByKey, { activePlayerId: opts.activePlayerId ?? null });
  const nearPlayer = near ? byId.get(near.playerId) : undefined;
  if (near && nearPlayer && !nearPlayer.taken) {
    const insertAt = opts.fromToolbar ? aboveRun(items, insertIndex, near.playerId, eventByKey) : insertIndex;
    return { ok: true, player: nearPlayer, matchId: near.matchId, insertAt };
  }

  const free = roster.filter((p) => !p.taken);
  const clipped = free.find((p) => p.clips > 0);
  if (clipped) {
    let at = items.findIndex((i) => {
      const e = isClipItem(i) ? eventByKey.get(itemKey(i)) : undefined;
      return !!e?.player && String(e.player.playerId) === clipped.playerId;
    });
    if (at >= 0) {
      const group = items[at].groupId;
      while (group && at > 0 && items[at - 1].groupId === group) at--;
      return { ok: true, player: clipped, matchId: clipped.matchId, insertAt: at };
    }
  }

  const first = free[0];
  if (first) return { ok: true, player: first, matchId: first.matchId, insertAt: insertIndex };
  return { ok: false, reason: "none_free" };
}
