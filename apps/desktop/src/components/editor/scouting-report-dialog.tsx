import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "react-qr-code";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { ProgressBar } from "@/components/ui/progress-bar";
import { trackEvent } from "@/lib/analytics";
import { fadeVariants, springs } from "@/lib/motion";
import { reportBaseUrl, type GenerateOutcome, type ReportProgress } from "@/lib/scouting-report";
import {
  ScoutingReportError,
  getScoutingReportShareLimit,
  revokeScoutingReport,
  type LiveReportRef,
  type MyScoutingReport,
  type ShareLimit,
} from "@/lib/scouting-reports-db";
import { APP_OPEN_HASH, isLiveReport, openedLabel, scoutingReportUrl } from "@scoutable/shared/lib/scouting-reports-db";
import { formatCardDate } from "@scoutable/shared/lib/stats-card";
import type { OrgPlanTier } from "@scoutable/shared/types/org";

type Phase =
  | { kind: "review" }
  | { kind: "working"; progress: ReportProgress | null }
  | { kind: "resolve"; failed: number; total: number }
  | { kind: "done"; id: string; expiresAt: string | null; leftOut: number }
  | { kind: "confirm-stop"; id: string; expiresAt: string | null }
  /** The plan shares one report at a time and another one is live. */
  | { kind: "limit"; blockedBy: LiveReportRef }
  | { kind: "confirm-stop-other"; blockedBy: LiveReportRef }
  | { kind: "error"; message: string };

const STAGE_LABEL = {
  clips: "Preparing clips",
  posters: "Saving previews",
  publishing: "Creating your report…",
} as const;

export interface ScoutingReportRun {
  allowMissing: boolean;
  signal: AbortSignal;
  onProgress: (p: ReportProgress) => void;
}

const isLive = isLiveReport;

/** "It works until 26 Nov 2026", or, for a kept report, until it is stopped. */
function worksUntil(expiresAt: string | null): string {
  return expiresAt === null ? "It works until you stop sharing it." : `It works until ${formatCardDate(expiresAt)}.`;
}

/** Where the review step starts: on the limit when another report is in the way. */
function reviewPhase(limit: ShareLimit | null): Phase {
  return limit?.blockedBy ? { kind: "limit", blockedBy: limit.blockedBy } : { kind: "review" };
}

function errorMessage(e: unknown): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You’re offline. Connect to the internet to create the link.";
  if (e instanceof ScoutingReportError && e.code === "license_locked") {
    return "This club’s licence has ended, so sharing is paused. Ask an admin to renew it.";
  }
  return "Couldn’t create the link. Nothing was shared. Try again.";
}

/** What the report holds, counted before any clip file is cut. */
export interface ReportSummary {
  players: number;
  clips: number;
  /** Players with neither a note nor clips. */
  empty: number;
}

/**
 * Share a report: a last look at what it holds, generate the link (clips and
 * previews are prepared first), then copy it, open it, save it as a PDF,
 * update it or stop sharing. The document itself is the report view behind
 * this sheet. Closing while it works cancels, and a cancelled run publishes
 * nothing: the page is only made public in the last step.
 *
 * A free plan shares one report at a time. The sheet says so before any clip
 * is prepared, and when another report is live it offers to stop that one or
 * go Pro instead of making the coach wait for an upload that can't publish.
 */
