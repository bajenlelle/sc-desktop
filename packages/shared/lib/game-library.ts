/**
 * The Library's view of a game: one state per row, derived from the match,
 * its cloud video row and any upload running on this device, plus the
 * search and the order the list uses. Pure, so the web's Library and the
 * Home page's recent imports read a game the same way.
 */
import type { StoredMatch } from "../types/match";
import type { GameVideo } from "./game-videos-db";

export type LibraryRowKind =
  /** A copy is ready and the plays are placed. */
  | "ready"
  /** A copy is ready and the converter applied a tip-off the user has not checked. */
  | "check-sync"
  /** A copy is ready but the game has no sync yet. */
  | "needs-sync"
  | "converting"
  /** An upload is running on this device. */
  | "uploading"
  /** An upload was started and not finished (no job on this device). */
  | "interrupted"
  | "failed"
  /** No cloud video at all. */
  | "none";

/** What the Library needs to know about an upload running here. */
export interface LibraryUploadJob {
  phase: "checking" | "uploading" | "finishing";
  doneBytes: number;
  totalBytes: number;
}

export interface LibraryRowState {
  kind: LibraryRowKind;
  /** A short state label; the ready state's length is added by the caller from `durationSeconds`. */
  label: string;
  durationSeconds: number | null;
  /** 0..1 while converting (null = waiting) or uploading. */
  progress: number | null;
}

export function libraryRowState(
  match: Pick<StoredMatch, "syncPoint">,
  video: GameVideo | null,
  job: LibraryUploadJob | null,
): LibraryRowState {
  const none: LibraryRowState = { kind: "none", label: "No video", durationSeconds: null, progress: null };
  if (!video) return none;
  switch (video.status) {
    case "uploading": {
      if (job) {
        const progress = job.totalBytes > 0 ? Math.min(1, job.doneBytes / job.totalBytes) : 0;
        return { kind: "uploading", label: job.phase === "finishing" ? "Finishing the upload" : "Uploading", durationSeconds: null, progress };
      }
      return { kind: "interrupted", label: "Upload interrupted", durationSeconds: null, progress: null };
    }
    case "converting":
      return {
        kind: "converting",
        label: video.convertProgress === null ? "Waiting to convert" : `Converting · ${Math.round(video.convertProgress * 100)}%`,
        durationSeconds: null,
        progress: video.convertProgress,
      };
    case "failed":
      return { kind: "failed", label: "Conversion failed", durationSeconds: null, progress: null };
    case "ready": {
      const synced = typeof match.syncPoint?.syncVideoTime === "number";
      if (!synced) return { kind: "needs-sync", label: "Set the tip-off", durationSeconds: video.durationSeconds, progress: null };
      if (video.syncStatus === "applied") return { kind: "check-sync", label: "Check the tip-off", durationSeconds: video.durationSeconds, progress: null };
      return { kind: "ready", label: "In the cloud", durationSeconds: video.durationSeconds, progress: null };
    }
  }
}

/** True for the states in which the game can be clipped on the web. */
export function canClipOnWeb(state: LibraryRowState): boolean {
  return state.kind === "ready" || state.kind === "check-sync";
}

function norm(s: string): string {
  return s.toLocaleLowerCase("sv").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** What the search and the order read of a game. */
export interface LibraryGame {
  title: string;
  /** ISO date of the game. */
  date: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

/** The games whose title or teams contain every word of the query. */
export function filterLibrary<T extends LibraryGame>(matches: readonly T[], query: string): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...matches];
  return matches.filter((m) => {
    const hay = norm(`${m.title} ${m.homeTeam.name} ${m.awayTeam.name}`);
    return words.every((w) => hay.includes(w));
  });
}

/**
 * Newest game first by game date; games on the same date keep their given
 * order (listMatchesLight already lists the latest import first).
 */
export function sortLibrary<T extends Pick<LibraryGame, "date">>(matches: readonly T[]): T[] {
  return [...matches].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
