/**
 * The numbers behind a stats card, on the desktop: the shared loader
 * (@scoutable/shared/lib/stats-card-data) reading the federation's hosted
 * pages through the app's HTTP client, with a layout change reported to
 * Sentry. Everything else (which games have stats, the fallbacks, the page
 * cache, building cards) is shared with the web.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createStatsCardLoader } from "@scoutable/shared/lib/stats-card-data";
import { Sentry } from "@/lib/sentry";

export {
  leagueSeasonsOf,
  makeGameCard,
  makeSeasonCard,
  seasonOf,
  statsKindOf,
  type CardKeep,
  type GameStats,
  type GameStatsKind,
  type StatsPlayerOption,
} from "@scoutable/shared/lib/stats-card-data";

/**
 * A page the federation hasn't served lately takes 10 to 12 seconds to come
 * back (the same page is 0.1 s once it is warm), so the first read of a
 * season is slow, not broken: the limit is well past that, and one failed
 * attempt (a timeout, a 5xx) is asked again, since the second hits the warm
 * page. A 4xx won't change by asking again.
 */
const PAGE_TIMEOUT_MS = 30_000;
const PAGE_ATTEMPTS = 2;

export const { loadGameStats, loadSeasonPlayer, loadSeasonPlayers } = createStatsCardLoader({
  fetchPage: async (url) => {
    let failure: unknown = new Error("The stats page could not be read");
    for (let attempt = 0; attempt < PAGE_ATTEMPTS; attempt++) {
      try {
        const res = await tauriFetch(url, { method: "GET", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
        if (res.ok) return await res.text();
        failure = new Error(`The stats page answered ${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        failure = e;
      }
    }
    throw failure;
  },
  // A layout change is ours to fix; a network failure isn't worth a report.
  onLayoutError: (err) => Sentry.captureException(err),
});
