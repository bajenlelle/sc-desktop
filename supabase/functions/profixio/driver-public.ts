// Public-pages driver: Profixio's old-style league pages plus the Livewire
// calls that fill their lazy lists. Prototype path until SBBF issues an API
// token — everything Profixio-markup-specific is in the pure extractors
// (packages/shared/lib/profixio-html.ts, vitest-tested against saved snippets),
// this file only composes them. Deletable wholesale once the API driver is
// verified.

import {
  hasLoadPostsInit,
  parseCategoryLinks,
  parseCompetitionLinks,
  parseCsrf,
  parseLazyLoadParam,
  parseMatchCards,
  parseMatchPage,
  parseNavState,
  parseSeasonOptions,
  parseUpdateUri,
  parseWireSnapshots,
  textOf,
} from "../../../packages/shared/lib/profixio-html.ts";
import {
  deriveHomeWebId,
  mapEventType,
  mapPublicEvent,
  mapPublicLineup,
  otherTeamId,
  sortEvents,
  type ProfixioScheduleRow,
} from "../../../packages/shared/lib/profixio-wire.ts";
import type { DistrictSeasonLeagues, LeagueDetail, MatchFetch, ProfixioDriver } from "./driver.ts";
import { ParseError, PROFIXIO_BASE, type Upstream } from "./upstream.ts";

const FEDERATION = "SBBF";

function livewireBootstrap(page: string, componentName: string) {
  const csrf = parseCsrf(page);
  const updateUri = parseUpdateUri(page) ?? `${PROFIXIO_BASE}/livewire/update`;
  const snapshot = parseWireSnapshots(page).find((s) => s.name === componentName);
  if (!csrf || !snapshot) throw new ParseError(`${componentName}: livewire bootstrap not found`);
  return { csrf, updateUri, snapshot };
}

function titleOf(page: string): string {
  const raw = page.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
  return textOf(raw).replace(/\s*[-–|]\s*Profixio\s*$/i, "").trim();
}

export const publicDriver: ProfixioDriver = {
  kind: "public",

  async listDistrictLeagues(district, seasons, up) {
    const url = `${PROFIXIO_BASE}/lx/${FEDERATION}/district/${district.id}`;
    const page = await up.get(url);
    const { csrf, updateUri, snapshot } = livewireBootstrap(page, "lx.competition-list");
    const param = parseLazyLoadParam(page);
    if (!param) throw new ParseError(`district ${district.id}: lazy-load parameter not found`);

    // The lazy list renders the current season and a season <select>.
    let res = await up.livewire(url, csrf, updateUri, snapshot.raw, [{ method: "__lazyLoad", params: [param] }]);
    const options = parseSeasonOptions(res.html);
    if (options.length === 0) throw new ParseError(`district ${district.id}: season selector not found`);

    const out: DistrictSeasonLeagues[] = [];
    for (const [i, season] of options.slice(0, Math.max(1, seasons)).entries()) {
      if (i > 0) {
        if (up.pastDeadline()) break;
        res = await up.livewire(url, csrf, updateUri, res.snapshot, [], { season_id: season.seasonId });
      }
      out.push({ seasonId: season.seasonId, seasonLabel: season.label, leagues: parseCompetitionLinks(res.html) });
    }
    return out;
  },

  async leagueDetail(leagueId, up) {
    const page = await up.get(`${PROFIXIO_BASE}/leagueid${leagueId}`);
    const name = titleOf(page);
    const nav = parseNavState(page);
    if (!name || !nav) throw new ParseError(`league ${leagueId}: title or nav state not found`);
    const categoriesPage = await up.get(`${PROFIXIO_BASE}/leagueid${leagueId}/categories`);
    return {
      leagueId,
      name,
      districtId: nav.districtId,
      tournamentId: nav.tournamentId,
      seasonId: nav.seasonId,
      categories: parseCategoryLinks(categoriesPage, leagueId),
    };
  },

  async schedule(league, categoryId, up) {
    const url = `${PROFIXIO_BASE}/leagueid${league.leagueId}/category/${categoryId}`;
    const page = await up.get(url);
    const byId = new Map<number, ProfixioScheduleRow>(parseMatchCards(page, league.leagueId).map((r) => [r.matchId, r]));
    let partial = false;
    if (hasLoadPostsInit(page)) {
      // More than ~100 matches: the page rendered a slice and loads the rest
      // in the browser. One Livewire call returns the full list.
      try {
        const { csrf, updateUri, snapshot } = livewireBootstrap(page, "matches.matches-per-category");
        const res = await up.livewire(url, csrf, updateUri, snapshot.raw, [{ method: "loadPosts", params: [] }]);
        for (const row of parseMatchCards(res.html, league.leagueId)) byId.set(row.matchId, row);
      } catch (e) {
        console.error(`[profixio] loadPosts failed for ${league.leagueId}/${categoryId}:`, e instanceof Error ? e.message : String(e));
        partial = true;
      }
    }
    const rows = [...byId.values()].sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.matchId - b.matchId);
    return { rows, partial };
  },

  async match(league, _categoryId, matchId, up) {
    const page = await up.get(`${PROFIXIO_BASE}/leagueid${league.leagueId}/match/${matchId}`);
    const state = parseMatchPage(page);
    if (!state) throw new ParseError(`match ${matchId}: inline state not found`);
    const events = sortEvents(state.events.map(mapPublicEvent));
    const lineup = state.lineup.map(mapPublicLineup);
    const homeWebId = state.homeWebId ?? deriveHomeWebId(events);
    const awayWebId = state.awayWebId ?? otherTeamId(events, homeWebId);
    const gamestate = state.gamestate ?? {};
    const matchState = events.some((e) => e.stopsMatch)
      ? "full_time"
      : events.length > 0 || Number(gamestate.period) > 0
        ? "in_progress"
        : "not_started";
    return {
      homeWebId,
      awayWebId,
      matchPeriods: state.matchPeriods,
      useMatchClock: state.useMatchClock,
      state: matchState,
      eventTypes: state.eventtypes.map(mapEventType),
      events,
      lineup,
    };
  },
};
