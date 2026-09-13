/**
 * Pure progress accounting for playlist exports (desktop).
 *
 * The Rust `export_playlist` command renders one ffmpeg process per segment,
 * then stitches everything with one final whole-timeline concat re-encode.
 * It reports `{ phase, done, total }` over a Tauri event: per-segment counts
 * during "clips", then a single "stitching" notification for the concat pass
 * — which is real, comparable-to-several-clips work, so it is counted as one
 * extra unit (total + 1) rather than letting the bar sit at 100% while ffmpeg
 * re-encodes the full timeline.
 */

export interface ExportProgress {
  phase: "clips" | "stitching";
  /** Segments fully rendered so far (clips phase). */
  done: number;
  /** Total segments in the export. */
  total: number;
}

/** Clamped integer percent over total+1 units (the +1 is the stitching pass). */
export function exportProgressPercent(p: ExportProgress): number {
  const units = Math.max(1, p.total) + 1;
  const done = p.phase === "stitching" ? Math.max(1, p.total) : Math.min(p.done, p.total);
  return Math.max(0, Math.min(100, Math.floor((done / units) * 100)));
}

/**
 * Human line for the export chip/dialogs: "Rendering clip 3 of 17" names the
 * clip IN FLIGHT (progress events fire on completion — same convention as the
 * share dialog's "Uploading clip X of Y"), then "Stitching clips…" for the
 * final pass.
 */
export function exportProgressLabel(p: ExportProgress): string {
  if (p.phase === "stitching") return "Stitching clips…";
  return `Rendering clip ${Math.min(p.done + 1, Math.max(1, p.total))} of ${p.total}`;
}
