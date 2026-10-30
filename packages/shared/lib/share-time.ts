/**
 * Groups shared things by when they were shared, the way Claude's Cowork list
 * does: "This week", "Last week", then one section per month ("October",
 * "September 2025" once it isn't this year), and anything without a readable
 * date last under "Earlier". Weeks start on Monday, in the device's local
 * calendar. Items keep their input order inside a section, so pass them
 * sorted (newest first); sections come newest first.
 */

export interface TimeSection<T> {
  /** "this-week", "last-week", "YYYY-MM" or "earlier". */
  key: string;
  title: string;
  items: T[];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Monday 00:00 of the week `d` falls in, local time. */
function startOfWeek(d: Date): Date {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sinceMonday = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - sinceMonday);
  return day;
}

export function shareTimeSections<T>(
  items: T[],
  dateOf: (item: T) => string | null | undefined,
  now: Date = new Date(),
): TimeSection<T>[] {
  const thisWeek = startOfWeek(now).getTime();
  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const lastWeekStart = lastWeek.getTime();

  const buckets = new Map<string, TimeSection<T> & { order: number }>();
  const put = (key: string, title: string, order: number, item: T) => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, title, items: [], order };
      buckets.set(key, b);
    }
    b.items.push(item);
  };

  for (const item of items) {
    const raw = dateOf(item);
    const t = raw ? new Date(raw).getTime() : NaN;
    if (Number.isNaN(t)) {
      put("earlier", "Earlier", -Infinity, item);
    } else if (t >= thisWeek) {
      put("this-week", "This week", Infinity, item);
    } else if (t >= lastWeekStart) {
      put("last-week", "Last week", Number.MAX_SAFE_INTEGER, item);
    } else {
      const d = new Date(t);
      const y = d.getFullYear();
      const m = d.getMonth();
      const key = `${y}-${String(m + 1).padStart(2, "0")}`;
      const title = y === now.getFullYear() ? MONTHS[m] : `${MONTHS[m]} ${y}`;
      put(key, title, y * 12 + m, item);
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.order - a.order)
    .map(({ key, title, items: sectionItems }) => ({ key, title, items: sectionItems }));
}
