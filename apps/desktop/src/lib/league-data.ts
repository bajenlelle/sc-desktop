import type { GeniusFixture } from "@scoutable/shared/lib/genius";
import { getGeniusFixtures, getGeniusSeason } from "@scoutable/shared/lib/genius-client";
import type { SeasonPayload } from "@scoutable/shared/lib/season-payload";
import { createClient } from "@/lib/supabase/client";

/**
 * A competition's season and fixture list, as the game's Stats view and the
 * Teams pages read them. One request per competition per half hour; the
 * `genius` function caches both behind it. A failure is asked again next time.
 */
const TTL_MS = 30 * 60 * 1000;

const seasons = new Map<number, { at: number; payload: Promise<SeasonPayload | null> }>();
const fixtureLists = new Map<number, { at: number; fixtures: Promise<GeniusFixture[]> }>();

/** The competition's season; null from a genius function that predates the season action. */
export function loadSeason(competitionId: number): Promise<SeasonPayload | null> {
  const hit = seasons.get(competitionId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.payload;
  const payload = (async () => {
    const res = await getGeniusSeason(createClient(), competitionId);
    if (!res.ok && res.error === "unknown_action") return null;
    if (!res.ok) throw new Error(`season: ${res.error}`);
    return res.data;
  })();
  seasons.set(competitionId, { at: Date.now(), payload });
  payload.catch(() => {
    if (seasons.get(competitionId)?.payload === payload) seasons.delete(competitionId);
  });
  return payload;
}

/** The competition's fixture list, every game played or to come. */
export function loadFixtures(competitionId: number): Promise<GeniusFixture[]> {
  const hit = fixtureLists.get(competitionId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.fixtures;
  const fixtures = (async () => {
    const res = await getGeniusFixtures(createClient(), competitionId);
    if (!res.ok) throw new Error(`fixtures: ${res.error}`);
    return res.data.fixtures ?? [];
  })();
  fixtureLists.set(competitionId, { at: Date.now(), fixtures });
  fixtures.catch(() => {
    if (fixtureLists.get(competitionId)?.fixtures === fixtures) fixtureLists.delete(competitionId);
  });
  return fixtures;
}

/** Forgets what was read of a competition, so Try again asks the function afresh. */
export function forgetLeague(competitionId: number): void {
  seasons.delete(competitionId);
  fixtureLists.delete(competitionId);
}
