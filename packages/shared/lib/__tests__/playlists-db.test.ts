import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addClips,
  clearShippedClip,
  createPlaylist,
  getMyDirectPlaylists,
  getMySharedPlaylists,
  getMyTeamPlaylists,
  getPlaylistOrgId,
  listPlaylistNames,
  listPlaylists,
  reorderItems,
  rowToPlaylist,
  type PlaylistClipRow,
  type PlaylistRow,
} from "../playlists-db";

function clipRow(partial: Partial<PlaylistClipRow>): PlaylistClipRow {
  return {
    item_type: "clip",
    item_id: null,
    match_id: "m1",
    event_id: 1,
    position: 0,
    pre_roll_offset: 0,
    post_roll_offset: 0,
    note: null,
    text_content: null,
    duration_seconds: null,
    r2_url: null,
    group_id: null,
    crop_keyframes: null,
    ...partial,
  };
}

function textRow(partial: Partial<PlaylistClipRow>): PlaylistClipRow {
  return clipRow({ item_type: "text", item_id: "t1", match_id: null, event_id: null, ...partial });
}

function plRow(partial: Partial<PlaylistRow>): PlaylistRow {
  return {
    id: "p1",
    user_id: "owner",
    name: "P",
    folder_id: null,
    team_id: null,
    org_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    playlist_clips: [],
    playlist_shares: [],
    playlist_user_shares: [],
    ...partial,
  };
}

