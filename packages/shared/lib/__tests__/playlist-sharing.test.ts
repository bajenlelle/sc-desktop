import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlaylistItem } from "../../types/match";
import { heldForPlayers, newRecipients, playlistIsShared, setPlaylistRecipients } from "../playlist-sharing";

describe("playlistIsShared", () => {
  it("is shared when it has a team or a person", () => {
    expect(playlistIsShared({})).toBe(false);
    expect(playlistIsShared({ teamIds: [], userIds: [] })).toBe(false);
    expect(playlistIsShared({ teamIds: ["t1"] })).toBe(true);
    expect(playlistIsShared({ userIds: ["u1"] })).toBe(true);
  });
});

describe("heldForPlayers", () => {
  const clip = (matchId: string, eventId: number, r2Url?: string): PlaylistItem => ({ type: "clip", matchId, eventId, ...(r2Url ? { r2Url } : {}) });
  const card: PlaylistItem = { type: "text", id: "t", text: "x", durationSeconds: 3 };
  const pl = (id: string, items: PlaylistItem[], shared = true) => ({ id, name: id, items, teamIds: shared ? ["t1"] : [] });

  it("lists nothing when no playlist is shared", () => {
    expect(heldForPlayers([pl("a", [clip("g1", 1)], false)], "g1", "a")).toEqual([]);
  });
  it("counts the target's clips with no file, from any game, and no cards", () => {
    const a = pl("a", [clip("g1", 1), clip("g2", 5), clip("g1", 2, "https://x/2.mp4"), card]);
    expect(heldForPlayers([a], "g1", "a")).toEqual([{ playlist: a, count: 2 }]);
  });
  it("lists another shared playlist only when it holds one of this game's clips with no file", () => {
    const b = pl("b", [clip("g1", 3)]);
    const c = pl("c", [clip("g2", 4)]);
    expect(heldForPlayers([b, c], "g1", null).map((h) => h.playlist.id)).toEqual(["b"]);
  });
  it("puts the target first, then the most held", () => {
    const a = pl("a", [clip("g1", 1)]);
    const b = pl("b", [clip("g1", 2), clip("g1", 3), clip("g1", 4)]);
    const c = pl("c", [clip("g1", 5), clip("g1", 6)]);
    expect(heldForPlayers([b, c, a], "g1", "a").map((h) => [h.playlist.id, h.count])).toEqual([["a", 1], ["b", 3], ["c", 2]]);
  });
  it("leaves out a shared target whose clips are all uploaded", () => {
    expect(heldForPlayers([pl("a", [clip("g1", 1, "https://x/1.mp4")])], "g1", "a")).toEqual([]);
  });
});

describe("newRecipients", () => {
  it("lists only the ids prev lacked", () => {
    expect(newRecipients({ teamIds: ["t1"], userIds: [] }, ["t1", "t2"], ["u1"])).toEqual({ teams: ["t2"], users: ["u1"] });
    expect(newRecipients({}, ["t1"], [])).toEqual({ teams: ["t1"], users: [] });
    expect(newRecipients({ teamIds: ["t1"], userIds: ["u1"] }, [], [])).toEqual({ teams: [], users: [] });
  });
});

describe("setPlaylistRecipients", () => {
  /** A client that accepts any query chain and records which tables were written with what. */
  function recordingClient() {
    const writes: Array<{ table: string; op: string; arg?: unknown }> = [];
    const chain = (table: string): Record<string, unknown> => {
      const b: Record<string, unknown> = {
        then(res: (x: { error: null; data: null }) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve({ error: null, data: null }).then(res, rej);
        },
      };
      for (const op of ["delete", "upsert", "update", "eq", "not", "in"]) {
        b[op] = (arg?: unknown) => {
          if (op === "delete" || op === "upsert" || op === "update") writes.push({ table, op, arg });
          return b;
        };
      }
      return b;
    };
    const client = {
      auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
      from: (table: string) => chain(table),
    } as unknown as SupabaseClient;
    return { client, writes };
  }

  it("writes the team shares, the legacy team_id and the direct shares", async () => {
    const { client, writes } = recordingClient();
    await setPlaylistRecipients(client, "pl1", ["t1"], ["u1"]);
    expect(writes).toContainEqual({ table: "playlist_shares", op: "upsert", arg: [{ playlist_id: "pl1", team_id: "t1" }] });
    expect(writes).toContainEqual({ table: "playlists", op: "update", arg: { team_id: "t1" } });
    expect(writes).toContainEqual({ table: "playlist_user_shares", op: "upsert", arg: [{ playlist_id: "pl1", user_id: "u1", shared_by: "me" }] });
    expect(writes.filter((w) => w.op === "delete").map((w) => w.table)).toEqual(["playlist_shares", "playlist_user_shares"]);
  });
});
