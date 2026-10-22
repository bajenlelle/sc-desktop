import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MoveError,
  getMoveToClubPreview,
  moveErrorToken,
  moveToClub,
  parseMovePreview,
  parseMoveResult,
} from "../space-move-db";
import type { MoveErrorToken, MovePreview, MoveResult } from "../../types/space-move";

/** Minimal Supabase double for the rpc-only helpers under test. */
function mockClient(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const rawPreview = {
  personal_org_id: "personal",
  target: { org_id: "club", name: "AIK", plan_tier: "pro", license_state: "grace" },
  folders: [
    { id: "f1", name: "Defence", parent_id: null, sort_order: 2 },
    { id: "f2", name: "Zone", parent_id: "f1", sort_order: 0 },
  ],
  playlists: [
    {
      id: "p1",
      name: "Ball screens",
      folder_id: "f2",
      created_at: "2026-10-01T10:00:00Z",
      clip_count: 12,
      match_ids: ["m1", "m2"],
      demo_clip_count: 1,
      other_space_clip_count: 2,
      shared: true,
    },
  ],
  games: [
    {
      id: "m1",
      title: "AIK vs Alvik",
      game_date: "2026-09-30",
      home: "AIK",
      away: "Alvik",
      created_at: "2026-10-01T09:00:00Z",
      duplicate: { club_match_id: "c1", mergeable: true, reason: null },
    },
    {
      id: "m2",
      title: "Vasa vs AIK",
      game_date: null,
      home: "Vasa",
      away: "AIK",
      created_at: "2026-10-02T09:00:00Z",
      duplicate: { club_match_id: "c2", mergeable: false, reason: "video_differs" },
    },
    {
      id: "m3",
      title: "AIK vs Djurgården",
      game_date: "2026-10-05",
      home: "AIK",
      away: "Djurgården",
      created_at: "2026-10-06T09:00:00Z",
      duplicate: null,
    },
  ],
};

const parsedPreview: MovePreview = {
  personalOrgId: "personal",
  target: { orgId: "club", name: "AIK", planTier: "pro", licenseState: "grace" },
  folders: [
    { id: "f1", name: "Defence", parentId: null, sortOrder: 2 },
    { id: "f2", name: "Zone", parentId: "f1", sortOrder: 0 },
  ],
  playlists: [
    {
      id: "p1",
      name: "Ball screens",
      folderId: "f2",
      createdAt: "2026-10-01T10:00:00Z",
      clipCount: 12,
      matchIds: ["m1", "m2"],
      demoClipCount: 1,
      otherSpaceClipCount: 2,
      shared: true,
    },
  ],
  games: [
    {
      id: "m1",
      title: "AIK vs Alvik",
      gameDate: "2026-09-30",
      home: "AIK",
      away: "Alvik",
      createdAt: "2026-10-01T09:00:00Z",
      duplicate: { clubMatchId: "c1", mergeable: true, reason: null },
    },
    {
      id: "m2",
      title: "Vasa vs AIK",
      gameDate: null,
      home: "Vasa",
      away: "AIK",
      createdAt: "2026-10-02T09:00:00Z",
      duplicate: { clubMatchId: "c2", mergeable: false, reason: "video_differs" },
    },
    {
      id: "m3",
      title: "AIK vs Djurgården",
      gameDate: "2026-10-05",
      home: "AIK",
      away: "Djurgården",
      createdAt: "2026-10-06T09:00:00Z",
      duplicate: null,
    },
  ],
};

const rawResult = {
  move_id: "mv1",
  games_moved: 3,
  games_merged: 1,
  games_kept_separate: 1,
  playlists_moved: 2,
  folders_created: 2,
  folders_reused: 1,
  folders_removed: 3,
  labels_created: 4,
  label_assignments_moved: 9,
  clips_repointed: 7,
  shares_removed: 1,
  merged: [{ from: "m1", to: "c1" }],
  separate: [{ match_id: "m2", club_match_id: "c2", reason: "stats_source_differs" }],
};

const parsedResult: MoveResult = {
  moveId: "mv1",
  gamesMoved: 3,
  gamesMerged: 1,
  gamesKeptSeparate: 1,
  playlistsMoved: 2,
  foldersCreated: 2,
  foldersReused: 1,
  foldersRemoved: 3,
  labelsCreated: 4,
  labelAssignmentsMoved: 9,
  clipsRepointed: 7,
  sharesRemoved: 1,
  merged: [{ from: "m1", to: "c1" }],
  separate: [{ matchId: "m2", clubMatchId: "c2", reason: "stats_source_differs" }],
};

/** Smallest payload parseMovePreview accepts. */
const minimalPreview = { personal_org_id: "personal", target: { org_id: "club" } };

describe("moveErrorToken", () => {
  it.each<MoveErrorToken>([
    "not_authenticated",
    "target_not_club",
    "not_staff",
    "license_locked",
    "no_personal_space",
    "nothing_to_move",
    "too_many",
    "not_movable",
    "demo_not_movable",
    "folder_has_other_space_content",
    "merge_incomplete",
  ])("reads the bare RAISE EXCEPTION token %s", (token) => {
    expect(moveErrorToken(token)).toBe(token);
  });

  it("finds a token inside a longer Postgres message", () => {
    expect(moveErrorToken("P0001: license_locked")).toBe("license_locked");
    expect(moveErrorToken('ERROR:  not_staff\nCONTEXT:  PL/pgSQL function move_to_club')).toBe("not_staff");
  });

  it("reads demo_not_movable as itself, not as not_movable", () => {
    expect(moveErrorToken("demo_not_movable")).toBe("demo_not_movable");
    expect(moveErrorToken("ERROR: demo_not_movable")).toBe("demo_not_movable");
  });

  it("is unknown for an empty or missing message", () => {
    expect(moveErrorToken(null)).toBe("unknown");
    expect(moveErrorToken(undefined)).toBe("unknown");
    expect(moveErrorToken("")).toBe("unknown");
  });

  it("is unknown for a message without a token", () => {
    expect(moveErrorToken("permission denied for function move_to_club")).toBe("unknown");
    expect(moveErrorToken("JWT expired")).toBe("unknown");
  });
});

describe("MoveError", () => {
  it("is an Error carrying its token and message", () => {
    const err = new MoveError("too_many", "too_many");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MoveError");
    expect(err.token).toBe("too_many");
    expect(err.message).toBe("too_many");
  });
});

describe("parseMovePreview", () => {
  it("maps a full preview from snake_case to camelCase", () => {
    expect(parseMovePreview(rawPreview)).toEqual(parsedPreview);
  });

  it.each([null, undefined, [], "preview", 42])("returns null for a non-object payload (%o)", (raw) => {
    expect(parseMovePreview(raw)).toBeNull();
  });

  it("returns null without a string personal_org_id", () => {
    expect(parseMovePreview({ target: { org_id: "club" } })).toBeNull();
    expect(parseMovePreview({ personal_org_id: 7, target: { org_id: "club" } })).toBeNull();
  });

  it("returns null without a target object carrying a string org_id", () => {
    expect(parseMovePreview({ personal_org_id: "personal" })).toBeNull();
    expect(parseMovePreview({ personal_org_id: "personal", target: null })).toBeNull();
    expect(parseMovePreview({ personal_org_id: "personal", target: [] })).toBeNull();
    expect(parseMovePreview({ personal_org_id: "personal", target: { name: "AIK" } })).toBeNull();
  });

  it("fills defaults for a minimal payload", () => {
    expect(parseMovePreview(minimalPreview)).toEqual({
      personalOrgId: "personal",
      target: { orgId: "club", name: "Club", planTier: null, licenseState: "active" },
      folders: [],
      playlists: [],
      games: [],
    });
  });

  it.each(["active", "expiring", "grace", "locked"])("keeps the license state %s", (state) => {
    const p = parseMovePreview({ ...minimalPreview, target: { org_id: "club", license_state: state } });
    expect(p?.target.licenseState).toBe(state);
  });

  it("reads an unknown or non-string license state as active", () => {
    expect(
      parseMovePreview({ ...minimalPreview, target: { org_id: "club", license_state: "suspended" } })?.target
        .licenseState,
    ).toBe("active");
    expect(
      parseMovePreview({ ...minimalPreview, target: { org_id: "club", license_state: 3 } })?.target.licenseState,
    ).toBe("active");
  });

  it("reads non-array lists as empty", () => {
    const p = parseMovePreview({ ...minimalPreview, folders: {}, playlists: "x", games: null });
    expect(p).toMatchObject({ folders: [], playlists: [], games: [] });
  });

  it("drops folders without a string id and defaults their other fields", () => {
    const p = parseMovePreview({
      ...minimalPreview,
      folders: [null, "f0", { id: 5 }, { name: "No id" }, { id: "f1", name: 9, parent_id: 4, sort_order: "3" }],
    });
    expect(p?.folders).toEqual([{ id: "f1", name: "Folder", parentId: null, sortOrder: 0 }]);
  });

  it("drops playlists without a string id and defaults their other fields", () => {
    const p = parseMovePreview({
      ...minimalPreview,
      playlists: [null, { name: "No id" }, { id: "p1", match_ids: "m1", shared: "true", clip_count: "4" }],
    });
    expect(p?.playlists).toEqual([
      {
        id: "p1",
        name: "Playlist",
        folderId: null,
        createdAt: "",
        clipCount: 0,
        matchIds: [],
        demoClipCount: 0,
        otherSpaceClipCount: 0,
        shared: false,
      },
    ]);
  });

  it("drops non-string match ids from a playlist", () => {
    const p = parseMovePreview({ ...minimalPreview, playlists: [{ id: "p1", match_ids: ["m1", 5, null, "m2", {}] }] });
    expect(p?.playlists[0].matchIds).toEqual(["m1", "m2"]);
  });

  it("drops games without a string id and defaults their other fields", () => {
    const p = parseMovePreview({ ...minimalPreview, games: [null, { id: 1 }, { id: "m1" }] });
    expect(p?.games).toEqual([
      { id: "m1", title: "Game", gameDate: null, home: null, away: null, createdAt: "", duplicate: null },
    ]);
  });

  it("drops a duplicate without a string club_match_id", () => {
    const p = parseMovePreview({
      ...minimalPreview,
      games: [
        { id: "m1", duplicate: { mergeable: true } },
        { id: "m2", duplicate: { club_match_id: 7, mergeable: true } },
        { id: "m3", duplicate: [] },
      ],
    });
    expect(p?.games.map((g) => g.duplicate)).toEqual([null, null, null]);
  });

  it("reads mergeable only from a literal true and an unknown merge reason as null", () => {
    const p = parseMovePreview({
      ...minimalPreview,
      games: [
        { id: "m1", duplicate: { club_match_id: "c1", mergeable: "true", reason: "colour_differs" } },
        { id: "m2", duplicate: { club_match_id: "c2", reason: 3 } },
      ],
    });
    expect(p?.games.map((g) => g.duplicate)).toEqual([
      { clubMatchId: "c1", mergeable: false, reason: null },
      { clubMatchId: "c2", mergeable: false, reason: null },
    ]);
  });

  it.each(["stats_source_differs", "plays_differ", "video_differs"])("keeps the merge reason %s", (reason) => {
    const p = parseMovePreview({
      ...minimalPreview,
      games: [{ id: "m1", duplicate: { club_match_id: "c1", mergeable: false, reason } }],
    });
    expect(p?.games[0].duplicate?.reason).toBe(reason);
  });
});

describe("parseMoveResult", () => {
  it("maps a full result from snake_case to camelCase", () => {
    expect(parseMoveResult(rawResult)).toEqual(parsedResult);
  });

  it.each([null, undefined, [], "ok", 1])("returns null for a non-object payload (%o)", (raw) => {
    expect(parseMoveResult(raw)).toBeNull();
  });

  it("returns null without a string move_id", () => {
    expect(parseMoveResult({ games_moved: 1 })).toBeNull();
    expect(parseMoveResult({ move_id: 1 })).toBeNull();
  });

  it("defaults missing or non-numeric counts to 0 and missing lists to []", () => {
    expect(parseMoveResult({ move_id: "mv1", games_moved: "3", games_merged: null })).toEqual({
      moveId: "mv1",
      gamesMoved: 0,
      gamesMerged: 0,
      gamesKeptSeparate: 0,
      playlistsMoved: 0,
      foldersCreated: 0,
      foldersReused: 0,
      foldersRemoved: 0,
      labelsCreated: 0,
      labelAssignmentsMoved: 0,
      clipsRepointed: 0,
      sharesRemoved: 0,
      merged: [],
      separate: [],
    });
  });

  it("drops merged pairs missing a string from or to", () => {
    const r = parseMoveResult({
      move_id: "mv1",
      merged: [{ from: "m1" }, { to: "c1" }, { from: 1, to: "c1" }, null, { from: "m2", to: "c2" }],
    });
    expect(r?.merged).toEqual([{ from: "m2", to: "c2" }]);
  });

  it("drops separate entries without a string match_id and defaults the rest", () => {
    const r = parseMoveResult({
      move_id: "mv1",
      separate: [
        { club_match_id: "c0" },
        "m9",
        { match_id: "m1", reason: "colour_differs" },
        { match_id: "m2", club_match_id: "c2", reason: null },
      ],
    });
    expect(r?.separate).toEqual([
      { matchId: "m1", clubMatchId: "", reason: null },
      { matchId: "m2", clubMatchId: "c2", reason: null },
    ]);
  });
});

describe("getMoveToClubPreview", () => {
  it("calls get_move_to_club_preview with the target org and returns the parsed preview", async () => {
    const { client, rpc } = mockClient({ data: rawPreview, error: null });
    await expect(getMoveToClubPreview(client, "club")).resolves.toEqual(parsedPreview);
    expect(rpc).toHaveBeenCalledWith("get_move_to_club_preview", { p_target_org: "club" });
  });

  it("throws a MoveError with the token from the rpc error", async () => {
    const { client } = mockClient({ data: null, error: { message: "not_staff" } });
    const err = await getMoveToClubPreview(client, "club").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MoveError);
    expect(err).toMatchObject({ name: "MoveError", token: "not_staff", message: "not_staff" });
  });

  it("throws an unknown MoveError keeping an unrecognised rpc message", async () => {
    const { client } = mockClient({ data: null, error: { message: "JWT expired" } });
    await expect(getMoveToClubPreview(client, "club")).rejects.toMatchObject({
      token: "unknown",
      message: "JWT expired",
    });
  });

  it("throws an unknown MoveError for an unparseable response", async () => {
    const { client } = mockClient({ data: { nope: true }, error: null });
    const err = await getMoveToClubPreview(client, "club").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MoveError);
    expect(err).toMatchObject({ token: "unknown", message: "Unexpected preview response" });
  });
});

