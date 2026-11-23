import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clipsProgress,
  featuredReport,
  firstUnwatchedClip,
  groupInbox,
  inboxProgress,
  inboxReportName,
  isUpcomingReport,
  readerStatus,
  reportClipLine,
  reportGameLabel,
  reportProgress,
  reportQueueClips,
  seenByCount,
  sortReaders,
  unreadReportCount,
  type InboxReport,
} from "../scouting-report-inbox";
import {
  ReportSendError,
  getReportDelivery,
  listMyInboxReports,
  listMyReportReach,
  recordReportRead,
  reportSendErrorCode,
  sendReport,
  unsendReport,
} from "../scouting-report-inbox-db";
import { buildScoutingReport, parseScoutingReport, reportContentKey, type ReportClip, type ScoutingReport } from "../scouting-report";
import { emptyDraft } from "../report-draft";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

function row(over: Partial<InboxReport> = {}): InboxReport {
  return {
    id: "r",
    title: "Fryshuset · Sat 28 Nov",
    opponent: "Fryshuset",
    game: null,
    players: 3,
    clips: 10,
    sentAt: iso(NOW - H),
    updatedAt: iso(NOW - H),
    expiresAt: null,
    senderName: "Coach L",
    teamName: "U18 Herr",
    openedAt: null,
    watchedKeys: [],
    ...over,
  };
}

function clip(id: string, key: string, over: Partial<ReportClip> = {}): ReportClip {
  return { kind: "clip", id, clipKey: key, posterKey: null, label: "3PT Made", type: "3pt", subType: "", made: true, period: "Q2", clock: "4:31", game: null, note: null, labels: [], ...over };
}

describe("inbox grouping", () => {
  it("leads with the next game, keeps a game for three hours after tip-off, and a report without one for a week", () => {
    const soon = row({ id: "soon", game: { at: iso(NOW + 24 * H), home: true } });
    const later = row({ id: "later", game: { at: iso(NOW + 72 * H), home: false } });
    const justPlayed = row({ id: "playing", game: { at: iso(NOW - 2 * H), home: true } });
    const played = row({ id: "played", game: { at: iso(NOW - 4 * H), home: true } });
    const noGameNew = row({ id: "new", sentAt: iso(NOW - 2 * 24 * H) });
    const noGameOld = row({ id: "old", sentAt: iso(NOW - 8 * 24 * H) });
    const { upcoming, earlier } = groupInbox([noGameNew, later, played, soon, noGameOld, justPlayed], NOW);
    expect(upcoming.map((r) => r.id)).toEqual(["playing", "soon", "later", "new"]);
    expect(earlier.map((r) => r.id)).toEqual(["played", "old"]);
    expect(isUpcomingReport(played, NOW)).toBe(false);
  });

  it("features the next game's report, else the newest unread, else nothing", () => {
    const next = row({ id: "next", openedAt: iso(NOW), game: { at: iso(NOW + 30 * H), home: true } });
    const unread = row({ id: "unread", sentAt: iso(NOW - 10 * 24 * H) });
    expect(featuredReport([unread, next], NOW)?.id).toBe("next");
    expect(featuredReport([unread], NOW)?.id).toBe("unread");
    const readOld = row({ id: "read", openedAt: iso(NOW), sentAt: iso(NOW - 10 * 24 * H) });
    expect(featuredReport([readOld], NOW)).toBeNull();
    // A read report without a game still leads in its first week.
    expect(featuredReport([row({ id: "fresh", openedAt: iso(NOW) })], NOW)?.id).toBe("fresh");
  });

  it("counts unread reports and progress", () => {
    expect(unreadReportCount([row(), row({ openedAt: iso(NOW) })])).toBe(1);
    expect(inboxProgress(row({ clips: 3, watchedKeys: ["a", "b"] }))).toEqual({ watched: 2, total: 3 });
    expect(inboxReportName(row({ opponent: null }))).toBe("Fryshuset · Sat 28 Nov");
    expect(inboxReportName(row({ opponent: "  ", title: "" }))).toBe("Scouting report");
  });

  it("names the game's day from the device clock", () => {
    const at = new Date(NOW);
    at.setHours(15, 0, 0, 0);
    expect(reportGameLabel(at.toISOString(), NOW)).toBe("Today, 15:00");
    expect(reportGameLabel(new Date(at.getTime() + 24 * H).toISOString(), NOW)).toBe("Tomorrow, 15:00");
    const far = new Date(2026, 10, 28, 9, 5);
    expect(reportGameLabel(far.toISOString(), NOW)).toBe("Sat 28 Nov, 09:05");
    expect(reportGameLabel("nonsense", NOW)).toBeNull();
  });
});

