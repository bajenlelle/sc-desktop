import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APP_OPEN_HASH,
  ScoutingReportError,
  countsAsReaderOpen,
  getMyScoutingReport,
  getScoutingReport,
  getScoutingReportShareLimit,
  isLiveReport,
  openedLabel,
  publishScoutingReport,
  recordScoutingReportOpen,
  revokeScoutingReport,
  scoutingReportErrorCode,
  scoutingReportUrl,
  sharedStatusLabel,
} from "../scouting-reports-db";
import { parseScoutingReport, type ScoutingReport } from "../scouting-report";

const CLIP = "clips/probe-m/1_pre10.0_post3.0_s100.0.mp4";
const POSTER = "highlights/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.jpg";

const report: ScoutingReport = {
  v: 1,
  header: { title: "AIK scouting", opponent: "AIK", preparedAt: "2026-10-20T12:00:00.000Z", players: 1, clips: 1, attribution: true },
  sections: [
    {
      id: "p1",
      kind: "player",
      player: { id: "1", name: "Alva Berg", number: "7", teamName: "AIK" },
      note: "Drives left.",
      stats: { context: "Season averages · 30 games", cells: [{ value: "13.3", label: "PTS" }], asOf: "2026-10-17T10:00:00Z" },
      blocks: [
        { kind: "text", text: "Press early." },
        {
          kind: "clip", id: "c1", clipKey: CLIP, posterKey: POSTER, label: "3PT Made", type: "3pt", subType: "", made: true,
          period: "Q2", clock: "04:31", game: null, note: null, labels: [],
        },
      ],
    },
  ],
};

