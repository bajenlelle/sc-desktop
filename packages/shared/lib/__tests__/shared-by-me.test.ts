import { describe, expect, it } from "vitest";
import type { SharedPlaylist } from "../playlists-db";
import type { TeamMemberRef } from "../teams-db";
import type { PlaylistClipView } from "../clip-views-db";
import type { PlaylistClipItem, PlaylistTextCard } from "../../types/match";
import {
  behindRecipients,
  buildDashboardRows,
  dashboardCounts,
  filterByTeamAndQuery,
  statusOf,
  summarizeDashboard,
  teamFilterOptions,
  visibleDashboardRows,
  type DashboardRow,
  type RecipientRow,
} from "../shared-by-me";

function pl(partial: Partial<SharedPlaylist>): SharedPlaylist {
  return { items: [], teamShares: [], userShares: [], ...partial } as SharedPlaylist;
}

function clip(matchId: string, eventId: number, r2Url?: string): PlaylistClipItem {
  return { type: "clip", matchId, eventId, ...(r2Url ? { r2Url } : {}) };
}

function text(id: string): PlaylistTextCard {
  return { type: "text", id, text: "note", durationSeconds: 5 };
}

function member(teamId: string, userId: string): TeamMemberRef {
  return { teamId, userId, role: "player" };
}

function view(
  playlistId: string,
  userId: string,
  matchId: string,
  eventId: number,
  watchedAt: string,
): PlaylistClipView {
  return { playlistId, userId, matchId, eventId, watchedAt };
}

function build(partial: Partial<Parameters<typeof buildDashboardRows>[0]>): DashboardRow[] {
  return buildDashboardRows({
    shared: [],
    teamMembers: [],
    views: [],
    memberMap: new Map(),
    teamMap: new Map(),
    currentUserId: "coach",
    ...partial,
  });
}

function rec(userId: string, watched: number, name = userId): RecipientRow {
  return { userId, name, avatarUrl: null, watched, lastActivity: null };
}

function row(partial: Partial<DashboardRow>): DashboardRow {
  return {
    playlist: pl({ id: "p", name: "P" }),
    teamNames: [],
    directCount: 0,
    playableCount: 0,
    uploadingCount: 0,
    newestSharedAt: null,
    recipients: [],
    completedCount: 0,
    startedCount: 0,
    ...partial,
  };
}