describe("reading a report", () => {
  const section = {
    blocks: [
      { kind: "text" as const, text: "Note" },
      clip("c1", "k1", { drawings: [{ id: "d1", at: 1, hold: 2, shapes: [] }] }),
      clip("c2", "k2"),
      clip("c3", "k1"),
    ],
  };

  it("plays a section's clips from the media host, with their effects", () => {
    const items = reportQueueClips(section, "https://media.scoutable.se/");
    expect(items.map((i) => [i.key, i.r2Url])).toEqual([
      ["c1", "https://media.scoutable.se/k1"],
      ["c2", "https://media.scoutable.se/k2"],
      ["c3", "https://media.scoutable.se/k1"],
    ]);
    expect(items[0].drawings).toHaveLength(1);
    expect(items[1]).not.toHaveProperty("drawings");
  });

  it("counts each file once, and starts Play all at the first unwatched clip", () => {
    const clips = section.blocks.filter((b): b is ReportClip => b.kind === "clip");
    expect(clipsProgress(clips, new Set(["k1"]))).toEqual({ watched: 1, total: 2 });
    expect(firstUnwatchedClip(clips, new Set(["k1"]))).toBe("c2");
    expect(firstUnwatchedClip(clips, new Set(["k1", "k2"]))).toBe("c1");
    expect(firstUnwatchedClip([], new Set())).toBeNull();
    const report = { sections: [{ ...section, id: "p1" }, { id: "p2", blocks: [clip("c4", "k3")] }] } as unknown as ScoutingReport;
    expect(reportProgress(report, new Set(["k3"]))).toEqual({ watched: 1, total: 3 });
  });

  it("writes a clip's line", () => {
    expect(reportClipLine(clip("c1", "k"))).toBe("3PT Made · Q2 4:31");
    expect(reportClipLine(clip("c1", "k", { game: "vs AIK" }))).toBe("3PT Made · Q2 4:31 · vs AIK");
  });
});

describe("the coach's view", () => {
  it("says how far each reader got, furthest first", () => {
    expect(readerStatus({ openedAt: null, watched: 0 }, 16)).toBe("Not yet");
    expect(readerStatus({ openedAt: "x", watched: 0 }, 16)).toBe("Opened");
    expect(readerStatus({ openedAt: "x", watched: 7 }, 16)).toBe("7 of 16");
    const readers = [
      { name: "Cleo", openedAt: null, watched: 0 },
      { name: "Bo", openedAt: "x", watched: 0 },
      { name: "Ada", openedAt: "x", watched: 3 },
      { name: "Al", openedAt: "x", watched: 9 },
    ];
    expect(sortReaders(readers).map((r) => r.name)).toEqual(["Al", "Ada", "Bo", "Cleo"]);
    expect(seenByCount(readers)).toEqual({ seen: 3, total: 4 });
  });
});

