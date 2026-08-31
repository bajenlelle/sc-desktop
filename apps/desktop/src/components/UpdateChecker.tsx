import { useEffect, useState } from "react";
import { type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { X } from "lucide-react";
import { Sentry } from "@/lib/sentry";
import { silentUpdateCheck, UPDATE_FOUND_EVENT } from "@/lib/updates";

export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

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
    if (!update) return;
    setStatus("downloading");
    try {
      await update.downloadAndInstall();
      setStatus("done");
      await relaunch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Update failed:", msg);
      Sentry.captureException(e);
      setError(msg);
      setStatus("error");
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 bg-primary px-4 py-2 text-sm text-primary-foreground shadow-md">
      <span className="font-medium">
        {status === "downloading"
          ? "Downloading update…"
          : status === "error"
          ? `Update failed: ${error}`
          : `Update available — v${update.version}${update.body ? ` — ${update.body}` : ""}`}
      </span>
      {status === "idle" && (
        <div className="flex items-center gap-2">
          <button
            onClick={installUpdate}
            className="rounded bg-primary-foreground/20 px-3 py-1 font-medium hover:bg-primary-foreground/30 transition-colors"
          >
            Install &amp; restart
          </button>
          <button
            onClick={() => setUpdate(null)}
            aria-label="Dismiss"
            className="rounded p-1 hover:bg-primary-foreground/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
