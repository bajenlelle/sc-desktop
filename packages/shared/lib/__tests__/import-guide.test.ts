import { describe, expect, it } from "vitest";
import {
  importGuideEntry,
  importGuideEvents,
  importGuideScrollBy,
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
    const { events } = importGuideEvents(startImportGuideRun(1_000, "auto"), fresh, 1_000);
    expect(events).toEqual([{ event: "import_guide_step_shown", step: "pick", n: 1, trigger: "auto" }]);
  });

  it("says nothing more while the page stays on the same step", () => {
    const first = importGuideEvents(startImportGuideRun(1_000, "auto"), fresh, 1_000);
    expect(importGuideEvents(first.run, fresh, 5_000).events).toEqual([]);
  });

  it("reports a step completed, with the seconds it took, and the next one shown", () => {
    const first = importGuideEvents(startImportGuideRun(1_000, "auto"), fresh, 1_000);
    const { events } = importGuideEvents(first.run, picked, 13_400);
    expect(events).toEqual([
      { event: "import_guide_step_completed", step: "pick", n: 1, seconds: 12, trigger: "auto" },
      { event: "import_guide_step_shown", step: "video", n: 2, trigger: "auto" },
    ]);
  });

  it("stays quiet when the coach goes back, and when they come forward again", () => {
    let state = importGuideEvents(startImportGuideRun(0, "auto"), fresh, 0);
    state = importGuideEvents(state.run, picked, 1_000);
    const back = importGuideEvents(state.run, fresh, 2_000);
    expect(back.events).toEqual([]);
    expect(importGuideEvents(back.run, picked, 3_000).events).toEqual([]);
  });

  it("does not report a step completed that it never showed", () => {
    // Reopened from the toolbar with a game and a video already in place.
    let state = importGuideEvents(startImportGuideRun(0, "auto"), withVideo, 0);
    expect(state.events).toEqual([{ event: "import_guide_step_shown", step: "tipoff", n: 3, trigger: "auto" }]);
    state = importGuideEvents(state.run, synced, 4_000);
    expect(state.events).toEqual([
      { event: "import_guide_step_completed", step: "tipoff", n: 3, seconds: 4, trigger: "auto" },
      { event: "import_guide_step_shown", step: "import", n: 4, trigger: "auto" },
    ]);
  });

  it("skips over a step that was already done when the guide reached it", () => {
    // The video was chosen before the game: picking the game lands on the tip-off.
    const first = importGuideEvents(startImportGuideRun(0, "auto"), { ...fresh, hasVideo: true }, 0);
    const { events } = importGuideEvents(first.run, withVideo, 2_000);
    expect(events).toEqual([
      { event: "import_guide_step_completed", step: "pick", n: 1, seconds: 2, trigger: "auto" },
      { event: "import_guide_step_shown", step: "tipoff", n: 3, trigger: "auto" },
    ]);
  });

  it("waits while something covers the page, then carries on", () => {
    const first = importGuideEvents(startImportGuideRun(0, "auto"), fresh, 0);
    const covered = importGuideEvents(first.run, { ...fresh, blocked: true }, 1_000);
    expect(covered.events).toEqual([]);
    expect(importGuideEvents(covered.run, picked, 3_000).events).toEqual([
      { event: "import_guide_step_completed", step: "pick", n: 1, seconds: 3, trigger: "auto" },
      { event: "import_guide_step_shown", step: "video", n: 2, trigger: "auto" },
    ]);
  });

  it("reports the last step and the whole guide completed when the import succeeds", () => {
    let state = importGuideEvents(startImportGuideRun(0, "auto"), synced, 0);
    // The import progress covers the page before the result arrives.
    state = importGuideEvents(state.run, { ...synced, blocked: true }, 6_000);
    state = importGuideEvents(state.run, { ...synced, blocked: true, imported: true }, 9_000);
    expect(state.events).toEqual([
      { event: "import_guide_step_completed", step: "import", n: 4, seconds: 9, trigger: "auto" },
      { event: "import_guide_completed", seconds: 9, trigger: "auto" },
    ]);
  });

  it("says on every event how the guide was started", () => {
    let state = importGuideEvents(startImportGuideRun(0, "manual"), synced, 0);
    expect(state.events).toEqual([{ event: "import_guide_step_shown", step: "import", n: 4, trigger: "manual" }]);
    state = importGuideEvents(state.run, { ...synced, imported: true }, 5_000);
    expect(state.events).toEqual([
      { event: "import_guide_step_completed", step: "import", n: 4, seconds: 5, trigger: "manual" },
      { event: "import_guide_completed", seconds: 5, trigger: "manual" },
    ]);
  });

  it("reports the guide completed only once", () => {
    let state = importGuideEvents(startImportGuideRun(0, "auto"), synced, 0);
    state = importGuideEvents(state.run, { ...synced, imported: true }, 2_000);
    expect(importGuideEvents(state.run, { ...synced, imported: true }, 3_000).events).toEqual([]);
  });
});

describe("importGuideScrollBy", () => {
  // What is visible, clear of the toolbar: 600px high.
  const view = { top: 100, bottom: 700 };
  const margin = 16;

  it("stays put when there is nothing to show", () => {
    expect(importGuideScrollBy({ action: null, bubble: null, view, margin })).toBe(0);
  });

  it("stays put when the button and the bubble are already in view", () => {
    expect(importGuideScrollBy({ action: { top: 500, bottom: 540 }, bubble: { top: 560, bottom: 680 }, view, margin })).toBe(0);
  });

  it("scrolls down just far enough to show a bubble below the fold", () => {
    expect(importGuideScrollBy({ action: null, bubble: { top: 720, bottom: 860 }, view, margin })).toBe(176);
  });

  it("scrolls up to a bubble above the view", () => {
    expect(importGuideScrollBy({ action: null, bubble: { top: -80, bottom: 60 }, view, margin })).toBe(-196);
  });

  it("shows the ringed button and the bubble together when both fit", () => {
    // The button is in view, the bubble under it is not: 104px brings the bubble in and keeps the button.
    const by = importGuideScrollBy({ action: { top: 640, bottom: 680 }, bubble: { top: 700, bottom: 788 }, view, margin });
    expect(by).toBe(104);
    expect(640 - by).toBeGreaterThanOrEqual(view.top);
  });

  it("shows the ringed button, not the bubble, when the two do not fit together", () => {
    // A suggested tip-off: its button is at the top of a card taller than the window, the bubble hangs under the card.
    expect(importGuideScrollBy({ action: { top: 150, bottom: 182 }, bubble: { top: 900, bottom: 1040 }, view, margin })).toBe(0);
    expect(importGuideScrollBy({ action: { top: -300, bottom: -268 }, bubble: { top: 450, bottom: 590 }, view, margin })).toBe(-416);
  });

  it("shows the ringed button when the bubble rides in the margin", () => {
    expect(importGuideScrollBy({ action: { top: 760, bottom: 796 }, bubble: null, view, margin })).toBe(112);
  });

  it("puts the top of something taller than the view at the top", () => {
    expect(importGuideScrollBy({ action: null, bubble: { top: 300, bottom: 1100 }, view, margin })).toBe(184);
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
