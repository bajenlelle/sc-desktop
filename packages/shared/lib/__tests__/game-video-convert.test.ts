import { describe, expect, it } from "vitest";
import {
  copyLooksWhole,
  isRetryableConvertError,
  parseProgressUs,
  progressFraction,
  sourceRefusal,
  syncStatusFor,
  transcodeArgs,
} from "../game-video-convert";
import { GAME_VIDEO_CONVERT_ERRORS, GAME_VIDEO_MAX_SOURCE_SECONDS } from "../game-video-wire";

describe("transcodeArgs", () => {
  // The same list the desktop builds in Rust (game_video.rs::transcode_args):
  // a copy looks the same whoever made it.
  const RUST = [
    "-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", "in.mp4", "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", "scale=-2:720",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "3500k", "-bufsize", "7000k", "-pix_fmt", "yuv420p",
    "-force_key_frames", "expr:gte(t,n_forced*2)", "-sc_threshold", "0", "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart",
    "out.mp4",
  ];

  it("matches the desktop's argument list when scaling down", () => {
    expect(transcodeArgs("in.mp4", "out.mp4", true)).toEqual(RUST);
  });

  it("leaves the scale filter out for a 720p-or-smaller source", () => {
    const args = transcodeArgs("in.mp4", "out.mp4", false);
    expect(args).not.toContain("-vf");
    expect(args).toEqual(RUST.filter((a) => a !== "-vf" && a !== "scale=-2:720"));
  });
});

describe("parseProgressUs", () => {
  it("reads out_time_us and the older out_time_ms, both microseconds", () => {
    expect(parseProgressUs("out_time_us=123456789")).toBe(123456789);
    expect(parseProgressUs("out_time_ms=123456789\n")).toBe(123456789);
    expect(parseProgressUs("  out_time_us = 42 ")).toBe(42);
  });

  it("ignores other lines and N/A", () => {
    expect(parseProgressUs("out_time=00:02:03.456789")).toBeNull();
    expect(parseProgressUs("out_time_us=N/A")).toBeNull();
    expect(parseProgressUs("out_time_us=-5")).toBeNull();
    expect(parseProgressUs("progress=continue")).toBeNull();
    expect(parseProgressUs("")).toBeNull();
  });
});

describe("syncStatusFor", () => {
  it("applies confirmed hints and confident estimates, suggests the rest", () => {
    expect(syncStatusFor("confirmed", null)).toBe("applied");
    expect(syncStatusFor("estimate", 0.92)).toBe("applied");
    expect(syncStatusFor("estimate", 0.75)).toBe("applied");
    expect(syncStatusFor("estimate", 0.6)).toBe("suggested");
    expect(syncStatusFor("estimate", 0.55)).toBe("suggested");
    expect(syncStatusFor("estimate", undefined)).toBe("suggested");
    expect(syncStatusFor("not_found", null)).toBe("not_found");
    expect(syncStatusFor("skipped", null)).toBe("skipped");
  });
});

describe("sourceRefusal", () => {
  it("accepts a readable game video", () => {
    expect(sourceRefusal({ durationS: 9350, width: 1920, height: 1080, hasVideo: true })).toBeNull();
  });

  it("names the final reasons", () => {
    expect(sourceRefusal(null)).toBe("unsupported_type");
    expect(sourceRefusal({ durationS: null, width: 0, height: 0, hasVideo: false })).toBe("unsupported_type");
    expect(sourceRefusal({ durationS: 100, width: 0, height: 0, hasVideo: false })).toBe("no_video_stream");
    expect(sourceRefusal({ durationS: GAME_VIDEO_MAX_SOURCE_SECONDS + 1, width: 1280, height: 720, hasVideo: true })).toBe("too_long");
    for (const reason of ["unsupported_type", "no_video_stream", "too_long"] as const) {
      expect(GAME_VIDEO_CONVERT_ERRORS).toContain(reason);
      expect(isRetryableConvertError(reason)).toBe(false);
    }
    expect(isRetryableConvertError("transcode_incomplete")).toBe(true);
    expect(isRetryableConvertError("source_unreadable")).toBe(true);
    expect(isRetryableConvertError("sigterm")).toBe(true);
  });
});

describe("progressFraction", () => {
  it("places each phase on one 0..1 bar, in order", () => {
    expect(progressFraction("download", 0)).toBe(0);
    expect(progressFraction("download", 1)).toBe(0.05);
    expect(progressFraction("encode", 0)).toBe(0.05);
    expect(progressFraction("encode", 0.5)).toBe(0.4);
    expect(progressFraction("encode", 1)).toBe(0.75);
    expect(progressFraction("upload", 1)).toBe(0.95);
    expect(progressFraction("detect", 1)).toBe(1);
    expect(progressFraction("encode", 7)).toBe(0.75);
    expect(progressFraction("encode", Number.NaN)).toBe(0.05);
  });
});

describe("copyLooksWhole", () => {
  it("allows two seconds of drift and nothing more", () => {
    expect(copyLooksWhole(9350, 9351.2)).toBe(true);
    expect(copyLooksWhole(9350, 9347.5)).toBe(false);
    expect(copyLooksWhole(9350, null)).toBe(false);
  });
});
