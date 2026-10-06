/**
 * BasketTV (Solidsport) games for the nightly tip-off job: the pure parts.
 * The job (scripts/nightly-tipoff) fetches the channel's past games from the
 * public API, maps them with `toGame`, and picks what to process with
 * `selectGamesToProcess`; this module never touches the network.
 */

/** League name as BasketTV's `event.name` → the league's channel slug. */
export const LEAGUE_CHANNELS = {
  "Herrar - Superettan Herr": "superettanherr",
  "Herrar - Basketettan Herr": "basketettan-herr",
  "Damer - Basketettan Dam": "basketettan-dam",
} as const;

export type LeagueChannel = (typeof LEAGUE_CHANNELS)[keyof typeof LEAGUE_CHANNELS];

/** Channels the scheduled run covers during the pilot; manual runs may name any channel. */
export const PILOT_CHANNELS: LeagueChannel[] = ["superettanherr"];

/** A replay is processed only once the game has been over this long (final cut published). */
export const SETTLE_S = 30 * 60;
/** Failed games are retried on later runs up to this many attempts in total. */
export const MAX_ATTEMPTS = 3;
/** Model readings vary between passes, so a "not found" gets one more look. */
export const MAX_NOT_FOUND_ATTEMPTS = 2;

/** The fields of a `timeline_objects/collections/past_games` item the job relies on. */
export interface BaskettvPastGame {
  slug: string;
  title: string;
  start_at: number;
  end_at: number | null;
  is_replay: boolean;
  has_livestream: boolean;
  home_score: number | null;
  away_score: number | null;
  event: { name: string } | null;
  home_team: { name: string } | null;
  away_team: { name: string } | null;
}

export interface BaskettvGame {
  slug: string;
  channel: string;
  league: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  score: string | null;
  /** Unix seconds. */
  startAt: number;
  endAt: number | null;
  isReplay: boolean;
}

export type RunStatus = "found" | "starts_after_tipoff" | "not_found" | "failed";

export interface RecordedRun {
  status: RunStatus;
  attempts: number;
}

export function toGame(raw: BaskettvPastGame, channel: string): BaskettvGame {
  const score = raw.home_score != null && raw.away_score != null ? `${raw.home_score}-${raw.away_score}` : null;
  return {
    slug: raw.slug,
    channel,
    league: raw.event?.name ?? null,
    homeTeam: raw.home_team?.name ?? null,
    awayTeam: raw.away_team?.name ?? null,
    score,
    startAt: raw.start_at,
    endAt: raw.end_at ?? null,
    isReplay: !!raw.is_replay,
  };
}

export interface SelectOptions {
  nowTs: number;
  /** Oldest game start to consider (unix seconds). */
  sinceTs: number;
  /** Earlier outcomes by slug. */
  recorded: Map<string, RecordedRun>;
  /** Explicit slugs: processed in this order regardless of window and earlier outcomes. */
  only?: string[];
  max: number;
}

/**
 * Which games a run should process: finished replays inside the window, newest
 * first, that have no final outcome yet (failures get a few more tries), capped
 * at `max`. With `only`, exactly those games, in that order.
 */
export function selectGamesToProcess(games: BaskettvGame[], opts: SelectOptions): BaskettvGame[] {
  const bySlug = new Map<string, BaskettvGame>();
  for (const g of games) if (!bySlug.has(g.slug)) bySlug.set(g.slug, g);

  if (opts.only) {
    return opts.only.map((slug) => bySlug.get(slug)).filter((g): g is BaskettvGame => g != null).slice(0, opts.max);
  }

  const due = (g: BaskettvGame) => {
    if (!g.isReplay || g.startAt < opts.sinceTs) return false;
    if (g.endAt != null && g.endAt > opts.nowTs - SETTLE_S) return false;
    const rec = opts.recorded.get(g.slug);
    if (!rec) return true;
    if (rec.status === "failed") return rec.attempts < MAX_ATTEMPTS;
    if (rec.status === "not_found") return rec.attempts < MAX_NOT_FOUND_ATTEMPTS;
    return false;
  };
  return [...bySlug.values()]
    .filter(due)
    .sort((a, b) => b.startAt - a.startAt)
    .slice(0, opts.max);
}

/** Public game page on the league's channel (the form Leonard uses in outreach). */
export function gameUrl(channel: string, slug: string): string {
  return `https://baskettv.se/${channel}/games/g/${slug}`;
}
