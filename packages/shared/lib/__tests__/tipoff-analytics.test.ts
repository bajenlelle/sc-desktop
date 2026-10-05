import { describe, expect, it } from "vitest";
import { tipoffResolutionPath, type TipoffResolutionInput } from "../tipoff-analytics";

describe("tipoffResolutionPath", () => {
  const cases: [TipoffResolutionInput, string][] = [
    [{ lastConfirm: "accepted", offeredSource: "hint", searchOutcome: "offered" }, "accepted_hint"],
    [{ lastConfirm: "accepted", offeredSource: "auto", searchOutcome: "offered" }, "accepted_detection"],
    [{ lastConfirm: "manual", offeredSource: "none", searchOutcome: "pending" }, "manual_while_searching"],
    [{ lastConfirm: "manual", offeredSource: "hint", searchOutcome: "offered" }, "manual_over_suggestion"],
    [{ lastConfirm: "manual", offeredSource: "auto", searchOutcome: "offered" }, "manual_over_suggestion"],
    [{ lastConfirm: "manual", offeredSource: "none", searchOutcome: "nothing" }, "manual_no_suggestion"],
  ];
  it.each(cases)("%o -> %s", (input, path) => {
    expect(tipoffResolutionPath(input)).toBe(path);
  });

  it("counts an accepted-then-adjusted tip-off as manual over the suggestion", () => {
    // The user took the suggestion, then scrubbed and set their own: the last confirm decides.
    expect(tipoffResolutionPath({ lastConfirm: "manual", offeredSource: "auto", searchOutcome: "offered" })).toBe("manual_over_suggestion");
  });

  it("treats a sync point that was never confirmed in the picker as manual", () => {
    // No confirm recorded (e.g. a value restored from elsewhere): never claim the suggestion was used.
    expect(tipoffResolutionPath({ lastConfirm: null, offeredSource: "hint", searchOutcome: "offered" })).toBe("manual_over_suggestion");
    expect(tipoffResolutionPath({ lastConfirm: null, offeredSource: "none", searchOutcome: "pending" })).toBe("manual_while_searching");
  });
});