describe("buildDashboardRows", () => {
  it("counts playable vs uploading clips and ignores text cards", () => {
    const [r] = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          items: [clip("m", 1, "u1"), clip("m", 2, "u2"), clip("m", 3), text("t1")],
        }),
      ],
    });
    expect(r.playableCount).toBe(2);
    expect(r.uploadingCount).toBe(1);
  });

  it("recipients are direct shares plus shared-team members, minus the coach", () => {
    const [r] = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          userShares: [
            { userId: "coach", sharedAt: null },
            { userId: "u1", sharedAt: null },
          ],
          teamShares: [{ teamId: "t1", sharedAt: null }],
        }),
      ],
      teamMembers: [member("t1", "coach"), member("t1", "u1"), member("t1", "u2")],
      memberMap: new Map([
        ["u1", { fullName: "Anna" }],
        ["u2", { email: "bea@x.se" }],
      ]),
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["u1", "u2"]);
    // name falls back fullName -> email -> "Unknown member"
    expect(r.recipients.map((x) => x.name)).toEqual(["Anna", "bea@x.se"]);
    // the coach's own direct share is excluded from directCount too
    expect(r.directCount).toBe(1);
  });

  it("counts views once per playable clip, ignores unshipped clips, tracks last activity", () => {
    const [r] = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          items: [clip("m", 1, "u"), clip("m", 2)],
          userShares: [{ userId: "u1", sharedAt: null }],
        }),
      ],
      views: [
        view("p1", "u1", "m", 1, "2026-01-01T10:00:00Z"),
        view("p1", "u1", "m", 1, "2026-01-02T10:00:00Z"), // duplicate of the same clip
        view("p1", "u1", "m", 2, "2026-01-03T10:00:00Z"), // unshipped clip — ignored
      ],
    });
    expect(r.recipients[0].watched).toBe(1);
    // last activity only tracks playable-clip views, so the later m:2 view is invisible
    expect(r.recipients[0].lastActivity).toBe("2026-01-02T10:00:00Z");
    expect(r.completedCount).toBe(1);
    expect(r.startedCount).toBe(1);
  });

  it("keeps completedCount at 0 when nothing is playable, even with recipients", () => {
    const [r] = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          items: [text("t1")],
          userShares: [{ userId: "u1", sharedAt: null }],
        }),
      ],
    });
    expect(r.playableCount).toBe(0);
    expect(r.recipients).toHaveLength(1);
    expect(r.completedCount).toBe(0);
  });

  it("counts started but not completed for partial progress", () => {
    const [r] = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          items: [clip("m", 1, "u"), clip("m", 2, "u")],
          userShares: [
            { userId: "u1", sharedAt: null },
            { userId: "u2", sharedAt: null },
          ],
        }),
      ],
      views: [
        view("p1", "u1", "m", 1, "2026-01-01T10:00:00Z"),
        view("p1", "u2", "m", 1, "2026-01-01T10:00:00Z"),
        view("p1", "u2", "m", 2, "2026-01-01T11:00:00Z"),
      ],
    });
    expect(r.startedCount).toBe(2);
    expect(r.completedCount).toBe(1);
  });

  it("orders recipients least-watched first, then by Swedish name", () => {
    const [r] = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          items: [clip("m", 1, "u")],
          userShares: [
            { userId: "u1", sharedAt: null },
            { userId: "u2", sharedAt: null },
            { userId: "u3", sharedAt: null },
          ],
        }),
      ],
      views: [view("p1", "u3", "m", 1, "2026-01-01T10:00:00Z")],
      memberMap: new Map([
        ["u1", { fullName: "Örjan" }],
        ["u2", { fullName: "Zebra" }],
        ["u3", { fullName: "Anna" }],
      ]),
    });
    // sv collation puts Ö after Z; watched=1 sorts after both zeros
    expect(r.recipients.map((x) => x.name)).toEqual(["Zebra", "Örjan", "Anna"]);
  });

  it("derives newestSharedAt across shares and sorts rows newest-first", () => {
    const rows = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          teamShares: [{ teamId: "t1", sharedAt: "2026-01-05T00:00:00Z" }],
          userShares: [{ userId: "u1", sharedAt: "2026-01-10T00:00:00Z" }],
        }),
        pl({
          id: "p2",
          name: "B",
          teamShares: [{ teamId: "t1", sharedAt: "2026-02-01T00:00:00Z" }],
        }),
        pl({
          id: "p3",
          name: "C",
          teamShares: [{ teamId: "t1", sharedAt: null }],
          userShares: [{ userId: "u1", sharedAt: null }],
        }),
      ],
    });
    expect(rows.map((r) => r.playlist.id)).toEqual(["p2", "p1", "p3"]);
    expect(rows[0].newestSharedAt).toBe("2026-02-01T00:00:00Z");
    expect(rows[1].newestSharedAt).toBe("2026-01-10T00:00:00Z");
    expect(rows[2].newestSharedAt).toBeNull();
  });

  it("falls back to 'Team' for unknown team ids", () => {
    const [r] = build({
      shared: [
        pl({
          id: "p1",
          name: "A",
          teamShares: [
            { teamId: "t1", sharedAt: null },
            { teamId: "ghost", sharedAt: null },
          ],
        }),
      ],
      teamMap: new Map([["t1", { name: "Alpha" }]]),
    });
    expect(r.teamNames).toEqual(["Alpha", "Team"]);
  });
});

describe("statusOf", () => {
  it("is null with zero recipients", () => {
    expect(statusOf(row({ recipients: [], completedCount: 0 }))).toBeNull();
  });

  it("is done only when everyone completed", () => {
    expect(statusOf(row({ recipients: [rec("u1", 1)], completedCount: 1 }))).toBe("done");
    expect(
      statusOf(row({ recipients: [rec("u1", 1), rec("u2", 0)], completedCount: 1 })),
    ).toBe("attention");
  });
});

