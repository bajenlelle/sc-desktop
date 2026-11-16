/**
 * What a coach opened last on this computer: playlists, reports and games,
 * newest first. The desktop's search shows it before anything is typed, and
 * uses it to order equally good matches (lib/quick-search.ts). Pure: the
 * desktop keeps the list per user and space (apps/desktop/src/lib/recent-opens.ts).
 */

/** The kinds of thing the search finds. A report is its playlist's: its id is the playlist's id. */
export type OpenKind = "playlist" | "report" | "game";

export interface RecentOpen {
  kind: OpenKind;
  id: string;
  /** When it was opened, in milliseconds. */
  at: number;
}

/** How many are remembered: more than the search shows, so a deleted one doesn't leave a gap. */
export const RECENT_OPENS_MAX = 20;

const KINDS: readonly string[] = ["playlist", "report", "game"];

/** The list with `what` first: one entry per thing, the oldest forgotten past `max`. */
export function noteOpened(list: readonly RecentOpen[], what: { kind: OpenKind; id: string }, now: number, max = RECENT_OPENS_MAX): RecentOpen[] {
  const rest = list.filter((r) => !(r.kind === what.kind && r.id === what.id));
  return [{ kind: what.kind, id: what.id, at: now }, ...rest].slice(0, max);
}

/** A stored list read back: anything it can't read is left out. */
export function parseRecentOpens(raw: unknown): RecentOpen[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentOpen[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { kind, id, at } = entry as Record<string, unknown>;
    if (typeof kind !== "string" || !KINDS.includes(kind) || typeof id !== "string" || typeof at !== "number") continue;
    out.push({ kind: kind as OpenKind, id, at });
    if (out.length === RECENT_OPENS_MAX) break;
  }
  return out;
}
