import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_KEY_RE,
  exportFileName,
  exportFrameRate,
  gameVideoExportKey,
  isGameVideoExportKey,
} from "../game-video-wire";
import { parseExportJobResult, parseExportRequest, rowToRenderJob } from "../render-jobs-db";

const U1 = "5dc28ee0-1111-4222-8333-444455556666";
const U2 = "1157b3ac-dde0-4f35-a988-1f40fe6c64e4";

describe("exportFrameRate (the desktop's export_frame_rate, lib.rs)", () => {
  it("maps the NTSC family to exact rationals", () => {
    expect(exportFrameRate(23.976)).toBe("24000/1001");
    expect(exportFrameRate(29.97)).toBe("30000/1001");
    expect(exportFrameRate(29.9701)).toBe("30000/1001");
    expect(exportFrameRate(59.94)).toBe("60000/1001");
  });

  it("rounds other rates and holds them to 1..60; unknown is 30", () => {
    expect(exportFrameRate(25)).toBe("25");
    expect(exportFrameRate(50)).toBe("50");
    expect(exportFrameRate(24.4)).toBe("24");
    expect(exportFrameRate(120)).toBe("60");
    // Positive but under half a frame a second: rounded to 0, then held at 1, as the Rust does.
    expect(exportFrameRate(0.4)).toBe("1");
    expect(exportFrameRate(0)).toBe("30");
    expect(exportFrameRate(null)).toBe("30");
    expect(exportFrameRate(undefined)).toBe("30");
    expect(exportFrameRate(Number.NaN)).toBe("30");
  });
});

describe("export keys and names", () => {
  it("puts downloads in the project's exports folder and recognises them", () => {
    const key = gameVideoExportKey("edalihizooqdxeekaklf", U1, U2);
    expect(key).toBe(`edalihizooqdxeekaklf/exports/${U1}/${U2}.mp4`);
    expect(isGameVideoExportKey(key)).toBe(true);
    expect(isGameVideoExportKey(`edalihizooqdxeekaklf/games/m/${U2}.mp4`)).toBe(false);
    expect(isGameVideoExportKey(`../exports/${U1}/${U2}.mp4`)).toBe(false);
  });

  it("admits highlight files as presign-upload does", () => {
    expect(HIGHLIGHT_KEY_RE.test(`highlights/${U1}/${U2}.mp4`)).toBe(true);
    expect(HIGHLIGHT_KEY_RE.test(`highlights/${U1}/${U2}.jpg`)).toBe(true);
    expect(HIGHLIGHT_KEY_RE.test(`highlights/${U1}/${U2}.png`)).toBe(false);
    expect(HIGHLIGHT_KEY_RE.test(`clips/${U1}/${U2}.mp4`)).toBe(false);
  });

  it("names the file the desktop's way", () => {
    expect(exportFileName("Norrort Makes", "16:9")).toBe("Norrort_Makes.mp4");
    expect(exportFileName("Lulea · makes!", "9:16")).toBe("Lulea___makes__vertical.mp4");
    expect(exportFileName("", "16:9")).toBe("playlist.mp4");
  });
});

describe("export jobs as the web reads them", () => {
  const row = {
    id: U2,
    kind: "export" as const,
    playlist_id: "p",
    status: "done" as const,
    phase: "upload",
    request: { aspect: "9:16", purpose: "share", watermark: true, selection: ["m:1", "text:c"] },
    progress: 1,
    requeue: false,
    result: { purpose: "share", aspect: "9:16", watermark: true, clips: 3, cards: 1, durationSeconds: 47.2, sizeBytes: 9000000, shareId: U1, url: `https://app/h/${U1}` },
    error: null,
    attempt: 1,
    created_at: "2026-10-19T10:00:00Z",
    finished_at: "2026-10-19T10:02:00Z",
  };

  it("parses the request, the result and the phase of an export", () => {
    const job = rowToRenderJob(row);
    expect(job.exportRequest).toEqual({ aspect: "9:16", purpose: "share", watermark: true, selection: ["m:1", "text:c"] });
    expect(job.exportResult).toMatchObject({ purpose: "share", clips: 3, cards: 1, shareId: U1 });
    expect(job.result).toBeNull();
    expect(job.phase).toBe("upload");
  });

  it("leaves ship jobs' export fields empty and ignores unknown shapes", () => {
    const ship = rowToRenderJob({ ...row, kind: "ship", request: {}, result: { shipped: 1, failed: 0, superseded: 0, total: 1, failures: [] }, phase: null });
    expect(ship.exportRequest).toBeNull();
    expect(ship.exportResult).toBeNull();
    expect(ship.result).toMatchObject({ shipped: 1 });
    expect(parseExportRequest({ aspect: "4:3", purpose: "share" })).toBeNull();
    expect(parseExportJobResult({ purpose: "mail", aspect: "16:9" })).toBeNull();
    expect(rowToRenderJob({ ...row, phase: "warp" }).phase).toBeNull();
  });
});
