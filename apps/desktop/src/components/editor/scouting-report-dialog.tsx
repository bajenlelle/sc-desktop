import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "react-qr-code";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, FileText, Loader2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoHeight } from "@/components/ui/auto-height";
import { ProgressBar } from "@/components/ui/progress-bar";
import { trackEvent } from "@/lib/analytics";
import { fadeVariants, springs } from "@/lib/motion";
import { reportBaseUrl, type GenerateOutcome, type ReportProgress } from "@/lib/scouting-report";
import { ScoutingReportError, revokeScoutingReport, type MyScoutingReport } from "@/lib/scouting-reports-db";
import { REPORT_TITLE_MAX, type OutlineRow } from "@scoutable/shared/lib/scouting-report";
import { scoutingReportUrl } from "@scoutable/shared/lib/scouting-reports-db";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";

type Phase =
  | { kind: "review" }
  | { kind: "working"; progress: ReportProgress | null }
  | { kind: "resolve"; failed: number; total: number }
  | { kind: "done"; id: string; expiresAt: string; leftOut: number }
  | { kind: "confirm-stop"; id: string; expiresAt: string }
  | { kind: "error"; message: string };

const STAGE_LABEL = {
  clips: "Preparing clips",
  posters: "Saving previews",
  publishing: "Creating your report…",
} as const;

export interface ScoutingReportRun {
  title: string;
  opponent: string | null;
  allowMissing: boolean;
  signal: AbortSignal;
  onProgress: (p: ReportProgress) => void;
}

function isLive(r: MyScoutingReport | null): r is MyScoutingReport {
  return !!r && new Date(r.expiresAt).getTime() > Date.now();
}

function errorMessage(e: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You’re offline. Connect to the internet to create the link.";
  if (e instanceof ScoutingReportError && e.code === "license_locked") {
    return "This club’s licence has ended, so sharing is paused. Ask an admin to renew it.";
  }
  return "Couldn’t create the link. Nothing was shared. Try again.";
}

/**
 * Share a playlist's scouting report: review what it holds, generate the
 * link (clips and previews are prepared first), then copy it, open it, save it
 * as a PDF, update it or stop sharing. Closing while it works cancels, and a
 * cancelled run publishes nothing: the page is only made public in the last step.
 *
 * A free plan can open this and look at the review; Generate is where the
 * upgrade dialog opens (the gate is on sharing, not on building).
 */
