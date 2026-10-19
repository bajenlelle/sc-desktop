import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RENDER_JOB_SELECT,
  getLiveRenderJob,
  getRenderJob,
  isRenderJobLive,
  parseRenderJobResult,
  renderJobCounts,
  rowToRenderJob,
  type RenderJobRow,
} from "../render-jobs-db";

function row(partial: Partial<RenderJobRow> = {}): RenderJobRow {
  return {
    id: "j1",
    kind: "ship",
    playlist_id: "p1",
    status: "running",
    progress: 0.375,
    requeue: false,
    result: null,
    error: null,
    attempt: 1,
    created_at: "2026-10-19T10:00:00Z",
    finished_at: null,
    ...partial,
  };
}

/** A PostgREST-shaped fake: every builder call chains, the terminal call answers. */
function fakeClient(answer: { data: unknown; error: { message: string } | null }) {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "order", "limit"]) {
    builder[name] = vi.fn((...args: unknown[]) => {
      record(name, args);
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(() => {
    record("maybeSingle", []);
    return Promise.resolve(answer);
  });
  const from = vi.fn((table: string) => {
    record("from", [table]);
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("rowToRenderJob", () => {
  it("maps the columns and holds progress inside 0..1", () => {
    expect(rowToRenderJob(row())).toEqual({
      id: "j1",
      kind: "ship",
      playlistId: "p1",
      status: "running",
      progress: 0.375,
      requeue: false,
      result: null,
      exportResult: null,
      exportRequest: null,
      phase: null,
      error: null,
      attempt: 1,
      createdAt: "2026-10-19T10:00:00Z",
      finishedAt: null,
    });
    expect(rowToRenderJob(row({ progress: "0.5" })).progress).toBe(0.5);
    expect(rowToRenderJob(row({ progress: 7 })).progress).toBe(1);
    expect(rowToRenderJob(row({ progress: null, status: "queued" })).progress).toBe(0);
    expect(rowToRenderJob(row({ progress: 0.2, status: "done" })).progress).toBe(1);
    expect(rowToRenderJob(row({ requeue: null, attempt: null })).requeue).toBe(false);
    expect(rowToRenderJob(row({ requeue: null, attempt: null })).attempt).toBe(0);
  });

  it("reads the finished result and tolerates shapes it doesn't know", () => {
    const result = { shipped: 6, failed: 1, superseded: 1, total: 8, failures: [{ matchId: "m1", eventId: 42, error: "cut_failed" }] };
    expect(parseRenderJobResult(result)).toEqual(result);
    expect(parseRenderJobResult({ shipped: "3", total: 3 })).toEqual({ shipped: 3, failed: 0, superseded: 0, total: 3, failures: [] });
    expect(parseRenderJobResult(null)).toBeNull();
    expect(parseRenderJobResult("done")).toBeNull();
    expect(parseRenderJobResult({ unrelated: true })).toBeNull();
    expect(rowToRenderJob(row({ status: "done", result })).result?.failed).toBe(1);
  });
});

describe("live jobs and counts", () => {
  it("counts queued and running as live", () => {
    expect(isRenderJobLive("queued")).toBe(true);
    expect(isRenderJobLive("running")).toBe(true);
    expect(isRenderJobLive("done")).toBe(false);
    expect(isRenderJobLive("failed")).toBe(false);
  });

  it("derives 'done of total' from progress while running and from the result once finished", () => {
    expect(renderJobCounts(null, 8)).toEqual({ done: 0, total: 8, failed: 0 });
    expect(renderJobCounts(rowToRenderJob(row({ progress: 0.375 })), 8)).toEqual({ done: 3, total: 8, failed: 0 });
    expect(renderJobCounts(rowToRenderJob(row({ progress: 1.5 })), 8)).toEqual({ done: 8, total: 8, failed: 0 });
    const done = rowToRenderJob(row({ status: "done", result: { shipped: 6, failed: 2, superseded: 0, total: 8 } }));
    expect(renderJobCounts(done, 5)).toEqual({ done: 8, total: 8, failed: 2 });
    const noTotal = rowToRenderJob(row({ status: "done", result: { shipped: 2, failed: 0, superseded: 0, total: 0 } }));
    expect(renderJobCounts(noTotal, 2)).toEqual({ done: 2, total: 2, failed: 0 });
  });
});

describe("reads", () => {
  it("getRenderJob selects the agreed columns by id and maps the row", async () => {
    const { client, calls } = fakeClient({ data: row({ status: "queued", progress: null }), error: null });
    const job = await getRenderJob(client, "j1");
    expect(calls.from).toEqual([["render_jobs"]]);
    expect(calls.select).toEqual([[RENDER_JOB_SELECT]]);
    expect(calls.eq).toEqual([["id", "j1"]]);
    expect(job).toMatchObject({ id: "j1", status: "queued", progress: 0 });
  });

  it("getRenderJob answers null for a missing row and for an error", async () => {
    expect(await getRenderJob(fakeClient({ data: null, error: null }).client, "j1")).toBeNull();
    expect(await getRenderJob(fakeClient({ data: null, error: { message: "boom" } }).client, "j1")).toBeNull();
  });

  it("getLiveRenderJob asks for the newest queued or running job of the kind", async () => {
    const { client, calls } = fakeClient({ data: row(), error: null });
    const job = await getLiveRenderJob(client, "p1", "ship");
    expect(calls.eq).toEqual([
      ["playlist_id", "p1"],
      ["kind", "ship"],
    ]);
    expect(calls.in).toEqual([["status", ["queued", "running"]]]);
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
    expect(calls.limit).toEqual([[1]]);
    expect(job?.id).toBe("j1");
    expect(await getLiveRenderJob(fakeClient({ data: null, error: null }).client, "p1", "ship")).toBeNull();
  });
});
