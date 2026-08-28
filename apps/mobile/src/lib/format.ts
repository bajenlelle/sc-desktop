/** "2h ago" / initials — single implementations live in the shared feed module. */
export { relativeTimeShort as relativeTime, initials } from "@scoutable/shared/lib/playlist-feed";

/** "12 apr. 2026" style date for clip context lines (sv-SE like web). */
export function shortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" });
}
