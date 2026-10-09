/**
 * Dates as the app shows them: English words in Swedish order
 * ("19 Sept 2026"), the same on every screen. Pass an ISO string, a
 * timestamp or a Date.
 */
const LOCALE = "en-SE";

type DateInput = string | number | Date;

export function formatDate(value: DateInput, style: "short" | "medium" | "long" = "medium"): string {
  const d = value instanceof Date ? value : new Date(value);
  if (style === "short") return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
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
