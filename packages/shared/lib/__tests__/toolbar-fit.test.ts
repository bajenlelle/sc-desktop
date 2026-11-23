import { describe, expect, it } from "vitest";
import { FIT_HYSTERESIS, INITIAL_TOOLBAR_FIT, nextToolbarFit, settleToolbarFit, type ToolbarFit, type ToolbarMeasure } from "../toolbar-fit";

/**
 * A made-up toolbar: what sits beside the title at each level (`others`), and the title's own width. Level 1
 * frees 280 px (labels to icons), level 2 another 90 (the subtitle and "Adding to").
 */
function bar(others: [number, number, number], titleWidth: number) {
  return (fit: ToolbarFit, headerWidth: number): ToolbarMeasure => ({ headerWidth, other: others[fit.level], titleWidth });
}

/** Lets the bar settle at a width, as the toolbar does: measure, step, measure again. */
function at(fit: ToolbarFit, headerWidth: number, measure: (fit: ToolbarFit, w: number) => ToolbarMeasure): ToolbarFit {
  return settleToolbarFit(fit, (f) => measure(f, headerWidth));
}

describe("nextToolbarFit", () => {
  const game = bar([805, 525, 435], 234);

  it("stays full while the title fits", () => {
    expect(at(INITIAL_TOOLBAR_FIT, 1220, game).level).toBe(0);
    expect(at(INITIAL_TOOLBAR_FIT, 805 + 234, game).level).toBe(0);
  });

  it("goes compact the moment the title would be cut", () => {
    expect(at(INITIAL_TOOLBAR_FIT, 805 + 233, game).level).toBe(1);
  });

  it("goes tight only when compact still cuts the title", () => {
    expect(at(INITIAL_TOOLBAR_FIT, 804, game).level).toBe(1); // 525 + 234 = 759 fits
    expect(at(INITIAL_TOOLBAR_FIT, 700, game).level).toBe(2);
  });

  it("records what a step saved, from the measures on either side of it", () => {
    const fit = at(INITIAL_TOOLBAR_FIT, 700, game);
    expect(fit.savings).toEqual([280, 90]);
    expect(fit.leftOther).toBeNull();
  });

  it("comes back a level only with the hysteresis to spare", () => {
    let fit = at(INITIAL_TOOLBAR_FIT, 900, game);
    expect(fit.level).toBe(1);
    // Full needs 805 + 234 = 1039; it comes back at 1039 + 32.
    fit = at(fit, 1039 + FIT_HYSTERESIS - 1, game);
    expect(fit.level).toBe(1);
    fit = at(fit, 1039 + FIT_HYSTERESIS, game);
    expect(fit.level).toBe(0);
  });

  it("doesn't flip back and forth on a width at the threshold", () => {
    let fit = at(INITIAL_TOOLBAR_FIT, 1038, game);
    expect(fit.level).toBe(1);
    for (let i = 0; i < 5; i++) {
      fit = at(fit, 1038 + (i % 2), game);
      expect(fit.level).toBe(1);
    }
  });

  it("comes down from tight to compact, then to full, as the bar grows", () => {
    let fit = at(INITIAL_TOOLBAR_FIT, 700, game);
    expect(fit.level).toBe(2);
    fit = at(fit, 525 + 234 + FIT_HYSTERESIS, game);
    expect(fit.level).toBe(1);
    fit = at(fit, 2000, game);
    expect(fit.level).toBe(0);
  });

  it("reads a longer title while compact: it doesn't come back when the new title wouldn't fit", () => {
    let fit = at(INITIAL_TOOLBAR_FIT, 1000, game);
    expect(fit.level).toBe(1);
    const longer = bar([805, 525, 435], 400);
    fit = at(fit, 1100, longer); // full would need 1205
    expect(fit.level).toBe(1);
    fit = at(fit, 1205 + FIT_HYSTERESIS, longer);
    expect(fit.level).toBe(0);
  });

  it("follows an action that grows while compact (a playlist chosen), by the live measure", () => {
    const before = bar([600, 320, 250], 234);
    let fit = at(INITIAL_TOOLBAR_FIT, 820, before);
    expect(fit.level).toBe(1);
    // The target's pill appears in both forms: 200 px more beside the title at every level.
    const after = bar([800, 520, 450], 234);
    fit = at(fit, 1000, after); // full would need 1034
    expect(fit.level).toBe(1);
    fit = at(fit, 1034 + FIT_HYSTERESIS, after);
    expect(fit.level).toBe(0);
  });

  it("settles even when an estimate was off: one step down, one back up, and no loop", () => {
    // Level 1 saves less than it did when the step was taken (an icon-only button appeared since).
    let fit = at(INITIAL_TOOLBAR_FIT, 1000, game);
    expect(fit.level).toBe(1);
    const changed = bar([905, 525, 435], 234); // full now needs 1139, the old saving says 1039
    fit = at(fit, 1039 + FIT_HYSTERESIS, changed);
    expect(fit.level).toBe(1);
    expect(fit.savings[0]).toBe(380);
  });

  it("leaves the fit as it is when nothing changes", () => {
    const fit = at(INITIAL_TOOLBAR_FIT, 1000, game);
    expect(nextToolbarFit(fit, game(fit, 1000))).toBe(fit);
  });

  it("an empty title never collapses anything", () => {
    expect(at(INITIAL_TOOLBAR_FIT, 805, bar([805, 525, 435], 0)).level).toBe(0);
  });
});
