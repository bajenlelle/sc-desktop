import { describe, expect, it } from "vitest";
import type { DownloadProgress, UpdateDownloadEvent } from "../update-progress";
import {
  applyDownloadEvent,
  downloadProgressLabel,
  INITIAL_DOWNLOAD_PROGRESS,
} from "../update-progress";

const MB = 1024 * 1024;

function run(events: UpdateDownloadEvent[]): DownloadProgress {
  return events.reduce(applyDownloadEvent, INITIAL_DOWNLOAD_PROGRESS);
}

describe("applyDownloadEvent", () => {
  it("accumulates chunk deltas into an integer percent", () => {
    const state = run([
      { event: "Started", data: { contentLength: 100 * MB } },
      { event: "Progress", data: { chunkLength: 12 * MB } },
      { event: "Progress", data: { chunkLength: 30 * MB } },
    ]);
    expect(state).toEqual({ received: 42 * MB, total: 100 * MB, percent: 42 });
  });

  it("starts determinate at 0% before the first chunk", () => {
    const state = run([{ event: "Started", data: { contentLength: 10 * MB } }]);
    expect(state.percent).toBe(0);
    expect(state.total).toBe(10 * MB);
  });

  it("treats a missing or zero contentLength as indeterminate", () => {
    for (const data of [{}, { contentLength: 0 }] as Array<{ contentLength?: number }>) {
      const state = run([
        { event: "Started", data },
        { event: "Progress", data: { chunkLength: 5 * MB } },
      ]);
      expect(state.total).toBeNull();
      expect(state.percent).toBeNull();
      expect(state.received).toBe(5 * MB);
    }
  });

  it("clamps at 100 when the server's contentLength lied low", () => {
    const state = run([
      { event: "Started", data: { contentLength: 10 * MB } },
      { event: "Progress", data: { chunkLength: 13 * MB } },
    ]);
    expect(state.percent).toBe(100);
  });

  it("Finished forces 100% and snaps received to a known total", () => {
    const state = run([
      { event: "Started", data: { contentLength: 10 * MB } },
      { event: "Progress", data: { chunkLength: 9 * MB } },
      { event: "Finished" },
    ]);
    expect(state).toEqual({ received: 10 * MB, total: 10 * MB, percent: 100 });
  });

  it("Finished forces 100% in indeterminate mode too, keeping the byte count", () => {
    const state = run([
      { event: "Started", data: {} },
      { event: "Progress", data: { chunkLength: 7 * MB } },
      { event: "Finished" },
    ]);
    expect(state).toEqual({ received: 7 * MB, total: null, percent: 100 });
  });
});

describe("downloadProgressLabel", () => {
  it("says the download is starting before any bytes arrive", () => {
    expect(downloadProgressLabel(INITIAL_DOWNLOAD_PROGRESS)).toBe("Starting download…");
    expect(
      downloadProgressLabel(run([{ event: "Started", data: { contentLength: 10 * MB } }])),
    ).toBe("Starting download…");
  });

  it("formats the determinate readout with percent and both sizes", () => {
    const state = run([
      { event: "Started", data: { contentLength: 29 * MB } },
      { event: "Progress", data: { chunkLength: 12 * MB } },
    ]);
    expect(downloadProgressLabel(state)).toBe("41% · 12 MB of 29 MB");
  });

  it("formats the indeterminate readout as bytes downloaded", () => {
    const state = run([
      { event: "Started", data: {} },
      { event: "Progress", data: { chunkLength: 12 * MB } },
    ]);
    expect(downloadProgressLabel(state)).toBe("12 MB downloaded");
  });

  it("keeps one decimal under 10 MB and whole megabytes above", () => {
    const small = run([
      { event: "Started", data: {} },
      { event: "Progress", data: { chunkLength: 2.34 * MB } },
    ]);
    expect(downloadProgressLabel(small)).toBe("2.3 MB downloaded");
    const large = run([
      { event: "Started", data: {} },
      { event: "Progress", data: { chunkLength: 123.6 * MB } },
    ]);
    expect(downloadProgressLabel(large)).toBe("124 MB downloaded");
  });

  it("is stable across sub-percent chunks — the re-render throttle contract", () => {
    let state = run([
      { event: "Started", data: { contentLength: 1000 * MB } },
      { event: "Progress", data: { chunkLength: 500 * MB } },
    ]);
    const before = downloadProgressLabel(state);
    // A chunk too small to move the integer percent or the whole-MB readout
    // must not change the label (the UI only re-renders on label changes).
    state = applyDownloadEvent(state, { event: "Progress", data: { chunkLength: 1024 } });
    expect(downloadProgressLabel(state)).toBe(before);
  });
});
