import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RESUME_SAMPLE_BYTES,
  StepTimeout,
  UploadMeter,
  anchorNoun,
  convertErrorIsRetryable,
  describeConvertError,
  describeUploadError,
  estimatedUploadLabel,
  formatBytes,
  formatEta,
  formatProgressBytes,
  formatSpeed,
  gameVideoStatusLabel,
  inParallel,
  resumeKey,
  retryDelayMs,
  sampleRanges,
  uploadDetail,
  uploadLabel,
  withTimeout,
} from "../game-upload-core";
import { GAME_VIDEO_CONVERT_ERRORS } from "../game-video-wire";

const S = RESUME_SAMPLE_BYTES;

describe("sampleRanges", () => {
  it("samples the first, middle and last 64 KiB of a large file, never overlapping", () => {
    const size = 3_000_000_000;
    const ranges = sampleRanges(size);
    expect(ranges).toEqual([
      { offset: 0, length: S },
      { offset: Math.floor((size - S) / 2), length: S },
      { offset: size - S, length: S },
    ]);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].offset).toBeGreaterThanOrEqual(ranges[i - 1].offset + ranges[i - 1].length);
    expect(ranges[2].offset + ranges[2].length).toBe(size);
  });

  it("reads a small file whole and refuses a size that isn't one", () => {
    expect(sampleRanges(S * 3)).toEqual([{ offset: 0, length: S * 3 }]);
    expect(sampleRanges(1000)).toEqual([{ offset: 0, length: 1000 }]);
    expect(sampleRanges(S * 3 + 1)).toHaveLength(3);
    expect(() => sampleRanges(0)).toThrow("invalid_size");
    expect(() => sampleRanges(-5)).toThrow("invalid_size");
    expect(() => sampleRanges(1.5)).toThrow("invalid_size");
  });
});

describe("resumeKey", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([4, 5]);

  it("is wb1: plus the SHA-256 of the size and the samples in order", async () => {
    const expected = createHash("sha256").update("12345|").update(Buffer.from([1, 2, 3, 4, 5])).digest("hex");
    await expect(resumeKey(12345, [a, b])).resolves.toBe(`wb1:${expected}`);
  });

  it("changes with the size or any sampled byte, and is the same for the same file", async () => {
    const key = await resumeKey(100, [a, b]);
    expect(key).toMatch(/^wb1:[0-9a-f]{64}$/);
    await expect(resumeKey(100, [a, b])).resolves.toBe(key);
    await expect(resumeKey(101, [a, b])).resolves.not.toBe(key);
    await expect(resumeKey(100, [a, new Uint8Array([4, 6])])).resolves.not.toBe(key);
    // The same bytes split differently are the same file.
    await expect(resumeKey(100, [new Uint8Array([1, 2, 3, 4, 5])])).resolves.toBe(key);
  });
});

describe("UploadMeter", () => {
  it("knows nothing from one sample and a steady speed from two", () => {
    const m = new UploadMeter();
    expect(m.speedBps).toBeNull();
    expect(m.etaSeconds(1000)).toBeNull();
    m.record(0, 0);
    expect(m.speedBps).toBeNull();
    m.record(10_000_000, 1000);
    expect(m.speedBps).toBeCloseTo(10_000_000);
    expect(m.etaSeconds(50_000_000)).toBeCloseTo(5);
  });

  it("follows a change over about ten seconds and falls during a stall", () => {
    const m = new UploadMeter();
    m.record(0, 0);
    let done = 0;
    for (let t = 1000; t <= 20_000; t += 1000) {
      done += 10_000_000;
      m.record(done, t);
    }
    expect(m.speedBps).toBeCloseTo(10_000_000, -3);
    // The uplink halves: after ten more seconds the meter is most of the way there.
    for (let t = 21_000; t <= 30_000; t += 1000) {
      done += 5_000_000;
      m.record(done, t);
    }
    expect(m.speedBps!).toBeLessThan(7_000_000);
    expect(m.speedBps!).toBeGreaterThan(5_000_000);
    m.stall(45_000);
    expect(m.speedBps!).toBeLessThan(2_000_000);
    m.stall(45_000);
    expect(m.etaSeconds(0)).toBe(0);
  });

  it("ignores samples that don't move the clock and never goes negative", () => {
    const m = new UploadMeter();
    m.record(0, 0);
    m.record(1000, 1000);
    const before = m.speedBps;
    m.record(2000, 1000);
    expect(m.speedBps).toBe(before);
    m.record(500, 2000); // a part was retried: done went down
    expect(m.speedBps!).toBeGreaterThanOrEqual(0);
    const fresh = new UploadMeter();
    fresh.stall(10);
    expect(fresh.speedBps).toBeNull();
  });
});

