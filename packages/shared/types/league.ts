/**
 * The league catalogue: what leagues and seasons the importer offers.
 *
 * Two providers feed it:
 *  - Genius Sports (SBF's national leagues). A Genius "competition" IS a
 *    league-season, so such a season carries exactly one `competitionId`.
 *  - Profixio (SBBF district basketball). A season carries a `profixio`
 *    handle — the public "avdelning" id behind `profixio.com/app/leagueid{N}`
 *    (a new id every season) plus, when known, the documented API's
 *    tournament id. Its stages are the Profixio match categories ("Nivå 1",
 *    "Nivå 2A", …) and are fetched lazily once the season is selected.
 *
 * Each provider's catalogue is served by its own edge function (`genius`,
 * `profixio`); the desktop client merges them and keeps a bundled Genius copy
 * as a fallback. Two shapes live here on purpose:
 *  - `CatalogLeague` / `CatalogSeason` — the wire shape, only what the server
 *    knows. Genius stages are absent because nothing server-side consumes them.
 *  - `League` / `Season` / `Stage` — what the picker renders, built from the
 *    wire shape by attaching stages client-side.
 */

export type LeagueProvider = "genius" | "profixio";

/** What the `profixio` function needs to address one league-season. */
export interface ProfixioSeasonHandle {
  /** Public "avdelning" id — the `leagueid{N}` in profixio.com URLs. */
  leagueId: number;
  /** Profixio season id (e.g. 776 = 2026/27). Informational. */
  seasonId?: number;
  /** Documented-API tournament id, once learned. */
  tournamentId?: number;
}

/** A phase within a season — regular season / playoffs, or a Profixio category. */
export interface Stage {
  id: string;
  label: string;
  /** Genius matchType this stage maps to; undefined = no filter (all games). */
  matchType?: "REGULAR" | "FINALS";
  /** Profixio match-category id; only on stages resolved for a Profixio season. */
  categoryId?: number;
}

/**
 * One season of a league. Genius seasons carry a competitionId; Profixio
 * seasons carry a `profixio` handle; national-team placeholders carry neither
 * (no data source wired up yet).
 */
export interface Season {
  id: string;
  label: string;
  competitionId?: number;
  /** Absent = genius (bundled and national-team placeholders never set it). */
  provider?: LeagueProvider;
  profixio?: ProfixioSeasonHandle;
  /** Genius: [REGULAR, PLAYOFF]. Profixio: [] until the categories are fetched. */
  stages: Stage[];
}

export interface League {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 — drives grouping and the flag in the picker. */
  country: string;
  gender?: "men" | "women";
  /** District / federation, e.g. "Stockholm Basket" — the picker group when present. */
  region?: string;
  provider?: LeagueProvider;
  /** Ordered newest-first; seasons[0] is treated as the current season. */
  seasons: Season[];
}

// ---------------------------------------------------------------------------
// Wire shape — what the edge functions serve
// ---------------------------------------------------------------------------

export interface CatalogGeniusSeason {
  id: string;
  label: string;
  competitionId: number;
  provider?: "genius";
}

export interface CatalogProfixioSeason {
  id: string;
  label: string;
  provider: "profixio";
  profixio: ProfixioSeasonHandle;
}

/** Discriminated so a reader can't take a competitionId off a Profixio season. */
export type CatalogSeason = CatalogGeniusSeason | CatalogProfixioSeason;

export interface CatalogLeague {
  id: string;
  name: string;
  country: string;
  /** Required for Genius leagues; youth league names don't always carry one. */
  gender?: "men" | "women";
  region?: string;
  provider?: LeagueProvider;
  /** Newest first — seasons[0] is the current season. */
  seasons: CatalogSeason[];
}

/** The two stages every Genius club season is split into. */
export const REGULAR: Stage = { id: "regular", label: "Regular season", matchType: "REGULAR" };
export const PLAYOFF: Stage = { id: "playoff", label: "Playoffs", matchType: "FINALS" };
