/**
 * Dates as the web app shows them (apps/web/src/lib/format-date.ts): English
 * words in Swedish order, "2 Oct" / "19 Sept 2026". Spelled out here rather
 * than through toLocaleDateString, whose locale data differs between iOS and
 * Android (Android printed "2 okt.").
 */
export { initials } from "@scoutable/shared/lib/playlist-feed";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

type DateInput = string | number | Date;

export function formatDate(value: DateInput, style: "short" | "medium" = "medium"): string {
  const d = value instanceof Date ? value : new Date(value);
  const dayMonth = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return style === "short" ? dayMonth : `${dayMonth} ${d.getFullYear()}`;
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date: how long ago something was shared or done. */
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

/** "today", "yesterday", or a short date: how recently something happened. */
export function formatRecentDay(value: DateInput, now: number = Date.now()): string {
  const d = value instanceof Date ? value : new Date(value);
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return formatDate(d, "short");
}

/** A clip's game date, as in the clip context lines. */
export function shortDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDate(d);
}
