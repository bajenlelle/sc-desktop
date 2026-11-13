import { describe, expect, it } from "vitest";
import {
  importGuideEntry,
  importGuideEvents,
  importGuideStep,
  startImportGuideRun,
  type ImportGuideFacts,
} from "../import-guide";

const fresh: ImportGuideFacts = {
  ready: true,
  hasGame: false,
  hasVideo: false,
  hasTipoff: false,
  settingQuarters: false,
  blocked: false,
  imported: false,
};

const picked = { ...fresh, hasGame: true };
const withVideo = { ...picked, hasVideo: true };
const synced = { ...withVideo, hasTipoff: true };

describe("importGuideStep", () => {
  it("starts on picking a game", () => {
    expect(importGuideStep(fresh)).toBe("pick");
  });

  it("moves to the video once a game is picked", () => {
    expect(importGuideStep(picked)).toBe("video");
  });

  it("moves to the tip-off once a video is chosen", () => {
    expect(importGuideStep(withVideo)).toBe("tipoff");
  });

  it("moves to the import once the tip-off is set", () => {
    expect(importGuideStep(synced)).toBe("import");
  });

  it("stays on the tip-off while later quarters are being set", () => {
    expect(importGuideStep({ ...synced, settingQuarters: true })).toBe("tipoff");
  });

  it("goes back to the video when it is removed, even with the old tip-off still set", () => {
    expect(importGuideStep({ ...synced, hasVideo: false })).toBe("video");
  });

  it("goes back to picking when the game is changed, whatever else is set", () => {
    expect(importGuideStep({ ...synced, hasGame: false })).toBe("pick");
  });

  it("has nothing to point at before the page has loaded", () => {
    expect(importGuideStep({ ...fresh, ready: false })).toBeNull();
  });

  it("steps aside while something covers the page", () => {
    expect(importGuideStep({ ...withVideo, blocked: true })).toBeNull();
  });

  it("is over once the game is imported", () => {
    expect(importGuideStep({ ...synced, imported: true })).toBeNull();
  });
});

describe("importGuideEvents", () => {
  it("reports the first step as shown", () => {
    const { events } = importGuideEvents(startImportGuideRun(1_000), fresh, 1_000);
    expect(events).toEqual([{ event: "import_guide_step_shown", step: "pick", n: 1 }]);
  });

  it("says nothing more while the page stays on the same step", () => {
    const first = importGuideEvents(startImportGuideRun(1_000), fresh, 1_000);
    expect(importGuideEvents(first.run, fresh, 5_000).events).toEqual([]);
  });

  it("reports a step completed, with the seconds it took, and the next one shown", () => {
    const first = importGuideEvents(startImportGuideRun(1_000), fresh, 1_000);
    const { events } = importGuideEvents(first.run, picked, 13_400);
    expect(events).toEqual([
      { event: "import_guide_step_completed", step: "pick", n: 1, seconds: 12 },
      { event: "import_guide_step_shown", step: "video", n: 2 },
    ]);
  });

  it("stays quiet when the coach goes back, and when they come forward again", () => {
    let state = importGuideEvents(startImportGuideRun(0), fresh, 0);
    state = importGuideEvents(state.run, picked, 1_000);
    const back = importGuideEvents(state.run, fresh, 2_000);
    expect(back.events).toEqual([]);
    expect(importGuideEvents(back.run, picked, 3_000).events).toEqual([]);
  });

  it("does not report a step completed that it never showed", () => {
    // Reopened from the toolbar with a game and a video already in place.
    let state = importGuideEvents(startImportGuideRun(0), withVideo, 0);
    expect(state.events).toEqual([{ event: "import_guide_step_shown", step: "tipoff", n: 3 }]);
    state = importGuideEvents(state.run, synced, 4_000);
    expect(state.events).toEqual([
      { event: "import_guide_step_completed", step: "tipoff", n: 3, seconds: 4 },
      { event: "import_guide_step_shown", step: "import", n: 4 },
    ]);
  });

  it("skips over a step that was already done when the guide reached it", () => {
    // The video was chosen before the game: picking the game lands on the tip-off.
    const first = importGuideEvents(startImportGuideRun(0), { ...fresh, hasVideo: true }, 0);
    const { events } = importGuideEvents(first.run, withVideo, 2_000);
    expect(events).toEqual([
      { event: "import_guide_step_completed", step: "pick", n: 1, seconds: 2 },
      { event: "import_guide_step_shown", step: "tipoff", n: 3 },
    ]);
  });

  it("waits while something covers the page, then carries on", () => {
    const first = importGuideEvents(startImportGuideRun(0), fresh, 0);
    const covered = importGuideEvents(first.run, { ...fresh, blocked: true }, 1_000);
    expect(covered.events).toEqual([]);
    expect(importGuideEvents(covered.run, picked, 3_000).events).toEqual([
      { event: "import_guide_step_completed", step: "pick", n: 1, seconds: 3 },
      { event: "import_guide_step_shown", step: "video", n: 2 },
    ]);
  });

  it("reports the last step and the whole guide completed when the import succeeds", () => {
    let state = importGuideEvents(startImportGuideRun(0), synced, 0);
    // The import progress covers the page before the result arrives.
    state = importGuideEvents(state.run, { ...synced, blocked: true }, 6_000);
    state = importGuideEvents(state.run, { ...synced, blocked: true, imported: true }, 9_000);
    expect(state.events).toEqual([
      { event: "import_guide_step_completed", step: "import", n: 4, seconds: 9 },
      { event: "import_guide_completed", seconds: 9 },
    ]);
  });

  it("reports the guide completed only once", () => {
    let state = importGuideEvents(startImportGuideRun(0), synced, 0);
    state = importGuideEvents(state.run, { ...synced, imported: true }, 2_000);
    expect(importGuideEvents(state.run, { ...synced, imported: true }, 3_000).events).toEqual([]);
  });
});

describe("importGuideEntry", () => {
  it("starts by itself for a coach who has never imported a game", () => {
    expect(importGuideEntry({ done: false, ownImports: 0 })).toBe("auto");
  });

  it("stays away once the coach has imported a game", () => {
    expect(importGuideEntry({ done: false, ownImports: 2 })).toBeNull();
  });

  it("stays away once the coach has skipped or finished it", () => {
    expect(importGuideEntry({ done: true, ownImports: 0 })).toBeNull();
  });

  it("stays away when the import count could not be read", () => {
    expect(importGuideEntry({ done: false, ownImports: null })).toBeNull();
  });
});
