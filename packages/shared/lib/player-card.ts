/**
 * Player cards: one opponent player's entry in a playlist, for the scouting
 * report (lib/scouting-report.ts). The player, one free-text note, and the
 * player's stats (a stats card spec, game or season, read the same way and
 * stored as the same snapshot).
 *
 * Storage: playlist_clips.item_type 'player', the spec in `card` (migration
 * 20261024100000). Not a text item: a build that doesn't know player cards
 * would draw a text item's fallback line as a card in every shared playlist,
 * and the mobile builds in the stores can't be fixed over the air. A row of
 * an unknown item_type is dropped by those builds (rowToPlaylist's clip
 * branch needs a match_id), so they see nothing.
 *
 * In the app the item stays a PlaylistTextCard (`type: 'text'`, `player`
 * set) so the editors' card rows, selection, drag and undo carry it with no
 * new item kind; durationSeconds is 0 and every place that plays, exports or
 * shows a playlist to a recipient skips it (isPlayerCard).
 *
 * The clips below a player card, up to the next one, belong to that player.
 */
import type { PlaylistItem, PlaylistTextCard } from "../types/match";
import { parseCardSpec, type StatsCardPlayer, type StatsCardSpec } from "./stats-card";

export const PLAYER_CARD_VERSION = 1 as const;

/** What the inspector lets a coach type. */
export const PLAYER_NOTE_LIMIT = 600;
/** What is stored: well under the row's 16 KB card cap, with room for the stats snapshot. */
export const PLAYER_NOTE_STORED_MAX = 2000;

export interface PlayerCardSpec {
  type: "player";
  v: typeof PLAYER_CARD_VERSION;
  player: StatsCardPlayer;
  /** The coach's note about the player; "" when there is none. */
  note: string;
  /** The player's numbers; null where the league has none or they could not be read. */
  stats: StatsCardSpec | null;
}

/** A playlist item that is a player card. */
export type PlayerCardItem = PlaylistTextCard & { player: PlayerCardSpec };

export function isPlayerCard(item: PlaylistItem): item is PlayerCardItem {
  return item.type === "text" && item.player !== undefined;
}

/** "#7 Alva Berg", or "Alva Berg" when the player has no number. */
export function playerCardLabel(spec: Pick<PlayerCardSpec, "player">): string {
  const { number, name } = spec.player;
  return number ? `#${number} ${name}` : name;
}

export function newPlayerCard(player: StatsCardPlayer, stats: StatsCardSpec | null): PlayerCardSpec {
  return { type: "player", v: PLAYER_CARD_VERSION, player, note: "", stats };
}

/** The same card with the note changed, held to the limit the inspector enforces. */
export function withPlayerNote(spec: PlayerCardSpec, note: string): PlayerCardSpec {
  return { ...spec, note: note.slice(0, PLAYER_NOTE_LIMIT) };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * A stored spec, or null when it isn't one this build can read. A stats
 * snapshot that no longer parses (an unknown version, say) becomes "no
 * stats": the player and the note are what the coach wrote, so they stay.
 */
export function parsePlayerCard(raw: unknown): PlayerCardSpec | null {
  if (!isObj(raw) || raw.type !== "player" || raw.v !== PLAYER_CARD_VERSION) return null;
  const p = raw.player;
  if (!isObj(p) || typeof p.id !== "string" || typeof p.name !== "string") return null;
  return {
    type: "player",
    v: PLAYER_CARD_VERSION,
    player: {
      id: p.id,
      name: p.name,
      number: strOrNull(p.number),
      teamId: strOrNull(p.teamId),
      teamName: typeof p.teamName === "string" ? p.teamName : "",
    },
    note: typeof raw.note === "string" ? raw.note.slice(0, PLAYER_NOTE_STORED_MAX) : "",
    stats: raw.stats == null ? null : parseCardSpec(raw.stats),
  };
}

/** The player cards in a playlist, in order. */
export function playerCardsOf(items: readonly PlaylistItem[]): PlayerCardItem[] {
  return items.filter(isPlayerCard);
}

/** Everything a viewer or an export plays: the playlist without its player cards. */
export function withoutPlayerCards<T extends PlaylistItem>(items: readonly T[]): T[] {
  return items.filter((i) => !isPlayerCard(i));
}
