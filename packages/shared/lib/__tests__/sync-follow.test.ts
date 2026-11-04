import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlayByPlayEvent, SyncPoint } from "../../types/match";
import { clipShipKey } from "../clip-timing";
import { followSyncChange, type ClipPatch, type RecutGroup, type RecutOutcome, type SyncFollowDeps } from "../sync-follow";

const T = (hms: string) => `2026-09-20T${hms}Z`;
/** Tip-off at 0:42 in the video; the play 10 min later, so at 642 s. */
const before: SyncPoint = { syncVideoTime: 42, syncRealWorldTime: T("17:30:00") };
/** The same game 4 s later. */
const after: SyncPoint = { syncVideoTime: 46, syncRealWorldTime: T("17:30:00") };
const ev = (eventId: number): PlayByPlayEvent => ({
  eventId, type: "2pt", subType: "jumpshot", period: 1, gameClockTime: "05:00",
  realWorldTime: T("17:40:00"), isSuccessful: 1, qualifiers: [],
});
const game = (sync: SyncPoint | undefined) => ({ id: "m1", title: "Lidingö vs Bajen", videoUrl: "/v.mp4", events: [ev(42), ev(43), ev(44)], syncPoint: sync });
const url = (eventId: number, pre: number, post: number, start: number) => "https://media/" + clipShipKey("m1", eventId, pre, post, start);

interface DbRow {
  playlist_id: string; match_id: string; event_id: number;
  pre_roll_offset: number; post_roll_offset: number; r2_url: string | null;
  crop_keyframes: Array<{ t: number; cx: number }> | null; playlists: { name: string };
}
const row = (playlist_id: string, event_id: number, over: Partial<DbRow> = {}): DbRow => ({
  playlist_id, match_id: "m1", event_id, pre_roll_offset: 0, post_roll_offset: 0, r2_url: null, crop_keyframes: null,
  playlists: { name: playlist_id.toUpperCase() }, ...over,
});

