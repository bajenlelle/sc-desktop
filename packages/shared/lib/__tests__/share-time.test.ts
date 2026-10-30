import { describe, expect, it } from "vitest";
import { shareTimeSections } from "../share-time";

/** Local-calendar dates, so the tests pass in any time zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
// Wednesday 28 October 2026, noon: this week starts Monday 26 Oct, last week Monday 19 Oct.
const NOW = new Date(2026, 9, 28, 12, 0);

type Item = { id: string; at?: string | null };
const titles = (items: Item[]) =>
  shareTimeSections(items, (i) => i.at, NOW).map((s) => `${s.title}: ${s.items.map((i) => i.id).join(",")}`);

describe("shareTimeSections", () => {
  it("puts Monday 00:00 in this week and Sunday 23:59 in last week", () => {
    expect(titles([{ id: "mon", at: at(2026, 10, 26, 0, 0) }, { id: "sun", at: at(2026, 10, 25, 23, 59) }])).toEqual([
      "This week: mon",
      "Last week: sun",
    ]);
  });

  it("buckets what came before last week by month, with the year once it isn't this one", () => {
    expect(
      titles([
        { id: "a", at: at(2026, 10, 18, 23, 59) },
        { id: "b", at: at(2026, 10, 2) },
        { id: "c", at: at(2026, 9, 30) },
        { id: "d", at: at(2025, 12, 31) },
      ]),
    ).toEqual(["October: a,b", "September: c", "December 2025: d"]);
  });

  it("keeps the input order inside a section and orders sections newest first", () => {
    expect(
      titles([
        { id: "old", at: at(2026, 9, 1) },
        { id: "new2", at: at(2026, 10, 27) },
        { id: "new1", at: at(2026, 10, 28) },
      ]),
    ).toEqual(["This week: new2,new1", "September: old"]);
  });

  it("files a date in the future (clock skew) under this week", () => {
    expect(titles([{ id: "f", at: at(2026, 11, 2) }])).toEqual(["This week: f"]);
  });

  it("puts undated or unreadable dates last, under Earlier", () => {
    expect(titles([{ id: "x" }, { id: "y", at: "not a date" }, { id: "z", at: at(2026, 10, 27) }])).toEqual([
      "This week: z",
      "Earlier: x,y",
    ]);
  });

  it("gives stable keys and nothing for an empty list", () => {
    expect(shareTimeSections([], () => null, NOW)).toEqual([]);
    expect(shareTimeSections([{ id: "a", at: at(2026, 9, 3) }], (i) => i.at, NOW).map((s) => s.key)).toEqual(["2026-09"]);
  });

  it("starts the week on Monday even when today is Sunday", () => {
    const sunday = new Date(2026, 10, 1, 20, 0); // Sunday 1 Nov 2026: this week began Monday 26 Oct
    expect(shareTimeSections([{ id: "mon", at: at(2026, 10, 26, 8) }], (i) => i.at, sunday).map((s) => s.title)).toEqual(["This week"]);
  });
});
