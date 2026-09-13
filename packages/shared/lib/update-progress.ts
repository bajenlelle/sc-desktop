/**
 * Pure progress accounting for the desktop updater's download banner.
 *
 * The Tauri updater plugin reports download progress as a stream of events
 * over a Channel: Started (with an OPTIONAL contentLength — servers may omit
 * Content-Length), then one Progress per HTTP chunk carrying only that
 * chunk's byte DELTA, then Finished. This module folds that stream into a
 * displayable state. The event type is structural on purpose — it matches
 * the plugin's DownloadEvent shape without importing tauri types into this
 * dependency-free package.
 *
 * Progress events arrive per chunk (hundreds to thousands per download), so
 * the label is also the re-render throttle: the UI should only setState when
 * `downloadProgressLabel` changes, which happens once per integer percent
 * (determinate) or per displayed-MB step (indeterminate).
 */

/** Structurally compatible with @tauri-apps/plugin-updater's DownloadEvent. */
export type UpdateDownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

export interface DownloadProgress {
  /** Bytes received so far. */
  received: number;
  /** Total bytes, or null when the server sent no usable Content-Length. */
  total: number | null;
  /** Clamped integer 0-100, or null while the total is unknown. */
  percent: number | null;
}

export const INITIAL_DOWNLOAD_PROGRESS: DownloadProgress = {
  received: 0,
  total: null,
  percent: null,
};

/**
 * Fold one plugin event into the progress state. Finished forces 100% even
 * in indeterminate mode (and snaps received to the total when one is known);
 * a lying Content-Length (received overshooting total) clamps at 100 rather
 * than ever showing 104%.
 */
export function applyDownloadEvent(
  state: DownloadProgress,
  event: UpdateDownloadEvent,
): DownloadProgress {
  switch (event.event) {
    case "Started": {
      const length = event.data.contentLength ?? 0;
      const total = Number.isFinite(length) && length > 0 ? length : null;
      return { received: 0, total, percent: total === null ? null : 0 };
    }
    case "Progress": {
      const received = state.received + event.data.chunkLength;
      const percent =
        state.total === null ? null : Math.min(100, Math.floor((received / state.total) * 100));
      return { ...state, received, percent };
    }
    case "Finished":
      return {
        received: state.total ?? state.received,
        total: state.total,
        percent: 100,
      };
  }
}

/** 12.3 MB under 10 MB, whole megabytes above — keeps the readout calm. */
function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}

/**
 * Human line for the banner: "42% · 12 of 29 MB" when the total is known,
 * "12 MB downloaded" when it isn't, "Starting download…" before any bytes.
 */
export function downloadProgressLabel(state: DownloadProgress): string {
  if (state.received === 0 && state.percent !== 100) return "Starting download…";
  if (state.total === null || state.percent === null) {
    return `${formatMegabytes(state.received)} downloaded`;
  }
  return `${state.percent}% · ${formatMegabytes(state.received)} of ${formatMegabytes(state.total)}`;
}
