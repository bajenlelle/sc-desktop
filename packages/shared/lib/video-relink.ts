/**
 * Bulk relink matching for missing match videos (the machine-switch flow):
 * the user points at a folder, the desktop app lists the video files inside,
 * and each missing match is matched to candidates by case-insensitive
 * filename — the same signal DaVinci Resolve and Lightroom relink on.
 * Exactly one candidate → confident auto-match; several files sharing the
 * name → ambiguous (user locates manually rather than us guessing); none →
 * unmatched. Pure and platform-free so it stays unit-testable.
 */

export interface MissingVideoRef {
  matchId: string;
  /** Basename of the dead path, e.g. "huddinge_aik.mp4". */
  fileName: string;
}

export interface VideoCandidate {
  /** Absolute path on this machine. */
  path: string;
  fileName: string;
}

export type RelinkMatch =
  | { matchId: string; fileName: string; outcome: "matched"; path: string }
  | { matchId: string; fileName: string; outcome: "ambiguous"; paths: string[] }
  | { matchId: string; fileName: string; outcome: "unmatched" };

export function matchMissingVideos(
  missing: MissingVideoRef[],
  candidates: VideoCandidate[],
): RelinkMatch[] {
  const byName = new Map<string, string[]>();
  for (const c of candidates) {
    const key = c.fileName.toLowerCase();
    const list = byName.get(key);
    if (list) list.push(c.path);
    else byName.set(key, [c.path]);
  }
  return missing.map((m) => {
    const paths = byName.get(m.fileName.toLowerCase()) ?? [];
    if (paths.length === 1) {
      return { matchId: m.matchId, fileName: m.fileName, outcome: "matched", path: paths[0] };
    }
    if (paths.length > 1) {
      return { matchId: m.matchId, fileName: m.fileName, outcome: "ambiguous", paths };
    }
    return { matchId: m.matchId, fileName: m.fileName, outcome: "unmatched" };
  });
}
