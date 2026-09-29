/**
 * The league catalogue: what leagues and seasons the importer offers.
 *
 * A Genius "competition" IS a league-season, so a season carries exactly one
 * competitionId. The catalogue is served by the `genius` edge function (which
 * derives its fetch allowlist from the same structure, so the two can't drift)
 * and the desktop client keeps a bundled copy as a fallback.
 *
 * Two shapes live here on purpose:
 *  - `CatalogLeague` / `CatalogSeason` — the wire shape, only what the server
 *    knows. Stages are absent because nothing server-side consumes them.
 *  - `League` / `Season` / `Stage` — what the picker renders, built from the
 *    wire shape by attaching stages client-side.
 */

/** A phase within a season — regular season or playoffs. */
export interface Stage {
  id: string;
  label: string;
  /** Genius matchType this stage maps to; undefined = no filter (all games). */
  matchType?: "REGULAR" | "FINALS";
}

/**
 * One season of a league. A season carries its Genius competitionId; seasons
 * without one (national teams) have no data source wired up yet.
 */
export interface Season {
  id: string;
  label: string;
  competitionId?: number;
  stages: Stage[];
}

export interface League {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 — drives grouping and the flag in the picker. */
  country: string;
  gender?: "men" | "women";
  /** Ordered newest-first; seasons[0] is treated as the current season. */
  seasons: Season[];
}

// ---------------------------------------------------------------------------
// Wire shape — what the edge function serves
// ---------------------------------------------------------------------------

export interface CatalogSeason {
  id: string;
  label: string;
  competitionId: number;
}

export interface CatalogLeague {
  id: string;
  name: string;
  country: string;
  gender: "men" | "women";
  /** Newest first — seasons[0] is the current season. */
  seasons: CatalogSeason[];
}

/** The two stages every club season is split into. */
export const REGULAR: Stage = { id: "regular", label: "Regular season", matchType: "REGULAR" };
export const PLAYOFF: Stage = { id: "playoff", label: "Playoffs", matchType: "FINALS" };
