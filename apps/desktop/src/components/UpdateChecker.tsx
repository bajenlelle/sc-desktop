import { useEffect, useState, useSyncExternalStore } from "react";
import { type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Loader2, X } from "lucide-react";
import {
  applyDownloadEvent,
  downloadProgressLabel,
  INITIAL_DOWNLOAD_PROGRESS,
  type DownloadProgress,
} from "@scoutable/shared/lib/update-progress";
import { releaseNoteLines, whatsNewUrl, type ReleaseNoteLine } from "@scoutable/shared/lib/release-notes";
import { shouldOfferFoundUpdate, UPDATE_RECHECK_MS } from "@scoutable/shared/lib/update-offer";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sentry } from "@/lib/sentry";
import { cn } from "@/lib/utils";
import { shortError } from "@scoutable/shared/lib/update-outcome";
import {
  clearPendingUpdate,
  markUpdatePending,
  silentUpdateCheck,
  trackUpdate,
  UPDATE_FOUND_EVENT,
  type UpdateCheckVia,
} from "@/lib/updates";
import { shipScheduler } from "@/lib/background-ship";

/**
 * Update state lives in a small store so the check (mounted once in App)
 * and the card (rendered in the sidebar, where a Mac app keeps its
 * "update available" notice) can be in different trees.
 */
type UpdateStatus = "idle" | "downloading" | "installing" | "error";

interface UpdateState {
  update: Update | null;
  status: UpdateStatus;
  error: string | null;
  progress: DownloadProgress;
}

let state: UpdateState = {
  update: null,
  status: "idle",
  error: null,
  progress: INITIAL_DOWNLOAD_PROGRESS,
};
const listeners = new Set<() => void>();
// Re-entrancy guard that can't go stale like render-captured status can
// (a same-frame double click would otherwise start two downloads).
let busy = false;
// Progress events arrive per HTTP chunk; accumulate here and only publish
// when the visible label changes (integer percent / MB step), so a big
// download doesn't mean thousands of re-renders.
let progressAcc: DownloadProgress = INITIAL_DOWNLOAD_PROGRESS;

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export async function installUpdate() {
  // Callable from idle and from the error state's "Try again" — never
  // while a download or install is already running.
  const update = state.update;
  if (!update || busy) return;
  busy = true;
  progressAcc = INITIAL_DOWNLOAD_PROGRESS;
  // Sent at once: on a fast connection Windows ends the app (the install
  // below) before the next batch of events would leave.
  trackUpdate(
    "update_install_started",
    { version: update.version, retry: state.status === "error" },
    { instantly: true },
  );
  setState({ status: "downloading", progress: INITIAL_DOWNLOAD_PROGRESS, error: null });
  // How far it got, for the failure event.
  let stage: "download" | "install" | "relaunch" = "download";
  try {
    await update.download((event) => {
      if (event.event === "Finished") return;
      const prev = progressAcc;
      const next = applyDownloadEvent(prev, event);
      progressAcc = next;
      if (downloadProgressLabel(next) !== downloadProgressLabel(prev)) setState({ progress: next });
    });
    stage = "install";
    setState({ status: "installing" });
    // The install can end this process, so leave a note for the next start to
    // report how it went. First thing here, so the webview has what time
    // there is to save it.
    await markUpdatePending(update.version);
    // Stop what ffmpeg is doing first (a background send's cut, an export), as
    // quitting would: on Windows the install below ends the process without
    // the app's exit handler, and a running ffmpeg.exe locks the file the
    // installer replaces. A stopped send's clips are offered again next visit.
    shipScheduler.cancelAll();
    await invoke("stop_all_exports").catch(() => {});
    await update.install();
    // On Windows (NSIS) the line above never returns — the plugin exits the
    // process and the installer relaunches the app itself. From here on is
    // the macOS path: the .app was swapped in place, restart into it.
    stage = "relaunch";
    await relaunch();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Update failed:", msg);
    Sentry.captureException(e);
    // A failed relaunch leaves the new app in place: keep the note, so the
    // start the coach does by hand still reports the install.
    if (stage !== "relaunch") clearPendingUpdate();
    trackUpdate("update_install_failed", { version: update.version, stage, error: shortError(e) });
    void invoke("resume_exports").catch(() => {});
    setState({ status: "error", error: msg });
    busy = false; // allow "Try again"
  }
}

// The version the coach dismissed this session: the periodic check keeps it
// hidden and brings the card back only for a newer release. A relaunch or a
// check the coach asks for shows it again.
let dismissedVersion: string | null = null;

export function dismissUpdate() {
  if (state.update) {
    dismissedVersion = state.update.version;
    trackUpdate("update_dismissed", { version: state.update.version });
  }
  // Release the Rust-side updater resource, not just the JS handle.
  state.update?.close().catch(() => {});
  setState({ update: null, status: "idle", error: null });
}

