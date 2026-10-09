import { describe, expect, it } from "vitest";
import type { ExportProgress } from "../export-progress";
import { exportProgressLabel, exportProgressPercent, isExportCancelled } from "../export-progress";

const p = (phase: ExportProgress["phase"], done: number, total: number): ExportProgress => ({
  phase,
  done,
  total,
});

describe("exportProgressPercent", () => {
  it("spreads the clips phase over total+1 units, reserving one for stitching", () => {
    expect(exportProgressPercent(p("clips", 0, 17))).toBe(0);
    expect(exportProgressPercent(p("clips", 9, 17))).toBe(50);
    // All clips rendered ≠ done: the stitching re-encode is still ahead.
    expect(exportProgressPercent(p("clips", 17, 17))).toBe(94);
    expect(exportProgressPercent(p("stitching", 17, 17))).toBe(94);
  });

  it("never reaches 100 (completion is announced by the toast, not the bar)", () => {
    expect(exportProgressPercent(p("stitching", 1, 1))).toBe(50);
    expect(exportProgressPercent(p("stitching", 100, 100))).toBe(99);
  });

  it("clamps degenerate inputs", () => {
    expect(exportProgressPercent(p("clips", 5, 3))).toBe(75); // done > total → total/(total+1)
    expect(exportProgressPercent(p("clips", -1, 3))).toBe(0);
    expect(exportProgressPercent(p("clips", 0, 0))).toBe(0);
    expect(exportProgressPercent(p("stitching", 0, 0))).toBe(50);
  });
});

describe("exportProgressLabel", () => {
  it("names the clip in flight, not the count completed", () => {
    expect(exportProgressLabel(p("clips", 0, 17))).toBe("Rendering clip 1 of 17");
    expect(exportProgressLabel(p("clips", 2, 17))).toBe("Rendering clip 3 of 17");
  });

  it("caps the in-flight number at the total", () => {
    expect(exportProgressLabel(p("clips", 17, 17))).toBe("Rendering clip 17 of 17");
  });

  it("labels the concat pass distinctly", () => {
    expect(exportProgressLabel(p("stitching", 17, 17))).toBe("Stitching clips…");
  });
});

describe("isExportCancelled", () => {
  it("recognises the command's own token and an AbortError", () => {
    expect(isExportCancelled("export_cancelled")).toBe(true);
    expect(isExportCancelled(new Error("export_cancelled"))).toBe(true);
    expect(isExportCancelled({ name: "AbortError", message: "Export stopped" })).toBe(true);
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(isExportCancelled(abort)).toBe(true);
  });

  it("leaves real failures alone", () => {
    expect(isExportCancelled("ffmpeg exited with code 1")).toBe(false);
    expect(isExportCancelled(new Error("No segments to export"))).toBe(false);
    expect(isExportCancelled(null)).toBe(false);
    expect(isExportCancelled(undefined)).toBe(false);
    expect(isExportCancelled(42)).toBe(false);
  });
});