export function ScoutingReportDialog({
  open,
  onClose,
  outline,
  contentKey,
  existing,
  onExistingChange,
  initialTitle,
  initialOpponent,
  blockedByPlan,
  onUpgrade,
  run,
}: {
  open: boolean;
  onClose: () => void;
  /** What the playlist holds, section by section (clips count before their files are cut). */
  outline: OutlineRow[];
  /** What the playlist says as a hash, to tell whether a published report is up to date. */
  contentKey: string;
  /** The playlist's report that is not switched off, if any. */
  existing: MyScoutingReport | null;
  /** Called after a run or a stop, so the page reads the playlist's report again. */
  onExistingChange: () => void;
  initialTitle: string;
  initialOpponent: string | null;
  /** The playlist's plan is free: Generate opens the upgrade dialog instead. */
  blockedByPlan: boolean;
  onUpgrade: () => void;
  run: (args: ScoutingReportRun) => Promise<GenerateOutcome>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const [title, setTitle] = useState(initialTitle);
  const [opponent, setOpponent] = useState(initialOpponent ?? "");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const startedAt = useRef(0);
  const copyRef = useRef<HTMLButtonElement | null>(null);

  // Opening: a live report shows its link, anything else starts at the review.
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setTitle(isLive(existing) ? existing.title : initialTitle);
    setOpponent(initialOpponent ?? "");
    if (isLive(existing)) setPhase({ kind: "done", id: existing.id, expiresAt: existing.expiresAt, leftOut: 0 });
    else {
      setPhase({ kind: "review" });
      trackEvent("scouting_report_previewed", {
        players: outline.filter((r) => r.id !== "team").length,
        clips: outline.reduce((n, r) => n + r.clips, 0),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The link's Copy button takes focus, so Return copies it.
  useEffect(() => {
    if (phase.kind === "done") copyRef.current?.focus();
  }, [phase.kind]);

  function close() {
    abortRef.current?.abort();
    abortRef.current = null;
    runIdRef.current++;
    onClose();
  }

  function generate(allowMissing: boolean) {
    if (blockedByPlan) {
      onUpgrade();
      close();
      return;
    }
    const id = ++runIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    startedAt.current = Date.now();
    setPhase({ kind: "working", progress: null });
    const current = () => id === runIdRef.current;
    run({
      title,
      opponent: opponent.trim() || null,
      allowMissing,
      signal: controller.signal,
      onProgress: (progress) => current() && setPhase({ kind: "working", progress }),
    })
      .then((outcome) => {
        if (!current()) return;
        if (outcome.kind === "cancelled") {
          trackEvent("scouting_report_cancelled", { stage: outcome.stage });
          return;
        }
        if (outcome.kind === "clips_failed") {
          trackEvent("scouting_report_failed", { stage: "ship", error: "clips_failed" });
          setPhase({ kind: "resolve", failed: outcome.failures.length, total: outcome.failures.length + outcome.shipped });
          return;
        }
        trackEvent("scouting_report_generated", {
          players: outline.filter((r) => r.id !== "team").length,
          clips: outcome.clips,
          shipped: outcome.shipped,
          posters: outcome.posters,
          regenerated: !outcome.created,
          seconds: Math.round((Date.now() - startedAt.current) / 1000),
        });
        setPhase({ kind: "done", id: outcome.id, expiresAt: outcome.expiresAt, leftOut: outcome.leftOut.length });
        onExistingChange();
      })
      .catch((e) => {
        if (!current() || controller.signal.aborted) return;
        if (e instanceof ScoutingReportError && e.code === "upgrade_required") {
          onUpgrade();
          close();
          return;
        }
        trackEvent("scouting_report_failed", { stage: "publish", error: e instanceof ScoutingReportError ? e.code : "unknown" });
        setPhase({ kind: "error", message: errorMessage(e) });
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });
  }

  function copy(url: string, method: "button" | "qr" = "button") {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      trackEvent("scouting_report_link_copied", { method });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function stopSharing(id: string) {
    try {
      await revokeScoutingReport(id);
      trackEvent("scouting_report_revoked");
      toast("Report is no longer shared");
      onExistingChange();
      close();
    } catch {
      toast.error("Couldn’t stop sharing. Try again.");
      setPhase({ kind: "error", message: "Couldn’t stop sharing. Try again." });
    }
  }

  const empty = outline.filter((r) => r.id !== "team" && !r.note && r.clips === 0).length;
  const working = phase.kind === "working";
  const stale = isLive(existing) && existing.contentKey !== contentKey;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            Scouting report
            {blockedByPlan && <Lock className="size-3.5 text-muted-foreground" aria-label="Sharing needs a paid plan" />}
          </DialogTitle>
          <DialogDescription>
            {phase.kind === "done" || phase.kind === "confirm-stop"
              ? `Scan the code or copy the link. It works until ${formatCardDate(phase.expiresAt)}.`
              : "One page with each player’s stats, note and clips."}
          </DialogDescription>
        </DialogHeader>

        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false}>
            {phase.kind === "review" && (
              <motion.div key="review" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="flex flex-col gap-3">
                {existing && !isLive(existing) && (
                  <p className="rounded-window bg-warning/12 px-3 py-2 text-callout text-foreground">
                    This report’s link has expired. Generating again brings the same link back for 30 days.
                  </p>
                )}
                <label className="flex flex-col gap-1 text-callout text-muted-foreground">
                  Title
                  <Input value={title} maxLength={REPORT_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} className="text-foreground" />
                </label>
                <label className="flex flex-col gap-1 text-callout text-muted-foreground">
                  Opponent <span className="sr-only">(optional)</span>
                  <Input value={opponent} maxLength={80} placeholder="Optional" onChange={(e) => setOpponent(e.target.value)} className="text-foreground" />
                </label>
                <div className="flex flex-col gap-1">
                  <p className="text-callout text-muted-foreground">Preview</p>
                  <ul className="max-h-44 divide-y divide-separator overflow-y-auto rounded-window bg-card ring-1 ring-separator" aria-label="Report preview">
                    {outline.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Nothing to show yet.</li>}
                    {outline.map((r) => (
                      <li key={r.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
                        <span className="truncate font-medium">{r.label}</span>
                        <span className="shrink-0 text-callout text-muted-foreground nums">
                          {[r.clips > 0 ? `${r.clips} ${r.clips === 1 ? "clip" : "clips"}` : null, r.stats ? "stats" : null, r.note ? "note" : null]
                            .filter(Boolean)
                            .join(" · ") || "empty"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {empty > 0 && (
                  <p className="text-callout text-muted-foreground">
                    {empty} {empty === 1 ? "player has" : "players have"} no note or clips.
                  </p>
                )}
                <p className="text-callout text-muted-foreground">Anyone with the link can view it for 30 days.</p>
              </motion.div>
            )}

            {phase.kind === "working" && (
              <motion.div key="working" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="flex flex-col items-center gap-3 py-6" role="status">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-foreground nums">
                  {phase.progress
                    ? phase.progress.stage === "publishing"
                      ? STAGE_LABEL.publishing
                      : `${STAGE_LABEL[phase.progress.stage]} · ${Math.min(phase.progress.done, phase.progress.total)} of ${phase.progress.total}`
                    : "Starting…"}
                </p>
                <div className="flex h-9 w-56 flex-col items-center gap-1.5">
                  {phase.progress && phase.progress.stage !== "publishing" && phase.progress.total > 0 && (
                    <ProgressBar percent={Math.round((100 * Math.min(phase.progress.done, phase.progress.total)) / phase.progress.total)} className="w-full" />
                  )}
                  <p className="text-callout text-muted-foreground">Long reports can take a few minutes.</p>
                </div>
              </motion.div>
            )}

            {phase.kind === "resolve" && (
              <motion.div key="resolve" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" role="alert" className="flex flex-col gap-1.5 rounded-window bg-warning/12 px-3 py-3">
                <p className="text-sm font-medium text-foreground">
                  {phase.failed} of {phase.total} clips didn’t upload
                </p>
                <p className="text-callout text-muted-foreground">Uploaded clips are saved. Trying again only retries the failed ones. Nothing has been shared yet.</p>
              </motion.div>
            )}

            {(phase.kind === "done" || phase.kind === "confirm-stop") && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={springs.gentle}
                className="flex flex-col items-center gap-4 py-2"
              >
                {(() => {
                  const url = scoutingReportUrl(reportBaseUrl(), phase.id);
                  return (
                    <>
                      <div className="rounded-lg bg-white p-3 shadow-menu">
                        <QRCode value={url} size={176} />
                      </div>
                      <input readOnly aria-label="Link" value={url} onFocus={(e) => e.currentTarget.select()} className="h-8 w-full rounded-md bg-card px-2 text-center text-callout text-foreground ring-1 ring-separator outline-none focus:ring-2 focus:ring-selection" />
                      {phase.kind === "done" ? (
                        <>
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <Button ref={copyRef} variant="outline" size="sm" onClick={() => copy(url)}>
                              {copied ? <Check /> : <Copy />}
                              {copied ? "Copied" : "Copy link"}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void openUrl(url)}>
                              <ExternalLink />
                              Open
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void openUrl(`${url}#print`)}>
                              <FileText />
                              Save as PDF
                            </Button>
                          </div>
                          {phase.leftOut > 0 && (
                            <p className="text-center text-callout text-muted-foreground">
                              {phase.leftOut} {phase.leftOut === 1 ? "clip isn’t" : "clips aren’t"} in the report: the game’s video isn’t on this computer.
                            </p>
                          )}
                          {stale && (
                            <p className="rounded-window bg-warning/12 px-3 py-2 text-center text-callout text-foreground">
                              You changed the playlist after sharing. Update the report to publish the changes.
                            </p>
                          )}
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => setPhase({ kind: "review" })}>
                              Update report
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setPhase({ kind: "confirm-stop", id: phase.id, expiresAt: phase.expiresAt })}>
                              Stop sharing
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div role="alertdialog" aria-label="Stop sharing this report?" className="flex flex-col items-center gap-3 rounded-window bg-fill-1 px-4 py-3 text-center">
                          <p className="text-sm font-medium text-foreground">Stop sharing this report?</p>
                          <p className="text-callout text-muted-foreground">The link stops working right away. You can share again with a new link.</p>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setPhase({ kind: "done", id: phase.id, expiresAt: phase.expiresAt, leftOut: 0 })}>
                              Keep sharing
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => void stopSharing(phase.id)}>
                              Stop sharing
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </motion.div>
            )}

            {phase.kind === "error" && (
              <motion.p key="error" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {phase.message}
              </motion.p>
            )}
          </AnimatePresence>
        </AutoHeight>

        <DialogFooter>
          {phase.kind === "review" && (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => generate(false)} disabled={!title.trim() || outline.length === 0}>
                {blockedByPlan && <Lock />}
                {isLive(existing) ? "Update link" : "Generate link"}
              </Button>
            </>
          )}
          {working && (
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
          )}
          {phase.kind === "resolve" && (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => generate(true)}>
                Share without them
              </Button>
              <Button onClick={() => generate(false)}>Try again</Button>
            </>
          )}
          {phase.kind === "error" && (
            <>
              <Button variant="outline" onClick={close}>
                Close
              </Button>
              <Button onClick={() => setPhase({ kind: "review" })}>Try again</Button>
            </>
          )}
          {(phase.kind === "done" || phase.kind === "confirm-stop") && (
            <Button onClick={close}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