/** Shows a found update in the card, releasing the one it replaces. */
function showUpdate(update: Update, via: UpdateCheckVia) {
  // One offer per version the card shows: asking again while it is up isn't a new one.
  if (state.update?.version !== update.version) trackUpdate("update_offered", { version: update.version, via });
  if (state.update && state.update !== update) state.update.close().catch(() => {});
  setState({ update, status: "idle", error: null });
}

/**
 * Runs the startup check, then looks again every few hours so a coach who
 * keeps the app open hears about a release (or one newer than they
 * dismissed). Listens for interactive checks too. Renders nothing.
 */
export function UpdateChecker() {
  useEffect(() => {
    silentUpdateCheck("startup").then((u) => {
      if (u) showUpdate(u, "startup");
    });
    const recheck = window.setInterval(() => {
      // Nothing to ask while the card is up or an install is running.
      if (state.update || busy) return;
      silentUpdateCheck("recheck").then((u) => {
        if (!u) return;
        if (shouldOfferFoundUpdate({ found: u.version, showing: state.update !== null || busy, dismissed: dismissedVersion })) {
          showUpdate(u, "recheck");
        } else {
          u.close().catch(() => {});
        }
      });
    }, UPDATE_RECHECK_MS);
    // Interactive checks (settings button, menu item) surface here too, so
    // the install affordance is always the sidebar card. The coach asked, so
    // a dismissed version shows again; an install already running keeps its
    // card.
    const onFound = (e: Event) => {
      const found = (e as CustomEvent<Update>).detail;
      if (busy) {
        found.close().catch(() => {});
        return;
      }
      showUpdate(found, "manual");
    };
    window.addEventListener(UPDATE_FOUND_EVENT, onFound);
    return () => {
      window.clearInterval(recheck);
      window.removeEventListener(UPDATE_FOUND_EVENT, onFound);
    };
  }, []);
  return null;
}

/** Lines the card shows before "More". */
const NOTES_PREVIEW = 3;

/** The card's text buttons (More/Less, What's new). */
const NOTES_LINK =
  "rounded-sm text-callout text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection";

/**
 * What's new in the release: its notes (the release tag's message), the first
 * few lines in the card and the rest behind "More", so a coach knows what the
 * update brings before restarting for it. "What's new" opens the site's page
 * at this version's notes, where every release is described.
 */
function ReleaseNotes({ lines, version }: { lines: ReleaseNoteLine[]; version: string }) {
  const [open, setOpen] = useState(false);
  const shown = open ? lines : lines.slice(0, NOTES_PREVIEW);
  return (
    <div className="mt-2 flex flex-col gap-1">
      <ul className={cn("flex flex-col gap-0.5 text-callout text-foreground", open && "max-h-48 overflow-y-auto")}>
        {shown.map((l, i) => (
          <li key={i} className={cn("[text-wrap:pretty]", l.kind === "bullet" && "relative pl-3")}>
            {l.kind === "bullet" && <span aria-hidden className="absolute left-0 text-muted-foreground">•</span>}
            {l.text}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        {lines.length > NOTES_PREVIEW && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={NOTES_LINK}
          >
            {open ? "Less" : "More"}
          </button>
        )}
        <button type="button" onClick={() => void openUrl(whatsNewUrl("update_card", version))} className={NOTES_LINK}>
          What&rsquo;s new
        </button>
      </div>
    </div>
  );
}

/** The sidebar's update notice. */
export function UpdateCard() {
  const { update, status, error, progress } = useUpdateState();
  if (!update) return null;
  const idle = status === "idle" || status === "error";
  return (
    <div className="rounded-lg bg-primary/10 p-3 text-sm ring-1 ring-primary/20">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            {status === "installing" && <Loader2 className="size-3.5 animate-spin" />}
            {status === "downloading"
              ? "Downloading update…"
              : status === "installing"
                ? "Installing update…"
                : status === "error"
                  ? "Update failed"
                  : "Update available"}
          </p>
          {(() => {
            const line = (
              <p className="truncate text-callout text-muted-foreground">
                {status === "error" ? error : `Version ${update.version}`}
              </p>
            );
            // A long error reads in full on hover; the release notes show in the card.
            const full = status === "error" ? error : null;
            return full ? (
              <Tooltip>
                <TooltipTrigger asChild>{line}</TooltipTrigger>
                <TooltipContent side="right" className="max-w-72 whitespace-pre-wrap">
                  {full}
                </TooltipContent>
              </Tooltip>
            ) : (
              line
            );
          })()}
        </div>
        {idle && (
          <button
            type="button"
            onClick={dismissUpdate}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-fill-2 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {status === "idle" && <ReleaseNotes lines={releaseNoteLines(update.body)} version={update.version} />}
      {status === "downloading" && (
        <>
          <ProgressBar percent={progress.percent} className="mt-2" />
          <p className="mt-1 text-subheadline nums text-muted-foreground">{downloadProgressLabel(progress)}</p>
        </>
      )}
      {idle && (
        <Button size="xs" className="mt-2 w-full" onClick={() => void installUpdate()}>
          {status === "error" ? "Try again" : "Install and restart"}
        </Button>
      )}
    </div>
  );
}
