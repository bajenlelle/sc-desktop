import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newRecipients, playlistIsShared, setPlaylistRecipients } from "../playlist-sharing";

describe("playlistIsShared", () => {
  it("is shared when it has a team or a person", () => {
    expect(playlistIsShared({})).toBe(false);
    expect(playlistIsShared({ teamIds: [], userIds: [] })).toBe(false);
    expect(playlistIsShared({ teamIds: ["t1"] })).toBe(true);
    expect(playlistIsShared({ userIds: ["u1"] })).toBe(true);
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
