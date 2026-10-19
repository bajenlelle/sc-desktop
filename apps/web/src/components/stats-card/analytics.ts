import type { StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import { trackEvent } from "@/lib/analytics";

/** Where a stats card was added from, as the desktop names it. */
export type StatsCardEntry = "menu" | "row" | "suggestion";

/**
 * The desktop's stats_card_inserted, from the web. Fire it once the card is
 * in the playlist (after the insert succeeds), as the desktop does; the
 * inspector doesn't, since it only hands back the card.
 */
export function trackStatsCardInserted(spec: StatsCardSpec, entry: StatsCardEntry): void {
  trackEvent("stats_card_inserted", {
    entry,
    scope: spec.scope,
    source: spec.source,
    columns: spec.columns.length,
    origin: "web",
  });
}
