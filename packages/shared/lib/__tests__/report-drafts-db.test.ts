import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteReportDraft, getReportDraft, listReportDraftPlaylistIds, saveReportDraft } from "../report-drafts-db";
import { addSections, emptyDraft, setIntro, type ReportDraft } from "../report-draft";

const ALVA = { id: "1", name: "Alva Berg", number: "7", teamId: null, teamName: "AIK" };

function tableClient(result: { data?: unknown; error?: { message: string } | null }, userId: string | null = "u1") {
  const calls: { table?: string; select?: string; eq: unknown[]; upsert?: { row: unknown; opts: unknown }; deleted?: boolean; single?: boolean; maybeSingle?: boolean } = { eq: [] };
  const answer = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  const b: Record<string, unknown> = {
    select(cols: string) { calls.select = cols; return b; },
    eq(c: string, v: unknown) { calls.eq.push([c, v]); return b; },
    upsert(row: unknown, opts: unknown) { calls.upsert = { row, opts }; return b; },
    delete() { calls.deleted = true; return b; },
    single() { calls.single = true; return answer(); },
    maybeSingle() { calls.maybeSingle = true; return answer(); },
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return answer().then(resolve, reject); },
  };
  const client = {
    from(t: string) { calls.table = t; return b; },
    auth: { getSession: () => Promise.resolve({ data: { session: userId ? { user: { id: userId } } : null }, error: null }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const draft: ReportDraft = setIntro(addSections(emptyDraft(), [ALVA], () => "s1"), "Press early.");

describe("getReportDraft", () => {
  it("reads the playlist's draft and parses it", async () => {
    const { client, calls } = tableClient({ data: { content: JSON.parse(JSON.stringify(draft)), updated_at: "2026-10-26T10:00:00Z" } });
    expect(await getReportDraft(client, "pl1")).toEqual({ draft, updatedAt: "2026-10-26T10:00:00Z" });
    expect(calls.table).toBe("scouting_report_drafts");
    expect(calls.select).toContain("content");
    expect(calls.eq).toEqual([["playlist_id", "pl1"]]);
    expect(calls.maybeSingle).toBe(true);
  });

  it("is null when the playlist has none", async () => {
    expect(await getReportDraft(tableClient({ data: null }).client, "pl1")).toBeNull();
  });

  it("throws when the read fails or the row can't be read, so an edit never writes over a draft it didn't see", async () => {
    await expect(getReportDraft(tableClient({ error: { message: "network" } }).client, "pl1")).rejects.toThrow("network");
    await expect(getReportDraft(tableClient({ data: { content: { v: 9 }, updated_at: "x" } }).client, "pl1")).rejects.toThrow("unreadable_draft");
  });
});

describe("saveReportDraft", () => {
  it("upserts the playlist's row for the signed-in user and answers when it was saved", async () => {
    const { client, calls } = tableClient({ data: { updated_at: "2026-10-26T10:00:00Z" } });
    expect(await saveReportDraft(client, "pl1", draft)).toEqual({ updatedAt: "2026-10-26T10:00:00Z" });
    expect(calls.table).toBe("scouting_report_drafts");
    expect(calls.upsert).toEqual({ row: { playlist_id: "pl1", user_id: "u1", content: draft }, opts: { onConflict: "playlist_id" } });
    expect(calls.select).toBe("updated_at");
    expect(calls.single).toBe(true);
  });

  it("refuses a draft the table would refuse, before sending it", async () => {
    const huge = setIntro(draft, "x".repeat(2000));
    const big: ReportDraft = { ...huge, sections: Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, player: { ...ALVA, id: String(i) }, note: "n".repeat(2000), stats: null })) };
    const bigger: ReportDraft = { ...big, placements: Object.fromEntries(Array.from({ length: 8000 }, (_, i) => [`match-${i}:${i}`, `s${i % 60}`])) };
    const { client, calls } = tableClient({ data: { updated_at: "x" } });
    await expect(saveReportDraft(client, "pl1", bigger)).rejects.toThrow("draft_too_large");
    expect(calls.upsert).toBeUndefined();
  });

  it("throws on a write error, and when nobody is signed in", async () => {
    await expect(saveReportDraft(tableClient({ error: { message: "row-level security" } }).client, "pl1", draft)).rejects.toThrow("row-level security");
    await expect(saveReportDraft(tableClient({ data: {} }, null).client, "pl1", draft)).rejects.toThrow("not_authenticated");
  });
});

describe("deleteReportDraft", () => {
  it("deletes the playlist's row", async () => {
    const { client, calls } = tableClient({});
    await deleteReportDraft(client, "pl1");
    expect(calls.table).toBe("scouting_report_drafts");
    expect(calls.deleted).toBe(true);
    expect(calls.eq).toEqual([["playlist_id", "pl1"]]);
  });

  it("throws on an error", async () => {
    await expect(deleteReportDraft(tableClient({ error: { message: "boom" } }).client, "pl1")).rejects.toThrow("boom");
  });
});

describe("listReportDraftPlaylistIds", () => {
  it("answers which playlists have a report, reading only the ids", async () => {
    const { client, calls } = tableClient({ data: [{ playlist_id: "pl1" }, { playlist_id: "pl2" }] });
    expect(await listReportDraftPlaylistIds(client)).toEqual(new Set(["pl1", "pl2"]));
    expect(calls.select).toBe("playlist_id");
  });

  it("is empty when the read fails", async () => {
    expect(await listReportDraftPlaylistIds(tableClient({ error: { message: "x" } }).client)).toEqual(new Set());
  });
});
