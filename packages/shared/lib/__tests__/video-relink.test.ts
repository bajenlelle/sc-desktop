import { describe, expect, it } from "vitest";
import type { MissingVideoRef, VideoCandidate } from "../video-relink";
import { matchMissingVideos } from "../video-relink";

const ref = (matchId: string, fileName: string): MissingVideoRef => ({ matchId, fileName });

/** Candidate whose fileName is the basename of its path. */
const cand = (path: string): VideoCandidate => ({ path, fileName: path.split("/").pop()! });

describe("matchMissingVideos", () => {
  it("matches a single exact-name candidate with that path", () => {
    const out = matchMissingVideos(
      [ref("m1", "huddinge_aik.mp4")],
      [cand("/Volumes/T7/games/huddinge_aik.mp4")],
    );
    expect(out).toEqual([
      {
        matchId: "m1",
        fileName: "huddinge_aik.mp4",
        outcome: "matched",
        path: "/Volumes/T7/games/huddinge_aik.mp4",
      },
    ]);
  });

  it("matches case-insensitively (Game1.MP4 finds game1.mp4)", () => {
    const out = matchMissingVideos([ref("m1", "Game1.MP4")], [cand("/new/game1.mp4")]);
    expect(out).toEqual([
      // fileName echoes the missing ref's original casing, not the candidate's
      { matchId: "m1", fileName: "Game1.MP4", outcome: "matched", path: "/new/game1.mp4" },
    ]);
  });

  it("reports two same-basename candidates in different folders as ambiguous with both paths", () => {
    const out = matchMissingVideos(
      [ref("m1", "game1.mp4")],
      [cand("/vids/2025/game1.mp4"), cand("/vids/2026/game1.mp4")],
    );
    expect(out).toEqual([
      {
        matchId: "m1",
        fileName: "game1.mp4",
        outcome: "ambiguous",
        paths: ["/vids/2025/game1.mp4", "/vids/2026/game1.mp4"],
      },
    ]);
  });

  it("reports a missing ref with no candidate as unmatched", () => {
    const out = matchMissingVideos([ref("m1", "gone.mp4")], [cand("/vids/other.mp4")]);
    expect(out).toEqual([{ matchId: "m1", fileName: "gone.mp4", outcome: "unmatched" }]);
  });

  it("resolves several missing refs independently in one call", () => {
    const out = matchMissingVideos(
      [ref("m1", "a.mp4"), ref("m2", "dup.mp4"), ref("m3", "nowhere.mp4")],
      [cand("/vids/a.mp4"), cand("/x/dup.mp4"), cand("/y/dup.mp4")],
    );
    expect(out).toEqual([
      { matchId: "m1", fileName: "a.mp4", outcome: "matched", path: "/vids/a.mp4" },
      { matchId: "m2", fileName: "dup.mp4", outcome: "ambiguous", paths: ["/x/dup.mp4", "/y/dup.mp4"] },
      { matchId: "m3", fileName: "nowhere.mp4", outcome: "unmatched" },
    ]);
  });

  it("lets two missing refs claim the same lone candidate", () => {
    // Matching is per-ref against the full candidate set — a candidate is not
    // consumed once matched, so both refs land on the same path.
    const out = matchMissingVideos(
      [ref("m1", "shared.mp4"), ref("m2", "SHARED.mp4")],
      [cand("/vids/shared.mp4")],
    );
    expect(out.map((r) => r.outcome)).toEqual(["matched", "matched"]);
  });

  it("marks everything unmatched when the candidate list is empty", () => {
    const out = matchMissingVideos([ref("m1", "a.mp4"), ref("m2", "b.mp4")], []);
    expect(out).toEqual([
      { matchId: "m1", fileName: "a.mp4", outcome: "unmatched" },
      { matchId: "m2", fileName: "b.mp4", outcome: "unmatched" },
    ]);
  });

  it("returns an empty result for an empty missing list", () => {
    expect(matchMissingVideos([], [cand("/vids/a.mp4")])).toEqual([]);
  });

  it("preserves the input order of missing across mixed outcomes", () => {
    const out = matchMissingVideos(
      [ref("m3", "z.mp4"), ref("m1", "nope.mp4"), ref("m2", "a.mp4")],
      [cand("/vids/a.mp4"), cand("/vids/z.mp4")],
    );
    expect(out.map((r) => r.matchId)).toEqual(["m3", "m1", "m2"]);
    expect(out.map((r) => r.outcome)).toEqual(["matched", "unmatched", "matched"]);
  });
});
