/**
 * The numbers behind a stats card, on the web: the shared loader
 * (@scoutable/shared/lib/stats-card-data) reading the federation's hosted
 * pages through this app's /api/hosted-stats route (signed-in users only; the
 * route builds the page's URL from the numbers and caches each page for ten
 * minutes), with a layout change reported to Sentry. Which games have stats,
 * the play-by-play fallback, the page cache and building cards are the
 * desktop's, shared.
 *
 * Browser only: the route answers the signed-in session's cookies.
 */
import * as Sentry from "@sentry/nextjs";
import {
  createStatsCardLoader,
  hostedPageQuery,
  hostedPageSearchParams,
  type HostedPageFetcher,
} from "@scoutable/shared/lib/stats-card-data";

export {
  isHostedLayoutError,
  makeGameCard,
  makeSeasonCard,
  seasonOf,
  statsKindOf,
  type CardKeep,
  type GameStats,
  type GameStatsKind,
  type StatsPlayerOption,
} from "@scoutable/shared/lib/stats-card-data";

const ROUTE = "/api/hosted-stats";

/** One page through the route. The loader only ever asks for the two page URLs it builds. */
const fetchThroughRoute: HostedPageFetcher = async (url, fresh) => {
  const query = hostedPageQuery(url);
  if (!query) throw new Error(`Not a stats page this app reads: ${url}`);
  const res = await fetch(`${ROUTE}?${hostedPageSearchParams(query, fresh)}`, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    // The route waits up to 10 s on the federation; this covers the hop as well.
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`The stats page answered ${res.status}`);
  return res.text();
};

export const { loadGameStats, loadSeasonPlayer } = createStatsCardLoader({
  fetchPage: fetchThroughRoute,
  // A layout change is ours to fix; a network failure isn't worth a report.
  onLayoutError: (err, url) => Sentry.captureException(err, { extra: { url } }),
});
