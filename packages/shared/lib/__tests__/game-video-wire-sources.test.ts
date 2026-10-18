import { describe, expect, it } from "vitest";
import {
  GAME_VIDEO_CONVERT_ERRORS,
  GAME_VIDEO_ERRORS,
  GAME_VIDEO_SOURCE_EXTS,
  gameVideoKey,
  gameVideoSourceKey,
  isGameVideoCopyKey,
  isGameVideoKey,
  isGameVideoSourceKey,
  sourceExtension,
} from "../game-video-wire";

const id = "5dc28ee0-0186-4ca5-9e8d-9023d4794a92";

describe("sourceExtension", () => {
  it("takes the extensions the converter accepts, lowercased", () => {
    expect(sourceExtension("Blackeberg-Sollentuna.MP4")).toBe("mp4");
    expect(sourceExtension("IMG_0421.mov")).toBe("mov");
    expect(sourceExtension("game.mkv")).toBe("mkv");
    expect(sourceExtension("stream.ts")).toBe("ts");
    for (const ext of GAME_VIDEO_SOURCE_EXTS) expect(sourceExtension(`a.${ext}`)).toBe(ext);
  });

  it("refuses names without a usable extension", () => {
    expect(sourceExtension("game")).toBeNull();
    expect(sourceExtension("game.avi")).toBeNull();
    expect(sourceExtension("game.mp4.exe")).toBeNull();
    expect(sourceExtension(".mp4")).toBe("mp4"); // a bare extension still names a type
    expect(sourceExtension("game.")).toBeNull();
  });
});

describe("source keys", () => {
  it("live under sources/ with the original's extension and belong to one prefix", () => {
    const key = gameVideoSourceKey("edalihizooqdxeekaklf", "2583394", id, "mov");
    expect(key).toBe(`edalihizooqdxeekaklf/sources/2583394/${id}.mov`);
    expect(isGameVideoSourceKey(key, "edalihizooqdxeekaklf")).toBe(true);
    expect(isGameVideoSourceKey(key, "nbmrujmazvdoaldirpyx")).toBe(false);
    expect(isGameVideoCopyKey(key, "edalihizooqdxeekaklf")).toBe(false);
  });

  it("isGameVideoKey admits copies and originals, nothing else", () => {
    const copy = gameVideoKey("p1", "2583394", id);
    const source = gameVideoSourceKey("p1", "2583394", id, "mp4");
    expect(isGameVideoKey(copy, "p1")).toBe(true);
    expect(isGameVideoKey(source, "p1")).toBe(true);
    expect(isGameVideoKey(`p1/sources/2583394/${id}.MP4`, "p1")).toBe(false);
    expect(isGameVideoKey(`p1/sources/2583394/${id}.toolong`, "p1")).toBe(false);
    expect(isGameVideoKey(`p1/sources/../${id}.mp4`, "p1")).toBe(false);
    expect(isGameVideoKey(`p1/sources/2583394/${id}`, "p1")).toBe(false);
    expect(isGameVideoKey(`p1/clips/2583394/${id}.mp4`, "p1")).toBe(false);
    expect(isGameVideoKey(source, "p1x")).toBe(false);
    expect(isGameVideoKey(source, "")).toBe(false);
  });
});

describe("error tokens", () => {
  it("carry the converter's and the browser path's tokens", () => {
    for (const t of ["unsupported_type", "converter_unavailable", "source_expired", "sync_locked", "bad_worker_secret", "stale_attempt", "job_busy"]) {
      expect(GAME_VIDEO_ERRORS).toContain(t);
    }
    expect(new Set(GAME_VIDEO_ERRORS).size).toBe(GAME_VIDEO_ERRORS.length);
    expect(new Set(GAME_VIDEO_CONVERT_ERRORS).size).toBe(GAME_VIDEO_CONVERT_ERRORS.length);
  });
});
