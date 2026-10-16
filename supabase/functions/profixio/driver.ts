// How index.ts reads Profixio: its documented API (driver-api.ts), behind
// this interface so the handler and the cache never see raw API shapes. Every
// method returns the shapes in profixio-wire.ts.

import type {
  ProfixioCategory,
  ProfixioEvent,
  ProfixioEventType,
  ProfixioLineupRow,
  ProfixioScheduleRow,
  ProfixioTournamentSummary,
} from "../../../packages/shared/lib/profixio-wire.ts";
import type { Upstream } from "./upstream.ts";

/** One tournament the API key may view, as the catalogue lists it. */
export type CatalogTournament = ProfixioTournamentSummary;

/** = a profixio_league_cache row. */
export interface LeagueDetail {
  leagueId: number;
  name: string;
  districtId: number | null;
  tournamentId: number | null;
  seasonId: number | null;
  categories: ProfixioCategory[];
}

/** Everything the API says about a match; index.ts adds the schedule row, ids and timestamps. */
export interface MatchFetch {
  homeWebId: number | null;
  awayWebId: number | null;
  matchPeriods: number;
  useMatchClock: boolean;
  state: string;
  eventTypes: ProfixioEventType[];
  /** Oldest first. */
  events: ProfixioEvent[];
  lineup: ProfixioLineupRow[];
}

export interface ProfixioDriver {
  /** The tournaments the key may view; `complete` is false when one of them could not be read. */
  listTournaments(up: Upstream): Promise<{ tournaments: CatalogTournament[]; complete: boolean }>;
  leagueDetail(tournamentId: number, up: Upstream): Promise<LeagueDetail>;
  schedule(league: LeagueDetail, categoryId: number, up: Upstream): Promise<{ rows: ProfixioScheduleRow[]; partial: boolean }>;
  match(league: LeagueDetail, categoryId: number, matchId: number, up: Upstream): Promise<MatchFetch>;
}