describe("summarizeDashboard", () => {
  it("counts distinct recipients across rows", () => {
    const s = summarizeDashboard([
      row({ recipients: [rec("u1", 0), rec("u2", 0)] }),
      row({ recipients: [rec("u1", 0)] }),
    ]);
    expect(s.playlists).toBe(2);
    expect(s.recipients).toBe(2);
  });

  it("dedupes behind targets to one per player, keeping the newest share", () => {
    const s = summarizeDashboard([
      row({
        playlist: pl({ id: "A", name: "A" }),
        playableCount: 2,
        newestSharedAt: "2026-01-01T00:00:00Z",
        recipients: [rec("u1", 0, "Anna")],
      }),
      row({
        playlist: pl({ id: "B", name: "B" }),
        playableCount: 2,
        newestSharedAt: "2026-02-01T00:00:00Z",
        recipients: [rec("u1", 1, "Anna")],
      }),
    ]);
    expect(s.behind).toBe(1);
    expect(s.behindTargets).toEqual([
      { userId: "u1", name: "Anna", playlistId: "B", sharedAt: "2026-02-01T00:00:00Z" },
    ]);
  });

  it("omits fully-done players and rows with nothing playable", () => {
    const s = summarizeDashboard([
      row({
        playlist: pl({ id: "A", name: "A" }),
        playableCount: 2,
        newestSharedAt: "2026-01-01T00:00:00Z",
        recipients: [rec("u1", 2)],
      }),
      row({
        playlist: pl({ id: "B", name: "B" }),
        playableCount: 0,
        newestSharedAt: "2026-02-01T00:00:00Z",
        recipients: [rec("u2", 0)],
      }),
    ]);
    expect(s.behind).toBe(0);
    expect(s.behindTargets).toEqual([]);
    expect(s.recipients).toBe(2);
  });
});

describe("teamFilterOptions", () => {
  it("puts All teams first, dedupes teams, and appends Direct when a row has user shares", () => {
    const rows = [
      row({
        playlist: pl({
          id: "p1",
          name: "A",
          teamShares: [
            { teamId: "t1", sharedAt: null },
            { teamId: "t2", sharedAt: null },
          ],
        }),
      }),
      row({
        playlist: pl({
          id: "p2",
          name: "B",
          teamShares: [{ teamId: "t1", sharedAt: null }],
          userShares: [{ userId: "u1", sharedAt: null }],
        }),
      }),
    ];
    expect(teamFilterOptions(rows, new Map([["t1", { name: "Alpha" }]]))).toEqual([
      { value: "all", label: "All teams" },
      { value: "t1", label: "Alpha" },
      { value: "t2", label: "Team" },
      { value: "direct", label: "Direct to members" },
    ]);
  });

  it("skips the direct option when nothing is shared directly", () => {
    const rows = [
      row({
        playlist: pl({ id: "p1", name: "A", teamShares: [{ teamId: "t1", sharedAt: null }] }),
      }),
    ];
    expect(teamFilterOptions(rows, new Map()).map((o) => o.value)).toEqual(["all", "t1"]);
  });
});

describe("filterByTeamAndQuery", () => {
  const rows = [
    row({
      playlist: pl({
        id: "p1",
        name: "Crunch Time",
        teamShares: [{ teamId: "t1", sharedAt: null }],
      }),
    }),
    row({
      playlist: pl({
        id: "p2",
        name: "Defense drills",
        userShares: [{ userId: "u1", sharedAt: null }],
      }),
    }),
  ];

  it("matches names case-insensitively", () => {
    expect(filterByTeamAndQuery(rows, "all", "crunch").map((r) => r.playlist.id)).toEqual(["p1"]);
    expect(filterByTeamAndQuery(rows, "all", "").map((r) => r.playlist.id)).toEqual(["p1", "p2"]);
  });

  it("scopes to direct shares or a specific team", () => {
    expect(filterByTeamAndQuery(rows, "direct", "").map((r) => r.playlist.id)).toEqual(["p2"]);
    expect(filterByTeamAndQuery(rows, "t1", "").map((r) => r.playlist.id)).toEqual(["p1"]);
  });

  it("composes team scope with the query", () => {
    expect(filterByTeamAndQuery(rows, "t1", "defense")).toEqual([]);
    expect(filterByTeamAndQuery(rows, "direct", "defense").map((r) => r.playlist.id)).toEqual([
      "p2",
    ]);
  });
});

