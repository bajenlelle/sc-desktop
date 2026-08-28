import { describe, expect, it } from "vitest";
import {
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