describe("rowToPlaylist", () => {
  it("sorts items by position", () => {
    const p = rowToPlaylist(
      plRow({
        playlist_clips: [
          clipRow({ event_id: 3, position: 2 }),
          clipRow({ event_id: 1, position: 0 }),
          clipRow({ event_id: 2, position: 1 }),
        ],
      }),
    );
    expect(p.items.map((i) => (i.type === "clip" ? i.eventId : -1))).toEqual([1, 2, 3]);
  });

  it("omits clip keys for zero offsets and null optionals", () => {
    const [item] = rowToPlaylist(plRow({ playlist_clips: [clipRow({})] })).items;
    expect(item).toEqual({ type: "clip", matchId: "m1", eventId: 1 });
    expect("preRollOffset" in item).toBe(false);
    expect("postRollOffset" in item).toBe(false);
    expect("note" in item).toBe(false);
    expect("r2Url" in item).toBe(false);
    expect("groupId" in item).toBe(false);
  });

  it("keeps clip keys for non-zero offsets and non-null optionals", () => {
    const [item] = rowToPlaylist(
      plRow({
        playlist_clips: [
          clipRow({
            pre_roll_offset: -1.5,
            post_roll_offset: 2,
            note: "watch feet",
            r2_url: "https://r2/x.mp4",
            group_id: "g1",
          }),
        ],
      }),
    ).items;
    expect(item).toEqual({
      type: "clip",
      matchId: "m1",
      eventId: 1,
      preRollOffset: -1.5,
      postRollOffset: 2,
      note: "watch feet",
      r2Url: "https://r2/x.mp4",
      groupId: "g1",
    });
  });

  it("maps text cards with defaults and keeps their group", () => {
    const p = rowToPlaylist(
      plRow({
        playlist_clips: [
          textRow({ text_content: null, duration_seconds: null }),
          textRow({ item_id: "t2", text_content: "Focus", duration_seconds: 8, group_id: "g1", position: 1 }),
        ],
      }),
    );
    expect(p.items[0]).toEqual({ type: "text", id: "t1", text: "", durationSeconds: 5 });
    expect(p.items[1]).toEqual({
      type: "text",
      id: "t2",
      text: "Focus",
      durationSeconds: 8,
      groupId: "g1",
    });
  });

  it("attaches a stats card spec to its text item, keeping the fallback line as text", () => {
    const spec = {
      type: "stats",
      v: 1,
      source: "genius_hosted",
      scope: "game",
      player: { id: "42", name: "Alva Berg", number: "7", teamId: "1", teamName: "Bajen" },
      game: { matchId: "m1", sourceGameId: "9", competitionId: 1, opponent: "AIK", date: "2026-10-12", home: true, us: 84, them: 79 },
      line: { min: 1800, pts: 24, fgm: 9, fga: 14, tpm: 3, tpa: 5, ftm: 3, fta: 4, oreb: 3, dreb: 7, ast: 5, stl: 1, blk: 0, tov: 2, pf: 3, pm: 12 },
      columns: ["pts", "reb"],
      heading: null,
      details: null,
      asOf: "2026-10-17T10:00:00Z",
    };
    const p = rowToPlaylist(
      plRow({
        playlist_clips: [
          textRow({ text_content: "Alva Berg · 24 PTS · 10 REB · vs AIK", card: spec }),
          textRow({ item_id: "t2", text_content: "Focus", card: { type: "title", v: 9 }, position: 1 }),
          clipRow({ card: spec, position: 2 }),
        ],
      }),
    );
    expect(p.items[0]).toMatchObject({ type: "text", id: "t1", text: "Alva Berg · 24 PTS · 10 REB · vs AIK", card: spec });
    // A spec this build can't draw is a plain text card.
    expect(p.items[1]).toEqual({ type: "text", id: "t2", text: "Focus", durationSeconds: 5 });
    expect(p.items[2]).not.toHaveProperty("card");
  });

  it("drops text cards without an item id and clips without match or event", () => {
    const p = rowToPlaylist(
      plRow({
        playlist_clips: [
          textRow({ item_id: null }),
          clipRow({ match_id: null, position: 1 }),
          clipRow({ event_id: null, position: 2 }),
          clipRow({ event_id: 9, position: 3 }),
        ],
      }),
    );
    expect(p.items).toEqual([{ type: "clip", matchId: "m1", eventId: 9 }]);
  });

  it("extracts teamIds and userIds from the share rows", () => {
    const p = rowToPlaylist(
      plRow({
        playlist_shares: [{ team_id: "t1" }, { team_id: "t2" }],
        playlist_user_shares: [{ user_id: "u1" }],
      }),
    );
    expect(p.teamIds).toEqual(["t1", "t2"]);
    expect(p.userIds).toEqual(["u1"]);
  });

  it("prefers the first user share's timestamp over a newer team share", () => {
    const p = rowToPlaylist(
      plRow({
        playlist_shares: [{ team_id: "t1", shared_at: "2026-02-01T00:00:00Z" }],
        playlist_user_shares: [{ user_id: "u1", shared_at: "2026-01-05T00:00:00Z" }],
      }),
    );
    // Suspicious: this depends on DB row order and can pick an older direct
    // share over a newer team share — pinned as current behavior.
    expect(p.sharedAt).toBe("2026-01-05T00:00:00Z");
  });

  it("falls back to the newest team share when the user share has no timestamp", () => {
    const p = rowToPlaylist(
      plRow({
        playlist_shares: [
          { team_id: "t1", shared_at: "2026-01-03T00:00:00Z" },
          { team_id: "t2", shared_at: "2026-01-08T00:00:00Z" },
        ],
        playlist_user_shares: [{ user_id: "u1" }],
      }),
    );
    expect(p.sharedAt).toBe("2026-01-08T00:00:00Z");
  });

  it("omits sharedAt entirely when no share carries a timestamp", () => {
    const p = rowToPlaylist(plRow({ playlist_shares: [{ team_id: "t1" }] }));
    expect("sharedAt" in p).toBe(false);
  });

  it("attributes sharedBy to the direct sharer, else the owner", () => {
    const direct = rowToPlaylist(
      plRow({
        playlist_user_shares: [
          { user_id: "u1", shared_at: "2026-01-05T00:00:00Z", shared_by: "coach2" },
        ],
      }),
    );
    expect(direct.sharedBy).toBe("coach2");

    const teamOnly = rowToPlaylist(
      plRow({ playlist_shares: [{ team_id: "t1", shared_at: "2026-01-05T00:00:00Z" }] }),
    );
    expect(teamOnly.sharedBy).toBe("owner");
  });
});

/**
 * Supabase double for the two chains getMyTeamPlaylists uses:
 *   from("playlist_shares").select("playlist_id")[.in("team_id", …)]
 *   from("playlists").select(…).in("id", …).order(…)
 */