export function ScoutingReportDialog({
  open,
  onClose,
  summary,
  contentKey,
  existing,
  onExistingChange,
  onOtherReportStopped,
  playlistId,
  plan,
  onUpgrade,
  run,
}: {
  open: boolean;
  onClose: () => void;
  summary: ReportSummary;
  /** What the report says as a hash, to tell whether a published report is up to date. */
  contentKey: string;
  /** The playlist's report that is not switched off, if any. */
  existing: MyScoutingReport | null;
  /** Called after a run or a stop, so the page reads the playlist's report again. */
  onExistingChange: () => void;
  /** Called after another playlist's report was stopped from the limit view, so the page forgets what it held for that playlist. */
  onOtherReportStopped: (playlistId: string) => void;
  playlistId: string;
  /** The space's plan tier, reported with the sheet's events. */
  plan: OrgPlanTier;
  /** Opens the upgrade dialog (the sheet closes itself after). */
  onUpgrade: () => void;
  run: (args: ScoutingReportRun) => Promise<GenerateOutcome>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  // What the plan allows for this playlist; null until it is read, or when the read failed (no line, no block).
  const [limit, setLimit] = useState<ShareLimit | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const startedAt = useRef(0);
  const copyRef = useRef<HTMLButtonElement | null>(null);

  /** Reads the plan's limit for this playlist into state and returns it. */
  async function readLimit(): Promise<ShareLimit | null> {
    const l = await getScoutingReportShareLimit(playlistId);
    setLimit(l);
    return l;
  }

  /** Back to the review step, or to the limit when another report is in the way. */
  function toReview(l: ShareLimit | null = limit) {
    setPhase(reviewPhase(l));
  }

  // Opening: a live report shows its link, anything else starts at the review.
  // The limit is read each time: another report may have been shared or stopped since.
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setLimit(null);
    let current = true;
    void getScoutingReportShareLimit(playlistId).then((l) => {
      if (current) setLimit(l);
    });
    if (isLive(existing)) setPhase({ kind: "done", id: existing.id, expiresAt: existing.expiresAt, leftOut: 0 });
    else {
      toReview(null);
      trackEvent("scouting_report_previewed", { players: summary.players, clips: summary.clips });
    }
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The limit arrives while the coach is still at the review: say so before any clip is prepared.
  useEffect(() => {
    if (!limit?.blockedBy || phase.kind !== "review") return;
    setPhase({ kind: "limit", blockedBy: limit.blockedBy });
    trackEvent("scouting_report_limit_reached", { source: "check" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

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
    const id = ++runIdRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    startedAt.current = Date.now();
    setPhase({ kind: "working", progress: null });
    const current = () => id === runIdRef.current;
    run({
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
          players: summary.players,
          clips: outcome.clips,
          shipped: outcome.shipped,
          posters: outcome.posters,
          regenerated: !outcome.created,
          seconds: Math.round((Date.now() - startedAt.current) / 1000),
          plan,
          limited: limit?.limited ?? null,
        });
        setPhase({ kind: "done", id: outcome.id, expiresAt: outcome.expiresAt, leftOut: outcome.leftOut.length });
        onExistingChange();
      })
      .catch((e) => {
        if (!current() || controller.signal.aborted) return;
        if (e instanceof ScoutingReportError && e.code === "report_limit_reached") {
          trackEvent("scouting_report_limit_reached", { source: "publish" });
          if (e.blockedBy) {
            setPhase({ kind: "limit", blockedBy: e.blockedBy });
            return;
          }
          // The database didn't name the other report: ask again, and fail only if there is none to name.
          void readLimit().then((l) => {
            if (!current()) return;
            if (l?.blockedBy) setPhase({ kind: "limit", blockedBy: l.blockedBy });
            else {
              trackEvent("scouting_report_failed", { stage: "publish", error: e.code });
              setPhase({ kind: "error", message: errorMessage(e) });
            }
          });
          return;
        }
        // A database from before the one-report limit asks for an upgrade outright.
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
      trackEvent("scouting_report_revoked", { via: "sheet" });
      toast("Report is no longer shared");
      onExistingChange();
      close();
    } catch {
      toast.error("Couldn’t stop sharing. Try again.");
      setPhase({ kind: "error", message: "Couldn’t stop sharing. Try again." });
    }
  }

  /** Stops the report that is in the way, then goes back to the review (or the limit, if something else still blocks). */
  async function stopOther(blocked: LiveReportRef) {
    try {
      await revokeScoutingReport(blocked.id);
    } catch {
      toast.error("Couldn’t stop sharing. Try again.");
      setPhase({ kind: "limit", blockedBy: blocked });
      return;
    }
    trackEvent("scouting_report_revoked", { via: "limit" });
    onOtherReportStopped(blocked.playlistId);
    toast(`“${blocked.title}” is no longer shared`);
    toReview(await readLimit());
  }

  const { empty } = summary;
  const working = phase.kind === "working";
  const stale = isLive(existing) && existing.contentKey !== contentKey;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            Scouting report
          </DialogTitle>
          <DialogDescription>
            {phase.kind === "done" || phase.kind === "confirm-stop"
              ? `Scan the code or copy the link. ${worksUntil(phase.expiresAt)}`
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
                <p className="text-sm text-foreground nums">
                  {summary.players} {summary.players === 1 ? "player" : "players"} · {summary.clips} {summary.clips === 1 ? "clip" : "clips"}
                </p>
                {empty > 0 && (
                  <p className="text-callout text-muted-foreground">
                    {empty} {empty === 1 ? "player has" : "players have"} no note or clips.
                  </p>
                )}
                <p className="text-callout text-muted-foreground">Anyone with the link can view it for 30 days.</p>
                {limit?.limited && !limit.blockedBy && (
                  <p className="text-callout text-muted-foreground">
                    1 shared report included.{" "}
                    <Button
                      variant="link"
                      className="inline h-auto p-0 align-baseline text-callout font-medium"
                      onClick={() => {
                        onUpgrade();
                        close();
                      }}
                    >
                      Go Pro
                    </Button>{" "}
                    to share as many as you like.
                  </p>
                )}
              </motion.div>
            )}

            {phase.kind === "limit" && (
              <motion.div key="limit" variants={fadeVariants} initial="hidden" animate="visible" exit="exit" role="alert" className="flex flex-col gap-1.5 rounded-window bg-warning/12 px-3 py-3">
                <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">
                  Your plan shares one report at a time. “{phase.blockedBy.title}” is shared until {formatCardDate(phase.blockedBy.expiresAt)}.
                </p>
                <p className="text-callout text-muted-foreground">Stop sharing it to share this one, or go Pro to share as many as you like.</p>
              </motion.div>
            )}

            {phase.kind === "confirm-stop-other" && (
              <motion.div
                key="confirm-stop-other"
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                role="alertdialog"
                aria-label={`Stop sharing “${phase.blockedBy.title}”?`}
                className="flex flex-col items-center gap-3 rounded-window bg-fill-1 px-4 py-3 text-center"
              >
                <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">Stop sharing “{phase.blockedBy.title}”?</p>
                <p className="text-callout text-muted-foreground">Its link stops working right away.</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPhase({ kind: "limit", blockedBy: phase.blockedBy })}>
                    Keep sharing
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void stopOther(phase.blockedBy)}>
                    Stop sharing
                  </Button>
                </div>
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
                          {existing?.id === phase.id && <p className="text-callout text-muted-foreground nums">{openedLabel(existing.opens)}</p>}
                          <div className="flex flex-wrap items-center justify-center gap-2">
                            <Button ref={copyRef} variant="outline" size="sm" onClick={() => copy(url)}>
                              {copied ? <Check /> : <Copy />}
                              {copied ? "Copied" : "Copy link"}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => void openUrl(`${url}${APP_OPEN_HASH}`)}>
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
                            <Button variant="ghost" size="sm" onClick={() => toReview()}>
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

        {/* The stop confirmation carries its own two buttons: no footer under it. */}
        <DialogFooter className={phase.kind === "confirm-stop-other" ? "hidden" : undefined}>
          {phase.kind === "review" && (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => generate(false)} disabled={summary.players === 0 && summary.clips === 0} title={summary.players === 0 && summary.clips === 0 ? "Add a player or a clip first" : undefined}>
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
              <Button onClick={() => toReview()}>Try again</Button>
            </>
          )}
          {phase.kind === "limit" && (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => setPhase({ kind: "confirm-stop-other", blockedBy: phase.blockedBy })}>
                Stop sharing it
              </Button>
              <Button
                onClick={() => {
                  onUpgrade();
                  close();
                }}
              >
                Go Pro
              </Button>
            </>
          )}
          {(phase.kind === "done" || phase.kind === "confirm-stop") && (
            <>
              <Button
                variant="ghost"
                className="mr-auto"
                onClick={() => {
                  close();
                  navigate("/reports");
                }}
              >
                See all reports
              </Button>
              <Button onClick={close}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