describe("copy", () => {
  it("formats sizes, progress, speed and time left the way the cards read", () => {
    expect(formatBytes(3_400_000_000)).toBe("3.4 GB");
    expect(formatBytes(850_000_000)).toBe("850 MB");
    expect(formatBytes(1)).toBe("1 MB");
    expect(formatBytes(-1)).toBe("0 MB");
    expect(formatProgressBytes(1_200_000_000, 3_400_000_000)).toBe("1.2 of 3.4 GB");
    expect(formatProgressBytes(120_000_000, 850_000_000)).toBe("120 of 850 MB");
    expect(formatSpeed(12_300_000)).toBe("12 MB/s");
    expect(formatSpeed(2_340_000)).toBe("2.3 MB/s");
    expect(formatSpeed(850_000)).toBe("850 kB/s");
    expect(formatEta(30)).toBe("About a minute left");
    expect(formatEta(240)).toBe("About 4 min left");
    expect(formatEta(3600)).toBe("About an hour left");
    expect(formatEta(7000)).toBe("About 2 h left");
    expect(estimatedUploadLabel(3_000_000_000)).toBe("About 20 min");
    expect(estimatedUploadLabel(100_000_000)).toBe("About a minute");
    expect(estimatedUploadLabel(8_000_000_000, 1e6)).toBe("About 2 h");
  });

  it("labels a job by phase, with speed and time left while uploading", () => {
    expect(uploadLabel({ phase: "checking", doneBytes: 0, totalBytes: 10, speedBps: null, etaSeconds: null })).toBe("Checking the file");
    const job = { phase: "uploading" as const, doneBytes: 1_200_000_000, totalBytes: 3_400_000_000, speedBps: 12_000_000, etaSeconds: 183 };
    expect(uploadLabel(job)).toBe("Uploading · 1.2 of 3.4 GB");
    expect(uploadDetail(job)).toBe("12 MB/s · About 3 min left");
    expect(uploadDetail({ ...job, etaSeconds: null })).toBe("12 MB/s");
    expect(uploadDetail({ ...job, speedBps: null })).toBeNull();
    expect(uploadLabel({ ...job, phase: "finishing" })).toBe("Finishing the upload");
    expect(uploadDetail({ ...job, phase: "finishing" })).toBeNull();
  });

  it("has a line for every function error that matters and a fallback", () => {
    expect(describeUploadError("unsupported_type")).toBe("Choose an MP4, MOV, MKV or WebM file.");
    expect(describeUploadError("too_large")).toBe("Files up to 8 GB can be uploaded.");
    expect(describeUploadError("cors_etag")).toContain("setup problem");
    expect(describeUploadError("converter_unavailable")).toContain("isn't available right now");
    expect(describeUploadError("limit_reached")).toBe("No cloud games left on your plan.");
    expect(describeUploadError("whatever")).toBe("Something went wrong. Try again.");
  });

  it("explains every conversion error and knows which can be retried", () => {
    for (const token of GAME_VIDEO_CONVERT_ERRORS) {
      expect(describeConvertError(token)).not.toBe(describeConvertError("other"));
    }
    expect(describeConvertError(null)).toBe("The conversion failed.");
    expect(convertErrorIsRetryable("too_long")).toBe(false);
    expect(convertErrorIsRetryable("unsupported_type")).toBe(false);
    expect(convertErrorIsRetryable("no_video_stream")).toBe(false);
    expect(convertErrorIsRetryable("gave_up")).toBe(true);
    expect(convertErrorIsRetryable("source_unreadable")).toBe(true);
    expect(convertErrorIsRetryable(null)).toBe(true);
  });

  it("names the anchor", () => {
    expect(anchorNoun("tipoff")).toBe("the tip-off");
    expect(anchorNoun("first_basket")).toBe("the first basket");
    expect(anchorNoun(null)).toBe("the tip-off");
  });
});

describe("gameVideoStatusLabel", () => {
  const base = { convertProgress: null, convertError: null, syncStatus: null, anchorKind: "tipoff" as const };

  it("says where an upload or conversion stands", () => {
    expect(gameVideoStatusLabel({ ...base, status: "uploading" }, { doneBytes: 1_200_000_000, totalBytes: 3_400_000_000 }, false)).toBe(
      "Uploading · 1.2 of 3.4 GB",
    );
    expect(gameVideoStatusLabel({ ...base, status: "uploading" }, null, false)).toBe("Upload didn't finish");
    expect(gameVideoStatusLabel({ ...base, status: "converting" }, null, false)).toBe("Waiting to convert");
    expect(gameVideoStatusLabel({ ...base, status: "converting", convertProgress: 0.42 }, null, false)).toBe("Converting · 42%");
    // The list keeps it short; the game page explains with describeConvertError.
    expect(gameVideoStatusLabel({ ...base, status: "failed", convertError: "too_long" }, null, false)).toBe("Conversion failed");
  });

  it("asks for the sync to be set or checked on a ready game, and says nothing otherwise", () => {
    expect(gameVideoStatusLabel({ ...base, status: "ready" }, null, false)).toBe("Set the tip-off");
    expect(gameVideoStatusLabel({ ...base, status: "ready", anchorKind: "first_basket" }, null, false)).toBe("Set the first basket");
    expect(gameVideoStatusLabel({ ...base, status: "ready", syncStatus: "applied" }, null, true)).toBe("Check the tip-off");
    expect(gameVideoStatusLabel({ ...base, status: "ready", syncStatus: "confirmed" }, null, true)).toBeNull();
    expect(gameVideoStatusLabel({ ...base, status: "ready" }, null, true)).toBeNull();
  });
});

describe("schedulers", () => {
  it("times a step out and lets a quick one through", async () => {
    await expect(withTimeout(Promise.resolve(1), 50, "quick")).resolves.toBe(1);
    await expect(withTimeout(new Promise(() => {}), 5, "slow")).rejects.toBeInstanceOf(StepTimeout);
    await expect(withTimeout(Promise.reject(new Error("boom")), 50, "failing")).rejects.toThrow("boom");
  });

  it("runs at most `limit` at once, in order, and stops at the first failure", async () => {
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];
    await inParallel([1, 2, 3, 4, 5, 6], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      order.push(n);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(order).toEqual([1, 2, 3, 4, 5, 6]);
    await expect(inParallel([1, 2], 2, async (n) => {
      if (n === 2) throw new Error("part 2");
    })).rejects.toThrow("part 2");
    await expect(inParallel([], 3, async () => {})).resolves.toBeUndefined();
  });

  it("waits a second more each retry", () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(2)).toBe(2000);
    expect(retryDelayMs(0)).toBe(1000);
  });
});
