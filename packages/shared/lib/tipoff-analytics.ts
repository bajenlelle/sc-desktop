/**
 * How a tip-off ended up set, for the `tipoff_suggestion_resolved` analytics event.
 * A suggestion is anything the strip offered: a hint (stored by an earlier import of the
 * same recording) or a detection (a fresh search of the video).
 */
export type TipoffResolutionPath =
  /** The user clicked "Use" on a hint. */
  | "accepted_hint"
  /** The user clicked "Use" on a detection result (including "starts after the tip-off"). */
  | "accepted_detection"
  /** Set with the scrubber before the lookup or search had finished. */
  | "manual_while_searching"
  /** Set with the scrubber although a suggestion was offered (dismissed, ignored or adjusted). */
  | "manual_over_suggestion"
  /** Set with the scrubber after the search found nothing, failed, was cancelled or unavailable. */
  | "manual_no_suggestion";

export interface TipoffResolutionInput {
  /** The last confirm in the picker: "Use" (accepted) or "Set tip-off here" (manual); null if none was seen. */
  lastConfirm: "accepted" | "manual" | null;
  /** What the strip offered, if anything. */
  offeredSource: "hint" | "auto" | "none";
  /** Where the lookup and search stood: still running, produced a suggestion, or ended with nothing. */
  searchOutcome: "pending" | "offered" | "nothing";
}

export function tipoffResolutionPath({ lastConfirm, offeredSource, searchOutcome }: TipoffResolutionInput): TipoffResolutionPath {
  if (lastConfirm === "accepted" && offeredSource !== "none") {
    return offeredSource === "hint" ? "accepted_hint" : "accepted_detection";
  }
  if (offeredSource !== "none" || searchOutcome === "offered") return "manual_over_suggestion";
  if (searchOutcome === "pending") return "manual_while_searching";
  return "manual_no_suggestion";
}
