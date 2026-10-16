// Profixio's documented API (https://www.profixio.com/app/docs), read with
// the PROFIXIO_API_SECRET key. The key may view a fixed set of tournaments
// (`/api/userinfo` → specificTournaments) and cannot list the organisation's
// tournaments, so the catalogue is exactly what Profixio has granted: a new
// grant shows up on the next catalogue refresh without a code change.
// Response shapes verified against the live API 2026-10-16.

import {
  mapApiCategories,
  mapApiEvent,
  mapApiLineup,
  mapApiScheduleRow,
  mapApiTournament,
  mapEventType,
  sortEvents,
  type ProfixioEventType,
  type ProfixioScheduleRow,
} from "../../../packages/shared/lib/profixio-wire.ts";
import type { CatalogTournament, ProfixioDriver } from "./driver.ts";
import { ClientError, PROFIXIO_BASE, ParseError, UpstreamStatusError, type Upstream } from "./upstream.ts";

const ORGANISATION = "SBBF.SE.BB";
const PAGE_LIMIT = 500;
/** Concurrent tournament reads during a catalogue refresh. */
const CATALOG_CONCURRENCY = 4;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positive(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function dataArray(body: Json): Json[] {
  return Array.isArray(body.data) ? (body.data as unknown[]).filter(isObject) : [];
}

export function createApiDriver(secret: string): ProfixioDriver {
  let eventTypesPromise: Promise<ProfixioEventType[]> | null = null;

  async function api(up: Upstream, path: string): Promise<Json> {
    let body: unknown;
    try {
      body = await up.getJson(`${PROFIXIO_BASE}${path}`, { "X-Api-Secret": secret });
    } catch (e) {
      // A rejected key is misconfiguration, never something the client did.
      if (e instanceof UpstreamStatusError && e.status === 401) throw new ClientError(500, "server_misconfigured");
      throw e;
    }
    if (!isObject(body)) throw new ParseError(`${path}: body is not an object`);
    return body;
  }

  /** Laravel-paginated list: follows `meta.last_page`. */
  async function apiAll(up: Upstream, path: string): Promise<Json[]> {
    const all: Json[] = [];
    for (let page = 1; ; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const body = await api(up, `${path}${sep}limit=${PAGE_LIMIT}&page=${page}`);
      const data = dataArray(body);
      all.push(...data);
      const last = Number((isObject(body.meta) ? body.meta.last_page : null) ?? page);
      if (page >= last || data.length === 0) return all;
    }
  }

  /** A tournament the key no longer (or never) may view reads as an unknown league. */
  async function tournament(up: Upstream, tournamentId: number): Promise<Json> {
    try {
      const body = await api(up, `/api/tournaments/${tournamentId}`);
      if (!isObject(body.data)) throw new ParseError(`tournament ${tournamentId}: no data`);
      return body.data;
    } catch (e) {
      if (e instanceof UpstreamStatusError && (e.status === 403 || e.status === 404)) {
        throw new ClientError(404, "unknown_league");
      }
      throw e;
    }
  }

  function eventTypes(up: Upstream): Promise<ProfixioEventType[]> {
    eventTypesPromise ??= api(up, `/api/organisations/${ORGANISATION}/matchEventTypes?sport=BB`)
      .then((body) => dataArray(body).map(mapEventType))
      .catch((e) => {
        eventTypesPromise = null;
        throw e;
      });
    return eventTypesPromise;
  }

  return {
    async listTournaments(up) {
      const info = await api(up, "/api/userinfo");
      const permissions = isObject(info.permissions) ? info.permissions : {};
      const orgs = Array.isArray(permissions.organisations) ? permissions.organisations.filter(isObject) : [];
      const org = orgs.find((o) => o.organisationId === ORGANISATION);
      const grants = org && Array.isArray(org.specificTournaments) ? org.specificTournaments.filter(isObject) : [];
      const ids = [
        ...new Set(grants.filter((g) => g.basicAccess !== false).map((g) => positive(g.tournamentId)).filter((id) => id != null)),
      ] as number[];
      if (!org) console.error(`[profixio] the API key has no access to ${ORGANISATION}`);

      const tournaments: CatalogTournament[] = [];
      let complete = true;
      for (let i = 0; i < ids.length; i += CATALOG_CONCURRENCY) {
        const batch = ids.slice(i, i + CATALOG_CONCURRENCY);
        const results = await Promise.allSettled(batch.map((id) => tournament(up, id)));
        results.forEach((r, j) => {
          if (r.status === "rejected") {
            complete = false;
            console.error(`[profixio] tournament ${batch[j]} unreadable:`, r.reason instanceof Error ? r.reason.message : String(r.reason));
            return;
          }
          const t = mapApiTournament(r.value, batch[j]);
          if (t) tournaments.push(t);
        });
      }
      return { tournaments, complete };
    },

    async leagueDetail(tournamentId, up) {
      const summary = mapApiTournament(await tournament(up, tournamentId), tournamentId);
      if (!summary) throw new ClientError(404, "unknown_league");
      const categories = await apiAll(up, `/api/tournaments/${tournamentId}/matchCategories`);
      const matches = await apiAll(up, `/api/tournaments/${tournamentId}/matches`);
      return {
        leagueId: summary.leagueId,
        name: summary.name,
        districtId: summary.districtId,
        tournamentId,
        seasonId: summary.seasonId,
        categories: mapApiCategories(categories, matches),
      };
    },

    async schedule(league, categoryId, up) {
      if (!league.tournamentId) throw new ClientError(404, "unknown_league");
      const matches = await apiAll(up, `/api/tournaments/${league.tournamentId}/matches?matchCategory=${categoryId}`);
      const rows: ProfixioScheduleRow[] = matches
        .map((m) => mapApiScheduleRow(m, league.leagueId))
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.matchId - b.matchId);
      return { rows, partial: false };
    },

    async match(league, _categoryId, matchId, up) {
      if (!league.tournamentId) throw new ClientError(404, "unknown_league");
      const base = `/api/tournaments/${league.tournamentId}/matches/${matchId}`;
      const matchBody = await api(up, base);
      const match = isObject(matchBody.data) ? matchBody.data : {};
      const homeTeamId = positive(isObject(match.homeTeam) ? match.homeTeam.teamRegistrationId : null);
      const awayTeamId = positive(isObject(match.awayTeam) ? match.awayTeam.teamRegistrationId : null);

      const events = sortEvents(dataArray(await api(up, `${base}/events`)).map(mapApiEvent));

      let lineup: ReturnType<typeof mapApiLineup> = [];
      try {
        lineup = mapApiLineup(await api(up, `${base}/lineup`), { homeTeamId, awayTeamId });
      } catch (e) {
        // 403 until lineupAvailableFrom; a match without names still imports.
        if (!(e instanceof UpstreamStatusError && e.status === 403)) {
          console.error(`[profixio] match ${matchId} lineup unreadable:`, e instanceof Error ? e.message : String(e));
        }
      }

      let types: ProfixioEventType[] = [];
      try {
        types = await eventTypes(up);
      } catch (e) {
        console.error("[profixio] event types unreadable:", e instanceof Error ? e.message : String(e));
      }

      const periodInfo = isObject(match.periodInfo) ? match.periodInfo : {};
      const kickoff = typeof match.datetimeStart === "string" ? Date.parse(match.datetimeStart) : NaN;
      const state = events.some((e) => e.stopsMatch)
        ? "full_time"
        : Number.isFinite(kickoff) && kickoff > Date.now()
          ? "not_started"
          : events.length > 0
            ? "in_progress"
            : "not_started";
      return {
        homeWebId: homeTeamId,
        awayWebId: awayTeamId,
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
