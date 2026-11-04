import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../../types/match";
import { itemsDiff } from "../playlist-history";
import { appendClips, writePlaylistItems } from "../playlist-write";

/** Every call to the client, in the order it was made. */
interface Call {
  op: "delete" | "upsert" | "insert" | "rpc";
  table?: string;
  args?: unknown;
  filters?: Array<[string, unknown]>;
}

function fakeClient() {
  const calls: Call[] = [];
  const chain = (call: Call) => {
    const b: Record<string, unknown> = {
      eq(col: string, v: unknown) { call.filters!.push([col, v]); return b; },
      in(col: string, v: unknown) { call.filters!.push([col, v]); return b; },
      then(res: (x: { error: null; data: null }) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve({ error: null, data: null }).then(res, rej);
      },
    };
    return b;
  };
  const client = {
    from(table: string) {
      return {
        delete() { const c: Call = { op: "delete", table, filters: [] }; calls.push(c); return chain(c); },
        upsert(rows: unknown, opts: unknown) { const c: Call = { op: "upsert", table, args: { rows, opts } }; calls.push(c); return chain(c); },
        insert(row: unknown) { const c: Call = { op: "insert", table, args: row }; calls.push(c); return chain(c); },
      };
    },
    rpc(name: string, args: unknown) { calls.push({ op: "rpc", args: { name, args } }); return Promise.resolve({ error: null }); },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const clip = (eventId: number, extra: Partial<PlaylistClipItem> = {}): PlaylistClipItem => ({ type: "clip", matchId: "m1", eventId, ...extra });
const text = (id: string, extra: Partial<PlaylistTextCard> = {}): PlaylistTextCard => ({ type: "text", id, text: "Focus", durationSeconds: 5, ...extra });

describe("writePlaylistItems", () => {
  it("brings the server from `from` to `to`: delete, put back with files, cards, then the order", async () => {
    const { client, calls } = fakeClient();
    const from: PlaylistItem[] = [clip(1), clip(2, { r2Url: "u" }), text("T1")];
    const to: PlaylistItem[] = [clip(2, { r2Url: "u" }), clip(3, { r2Url: "c" }), text("T2")];

    const diff = await writePlaylistItems(client, "pl1", from, to);

    expect(diff).toEqual(itemsDiff(from, to));
    expect(calls.map((c) => c.op)).toEqual(["delete", "delete", "upsert", "insert", "rpc"]);
    expect(calls[0]).toMatchObject({ table: "playlist_clips", filters: [["playlist_id", "pl1"], ["match_id", "m1"], ["event_id", 1]] });
    expect(calls[1]).toMatchObject({ table: "playlist_clips", filters: [["playlist_id", "pl1"], ["item_id", ["T1"]]] });
    // A row put back keeps its hosted file (restore), at a placeholder position: the order is saved after.
    expect(calls[2].args).toEqual({
      rows: [{
        playlist_id: "pl1", item_type: "clip", match_id: "m1", event_id: 3, position: 0,
        pre_roll_offset: 0, post_roll_offset: 0, note: null, crop_keyframes: null, r2_url: "c",
      }],
      opts: { onConflict: "playlist_id,match_id,event_id", ignoreDuplicates: true },
    });
    expect(calls[3].args).toEqual({
      playlist_id: "pl1", item_type: "text", item_id: "T2", text_content: "Focus", duration_seconds: 5,
      position: 0, match_id: null, event_id: null, pre_roll_offset: 0, post_roll_offset: 0,
    });
    expect(calls[4].args).toEqual({
      name: "reorder_playlist_items",
      args: {
        p_playlist_id: "pl1",
        p_items: [
          { item_type: "clip", match_id: "m1", event_id: 2, position: 0, group_id: null },
          { item_type: "clip", match_id: "m1", event_id: 3, position: 1, group_id: null },
          { item_type: "text", item_id: "T2", position: 2, group_id: null },
        ],
      },
    });
  });

  it("removing the last row still deletes it (the order is skipped on an empty list)", async () => {
    const { client, calls } = fakeClient();
    await writePlaylistItems(client, "pl1", [clip(1)], []);
    expect(calls.map((c) => c.op)).toEqual(["delete"]);
    expect(calls[0].filters).toEqual([["playlist_id", "pl1"], ["match_id", "m1"], ["event_id", 1]]);
  });

  it("a pure reorder makes one rpc call and nothing else", async () => {
    const { client, calls } = fakeClient();
    await writePlaylistItems(client, "pl1", [clip(1), clip(2)], [clip(2), clip(1)]);
    expect(calls.map((c) => c.op)).toEqual(["rpc"]);
  });
});

describe("appendClips", () => {
  it("skips clips already in the playlist and duplicates in the batch, strips groupId, and positions from the end", async () => {
    const { client, calls } = fakeClient();
    const playlist = { id: "pl1", items: [clip(1, { groupId: "g1" }), text("T1")] };

    const fresh = await appendClips(client, playlist, [clip(1), clip(4, { groupId: "g9" }), clip(4)]);

    expect(fresh).toEqual([{ type: "clip", matchId: "m1", eventId: 4 }]);
    expect(calls.map((c) => c.op)).toEqual(["upsert"]);
    const { rows, opts } = calls[0].args as { rows: Record<string, unknown>[]; opts: unknown };
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ playlist_id: "pl1", match_id: "m1", event_id: 4, position: 2 });
    expect("r2_url" in rows[0]).toBe(false);
    expect(opts).toEqual({ onConflict: "playlist_id,match_id,event_id", ignoreDuplicates: true });
  });

  it("with nothing new makes no call and returns []", async () => {
    const { client, calls } = fakeClient();
    const fresh = await appendClips(client, { id: "pl1", items: [clip(1)] }, [clip(1)]);
    expect(fresh).toEqual([]);
    expect(calls).toEqual([]);
  });
});