/** A client that lists `rows` for the game and records every update. */
function fakeClient(rows: DbRow[] | Error, failUpdates: (patch: Record<string, unknown>) => boolean = () => false) {
  const updates: Array<{ patch: unknown; filters: Array<[string, unknown]> }> = [];
  const thenable = (result: () => { data: unknown; error: { message: string } | null }, filters: Array<[string, unknown]>) => {
    const b: Record<string, unknown> = {
      eq(col: string, v: unknown) { filters.push([col, v]); return b; },
      or() { return b; },
      then(res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(result()).then(res, rej); },
    };
    return b;
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } }, error: null }) },
    from(table: string) {
      expect(table).toBe("playlist_clips");
      return {
        select: () => thenable(() => (rows instanceof Error ? { data: null, error: { message: rows.message } } : { data: rows, error: null }), []),
        update(patch: Record<string, unknown>) {
          const call = { patch, filters: [] as Array<[string, unknown]> };
          updates.push(call);
          return thenable(() => (failUpdates(patch) ? { data: null, error: { message: "db down" } } : { data: null, error: null }), call.filters);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, updates };
}

function deps(over: { canCut?: boolean; recut?: SyncFollowDeps["recut"] } = {}) {
  const patches: ClipPatch[] = [];
  const recuts: RecutGroup[] = [];
  const reported: Array<{ error: unknown; where: string }> = [];
  const d: SyncFollowDeps = {
    canCut: async () => over.canCut ?? true,
    recut: over.recut ?? (async (group) => { recuts.push(group); return { shipped: group.rows.length, failedEventIds: [], uploaded: [], aborted: false }; }),
    onPatches: (p) => patches.push(...p),
    report: (error, where) => reported.push({ error, where }),
  };
  return { d, patches, recuts, reported };
}

const signal = () => new AbortController().signal;

describe("followSyncChange", () => {
  it("does nothing when the game has no sync, no rows, or nothing moved", async () => {
    const none = fakeClient([]);
    expect(await followSyncChange(none.client, game(undefined), before, signal(), deps().d)).toEqual({ kind: "nothing" });
    expect(await followSyncChange(none.client, game(after), before, signal(), deps().d)).toEqual({ kind: "nothing" });
    const same = fakeClient([row("p1", 42, { r2_url: url(42, 8, 5, 634) })]);
    const d = deps();
    expect(await followSyncChange(same.client, game(before), before, signal(), d.d)).toEqual({ kind: "nothing" });
    expect(same.updates).toEqual([]);
    expect(d.recuts).toEqual([]);
  });

  it("shifts each pan by the clip's move and announces the patch", async () => {
    const { client, updates } = fakeClient([row("p1", 42, { crop_keyframes: [{ t: 640, cx: 0.4 }] })]);
    const d = deps();
    expect(await followSyncChange(client, game(after), before, signal(), d.d)).toEqual({ kind: "nothing" });
    expect(updates).toEqual([{ patch: { crop_keyframes: [{ t: 644, cx: 0.4 }] }, filters: [["playlist_id", "p1"], ["match_id", "m1"], ["event_id", 42]] }]);
    expect(d.patches).toEqual([{ playlistId: "p1", matchId: "m1", eventId: 42, cropKeyframes: [{ t: 644, cx: 0.4 }] }]);
  });

  it("hides every moved shared clip when the video can't be cut here", async () => {
    const { client, updates } = fakeClient([row("p1", 42, { r2_url: url(42, 8, 5, 634) }), row("p2", 43, { r2_url: url(43, 8, 5, 634) })]);
    const d = deps({ canCut: false });
    expect(await followSyncChange(client, game(after), before, signal(), d.d)).toEqual({ kind: "hidden", hidden: 2 });
    expect(updates.map((u) => u.patch)).toEqual([{ r2_url: null }, { r2_url: null }]);
    expect(updates[0].filters).toContainEqual(["r2_url", url(42, 8, 5, 634)]);
    expect(d.patches).toEqual([
      { playlistId: "p1", matchId: "m1", eventId: 42, r2Url: null },
      { playlistId: "p2", matchId: "m1", eventId: 43, r2Url: null },
    ]);
    expect(d.recuts).toEqual([]);
  });

  it("re-cuts moved clips in groups per playlist and roll pair, and hides the ones that failed", async () => {
    const rows = [
      row("p1", 42, { r2_url: url(42, 8, 5, 634) }),
      row("p1", 43, { r2_url: url(43, 8, 5, 634) }),
      row("p1", 44, { r2_url: url(44, 10, 5, 632) }),
      row("p2", 42, { r2_url: url(42, 8, 5, 634) }),
    ];
    const { client, updates } = fakeClient(rows);
    const groups: RecutGroup[] = [];
    const recut = async (group: RecutGroup): Promise<RecutOutcome> => {
      groups.push(group);
      if (group.playlistId === "p1" && group.rolls.pre === 8)
        return { shipped: 1, failedEventIds: [43], uploaded: [{ matchId: "m1", eventId: 42, r2Url: "new42" }], aborted: false };
      return { shipped: 1, failedEventIds: [], uploaded: [{ matchId: "m1", eventId: group.rows[0].clip.eventId, r2Url: "new" }], aborted: false };
    };
    const d = deps({ recut });

    const result = await followSyncChange(client, game(after), before, signal(), d.d);

    expect(result).toEqual({ kind: "recut", shipped: 3, failed: 1, hidden: 1, playlists: 2 });
    expect(groups.map((g) => [g.playlistId, g.playlistName, g.rolls, g.rows.map((r) => r.clip.eventId)])).toEqual([
      ["p1", "P1", { pre: 8, post: 5 }, [42, 43]],
      ["p1", "P1", { pre: 10, post: 5 }, [44]],
      ["p2", "P2", { pre: 8, post: 5 }, [42]],
    ]);
    expect(d.patches).toContainEqual({ playlistId: "p1", matchId: "m1", eventId: 42, r2Url: "new42" });
    expect(d.patches).toContainEqual({ playlistId: "p1", matchId: "m1", eventId: 43, r2Url: null });
    expect(updates).toEqual([{ patch: { r2_url: null }, filters: [["playlist_id", "p1"], ["match_id", "m1"], ["event_id", 43], ["r2_url", url(43, 8, 5, 634)]] }]);
  });

  it("a group whose cut throws is hidden, the others continue", async () => {
    const { client, updates } = fakeClient([row("p1", 42, { r2_url: url(42, 8, 5, 634) }), row("p2", 43, { r2_url: url(43, 8, 5, 634) })]);
    const recut = async (group: RecutGroup): Promise<RecutOutcome> => {
      if (group.playlistId === "p1") throw new Error("file went away");
      return { shipped: 1, failedEventIds: [], uploaded: [], aborted: false };
    };
    const d = deps({ recut });
    expect(await followSyncChange(client, game(after), before, signal(), d.d)).toEqual({ kind: "recut", shipped: 1, failed: 1, hidden: 1, playlists: 2 });
    expect(updates.map((u) => u.filters[0])).toEqual([["playlist_id", "p1"]]);
  });

  it("an aborted signal stops before hiding anything and reports aborted", async () => {
    const { client, updates } = fakeClient([row("p1", 42, { r2_url: url(42, 8, 5, 634) }), row("p2", 43, { r2_url: url(43, 8, 5, 634) })]);
    const controller = new AbortController();
    const seen: string[] = [];
    const recut = async (group: RecutGroup): Promise<RecutOutcome> => {
      seen.push(group.playlistId);
      controller.abort();
      return { shipped: 0, failedEventIds: [42], uploaded: [], aborted: true };
    };
    const d = deps({ recut });
    expect(await followSyncChange(client, game(after), before, controller.signal, d.d)).toEqual({ kind: "aborted" });
    expect(seen).toEqual(["p1"]);
    expect(updates).toEqual([]);
  });

  it("a signal already aborted does nothing, and shows nothing (no toast was started)", async () => {
    const { client, updates } = fakeClient([row("p1", 42, { r2_url: url(42, 8, 5, 634), crop_keyframes: [{ t: 640, cx: 0.4 }] })]);
    const controller = new AbortController();
    controller.abort();
    const d = deps();
    expect(await followSyncChange(client, game(after), before, controller.signal, d.d)).toEqual({ kind: "nothing" });
    expect(updates).toEqual([]);
    expect(d.recuts).toEqual([]);
  });

  it("moves the pans even when the moved shared clips can only be hidden", async () => {
    const { client, updates } = fakeClient([row("p1", 42, { r2_url: url(42, 8, 5, 634), crop_keyframes: [{ t: 640, cx: 0.4 }] })]);
    const d = deps({ canCut: false });
    expect(await followSyncChange(client, game(after), before, signal(), d.d)).toEqual({ kind: "hidden", hidden: 1 });
    expect(updates.map((u) => u.patch)).toEqual([{ crop_keyframes: [{ t: 644, cx: 0.4 }] }, { r2_url: null }]);
    expect(d.patches.map((p) => ("r2Url" in p ? "hidden" : "pan"))).toEqual(["pan", "hidden"]);
  });

  it("tells the cutter how many clips were resolved before each group, of how many", async () => {
    const { client } = fakeClient([row("p1", 42, { r2_url: url(42, 8, 5, 634) }), row("p1", 43, { r2_url: url(43, 8, 5, 634) }), row("p2", 44, { r2_url: url(44, 8, 5, 634) })]);
    const progress: Array<[number, number]> = [];
    const recut = async (group: RecutGroup, done: number, total: number): Promise<RecutOutcome> => {
      progress.push([done, total]);
      return { shipped: group.rows.length, failedEventIds: [], uploaded: [], aborted: false };
    };
    await followSyncChange(client, game(after), before, signal(), deps({ recut }).d);
    expect(progress).toEqual([[0, 3], [2, 3]]);
  });

  it("reports a failed pan update, a failed hide and a group that couldn't be cut, with the error itself", async () => {
    const { client } = fakeClient(
      [row("p1", 42, { r2_url: url(42, 8, 5, 634), crop_keyframes: [{ t: 640, cx: 0.4 }] }), row("p2", 43, { r2_url: url(43, 8, 5, 634) })],
      (patch) => "crop_keyframes" in patch || "r2_url" in patch,
    );
    const boom = new Error("file went away");
    const recut = async (group: RecutGroup): Promise<RecutOutcome> => {
      if (group.playlistId === "p1") throw boom;
      return { shipped: 0, failedEventIds: [43], uploaded: [], aborted: false };
    };
    const d = deps({ recut });
    expect(await followSyncChange(client, game(after), before, signal(), d.d)).toEqual({ kind: "recut", shipped: 0, failed: 2, hidden: 0, playlists: 2 });
    expect(d.reported.map((r) => r.where)).toEqual(["pan", "recut", "hide", "hide"]);
    expect(d.reported[1].error).toBe(boom);
    expect(d.reported[0].error).toBeInstanceOf(Error);
  });

  it("a listing error throws", async () => {
    const { client } = fakeClient(new Error("boom"));
    await expect(followSyncChange(client, game(after), before, signal(), deps().d)).rejects.toThrow(/boom/);
  });
});
