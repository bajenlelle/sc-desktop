// The two ways to read Profixio, behind one interface. index.ts picks the
// driver per request: the documented API when PROFIXIO_API_SECRET is set,
// the public pages otherwise. Both return the shapes in profixio-wire.ts.

import type {
  ProfixioCategory,
  ProfixioEvent,
  ProfixioEventType,
  ProfixioLineupRow,
  ProfixioScheduleRow,
} from "../../../packages/shared/lib/profixio-wire.ts";
import type { Upstream } from "./upstream.ts";

export interface District {
  id: number;
  name: string;
}

/** One district-season's competition list, as crawled. */
export interface DistrictSeasonLeagues {
  seasonId: number;
  seasonLabel: string;
  leagues: Array<{ leagueId: number; name: string }>;
}

/** = a profixio_league_cache row. */
export interface LeagueDetail {
  leagueId: number;
  name: string;
  districtId: number | null;
  tournamentId: number | null;
  seasonId: number | null;
  categories: ProfixioCategory[];
}

/** Everything a driver can know about a match; index.ts adds the schedule row, ids and timestamps. */
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
  readonly kind: "public" | "api";
  /** The leagues of one district for the newest `seasons` seasons. */
  listDistrictLeagues(district: District, seasons: number, up: Upstream): Promise<DistrictSeasonLeagues[]>;
  leagueDetail(leagueId: number, up: Upstream): Promise<LeagueDetail>;
  schedule(league: LeagueDetail, categoryId: number, up: Upstream): Promise<{ rows: ProfixioScheduleRow[]; partial: boolean }>;
  match(league: LeagueDetail, categoryId: number, matchId: number, up: Upstream): Promise<MatchFetch>;
}
