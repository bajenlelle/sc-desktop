/**
 * Dates as the app shows them: English words in Swedish order
 * ("19 Sept 2026"), the same on every screen. Pass an ISO string, a
 * timestamp or a Date.
 */
const LOCALE = "en-SE";

type DateInput = string | number | Date;

export function formatDate(value: DateInput, style: "short" | "medium" | "long" | "weekday" = "medium"): string {
  const d = value instanceof Date ? value : new Date(value);
  if (style === "short") return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
  if (style === "weekday") return d.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric", month: "short" });
  if (style === "long") return d.toLocaleDateString(LOCALE, { day: "numeric", month: "long", year: "numeric" });
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

/** "today", "yesterday", or a short date: how recently something happened. */
export function formatRecentDay(value: DateInput): string {
  const d = value instanceof Date ? value : new Date(value);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return formatDate(d, "short");
}

/**
 * "just now", "5m ago", "3h ago", "2d ago", then the date: how long ago
 * something was shared or done. Same steps as the shared relativeTimeShort,
 * with the date in the app's own format.
 */
export function relativeTime(iso?: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(then, "short");
}
