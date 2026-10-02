// Documented-API driver (https://www.profixio.com/app/docs). Activates when
// the PROFIXIO_API_SECRET function secret is set. Written from the OpenAPI
// examples — NOT yet exercised against a real token. Every place where the
// examples leave a field unverified is marked TODO(verify-with-token). Until
// the API is confirmed to expose the public "avdelning" ids (the ids the
// catalogue and the client address everything by), league discovery and
// league detail still read the public pages.

import {
  mapApiEvent,
  mapApiLineup,
  mapApiScheduleRow,
  mapEventType,
  deriveHomeWebId,
  otherTeamId,
  sortEvents,
  type ProfixioEventType,
  type ProfixioScheduleRow,
} from "../../../packages/shared/lib/profixio-wire.ts";
import type { LeagueDetail, ProfixioDriver } from "./driver.ts";
import { publicDriver } from "./driver-public.ts";
import { ClientError, PROFIXIO_BASE, type Upstream } from "./upstream.ts";

const ORGANISATION = "SBBF.SE.BB";
const PAGE_LIMIT = 500;

type Json = Record<string, unknown>;

export function createApiDriver(secret: string): ProfixioDriver {
  let eventTypesPromise: Promise<ProfixioEventType[]> | null = null;

  async function api(up: Upstream, path: string): Promise<Json> {
    try {
      return (await up.getJson(`${PROFIXIO_BASE}${path}`, { "X-Api-Secret": secret })) as Json;
    } catch (e) {
      // A rejected secret must surface as misconfiguration, never as a silent fallback to scraping.
      if (e instanceof Error && /profixio 401 /.test(e.message)) throw new ClientError(500, "server_misconfigured");
      throw e;
    }
  }

  /** Laravel-paginated list: follows `meta.last_page`. */
  async function apiAll(up: Upstream, path: string): Promise<Json[]> {
    const all: Json[] = [];
    for (let page = 1; ; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const body = await api(up, `${path}${sep}limit=${PAGE_LIMIT}&page=${page}`);
      const data = Array.isArray(body.data) ? (body.data as Json[]) : [];
      all.push(...data);
      const last = Number((body.meta as Json | undefined)?.last_page ?? page);
      if (page >= last || data.length === 0) return all;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  function eventTypes(up: Upstream): Promise<ProfixioEventType[]> {
    eventTypesPromise ??= api(up, `/api/organisations/${ORGANISATION}/matchEventTypes?sport=BB`)
      .then((body) => (Array.isArray(body.data) ? (body.data as Json[]).map(mapEventType) : []))
      .catch((e) => {
        eventTypesPromise = null;
        throw e;
      });
    return eventTypesPromise;
  }

  function tournamentIdOf(league: LeagueDetail): number | null {
    return league.tournamentId && league.tournamentId > 0 ? league.tournamentId : null;
  }

  return {
    kind: "api",

    // TODO(verify-with-token): /api/seasons/{s}/tournaments?sportId=BB lists
    // tournaments with matchCategories and a slug like "leagueid17550"; once
    // confirmed, build the catalogue from it instead of the public pages.
    listDistrictLeagues: (district, seasons, up) => publicDriver.listDistrictLeagues(district, seasons, up),
    leagueDetail: (leagueId, up) => publicDriver.leagueDetail(leagueId, up),

    async schedule(league, categoryId, up) {
      const tournamentId = tournamentIdOf(league);
      if (!tournamentId) return publicDriver.schedule(league, categoryId, up);
      const matches = await apiAll(up, `/api/tournaments/${tournamentId}/matches?matchCategory=${categoryId}`);
      const rows: ProfixioScheduleRow[] = matches
        .map((m) => mapApiScheduleRow(m, league.leagueId))
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.matchId - b.matchId);
      return { rows, partial: false };
    },

    async match(league, categoryId, matchId, up) {
      const tournamentId = tournamentIdOf(league);
      if (!tournamentId) return publicDriver.match(league, categoryId, matchId, up);
      const base = `/api/tournaments/${tournamentId}/matches/${matchId}`;
      const [matchBody, eventsBody, types] = [await api(up, base), await api(up, `${base}/events`), await eventTypes(up)];
      let lineupRaw: Json[] = [];
      try {
        const lineupBody = await api(up, `${base}/lineup`);
        lineupRaw = Array.isArray(lineupBody.data) ? (lineupBody.data as Json[]) : [];
      } catch {
        // 403 before lineupAvailableFrom — a match without a lineup is still importable.
      }
      const events = sortEvents((Array.isArray(eventsBody.data) ? (eventsBody.data as Json[]) : []).map(mapApiEvent));
      const lineup = lineupRaw.map(mapApiLineup);
      const match = (matchBody.data ?? {}) as Json;
      const periodInfo = (match.periodInfo ?? {}) as Json;
      // TODO(verify-with-token): whether event.teamId is the web team id (as
      // on the public page) and which field carries the match state.
      const homeWebId = deriveHomeWebId(events);
      const awayWebId = otherTeamId(events, homeWebId);
      const kickoff = typeof match.datetimeStart === "string" ? Date.parse(match.datetimeStart) : NaN;
      const state = events.some((e) => e.stopsMatch)
        ? "full_time"
        : Number.isFinite(kickoff) && kickoff > Date.now()
          ? "not_started"
          : events.length > 0
            ? "in_progress"
            : "not_started";
      return {
        homeWebId,
        awayWebId,
        matchPeriods: Number(periodInfo.numberOfPeriods) || 4,
        useMatchClock: events.some((e) => e.clock != null),
        state,
        eventTypes: types,
        events,
        lineup,
      };
    },
  };
}
