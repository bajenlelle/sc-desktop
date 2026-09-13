import { useEffect, useRef, useState } from "react";
import { type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Loader2, X } from "lucide-react";
import {
  applyDownloadEvent,
  downloadProgressLabel,
  INITIAL_DOWNLOAD_PROGRESS,
  type DownloadProgress,
} from "@scoutable/shared/lib/update-progress";
import { Sentry } from "@/lib/sentry";
import { silentUpdateCheck, UPDATE_FOUND_EVENT } from "@/lib/updates";

export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<"idle" | "downloading" | "installing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>(INITIAL_DOWNLOAD_PROGRESS);
  // Progress events arrive per HTTP chunk; accumulate here and only setState
  // when the visible label changes (integer percent / MB step), so a big
  // download doesn't mean thousands of banner re-renders.
  const progressRef = useRef<DownloadProgress>(INITIAL_DOWNLOAD_PROGRESS);
  // Re-entrancy guard that can't go stale like render-captured status can
  // (a same-frame double click would otherwise start two downloads).
  const busyRef = useRef(false);

  useEffect(() => {
    silentUpdateCheck().then((u) => {
      if (u) setUpdate(u);
    });
    // Interactive checks (settings button, menu item) surface here too, so
    // the install affordance is always this banner.
    const onFound = (e: Event) => setUpdate((e as CustomEvent<Update>).detail);
    window.addEventListener(UPDATE_FOUND_EVENT, onFound);
    return () => window.removeEventListener(UPDATE_FOUND_EVENT, onFound);
  }, []);

  if (!update) return null;

  async function installUpdate() {
    // Callable from idle and from the error state's "Try again" — never
    // while a download or install is already running.
    if (!update || busyRef.current) return;
    busyRef.current = true;
    progressRef.current = INITIAL_DOWNLOAD_PROGRESS;
    setProgress(INITIAL_DOWNLOAD_PROGRESS);
    setStatus("downloading");
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Finished") {
          setStatus("installing");
          return;
        }
        const prev = progressRef.current;
        const next = applyDownloadEvent(prev, event);
        progressRef.current = next;
        if (downloadProgressLabel(next) !== downloadProgressLabel(prev)) setProgress(next);
      });
      // On Windows (NSIS) the line above never returns — the plugin exits the
      // process and the installer relaunches the app itself. From here on is
      // the macOS path: the .app was swapped in place, restart into it.
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Update failed:", msg);
      Sentry.captureException(e);
      setError(msg);
      setStatus("error");
      busyRef.current = false; // allow "Try again"
    }
  }

  function dismiss() {
    // Release the Rust-side updater resource, not just the JS handle.
    update?.close().catch(() => {});
    setUpdate(null);
  }

  const percent = progress.percent;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-primary px-4 py-2 text-sm text-primary-foreground shadow-md">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 font-medium">
          {status === "installing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {status === "downloading"
            ? "Downloading update…"
            : status === "installing"
            ? "Installing update…"
            : status === "error"
            ? `Update failed: ${error}`
            : `Update available — v${update.version}${update.body ? ` — ${update.body}` : ""}`}
        </span>
        {status === "downloading" && (
          <span className="shrink-0 tabular-nums text-primary-foreground/85">
            {downloadProgressLabel(progress)}
          </span>
        )}
        {(status === "idle" || status === "error") && (
          <div className="flex items-center gap-2">
            <button
              onClick={installUpdate}
              className="rounded bg-primary-foreground/20 px-3 py-1 font-medium hover:bg-primary-foreground/30 transition-colors"
            >
              {status === "error" ? "Try again" : "Install & restart"}
            </button>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="rounded p-1 hover:bg-primary-foreground/20 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {status === "downloading" && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-primary-foreground/25">
          <div
            className="h-full rounded-full bg-primary-foreground transition-all"
            // Indeterminate (no Content-Length): hold a small sliver, the
            // byte counter above still shows movement.
            style={{ width: percent !== null ? `${percent}%` : "5%" }}
          />
        </div>
      )}
    </div>
  );
}