describe("the game in the published report", () => {
  it("is carried from the draft, read back, and part of the content key", () => {
    const draft = { ...emptyDraft(), blocks: [], game: { id: "g1", at: "2026-11-28T14:00:00Z", home: true } };
    const built = buildScoutingReport({ draft, playlist: { items: [] }, eventByKey: new Map() });
    expect(built.report.header.game).toEqual({ at: "2026-11-28T14:00:00Z", home: true });
    expect(parseScoutingReport(built.report)?.header.game).toEqual({ at: "2026-11-28T14:00:00Z", home: true });
    const without = buildScoutingReport({ draft: { ...draft, game: null }, playlist: { items: [] }, eventByKey: new Map() });
    expect(without.report.header).not.toHaveProperty("game");
    expect(reportContentKey(built.report)).not.toBe(reportContentKey(without.report));
    expect(parseScoutingReport({ ...built.report, header: { ...built.report.header, game: { at: "soon" } } })?.header).not.toHaveProperty("game");
  });
});

function rpcClient(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("database wrappers", () => {
  it("lists what reached the caller", async () => {
    const { client } = rpcClient({
      data: [
        {
          id: "r1", title: "T", opponent: "AIK", game: { at: "2026-11-28T14:00:00Z", home: false }, players: 2, clips: 5,
          sent_at: "s", updated_at: "u", expires_at: "infinity", sender_name: "Coach L", team_name: null, opened_at: null, watched_keys: ["k"],
        },
        { id: "r2", title: "T2", opponent: null, game: { at: "nope" }, players: null, clips: null, sent_at: "s", updated_at: "u", expires_at: "2026-12-01T00:00:00Z", sender_name: null, team_name: "U18", opened_at: "o", watched_keys: null },
      ],
    });
    const rows = await listMyInboxReports(client);
    expect(rows[0]).toMatchObject({ id: "r1", game: { at: "2026-11-28T14:00:00Z", home: false }, expiresAt: null, watchedKeys: ["k"] });
    expect(rows[1]).toMatchObject({ game: null, players: 0, clips: 0, expiresAt: "2026-12-01T00:00:00Z", watchedKeys: [] });
  });

  it("passes sends, removals and reads through, and names the errors", async () => {
    const send = rpcClient({ data: { reached: 12, notified: 11 } });
    expect(await sendReport(send.client, "r1", { teamIds: ["t1"] })).toEqual({ reached: 12, notified: 11 });
    expect(send.calls[0]).toEqual({ name: "send_scouting_report", args: { p_report: "r1", p_team_ids: ["t1"], p_user_ids: [] } });

    const un = rpcClient({});
    await unsendReport(un.client, "r1", { userId: "u1" });
    expect(un.calls[0].args).toEqual({ p_report: "r1", p_team_id: null, p_user_id: "u1" });

    const read = rpcClient({});
    await recordReportRead(read.client, "r1", "k1");
    expect(read.calls[0]).toEqual({ name: "record_scouting_report_read", args: { p_report: "r1", p_clip_key: "k1" } });

    const locked = rpcClient({ error: { message: "license_locked" } });
    await expect(sendReport(locked.client, "r1", { userIds: ["u"] })).rejects.toMatchObject({ code: "license_locked" });
    await expect(sendReport(locked.client, "r1", {})).rejects.toBeInstanceOf(ReportSendError);
    expect(reportSendErrorCode("something else")).toBe("unknown");
  });

  it("reads the delivery and the reach", async () => {
    const { client } = rpcClient({
      data: {
        clips: 16,
        targets: [{ teamId: "t1", userId: null, name: "U18", sentAt: "s" }],
        readers: [{ userId: "u1", name: "Pedro", role: "player", teamName: "U18", openedAt: "o", lastOpenedAt: "l", watched: 7 }],
      },
    });
    const d = await getReportDelivery(client, "r1");
    expect(d.clips).toBe(16);
    expect(d.readers[0]).toMatchObject({ name: "Pedro", watched: 7 });
    const reach = await listMyReportReach(rpcClient({ data: [{ report_id: "r1", reached: 12, opened: 9 }] }).client);
    expect(reach.get("r1")).toEqual({ reached: 12, opened: 9 });
  });
});