describe("dashboardCounts", () => {
  it("counts issues by uploading clips regardless of status", () => {
    const rows = [
      row({ recipients: [rec("u1", 1)], completedCount: 1, uploadingCount: 2 }), // done + issue
      row({ recipients: [rec("u1", 0)], completedCount: 0 }), // attention
      row({ recipients: [], uploadingCount: 1 }), // status null + issue
    ];
    expect(dashboardCounts(rows)).toEqual({ all: 3, attention: 1, done: 1, issues: 2 });
  });
});

describe("visibleDashboardRows", () => {
  it("filters by issues", () => {
    const rows = [
      row({ playlist: pl({ id: "p1", name: "A" }), uploadingCount: 1 }),
      row({ playlist: pl({ id: "p2", name: "B" }) }),
    ];
    expect(visibleDashboardRows(rows, "issues", "recent").map((r) => r.playlist.id)).toEqual([
      "p1",
    ]);
  });

  it("least sorts by completion ratio ascending, empty rows as ratio 1, newest-first ties", () => {
    const half = row({
      playlist: pl({ id: "half", name: "H" }),
      recipients: [rec("u1", 0), rec("u2", 1)],
      completedCount: 1,
      newestSharedAt: "2026-03-01T00:00:00Z",
    });
    const emptyOld = row({
      playlist: pl({ id: "emptyOld", name: "E" }),
      recipients: [],
      newestSharedAt: "2026-01-01T00:00:00Z",
    });
    const doneNew = row({
      playlist: pl({ id: "doneNew", name: "D" }),
      recipients: [rec("u1", 1)],
      completedCount: 1,
      newestSharedAt: "2026-02-01T00:00:00Z",
    });
    expect(
      visibleDashboardRows([emptyOld, doneNew, half], "all", "least").map((r) => r.playlist.id),
    ).toEqual(["half", "doneNew", "emptyOld"]);
  });

  it("name uses Swedish collation", () => {
    const rows = [
      row({ playlist: pl({ id: "p1", name: "Örebro" }) }),
      row({ playlist: pl({ id: "p2", name: "Zebra" }) }),
    ];
    expect(visibleDashboardRows(rows, "all", "name").map((r) => r.playlist.name)).toEqual([
      "Zebra",
      "Örebro",
    ]);
  });

  it("recent preserves input order", () => {
    const rows = [
      row({ playlist: pl({ id: "p1", name: "A" }) }),
      row({ playlist: pl({ id: "p2", name: "B" }) }),
    ];
    expect(visibleDashboardRows(rows, "all", "recent").map((r) => r.playlist.id)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("composes status filter with sorting", () => {
    const rows = [
      row({
        playlist: pl({ id: "p1", name: "Örebro" }),
        recipients: [rec("u1", 0)],
      }),
      row({
        playlist: pl({ id: "p2", name: "Zebra" }),
        recipients: [rec("u1", 0)],
      }),
      row({
        playlist: pl({ id: "p3", name: "Aaa" }),
        recipients: [rec("u1", 1)],
        completedCount: 1,
      }),
    ];
    expect(
      visibleDashboardRows(rows, "attention", "name").map((r) => r.playlist.name),
    ).toEqual(["Zebra", "Örebro"]);
  });
});

describe("behindRecipients", () => {
  it("is empty when nothing is playable", () => {
    expect(behindRecipients(row({ playableCount: 0, recipients: [rec("u1", 0)] }))).toEqual([]);
  });

  it("returns recipients with clips left", () => {
    const r = row({ playableCount: 2, recipients: [rec("u1", 2), rec("u2", 1)] });
    expect(behindRecipients(r).map((x) => x.userId)).toEqual(["u2"]);
  });
});
