/**
 * Pure logic for consumption surfaces (web/mobile my-playlists) that load
 * match context for playlists: which matches a feed actually needs, merging
 * separately-fetched events into light match shells, and club-badged team
 * maps for the aggregated player feed.
 */
import { isClipItem, type Playlist, type PlayByPlayEvent, type StoredMatch } from '../types/match';
import type { OrgTeam } from '../types/org';

/**
 * The matches a set of playlists can actually play: unique matchIds from
 * clip items shipped to R2. Unshipped clips never render on consumption
 * surfaces, so their matches' events would be dead weight.
 */
export function collectReferencedMatchIds(playlists: Playlist[]): string[] {
  const ids = new Set<string>();
  for (const pl of playlists) {
    for (const item of pl.items) {
      if (isClipItem(item) && item.r2Url) ids.add(item.matchId);
    }
  }
  return [...ids];
}

/**
 * Fill listMatchesLight shells with events fetched via listEventsForMatches.
 * Callers must publish the merged result in ONE state update — clip rows
 * silently drop when an event lookup misses, so a light-shells-first render
 * window would flash every playlist empty.
 */
export function mergeEventsIntoMatches(
  shells: StoredMatch[],
  eventsByMatch: Record<string, PlayByPlayEvent[]>
): StoredMatch[] {
  return shells.map((m) => ({ ...m, events: eventsByMatch[m.id] ?? [] }));
}

/**
 * Team map for the feed's badges. In the aggregated multi-club feed each
 * team name is prefixed with its club ("AIK · U16") so identically-named
 * teams from different clubs stay tellable apart; single-club and scoped
 * feeds keep raw names. Null entries (a club whose context failed to load)
 * are skipped without breaking the org↔teams pairing.
 */
export function buildAggregatedTeamMap(
  entries: Array<{ orgName?: string; teams: OrgTeam[] } | null>,
  multiClub: boolean
): Map<string, OrgTeam> {
  const map = new Map<string, OrgTeam>();
  for (const entry of entries) {
    if (!entry) continue;
    for (const t of entry.teams) {
      const name = multiClub && entry.orgName ? `${entry.orgName} · ${t.name}` : t.name;
      map.set(t.id, { ...t, name });
    }
  }
  return map;
}