describe("moveToClub", () => {
  it("calls move_to_club with the target org and deduped id lists, first occurrence kept", async () => {
    const { client, rpc } = mockClient({ data: rawResult, error: null });
    await moveToClub(client, "club", {
      matchIds: ["m2", "m1", "m2"],
      playlistIds: ["p1", "p1"],
      folderIds: ["f2", "f1", "f2", "f1"],
    });
    expect(rpc).toHaveBeenCalledWith("move_to_club", {
      p_target_org: "club",
      p_match_ids: ["m2", "m1"],
      p_playlist_ids: ["p1"],
      p_folder_ids: ["f2", "f1"],
    });
  });

  it("sends empty lists as [] (the server raises nothing_to_move)", async () => {
    const { client, rpc } = mockClient({ data: rawResult, error: null });
    await moveToClub(client, "club", { matchIds: [], playlistIds: [], folderIds: [] });
    expect(rpc).toHaveBeenCalledWith("move_to_club", {
      p_target_org: "club",
      p_match_ids: [],
      p_playlist_ids: [],
      p_folder_ids: [],
    });
  });

  it("returns the parsed result", async () => {
    const { client } = mockClient({ data: rawResult, error: null });
    await expect(moveToClub(client, "club", { matchIds: ["m1"], playlistIds: [], folderIds: [] })).resolves.toEqual(
      parsedResult,
    );
  });

  it("throws a MoveError with the token from the rpc error", async () => {
    const { client } = mockClient({ data: null, error: { message: "demo_not_movable" } });
    const err = await moveToClub(client, "club", { matchIds: ["demo"], playlistIds: [], folderIds: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MoveError);
    expect(err).toMatchObject({ token: "demo_not_movable", message: "demo_not_movable" });
  });

  it("throws an unknown MoveError for an unparseable response", async () => {
    const { client } = mockClient({ data: null, error: null });
    const err = await moveToClub(client, "club", { matchIds: ["m1"], playlistIds: [], folderIds: [] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MoveError);
    expect(err).toMatchObject({ token: "unknown", message: "Unexpected move response" });
  });
});
