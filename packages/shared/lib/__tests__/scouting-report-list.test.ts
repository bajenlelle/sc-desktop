import { describe, expect, it } from "vitest";
import {
  filterReportList,
  mergeReportList,
  reportStatusLabel,
  type ReportDraftRow,
  type ReportListItem,
  type ReportRow,
} from "../scouting-report-list";

const NOW = new Date("2026-11-10T12:00:00Z");

const playlists = [
  { id: "pl-aik", name: "AIK scout" },
  { id: "pl-sod", name: "Södertälje" },
  { id: "pl-ume", name: "Umeå away" },
];

function report(over: Partial<ReportRow> & Pick<ReportRow, "id" | "playlistId">): ReportRow {
  return {
    title: "Report",
    updatedAt: "2026-11-01T10:00:00Z",
    expiresAt: "2026-12-01T10:00:00Z",
    revokedAt: null,
    opens: 0,
    ...over,
  };
}

function draft(over: Partial<ReportDraftRow> & Pick<ReportDraftRow, "playlistId">): ReportDraftRow {
  return { updatedAt: "2026-11-01T10:00:00Z", title: null, players: 0, ...over };
}

describe("mergeReportList", () => {
  it("lists a live report with its opens and expiry", () => {
    const [item] = mergeReportList([report({ id: "r1", playlistId: "pl-aik", title: "AIK scouting", opens: 14 })], [], playlists, NOW);
    expect(item).toEqual<ReportListItem>({
      playlistId: "pl-aik",
      playlistName: "AIK scout",
      reportId: "r1",
      title: "AIK scouting",
      status: "live",
      expiresAt: "2026-12-01T10:00:00Z",
      endedAt: null,
      opens: 14,
      players: 0,
      changedAt: "2026-11-01T10:00:00Z",
    });
  });

  it("counts a kept report (no expiry) as live", () => {
    const [item] = mergeReportList([report({ id: "r1", playlistId: "pl-aik", expiresAt: null })], [], playlists, NOW);
    expect(item.status).toBe("live");
    expect(item.expiresAt).toBeNull();
  });

  it("says expired once the expiry has passed, ended at the expiry", () => {
    const [item] = mergeReportList([report({ id: "r1", playlistId: "pl-aik", expiresAt: "2026-11-05T10:00:00Z", opens: 3 })], [], playlists, NOW);
    expect(item.status).toBe("expired");
    expect(item.endedAt).toBe("2026-11-05T10:00:00Z");
    expect(item.opens).toBe(3);
  });

  it("says stopped when the report was switched off, ended when it was", () => {
    const [item] = mergeReportList(
      [report({ id: "r1", playlistId: "pl-aik", revokedAt: "2026-11-03T09:00:00Z", updatedAt: "2026-11-03T09:00:00Z" })],
      [],
      playlists,
      NOW,
    );
    expect(item.status).toBe("stopped");
    expect(item.endedAt).toBe("2026-11-03T09:00:00Z");
  });

  it("shows a playlist's report that is not switched off over its older stopped ones", () => {
    const items = mergeReportList(
      [
        report({ id: "old", playlistId: "pl-aik", revokedAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-20T09:00:00Z" }),
        report({ id: "now", playlistId: "pl-aik", updatedAt: "2026-10-10T09:00:00Z" }),
      ],
      [],
      playlists,
      NOW,
    );
    expect(items.map((i) => i.reportId)).toEqual(["now"]);
  });

  it("shows the latest of a playlist's stopped reports when none is on", () => {
    const items = mergeReportList(
      [
        report({ id: "first", playlistId: "pl-aik", revokedAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-20T09:00:00Z" }),
        report({ id: "second", playlistId: "pl-aik", revokedAt: "2026-11-02T09:00:00Z", updatedAt: "2026-11-02T09:00:00Z" }),
      ],
      [],
      playlists,
      NOW,
    );
    expect(items.map((i) => i.reportId)).toEqual(["second"]);
  });

  it("lists a draft never shared, titled by the draft or else the playlist", () => {
    const items = mergeReportList(
      [],
      [draft({ playlistId: "pl-sod", title: "Södertälje scouting", players: 4 }), draft({ playlistId: "pl-ume" })],
      playlists,
      NOW,
    );
    const byPlaylist = Object.fromEntries(items.map((i) => [i.playlistId, i]));
    expect(byPlaylist["pl-sod"]).toMatchObject({ status: "draft", reportId: null, title: "Södertälje scouting", players: 4, opens: 0, expiresAt: null });
    expect(byPlaylist["pl-ume"]).toMatchObject({ status: "draft", title: "Umeå away" });
  });

  it("joins a shared report with its draft: the report's status and title, the draft's players", () => {
    const [item] = mergeReportList(
      [report({ id: "r1", playlistId: "pl-aik", title: "AIK scouting" })],
      [draft({ playlistId: "pl-aik", title: "AIK (edited)", players: 5 })],
      playlists,
      NOW,
    );
    expect(item).toMatchObject({ status: "live", title: "AIK scouting", players: 5 });
  });

  it("dates the change by whichever of the report and draft changed last", () => {
    const [item] = mergeReportList(
      [report({ id: "r1", playlistId: "pl-aik", updatedAt: "2026-11-01T10:00:00Z" })],
      [draft({ playlistId: "pl-aik", updatedAt: "2026-11-04T10:00:00Z" })],
      playlists,
      NOW,
    );
    expect(item.changedAt).toBe("2026-11-04T10:00:00Z");
  });

  it("leaves out reports and drafts whose playlist isn't listed (another space, or deleted)", () => {
    const items = mergeReportList(
      [report({ id: "r1", playlistId: "pl-other" }), report({ id: "r2", playlistId: null })],
      [draft({ playlistId: "pl-gone" })],
      playlists,
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("puts the most recently changed first", () => {
    const items = mergeReportList(
      [report({ id: "r1", playlistId: "pl-aik", updatedAt: "2026-11-02T10:00:00Z" })],
      [draft({ playlistId: "pl-sod", updatedAt: "2026-11-05T10:00:00Z" }), draft({ playlistId: "pl-ume", updatedAt: "2026-10-30T10:00:00Z" })],
      playlists,
      NOW,
    );
    expect(items.map((i) => i.playlistId)).toEqual(["pl-sod", "pl-aik", "pl-ume"]);
  });
});

describe("filterReportList", () => {
  const items = mergeReportList(
    [
      report({ id: "r1", playlistId: "pl-aik", title: "AIK scouting" }),
      report({ id: "r2", playlistId: "pl-ume", title: "Umeå", revokedAt: "2026-11-03T09:00:00Z" }),
    ],
    [draft({ playlistId: "pl-sod", title: "Södertälje scouting" })],
    playlists,
    NOW,
  );

  it("keeps everything for All", () => {
    expect(filterReportList(items, "all", "")).toHaveLength(3);
  });

  it("keeps what has been shared, stopped and expired included, for Shared", () => {
    expect(filterReportList(items, "shared", "").map((i) => i.playlistId).sort()).toEqual(["pl-aik", "pl-ume"]);
  });

  it("keeps the drafts for Drafts", () => {
    expect(filterReportList(items, "drafts", "").map((i) => i.playlistId)).toEqual(["pl-sod"]);
  });

  it("searches title and playlist name, ignoring case and accents", () => {
    expect(filterReportList(items, "all", "sodertalje").map((i) => i.playlistId)).toEqual(["pl-sod"]);
    expect(filterReportList(items, "all", "UMEA AWAY").map((i) => i.playlistId)).toEqual(["pl-ume"]);
    expect(filterReportList(items, "all", "scouting aik").map((i) => i.playlistId)).toEqual(["pl-aik"]);
  });
});

describe("reportStatusLabel", () => {
  const base: ReportListItem = {
    playlistId: "p",
    playlistName: "P",
    reportId: "r",
    title: "T",
    status: "live",
    expiresAt: "2026-11-26T12:00:00Z",
    endedAt: null,
    opens: 0,
    players: 0,
    changedAt: "2026-11-01T10:00:00Z",
  };

  it("says when a shared report expires, or that a kept one never does", () => {
    expect(reportStatusLabel(base)).toBe("Shared · expires 26 Nov 2026");
    expect(reportStatusLabel({ ...base, expiresAt: null })).toBe("Shared · never expires");
  });

  it("says when an ended report expired or was stopped", () => {
    expect(reportStatusLabel({ ...base, status: "expired", endedAt: "2026-11-05T10:00:00Z" })).toBe("Expired 5 Nov 2026");
    expect(reportStatusLabel({ ...base, status: "stopped", endedAt: "2026-11-03T09:00:00Z" })).toBe("Stopped 3 Nov 2026");
  });

  it("calls a draft a draft", () => {
    expect(reportStatusLabel({ ...base, status: "draft", reportId: null, expiresAt: null })).toBe("Draft");
  });
});