function mockClient(opts: {
  shares?: Array<{ playlist_id: string }> | null;
  sharesError?: { message: string } | null;
  playlists?: PlaylistRow[] | null;
  playlistsError?: { message: string } | null;
}) {
  const calls: { tables: string[]; teamFilter?: unknown; idFilter?: unknown } = { tables: [] };
  const sharesResult = { data: opts.shares ?? null, error: opts.sharesError ?? null };
  const playlistsResult = { data: opts.playlists ?? null, error: opts.playlistsError ?? null };

  const client = {
    from(table: string) {
      calls.tables.push(table);
      if (table === "playlist_shares") {
        const b: Record<string, unknown> = {
          in(_col: string, values: unknown) { calls.teamFilter = values; return b; },
          then: (r: (x: typeof sharesResult) => unknown) => Promise.resolve(sharesResult).then(r),
        };
        return { select: () => b };
      }
      const b: Record<string, unknown> = {
        in(_col: string, values: unknown) { calls.idFilter = values; return b; },
        order() { return b; },
        then: (r: (x: typeof playlistsResult) => unknown) => Promise.resolve(playlistsResult).then(r),
      };
      return { select: () => b };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe("getMyTeamPlaylists", () => {
  it("resolves playlists through playlist_shares, scoped to the given teams", async () => {
    const { client, calls } = mockClient({
      shares: [{ playlist_id: "p1" }],
      playlists: [plRow({ id: "p1" })],
    });
    const out = await getMyTeamPlaylists(client, ["teamA", "teamB"]);
    expect(calls.tables).toEqual(["playlist_shares", "playlists"]);
    expect(calls.teamFilter).toEqual(["teamA", "teamB"]);
    expect(calls.idFilter).toEqual(["p1"]);
    expect(out.map((p) => p.id)).toEqual(["p1"]);
  });

  // The bug this function was rewritten for: playlists.team_id only ever held
  // teamIds[0], and ON DELETE SET NULL wiped it when that team was deleted.
  it("still finds a playlist whose legacy team_id is null (team was deleted)", async () => {
    const { client } = mockClient({
      shares: [{ playlist_id: "p1" }],
      playlists: [plRow({ id: "p1", team_id: null })],
    });
    await expect(getMyTeamPlaylists(client, ["survivingTeam"])).resolves.toHaveLength(1);
  });

  // The other half: a player in a team OTHER than the first one shared with.
  it("still finds a playlist whose legacy team_id points at a different team", async () => {
    const { client } = mockClient({
      shares: [{ playlist_id: "p1" }],
      playlists: [plRow({ id: "p1", team_id: "someOtherTeam" })],
    });
    await expect(getMyTeamPlaylists(client, ["myTeam"])).resolves.toHaveLength(1);
  });

  it("dedupes a playlist shared with two of the caller's teams", async () => {
    const { client, calls } = mockClient({
      shares: [{ playlist_id: "p1" }, { playlist_id: "p1" }, { playlist_id: "p2" }],
      playlists: [plRow({ id: "p1" }), plRow({ id: "p2" })],
    });
    await getMyTeamPlaylists(client, ["teamA", "teamB"]);
    expect(calls.idFilter).toEqual(["p1", "p2"]);
  });

  it("leaves scoping to RLS when no teamIds are given", async () => {
    const { client, calls } = mockClient({
      shares: [{ playlist_id: "p1" }],
      playlists: [plRow({ id: "p1" })],
    });
    await getMyTeamPlaylists(client);
    expect(calls.teamFilter).toBeUndefined();
  });

  it("returns [] without touching the database for an empty team list", async () => {
    const { client, calls } = mockClient({});
    await expect(getMyTeamPlaylists(client, [])).resolves.toEqual([]);
    expect(calls.tables).toEqual([]);
  });

  it("returns [] without fetching playlists when no shares match", async () => {
    const { client, calls } = mockClient({ shares: [] });
    await expect(getMyTeamPlaylists(client, ["teamA"])).resolves.toEqual([]);
    expect(calls.tables).toEqual(["playlist_shares"]);
  });

  it("degrades to [] when the share lookup fails", async () => {
    const { client, calls } = mockClient({ sharesError: { message: "boom" } });
    await expect(getMyTeamPlaylists(client, ["teamA"])).resolves.toEqual([]);
    expect(calls.tables).toEqual(["playlist_shares"]);
  });

  it("degrades to [] when the playlist fetch fails", async () => {
    const { client } = mockClient({
      shares: [{ playlist_id: "p1" }],
      playlistsError: { message: "boom" },
    });
    await expect(getMyTeamPlaylists(client, ["teamA"])).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Org scoping — the space-isolation filter on own-content queries
// ---------------------------------------------------------------------------

/**
 * Double for the owner-scoped chains:
 *   from("playlists").select(…).eq("user_id", …)[.eq("org_id", …)|.or(…)].order(…)
 *   from("playlists").insert(…).select().single()
 */
function mockOwnClient(rows: unknown[] = [], error: { message: string } | null = null) {
  const calls: { eq: Array<[string, unknown]>; or: string[]; select?: string; inserted?: Record<string, unknown> } = {
    eq: [],
    or: [],
  };
  const listResult = { data: error ? null : rows, error };
  const b: Record<string, unknown> = {
    select(cols?: string) { calls.select = cols; return b; },
    eq(col: string, val: unknown) { calls.eq.push([col, val]); return b; },
    or(filter: string) { calls.or.push(filter); return b; },
    order() { return b; },
    insert(payload: Record<string, unknown>) { calls.inserted = payload; return b; },
    single: async () => ({
      data: { id: "new", name: "N", folder_id: null, org_id: calls.inserted?.org_id ?? null },
      error: null,
    }),
    then: (r: (x: typeof listResult) => unknown) => Promise.resolve(listResult).then(r),
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "owner" } } }, error: null }),
      getUser: async () => ({ data: { user: { id: "owner" } }, error: null }),
    },
    from: () => b,
  } as unknown as SupabaseClient;
  return { client, calls };
}

/**
 * Supabase double for getMyDirectPlaylists' two chains:
 *   from("playlist_user_shares").select("playlist_id").eq("user_id", uid)
 *   from("playlists").select(…).in("id", …).order(…)[.or(…) | .eq(…) | .in(…)]
 */
function mockDirectClient(shares: Array<{ playlist_id: string }>, playlists: PlaylistRow[]) {
  const calls: { tables: string[]; eq: Array<[string, unknown]>; in: Array<[string, unknown]>; or: string[] } = {
    tables: [],
    eq: [],
    in: [],
    or: [],
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "player" } } }, error: null }),
      getUser: async () => ({ data: { user: { id: "player" } }, error: null }),
    },
    from(table: string) {
      calls.tables.push(table);
      const result = table === "playlist_user_shares" ? { data: shares, error: null } : { data: playlists, error: null };
      const b: Record<string, unknown> = {
        select() { return b; },
        eq(col: string, val: unknown) { calls.eq.push([col, val]); return b; },
        in(col: string, val: unknown) { calls.in.push([col, val]); return b; },
        or(filter: string) { calls.or.push(filter); return b; },
        order() { return b; },
        then: (r: (x: typeof result) => unknown) => Promise.resolve(result).then(r),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("getMyDirectPlaylists", () => {
  it("returns every direct share RLS permits when unscoped (the player feed)", async () => {
    const { client, calls } = mockDirectClient([{ playlist_id: "p1" }], [plRow({ id: "p1", team_id: null })]);
    const out = await getMyDirectPlaylists(client);
    expect(calls.eq).toContainEqual(["user_id", "player"]);
    expect(calls.in).toEqual([["id", ["p1"]]]);
    expect(calls.or).toEqual([]);
    expect(out.map((p) => [p.id, p.directShare])).toEqual([["p1", true]]);
  });

  // The bug: unsharing a playlist from its team nulls the legacy
  // playlists.team_id (setPlaylistTeams keeps it as teamIds[0] ?? null), so a
  // playlist shared only directly vanished wherever the scope filtered on it
  // (the desktop's My playlists, the coach views on web and mobile).
  it("scopes to the space by the playlist's org, not by the legacy team_id", async () => {
    const { client, calls } = mockDirectClient([{ playlist_id: "p1" }], [plRow({ id: "p1", team_id: null, org_id: "orgA" })]);
    const out = await getMyDirectPlaylists(client, { orgId: "orgA", teamIds: ["t1", "t2"] });
    expect(calls.in.map(([col]) => col)).not.toContain("team_id");
    expect(calls.or).toEqual(["org_id.eq.orgA,and(org_id.is.null,team_id.in.(t1,t2))"]);
    expect(out.map((p) => p.id)).toEqual(["p1"]);
  });

  it("still looks in the space when the caller has no team there", async () => {
    const { client, calls } = mockDirectClient([{ playlist_id: "p1" }], [plRow({ id: "p1", org_id: "orgA" })]);
    const out = await getMyDirectPlaylists(client, { orgId: "orgA", teamIds: [] });
    expect(calls.tables).toEqual(["playlist_user_shares", "playlists"]);
    expect(calls.eq).toContainEqual(["org_id", "orgA"]);
    expect(out).toHaveLength(1);
  });

  it("stops after the share lookup when nothing was shared directly", async () => {
    const { client, calls } = mockDirectClient([], []);
    await expect(getMyDirectPlaylists(client, { orgId: "orgA", teamIds: ["t1"] })).resolves.toEqual([]);
    expect(calls.tables).toEqual(["playlist_user_shares"]);
  });
});

describe("listPlaylists org scoping", () => {
  it("filters by org_id when an orgId is given", async () => {
    const { client, calls } = mockOwnClient([plRow({ org_id: "orgA" })]);
    await listPlaylists(client, "orgA");
    expect(calls.eq).toContainEqual(["user_id", "owner"]);
    expect(calls.eq).toContainEqual(["org_id", "orgA"]);
    expect(calls.or).toEqual([]);
  });

  it("includes org_id NULL rows via .or when includeUnscoped is set (personal space)", async () => {
    const { client, calls } = mockOwnClient();
    await listPlaylists(client, "orgP", { includeUnscoped: true });
    expect(calls.or).toEqual(["org_id.eq.orgP,org_id.is.null"]);
    expect(calls.eq).toEqual([["user_id", "owner"]]);
  });

  it("stays unfiltered (cross-org) when orgId is omitted", async () => {
    const { client, calls } = mockOwnClient();
    await listPlaylists(client);
    expect(calls.eq).toEqual([["user_id", "owner"]]);
    expect(calls.or).toEqual([]);
  });

  it("maps org_id onto the domain object", async () => {
    const { client } = mockOwnClient([plRow({ org_id: "orgA" })]);
    const [p] = await listPlaylists(client, "orgA");
    expect(p.orgId).toBe("orgA");
  });
});

describe("listPlaylistNames", () => {
  it("reads only the id and name of the caller's playlists in the space", async () => {
    const { client, calls } = mockOwnClient([{ id: "p1", name: "AIK" }]);
    expect(await listPlaylistNames(client, "orgA")).toEqual([{ id: "p1", name: "AIK" }]);
    expect(calls.select).toBe("id, name");
    expect(calls.eq).toEqual([["user_id", "owner"], ["org_id", "orgA"]]);
  });

  it("includes org_id NULL rows in the personal space", async () => {
    const { client, calls } = mockOwnClient();
    await listPlaylistNames(client, "orgP", { includeUnscoped: true });
    expect(calls.or).toEqual(["org_id.eq.orgP,org_id.is.null"]);
  });

  it("throws when the read fails, so an error never reads as no playlists", async () => {
    const { client } = mockOwnClient([], { message: "x" });
    await expect(listPlaylistNames(client, "orgA")).rejects.toThrow("Failed to load playlists");
  });
});

describe("createPlaylist org scoping", () => {
  it("writes the org_id it was given", async () => {
    const { client, calls } = mockOwnClient();
    const created = await createPlaylist(client, "Name", undefined, "orgA");
    expect(calls.inserted?.org_id).toBe("orgA");
    expect(created.orgId).toBe("orgA");
  });

  it("writes org_id NULL when no org is given (legacy caller)", async () => {
    const { client, calls } = mockOwnClient();
    const created = await createPlaylist(client, "Name");
    expect(calls.inserted?.org_id).toBeNull();
    expect(created.orgId).toBeUndefined();
  });
});

describe("getMySharedPlaylists org scoping", () => {
  it("applies the org filter and still keeps only rows with shares", async () => {
    const { client, calls } = mockOwnClient([
      plRow({ id: "shared", org_id: "orgA", playlist_shares: [{ team_id: "t1" }] }),
      plRow({ id: "unshared", org_id: "orgA" }),
    ]);
    const out = await getMySharedPlaylists(client, "orgA");
    expect(calls.eq).toContainEqual(["org_id", "orgA"]);
    expect(out.map((p) => p.id)).toEqual(["shared"]);
  });
});

/**
 * Captures the upsert payload + options. addClips is the only write here, so a
 * bare table double is enough — no chaining beyond `.from().upsert()`.
 */
function mockUpsertClient(error: { message: string } | null = null) {
  const calls: { rows?: Array<Record<string, unknown>>; opts?: Record<string, unknown>; count: number } = { count: 0 };
  const client = {
    from: () => ({
      upsert: async (rows: Array<Record<string, unknown>>, opts: Record<string, unknown>) => {
        calls.count += 1;
        calls.rows = rows;
        calls.opts = opts;
        return { error };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("addClips", () => {
  it("puts a clip's hosted file back only when restoring it (undo), never on a plain add", async () => {
    const shipped = { type: "clip" as const, matchId: "m1", eventId: 7, r2Url: "https://media.example.com/clips/m1/7.mp4" };
    const plain = mockUpsertClient();
    await addClips(plain.client, "pl1", [shipped], 0);
    expect(plain.calls.rows?.[0]).not.toHaveProperty("r2_url");
    const restore = mockUpsertClient();
    await addClips(restore.client, "pl1", [shipped, { type: "clip", matchId: "m1", eventId: 8 }], 0, { restore: true });
    expect(restore.calls.rows?.map((r) => r["r2_url"])).toEqual(["https://media.example.com/clips/m1/7.mp4", null]);
  });

  it("upserts on uq_playlist_clip and ignores duplicates, so a re-add is a no-op", async () => {
    const { client, calls } = mockUpsertClient();
    await addClips(client, "pl1", [{ type: "clip", matchId: "m1", eventId: 7 }], 0);
    expect(calls.opts).toEqual({
      onConflict: "playlist_id,match_id,event_id",
      ignoreDuplicates: true,
    });
  });

  it("collapses a clip repeated within one batch to a single row", async () => {
    const { client, calls } = mockUpsertClient();
    await addClips(
      client,
      "pl1",
      [
        { type: "clip", matchId: "m1", eventId: 7 },
        { type: "clip", matchId: "m1", eventId: 7 },
        { type: "clip", matchId: "m1", eventId: 8 },
      ],
      0,
    );
    expect(calls.rows).toHaveLength(2);
    expect(calls.rows?.map((r) => r["event_id"])).toEqual([7, 8]);
  });

  it("numbers positions over the deduped rows so no position is skipped", async () => {
    const { client, calls } = mockUpsertClient();
    await addClips(
      client,
      "pl1",
      [
        { type: "clip", matchId: "m1", eventId: 7 },
        { type: "clip", matchId: "m1", eventId: 7 },
        { type: "clip", matchId: "m2", eventId: 9 },
      ],
      5,
    );
    expect(calls.rows?.map((r) => r["position"])).toEqual([5, 6]);
  });

  it("keeps distinct events on the same match, and same event ids across matches", async () => {
    const { client, calls } = mockUpsertClient();
    await addClips(
      client,
      "pl1",
      [
        { type: "clip", matchId: "m1", eventId: 7 },
        { type: "clip", matchId: "m2", eventId: 7 },
      ],
      0,
    );
    expect(calls.rows).toHaveLength(2);
  });

  it("does not touch the network for an empty batch", async () => {
    const { client, calls } = mockUpsertClient();
    await addClips(client, "pl1", [], 0);
    expect(calls.count).toBe(0);
  });

  it("still throws on a real write failure", async () => {
    const { client } = mockUpsertClient({ message: "permission denied" });
    await expect(
      addClips(client, "pl1", [{ type: "clip", matchId: "m1", eventId: 7 }], 0),
    ).rejects.toThrow("Failed to add clips: permission denied");
  });
});

describe("clearShippedClip", () => {
  function mockUpdateClient(error: { message: string } | null = null) {
    const calls: { table?: string; patch?: unknown; filters: Array<[string, unknown]> } = { filters: [] };
    const builder = {
      eq(col: string, value: unknown) {
        calls.filters.push([col, value]);
        return builder;
      },
      then(resolve: (v: { error: unknown }) => unknown) {
        return Promise.resolve({ error }).then(resolve);
      },
    };
    const client = {
      from(table: string) {
        calls.table = table;
        return {
          update(patch: unknown) {
            calls.patch = patch;
            return builder;
          },
        };
      },
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it("nulls the one clip's URL", async () => {
    const { client, calls } = mockUpdateClient();
    await clearShippedClip(client, "pl1", "m1", 7);
    expect(calls.table).toBe("playlist_clips");
    expect(calls.patch).toEqual({ r2_url: null });
    expect(calls.filters).toEqual([
      ["playlist_id", "pl1"],
      ["match_id", "m1"],
      ["event_id", 7],
    ]);
  });

  it("only clears the URL it was given, so a newer upload survives", async () => {
    const { client, calls } = mockUpdateClient();
    await clearShippedClip(client, "pl1", "m1", 7, "https://cdn/clips/m1/7_old.mp4");
    expect(calls.filters).toContainEqual(["r2_url", "https://cdn/clips/m1/7_old.mp4"]);
  });

  it("throws on a database error", async () => {
    const { client } = mockUpdateClient({ message: "boom" });
    await expect(clearShippedClip(client, "pl1", "m1", 7)).rejects.toThrow(/boom/);
  });
});

// ---------------------------------------------------------------------------
// Rows this build doesn't know
// ---------------------------------------------------------------------------

describe("rowToPlaylist: unknown item types", () => {
  it("drops a row of an item type it doesn't know (the retired player cards among them), keeping the rest", () => {
    const rows = [
      clipRow({ event_id: 1, position: 0 }),
      { ...textRow({ item_id: "pc1", position: 1 }), item_type: "player" as PlaylistClipRow["item_type"], card: { type: "player", v: 1 } },
      clipRow({ event_id: 2, position: 2 }),
    ];
    const p = rowToPlaylist(plRow({ playlist_clips: rows }));
    expect(p.items.map((i) => (i.type === "clip" ? i.eventId : i.id))).toEqual([1, 2]);
  });
});

describe("getPlaylistOrgId", () => {
  /** from("playlists").select("org_id").eq("id", …).maybeSingle() */
  function orgClient(result: { data: { org_id: string | null } | null; error: { message: string } | null }) {
    const calls: { table?: string; select?: string; eq?: [string, unknown] } = {};
    const client = {
      from(table: string) {
        calls.table = table;
        const b = {
          select(cols: string) { calls.select = cols; return b; },
          eq(col: string, value: unknown) { calls.eq = [col, value]; return b; },
          maybeSingle: () => Promise.resolve(result),
        };
        return b;
      },
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it("reads the space of one playlist by id", async () => {
    const { client, calls } = orgClient({ data: { org_id: "club" }, error: null });
    expect(await getPlaylistOrgId(client, "p1")).toBe("club");
    expect(calls).toEqual({ table: "playlists", select: "org_id", eq: ["id", "p1"] });
  });

  it("returns null for a playlist the caller can't read (or that is gone)", async () => {
    const { client } = orgClient({ data: null, error: null });
    expect(await getPlaylistOrgId(client, "p1")).toBeNull();
  });

  it("returns null when the read fails", async () => {
    const { client } = orgClient({ data: null, error: { message: "x" } });
    expect(await getPlaylistOrgId(client, "p1")).toBeNull();
  });
});