function rpcClient(result: { data?: unknown; error?: { message: string; details?: string } | null }) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("parseScoutingReport", () => {
  it("reads back what the builder wrote", () => {
    expect(parseScoutingReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("rejects what isn't a version 1 report", () => {
    expect(parseScoutingReport(null)).toBeNull();
    expect(parseScoutingReport({ ...report, v: 2 })).toBeNull();
    expect(parseScoutingReport({ ...report, sections: "x" })).toBeNull();
    expect(parseScoutingReport({ ...report, header: null })).toBeNull();
  });

  it("drops blocks and sections it can't read instead of failing", () => {
    const messy = {
      ...report,
      sections: [
        { id: "x", kind: "player", blocks: [] }, // a player section with no player
        { id: "y", kind: "other", blocks: [] },
        {
          ...report.sections[0],
          blocks: [
            { kind: "clip", clipKey: "clips/../x.mp4" },
            { kind: "text", text: "   " },
            { kind: "stats", heading: "h", stats: { cells: "no" } },
            { kind: "video" },
            5,
            ...report.sections[0].blocks,
          ],
        },
      ],
    };
    const parsed = parseScoutingReport(messy)!;
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].blocks.map((b) => b.kind)).toEqual(["text", "clip"]);
    expect(parsed.header).toMatchObject({ players: 1, clips: 1 });
  });

  it("drops a poster that isn't one of ours", () => {
    const bad = JSON.parse(JSON.stringify(report));
    bad.sections[0].blocks[1].posterKey = "https://evil.example/x.jpg";
    expect(parseScoutingReport(bad)!.sections[0].blocks[1]).toMatchObject({ kind: "clip", posterKey: null });
  });

  it("shows the mark unless the report says otherwise", () => {
    const off = { ...report, header: { ...report.header, attribution: false } };
    expect(parseScoutingReport(off)!.header.attribution).toBe(false);
    const absent = JSON.parse(JSON.stringify(report));
    delete absent.header.attribution;
    expect(parseScoutingReport(absent)!.header.attribution).toBe(true);
  });
});

describe("getScoutingReport", () => {
  it("returns a valid report parsed", async () => {
    const { client, calls } = rpcClient({
      data: { valid: true, title: "AIK scouting", updated_at: "2026-10-20T12:00:00Z", expires_at: "2026-11-19T12:00:00Z", content: report },
    });
    const page = await getScoutingReport(client, "abc");
    expect(calls).toEqual([{ name: "get_scouting_report", args: { p_id: "abc" } }]);
    expect(page).toMatchObject({ valid: true, title: "AIK scouting", expiresAt: "2026-11-19T12:00:00Z" });
    expect(page.valid && page.report.sections).toHaveLength(1);
  });

  it("passes on why there is no report", async () => {
    for (const reason of ["not_found", "expired", "revoked"] as const) {
      expect(await getScoutingReport(rpcClient({ data: { valid: false, reason } }).client, "abc")).toEqual({ valid: false, reason });
    }
    expect(await getScoutingReport(rpcClient({ data: { valid: false, reason: "weird" } }).client, "abc")).toEqual({ valid: false, reason: "not_found" });
  });

  it("treats a row this build can't read as not found", async () => {
    const { client } = rpcClient({ data: { valid: true, title: "x", content: { v: 9 } } });
    expect(await getScoutingReport(client, "abc")).toEqual({ valid: false, reason: "not_found" });
  });

  it("throws on a transport error", async () => {
    await expect(getScoutingReport(rpcClient({ error: { message: "network" } }).client, "abc")).rejects.toThrow("network");
  });
});

describe("publishScoutingReport", () => {
  it("sends the report and answers the link's id and expiry", async () => {
    const { client, calls } = rpcClient({ data: { id: "r1", expires_at: "2026-11-19T12:00:00Z", created: true } });
    const out = await publishScoutingReport(client, { playlistId: "pl1", title: "AIK scouting", report, contentKey: "k1" });
    expect(out).toEqual({ id: "r1", expiresAt: "2026-11-19T12:00:00Z", created: true });
    expect(calls[0]).toEqual({
      name: "publish_scouting_report",
      args: { p_playlist_id: "pl1", p_title: "AIK scouting", p_content: report, p_content_key: "k1" },
    });
  });

  it("answers no expiry when a kept report was updated (the database keeps infinity)", async () => {
    const { client } = rpcClient({ data: { id: "r1", expires_at: "infinity", created: false } });
    expect(await publishScoutingReport(client, { playlistId: "pl1", title: "AIK scouting", report, contentKey: "k1" })).toEqual({ id: "r1", expiresAt: null, created: false });
  });

  it("raises a coded error the UI can branch on", async () => {
    const { client } = rpcClient({ error: { message: "upgrade_required" } });
    const err = await publishScoutingReport(client, { playlistId: "pl1", title: "t", report, contentKey: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(ScoutingReportError);
    expect(err.code).toBe("upgrade_required");
  });

  it("names the live report when the free plan's one report is taken", async () => {
    const details = JSON.stringify({ id: "r2", playlist_id: "pl2", title: "Djurgården", expires_at: "2026-11-20T10:00:00Z" });
    const { client } = rpcClient({ error: { message: "report_limit_reached", details } });
    const err = await publishScoutingReport(client, { playlistId: "pl1", title: "t", report, contentKey: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(ScoutingReportError);
    expect(err).toMatchObject({
      code: "report_limit_reached",
      blockedBy: { id: "r2", playlistId: "pl2", title: "Djurgården", expiresAt: "2026-11-20T10:00:00Z" },
    });
  });

  it("has no blockedBy when the details can't be read", async () => {
    for (const details of ["garbage", JSON.stringify({ id: "r2" }), undefined]) {
      const { client } = rpcClient({ error: { message: "report_limit_reached", details } });
      const err = await publishScoutingReport(client, { playlistId: "pl1", title: "t", report, contentKey: "k" }).catch((e) => e);
      expect(err).toMatchObject({ code: "report_limit_reached", blockedBy: null });
    }
  });

  it("has no blockedBy on any other error", async () => {
    const details = JSON.stringify({ id: "r2", playlist_id: "pl2", title: "x", expires_at: "2026-11-20T10:00:00Z" });
    const { client } = rpcClient({ error: { message: "not_owner", details } });
    const err = await publishScoutingReport(client, { playlistId: "pl1", title: "t", report, contentKey: "k" }).catch((e) => e);
    expect(err).toMatchObject({ code: "not_owner", blockedBy: null });
  });
});

describe("getScoutingReportShareLimit", () => {
  it("reads whether the plan is limited and which report blocks", async () => {
    const { client, calls } = rpcClient({
      data: { limited: true, blocked_by: { id: "r2", playlist_id: "pl2", title: "Djurgården", expires_at: "2026-11-20T10:00:00Z" } },
    });
    expect(await getScoutingReportShareLimit(client, "pl1")).toEqual({
      limited: true,
      blockedBy: { id: "r2", playlistId: "pl2", title: "Djurgården", expiresAt: "2026-11-20T10:00:00Z" },
    });
    expect(calls).toEqual([{ name: "scouting_report_share_limit", args: { p_playlist_id: "pl1" } }]);
  });

  it("is limited with nothing blocking when the free plan's report is free", async () => {
    const { client } = rpcClient({ data: { limited: true, blocked_by: null } });
    expect(await getScoutingReportShareLimit(client, "pl1")).toEqual({ limited: true, blockedBy: null });
  });

  it("is unlimited with nothing blocking on a paid plan", async () => {
    const { client } = rpcClient({ data: { limited: false, blocked_by: null } });
    expect(await getScoutingReportShareLimit(client, "pl1")).toEqual({ limited: false, blockedBy: null });
  });

  it("is null when the check fails", async () => {
    expect(await getScoutingReportShareLimit(rpcClient({ error: { message: "not_owner" } }).client, "pl1")).toBeNull();
    expect(await getScoutingReportShareLimit(rpcClient({ data: null }).client, "pl1")).toBeNull();
    const rejecting = { rpc: () => Promise.reject(new Error("network")) } as unknown as SupabaseClient;
    expect(await getScoutingReportShareLimit(rejecting, "pl1")).toBeNull();
  });
});

describe("recordScoutingReportOpen", () => {
  it("counts an open", async () => {
    const { client, calls } = rpcClient({});
    await recordScoutingReportOpen(client, "r1");
    expect(calls).toEqual([{ name: "record_scouting_report_open", args: { p_id: "r1" } }]);
  });

  it("never throws", async () => {
    await expect(recordScoutingReportOpen(rpcClient({ error: { message: "boom" } }).client, "r1")).resolves.toBeUndefined();
    const rejecting = { rpc: () => Promise.reject(new Error("network")) } as unknown as SupabaseClient;
    await expect(recordScoutingReportOpen(rejecting, "r1")).resolves.toBeUndefined();
    const throwing = { rpc: () => { throw new Error("sync"); } } as unknown as SupabaseClient;
    await expect(recordScoutingReportOpen(throwing, "r1")).resolves.toBeUndefined();
  });
});

describe("openedLabel", () => {
  it("says how often the link was opened", () => {
    expect([0, 1, 2, 23].map(openedLabel)).toEqual(["Not opened yet", "Opened once", "Opened 2 times", "Opened 23 times"]);
  });
});

describe("countsAsReaderOpen", () => {
  it("counts a reader's open, not the coach's own from the app", () => {
    expect(countsAsReaderOpen("")).toBe(true);
    expect(countsAsReaderOpen("#p3")).toBe(true);
    expect(countsAsReaderOpen(APP_OPEN_HASH)).toBe(false);
    expect(countsAsReaderOpen("#print")).toBe(false);
  });
});

describe("revokeScoutingReport", () => {
  it("calls the function and raises a coded error", async () => {
    const ok = rpcClient({});
    await revokeScoutingReport(ok.client, "r1");
    expect(ok.calls).toEqual([{ name: "revoke_scouting_report", args: { p_id: "r1" } }]);
    const bad = rpcClient({ error: { message: "not_found" } });
    await expect(revokeScoutingReport(bad.client, "r1")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("scoutingReportErrorCode", () => {
  it("finds the raised token in a message, else unknown", () => {
    expect(scoutingReportErrorCode("license_locked")).toBe("license_locked");
    expect(scoutingReportErrorCode("P0001: invalid_content")).toBe("invalid_content");
    expect(scoutingReportErrorCode("P0001: report_limit_reached")).toBe("report_limit_reached");
    expect(scoutingReportErrorCode("boom")).toBe("unknown");
    expect(scoutingReportErrorCode(undefined)).toBe("unknown");
  });
});

describe("getMyScoutingReport", () => {
  function tableClient(result: { data: unknown; error: unknown }) {
    const calls: { table?: string; select?: string; eq: unknown[]; is: unknown[] } = { eq: [], is: [] };
    const b: Record<string, unknown> = {
      select(cols: string) { calls.select = cols; return b; },
      eq(c: string, v: unknown) { calls.eq.push([c, v]); return b; },
      is(c: string, v: unknown) { calls.is.push([c, v]); return b; },
      maybeSingle: () => Promise.resolve(result),
    };
    const client = { from(t: string) { calls.table = t; return b; } } as unknown as SupabaseClient;
    return { client, calls };
  }

  it("reads the playlist's live row without its content", async () => {
    const { client, calls } = tableClient({
      data: { id: "r1", title: "AIK", content_key: "k", created_at: "a", updated_at: "b", expires_at: "c", open_count: 3 },
      error: null,
    });
    expect(await getMyScoutingReport(client, "pl1")).toEqual({ id: "r1", title: "AIK", contentKey: "k", createdAt: "a", updatedAt: "b", expiresAt: "c", opens: 3 });
    expect(calls.table).toBe("scouting_reports");
    expect(calls.select).not.toContain("content,");
    expect(calls.select).toContain("open_count");
    expect(calls.eq).toEqual([["playlist_id", "pl1"]]);
    expect(calls.is).toEqual([["revoked_at", null]]);
  });

  it("reads a row without open_count as never opened", async () => {
    const { client } = tableClient({
      data: { id: "r1", title: "AIK", content_key: "k", created_at: "a", updated_at: "b", expires_at: "c" },
      error: null,
    });
    expect(await getMyScoutingReport(client, "pl1")).toMatchObject({ opens: 0 });
  });

  it("is null when there is none or the read fails", async () => {
    expect(await getMyScoutingReport(tableClient({ data: null, error: null }).client, "pl1")).toBeNull();
    expect(await getMyScoutingReport(tableClient({ data: null, error: { message: "x" } }).client, "pl1")).toBeNull();
  });

  it("answers no expiry for a kept report (the database says infinity)", async () => {
    const { client } = tableClient({
      data: { id: "r1", title: "AIK", content_key: "k", created_at: "a", updated_at: "b", expires_at: "infinity", open_count: 0 },
      error: null,
    });
    expect((await getMyScoutingReport(client, "pl1"))?.expiresAt).toBeNull();
  });
});

describe("isLiveReport", () => {
  const base = { id: "r1", title: "AIK", contentKey: "k", createdAt: "a", updatedAt: "b", opens: 0 };
  it("is live until its expiry", () => {
    expect(isLiveReport({ ...base, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })).toBe(true);
    expect(isLiveReport({ ...base, expiresAt: new Date(Date.now() - 1_000).toISOString() })).toBe(false);
  });
  it("is live for ever when kept", () => {
    expect(isLiveReport({ ...base, expiresAt: null })).toBe(true);
  });
  it("is not live when there is no report", () => {
    expect(isLiveReport(null)).toBe(false);
  });
});

describe("sharedStatusLabel", () => {
  const base = { id: "r1", title: "AIK", contentKey: "k", createdAt: "a", updatedAt: "b", opens: 0 };
  it("says when a shared report expires", () => {
    expect(sharedStatusLabel({ ...base, expiresAt: "2026-11-26T12:00:00Z" })).toMatch(/^Shared · expires .*2026$/);
  });
  it("says a kept report never expires", () => {
    expect(sharedStatusLabel({ ...base, expiresAt: null })).toBe("Shared · never expires");
  });
});

describe("scoutingReportUrl", () => {
  it("joins the web base and the id", () => {
    expect(scoutingReportUrl("https://app.scoutable.se/", "abc")).toBe("https://app.scoutable.se/r/abc");
    expect(scoutingReportUrl("http://localhost:3000", "abc")).toBe("http://localhost:3000/r/abc");
  });
});
