import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listMatchIndex } from "../matches-db";
import { listPlaylistIndex } from "../playlists-db";
import { listReportDraftTitles } from "../report-drafts-db";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** Thenable chain double: records every call; each awaited read takes the next result. */
function mockClient(results: Result[], uid: string | null = "me") {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  let read = 0;
  builder.then = (resolve: (v: unknown) => void) => resolve(results[Math.min(read++, results.length - 1)]);
  const from = vi.fn(() => builder);
  const client = {
    from,
    auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null }, error: null }) },
  } as unknown as SupabaseClient;
  return { client, from, calls, reads: () => read };
}

const selects = (calls: { method: string; args: unknown[] }[]) => calls.filter((c) => c.method === "select").map((c) => c.args[0]);

describe("listPlaylistIndex", () => {
  const rows = [
    { id: "p1", name: "Scouting", folder_id: "f1", created_at: "2026-10-01T10:00:00Z" },
    { id: "p2", name: "Loose", folder_id: null, created_at: "2026-10-02T10:00:00Z" },
  ];

  it("reads the caller's playlists in the space: names, folders and dates, never their clips", async () => {
    const { client, from, calls } = mockClient([{ data: rows, error: null }]);
    expect(await listPlaylistIndex(client, "org1")).toEqual([
      { id: "p1", name: "Scouting", folderId: "f1", createdAt: "2026-10-01T10:00:00Z" },
      { id: "p2", name: "Loose", folderId: null, createdAt: "2026-10-02T10:00:00Z" },
    ]);
    expect(from).toHaveBeenCalledWith("playlists");
    expect(selects(calls)).toEqual(["id, name, folder_id, created_at, kind"]);
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", "me"] });
    expect(calls).toContainEqual({ method: "eq", args: ["org_id", "org1"] });
  });

  it("takes in a personal space's playlists from before spaces", async () => {
    const { client, calls } = mockClient([{ data: rows, error: null }]);
    await listPlaylistIndex(client, "org1", { includeUnscoped: true });
    expect(calls).toContainEqual({ method: "or", args: ["org_id.eq.org1,org_id.is.null"] });
  });

  it("is empty without a session, and asks nothing", async () => {
    const { client, from } = mockClient([{ data: rows, error: null }], null);
    expect(await listPlaylistIndex(client, "org1")).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("throws when the read fails, so a failure is never read as no playlists", async () => {
    const { client } = mockClient([{ data: null, error: { message: "boom" } }]);
    await expect(listPlaylistIndex(client, "org1")).rejects.toThrow(/boom/);
  });
});

describe("listMatchIndex", () => {
  const row = {
    id: "g1",
    title: "Södertälje BBK vs Köping Stars",
    game_date: "2026-11-14",
    home_team: { name: "Södertälje BBK", color: "#123456" },
    away_team: { name: "Köping Stars", color: "#654321" },
    archived_at: null,
    created_at: "2026-11-15T10:00:00Z",
  };

  it("reads the caller's games in the space as the Library lists them, without rosters, marks or plays", async () => {
    const { client, from, calls } = mockClient([{ data: [row, { ...row, id: "g2", archived_at: "2026-11-16T10:00:00Z" }], error: null }]);
    expect(await listMatchIndex(client, "org1")).toEqual([
      { id: "g1", title: "Södertälje BBK vs Köping Stars", date: "2026-11-14", homeTeam: "Södertälje BBK", awayTeam: "Köping Stars", archivedAt: null, createdAt: "2026-11-15T10:00:00Z" },
      { id: "g2", title: "Södertälje BBK vs Köping Stars", date: "2026-11-14", homeTeam: "Södertälje BBK", awayTeam: "Köping Stars", archivedAt: "2026-11-16T10:00:00Z", createdAt: "2026-11-15T10:00:00Z" },
    ]);
    expect(from).toHaveBeenCalledWith("matches");
    expect(selects(calls)).toEqual(["id, title, game_date, home_team, away_team, created_at, archived_at"]);
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", "me"] });
    expect(calls).toContainEqual({ method: "eq", args: ["org_id", "org1"] });
  });

  it("still lists the games of a database the archive migration hasn't reached, none of them archived", async () => {
    const { archived_at: _left, ...older } = row;
    const { client, calls, reads } = mockClient([
      { data: null, error: { message: "column matches.archived_at does not exist", code: "42703" } },
      { data: [older], error: null },
    ]);
    const games = await listMatchIndex(client, "org1");
    expect(reads()).toBe(2);
    expect(selects(calls)).toEqual([
      "id, title, game_date, home_team, away_team, created_at, archived_at",
      "id, title, game_date, home_team, away_team, created_at",
    ]);
    expect(games).toHaveLength(1);
    expect(games[0].archivedAt).toBeNull();
  });

  it("tolerates a game with a team it can't name", async () => {
    const { client } = mockClient([{ data: [{ ...row, home_team: null, game_date: null }], error: null }]);
    expect(await listMatchIndex(client, "org1")).toMatchObject([{ homeTeam: "", awayTeam: "Köping Stars", date: null }]);
  });

  it("is empty without a session, and asks nothing", async () => {
    const { client, from } = mockClient([{ data: [row], error: null }], null);
    expect(await listMatchIndex(client, "org1")).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("throws when the read fails", async () => {
    const { client } = mockClient([{ data: null, error: { message: "boom" } }]);
    await expect(listMatchIndex(client, "org1")).rejects.toThrow(/boom/);
  });
});

describe("listReportDraftTitles", () => {
  it("reads each draft's title and date, and none of its sections", async () => {
    const { client, from, calls } = mockClient([
      {
        data: [
          { playlist_id: "p1", updated_at: "2026-11-01T10:00:00Z", title: "Södertälje BBK" },
          { playlist_id: "p2", updated_at: "2026-11-02T10:00:00Z", title: "" },
        ],
        error: null,
      },
    ]);
    expect(await listReportDraftTitles(client)).toEqual([
      { playlistId: "p1", updatedAt: "2026-11-01T10:00:00Z", title: "Södertälje BBK", players: 0 },
      { playlistId: "p2", updatedAt: "2026-11-02T10:00:00Z", title: null, players: 0 },
    ]);
    expect(from).toHaveBeenCalledWith("scouting_report_drafts");
    expect(selects(calls)).toEqual(["playlist_id, updated_at, title:content->>title"]);
  });

  it("throws when the read fails", async () => {
    const { client } = mockClient([{ data: null, error: { message: "boom" } }]);
    await expect(listReportDraftTitles(client)).rejects.toThrow(/boom/);
  });
});
