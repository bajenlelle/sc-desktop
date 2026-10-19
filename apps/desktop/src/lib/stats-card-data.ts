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
  makeGameCard,
  makeSeasonCard,
  seasonOf,
  statsKindOf,
  type CardKeep,
  type GameStats,
  type GameStatsKind,
  type StatsPlayerOption,
} from "@scoutable/shared/lib/stats-card-data";

export const { loadGameStats, loadSeasonPlayer } = createStatsCardLoader({
  fetchPage: async (url) => {
    const res = await tauriFetch(url, { method: "GET", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`The stats page answered ${res.status}`);
    return res.text();
  },
  // A layout change is ours to fix; a network failure isn't worth a report.
  onLayoutError: (err) => Sentry.captureException(err),
});
